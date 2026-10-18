import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errorSchema, listQuerySchema, messagePageSchema, messageQuerySchema, projectDetailSchema, projectListSchema,
  projectParamsSchema, projectRequestSchema, sessionRequestSchema, sessionResponseSchema, templateListSchema } from '../contracts/projects.js';
import { ProjectError } from '../projects/errors.js';
import { SESSION_LIFETIME_MS } from '../storage/store.js';
import type { ProjectStore } from '../storage/store.js';
import type { TemplateCatalog } from '../templates/catalog.js';
import type { GenerationOptions, GenerationManager } from '../generation/manager.js';
import { generationRoutes } from './generations.js';
import { versionRoutes } from './versions.js';

export type ProjectServices = {
  store: ProjectStore;
  catalog: TemplateCatalog;
  origins: readonly string[];
  secureCookies: boolean;
  now?: () => number;
  limits?: { sessionPerMinute?: number; projectsPerMinute?: number; projectsPerSession?: number };
  generation?: GenerationOptions;
  releaseOwnership?: () => Promise<void>;
  ownershipSignal?: AbortSignal;
};
const errors = { '4xx': errorSchema, '5xx': errorSchema };
export async function projectRoutes(app: FastifyInstance, services: ProjectServices & { manager: GenerationManager }) {
  const { store, catalog } = services;
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.setValidatorCompiler<z.ZodType>(({ schema }) => value => {
    const result = schema.safeParse(value);
    return result.success ? { value: result.data } : { error: new ProjectError('INVALID_INPUT') };
  });
  app.setSerializerCompiler<z.ZodType>(({ schema }) => data => {
    const result = schema.safeParse(data);
    if (!result.success) throw new ProjectError('INTERNAL_ERROR');
    return JSON.stringify(result.data);
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.method === 'POST') {
      if (!request.headers.origin || !services.origins.includes(request.headers.origin)) throw new ProjectError('ORIGIN_NOT_ALLOWED');
      if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new ProjectError('JSON_REQUIRED');
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const parsedStatus = z.object({ statusCode: z.number() }).safeParse(error);
    const status = parsedStatus.success ? parsedStatus.data.statusCode : null;
    const safe = error instanceof ProjectError ? error : new ProjectError(
      status === 429 ? 'RATE_LIMITED' : status === 413 ? 'BODY_TOO_LARGE' :
        status === 415 ? 'JSON_REQUIRED' : status === 400 ? 'INVALID_INPUT' : 'INTERNAL_ERROR');
    if (safe.status >= 500) request.log.error({ err: { name: 'ProjectError', message: safe.message, code: safe.code } }, 'Project request failed');
    if (safe.retryAfter) reply.header('Retry-After', safe.retryAfter);
    return reply.code(safe.status).send({ error: { code: safe.code, message: safe.message }, requestId: request.id });
  });
  const owner = (cookies: Record<string, string | undefined>) => {
    const session = store.findSession(cookies['atoms_session'], services.now?.());
    if (!session) throw new ProjectError('SESSION_REQUIRED');
    return session.id;
  };
  generationRoutes(app, services.manager, owner);
  versionRoutes(app, store, services.manager, owner, services.now);

  app.post('/session', {
    bodyLimit: 8192,
    config: { rateLimit: { max: services.limits?.sessionPerMinute ?? 30, timeWindow: 60_000 } },
    schema: { body: sessionRequestSchema, querystring: sessionRequestSchema, response: { 200: sessionResponseSchema, 201: sessionResponseSchema, ...errors } },
  }, async (request, reply) => {
    const existing = store.findSession(request.cookies['atoms_session'], services.now?.());
    if (existing) return { expiresAt: new Date(existing.expiresAt).toISOString() };
    const session = store.createSession(services.now?.());
    reply.setCookie('atoms_session', session.token, {
      path: '/api', httpOnly: true, sameSite: 'strict', secure: services.secureCookies,
      maxAge: SESSION_LIFETIME_MS / 1000,
    });
    return reply.code(201).send({ expiresAt: new Date(session.expiresAt).toISOString() });
  });
  app.get('/templates', { schema: { querystring: sessionRequestSchema, response: { 200: templateListSchema, ...errors } } }, async () => catalog.list());
  app.post<{ Body: z.infer<typeof projectRequestSchema> }>('/projects', {
    bodyLimit: 8192,
    config: { rateLimit: { max: services.limits?.projectsPerMinute ?? 10, timeWindow: 60_000 } },
    schema: { body: projectRequestSchema, querystring: sessionRequestSchema, response: { 201: projectDetailSchema, ...errors } },
  }, async (request, reply) => {
    const ownerId = owner(request.cookies);
    const body = request.body;
    const bundle = catalog.resolve(body.templateId, body.templateVersion, body.templateDigest);
    return reply.code(201).send(store.createProject(ownerId, body.title, bundle, services.limits?.projectsPerSession ?? 20));
  });
  app.get<{ Querystring: z.infer<typeof listQuerySchema> }>('/projects', {
    schema: { querystring: listQuerySchema, response: { 200: projectListSchema, ...errors } },
  }, async request => store.listProjects(owner(request.cookies), request.query.limit, request.query.cursor));
  app.get<{ Params: z.infer<typeof projectParamsSchema> }>('/projects/:projectId', {
    schema: { params: projectParamsSchema, querystring: sessionRequestSchema, response: { 200: projectDetailSchema, ...errors } },
  }, async request => store.getProject(owner(request.cookies), request.params.projectId));
  app.get<{ Params: z.infer<typeof projectParamsSchema>; Querystring: z.infer<typeof messageQuerySchema> }>('/projects/:projectId/messages', {
    schema: { params: projectParamsSchema, querystring: messageQuerySchema, response: { 200: messagePageSchema, ...errors } },
  }, async request => 'direction' in request.query
    ? store.latestMessages(owner(request.cookies), request.params.projectId, request.query.limit, request.query.beforeSequence)
    : store.listMessages(owner(request.cookies), request.params.projectId, request.query.afterSequence, request.query.limit));
}
