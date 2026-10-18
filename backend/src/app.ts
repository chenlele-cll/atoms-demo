import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import { healthRoutes } from './routes/health.js';
import { projectRoutes } from './routes/projects.js';
import type { ProjectServices } from './routes/projects.js';

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
    app.register(projectRoutes, { ...services, prefix: '/api' });
    app.addHook('onClose', async () => { services.store.close(); });
  }

  return app;
}
