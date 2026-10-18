import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { generationBodySchema, generationParamsSchema, generationStatusSchema } from '../contracts/generations.js';
import { errorSchema, projectParamsSchema, sessionRequestSchema } from '../contracts/projects.js';
import type { GenerationManager } from '../generation/manager.js';
import { ProjectError } from '../projects/errors.js';

export function generationRoutes(app: FastifyInstance, manager: GenerationManager, owner: (cookies: Record<string, string | undefined>) => string) {
  const errors = { '4xx': errorSchema, '5xx': errorSchema };
  const statusResponse = { 200: generationStatusSchema, 202: generationStatusSchema, ...errors };
  app.post<{ Params: z.infer<typeof projectParamsSchema>; Body: z.infer<typeof generationBodySchema> }>('/projects/:projectId/generations', {
    bodyLimit: 32 * 1024,
    config: { rateLimit: { max: manager.options.limits?.postPerMinute ?? 6, timeWindow: 60_000 } },
    schema: { params: projectParamsSchema, body: generationBodySchema, querystring: sessionRequestSchema,
      response: { 202: generationStatusSchema, ...errors } },
  }, (request, reply) => {
    const ownerId = owner(request.cookies);
    // Require the explicit media type, with a nonzero quality; */* is insufficient.
    if (!request.headers.accept?.split(',').some(part => {
      const [type, ...parameters] = part.trim().toLowerCase().split(';');
      return type?.trim() === 'text/event-stream' && !parameters.some(parameter => /^q\s*=\s*0(?:\.0*)?$/.test(parameter.trim()));
    })) throw new ProjectError('ACCEPT_REQUIRED');
    const accepted = manager.accept({ ...request.body, projectId: request.params.projectId, sessionId: ownerId });
    if (!accepted.fresh) {
      // 200 also carries a stream on the fresh branch, so validate this JSON branch explicitly.
      return reply.type('application/json').code(accepted.state.status === 'running' ? 202 : 200)
        .send(generationStatusSchema.parse(accepted.state));
    }
    reply.headers({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' });
    accepted.stream.bind(reply.raw);
    reply.send(accepted.stream.readable);
    // The stream is now owned by Fastify. accepted is pushed before any model work.
    accepted.start();
    return reply;
  });
  app.get<{ Params: z.infer<typeof generationParamsSchema> }>('/projects/:projectId/generations/by-request/:requestId', {
    config: { rateLimit: { max: manager.options.limits?.queryPerMinute ?? 120, timeWindow: 60_000 } },
    schema: { params: generationParamsSchema, querystring: sessionRequestSchema, response: { 200: generationStatusSchema, ...errors } },
  }, request => manager.status(owner(request.cookies), request.params.projectId, request.params.requestId));
  app.post<{ Params: z.infer<typeof generationParamsSchema> }>('/projects/:projectId/generations/by-request/:requestId/cancel', {
    bodyLimit: 32 * 1024,
    config: { rateLimit: { max: manager.options.limits?.cancelPerMinute ?? 120, timeWindow: 60_000 } },
    schema: { params: generationParamsSchema, querystring: sessionRequestSchema, body: sessionRequestSchema, response: statusResponse },
  }, (request, reply) => {
    const state = manager.cancel(owner(request.cookies), request.params.projectId, request.params.requestId);
    return reply.code(state.status === 'running' ? 202 : 200).send(state);
  });
}
