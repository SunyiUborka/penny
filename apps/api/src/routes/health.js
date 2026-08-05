/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default function healthRoutes(fastify) {
  fastify.get('/health', () => {
    return { status: 'ok' };
  });
}
