import mongoose from 'mongoose';
import fp from 'fastify-plugin';

/**
 * Csatlakozik a MongoDB-hez mongoose-szal, és a fastify instance-hoz köti a
 * lezárását graceful shutdownkor.
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ mongoUrl: string }} opts
 */
async function mongoPlugin(fastify, opts) {
  await mongoose.connect(opts.mongoUrl);
  fastify.log.info('MongoDB kapcsolat létrejött');

  fastify.addHook('onClose', async () => {
    await mongoose.disconnect();
  });
}

export default fp(mongoPlugin, { name: 'mongo' });
