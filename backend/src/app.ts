import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import { healthRoutes } from './routes/health.js';
import { projectRoutes } from './routes/projects.js';
import type { ProjectServices } from './routes/projects.js';
import { GenerationManager } from './generation/manager.js';

export function buildApp(options: FastifyServerOptions = {}, services?: ProjectServices) {
  const app = Fastify({
    ...options,
    logger: options.logger === false ? false : {
      ...(typeof options.logger === 'object' ? options.logger : {}),
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      serializers: {
        req: (request: { method: string }) => ({ method: request.method }),
        res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
      },
    },
  });

  app.register(healthRoutes, { prefix: '/api' });
  app.setNotFoundHandler((request, reply) => reply.header('Cache-Control', 'no-store').code(404)
    .send({ error: { code: 'NOT_FOUND', message: 'Resource not found.' }, requestId: request.id }));
  if (services) {
    if (options.trustProxy) throw new Error('Project routes require trustProxy=false');
    const manager = new GenerationManager(services.store, services.generation);
    const lost = () => manager.revokeOwnership();
    services.ownershipSignal?.addEventListener('abort', lost, { once: true });
    if (services.ownershipSignal?.aborted) lost();
    app.register(projectRoutes, { ...services, manager, prefix: '/api' });
    app.addHook('preClose', async () => { await manager.shutdown(); });
    app.addHook('onClose', async () => {
      services.ownershipSignal?.removeEventListener('abort', lost);
      try { services.store.close(); } finally { await services.releaseOwnership?.(); }
    });
  }

  return app;
}
