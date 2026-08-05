import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { buildLoggerOptions } from './config/logger.js';
import mongoPlugin from './plugins/mongo.js';
import errorHandlerPlugin from './plugins/errorHandler.js';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import peopleRoutes from './routes/people.js';
import eventsRoutes from './routes/events.js';
import expensesRoutes from './routes/expenses.js';
import ratesRoutes from './routes/rates.js';
import { requireAuth } from './middleware/requireAuth.js';
import { initPasswordHash } from './services/authService.js';

/**
 * Felépíti a Fastify app instance-t regisztrált plugin-okkal és route-okkal,
 * anélkül hogy elindítaná a szervert. Tesztekben is ez hívható.
 * @param {import('./config/env.js').Env} env
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function buildApp(env) {
  const app = Fastify({
    logger: buildLoggerOptions(env.NODE_ENV),
    genReqId: () => randomUUID(),
    trustProxy: true,
  });

  app.decorate('env', env);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await initPasswordHash(env.APP_PASSWORD);

  await app.register(errorHandlerPlugin);
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(cors, { origin: false, credentials: true });
  await app.register(rateLimit, { global: false });

  await app.register(mongoPlugin, { mongoUrl: env.MONGO_URL });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/auth' });

  await app.register(
    async (protectedApi) => {
      protectedApi.addHook('onRequest', requireAuth);
      await protectedApi.register(peopleRoutes, { prefix: '/people' });
      await protectedApi.register(eventsRoutes, { prefix: '/events' });
      await protectedApi.register(expensesRoutes, { prefix: '/expenses' });
      await protectedApi.register(ratesRoutes, { prefix: '/rates' });
    },
    { prefix: '/api' },
  );

  return app;
}
