import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'service'],
          properties: {
            status: { type: 'string', const: 'ok' },
            service: { type: 'string', const: 'atoms-backend' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    return reply.header('Cache-Control', 'no-store').send({
      status: 'ok',
      service: 'atoms-backend',
    });
  });
}
