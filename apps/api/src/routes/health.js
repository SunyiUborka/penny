import { healthResponseSchema } from '@filler/shared';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default function healthRoutes(fastify) {
  fastify.get('/health', { schema: { response: { 200: healthResponseSchema } } }, () => {
    return { status: 'ok' };
  });
}
