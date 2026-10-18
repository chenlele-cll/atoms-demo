import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { adoptRequestSchema, adoptResponseSchema, errorSchema, versionParamsSchema, versionReviewSchema } from '@atoms/contracts';
import { sessionRequestSchema } from '../contracts/projects.js';
import type { ProjectStore } from '../storage/store.js';
import type { GenerationManager } from '../generation/manager.js';

export function versionRoutes(app: FastifyInstance, store: ProjectStore, manager: GenerationManager,
  owner: (cookies: Record<string, string | undefined>) => string, now?: () => number) {
  const errors = { '4xx': errorSchema, '5xx': errorSchema };
  app.get<{ Params: z.infer<typeof versionParamsSchema> }>('/projects/:projectId/versions/:versionId', {
    config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    schema: { params: versionParamsSchema, querystring: sessionRequestSchema, response: { 200: versionReviewSchema, ...errors } },
  }, request => store.versionReview(owner(request.cookies), request.params.projectId, request.params.versionId, () => manager.projectActivity(request.params.projectId)));
  app.post<{ Params: z.infer<typeof versionParamsSchema>; Body: z.infer<typeof adoptRequestSchema> }>('/projects/:projectId/versions/:versionId/adopt', {
    bodyLimit: 1024, config: { rateLimit: { max: 10, timeWindow: 60_000 } },
    schema: { params: versionParamsSchema, querystring: sessionRequestSchema, body: adoptRequestSchema, response: { 200: adoptResponseSchema, ...errors } },
  }, request => store.adoptVersion(owner(request.cookies), request.params.projectId, request.params.versionId, request.body.expectedCurrentVersionId,
    () => manager.projectActivity(request.params.projectId), now));
}
