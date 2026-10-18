import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import { healthRoutes } from './routes/health.js';

export function buildApp(options: FastifyServerOptions = {}) {
  const app = Fastify({
    logger: {
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    ...options,
  });

  app.register(healthRoutes, { prefix: '/api' });

  return app;
}
