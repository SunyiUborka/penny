import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { buildLoggerOptions } from './config/logger.js';
import { NATIVE_APP_ORIGINS } from './config/cors.js';
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
import { AppError } from './errors.js';

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

  // Az Android natív HTTP-rétege (HttpURLConnection, amin a Capacitor app
  // nem-GET kérései mennek) a törzs nélküli kérésekre is ráteszi a saját
  // alapértelmezett `application/x-www-form-urlencoded` Content-Type-ját. Ez a
  // JS-réteg alatt történik, tehát a kliensünk nem tudja megakadályozni —
  // enélkül a Fastify az app MINDEN DELETE kérését 415-tel utasítja el
  // („Unsupported Media Type”), és a törlés némán nem működik a telefonon.
  //
  // Csak az ÜRES törzset fogadjuk el ezzel a típussal: egy valódi urlencoded
  // törzs továbbra is elutasított, mert az API kizárólag JSON-t vesz.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      if (body === '') {
        done(null, undefined);
        return;
      }
      done(new AppError('UNSUPPORTED_MEDIA_TYPE', 'Az API kizárólag JSON törzset fogad.', 415));
    },
  );

  await initPasswordHash(env.APP_PASSWORD);

  await app.register(errorHandlerPlugin);
  await app.register(cookie, { secret: env.SESSION_SECRET });
  // `origin: false` helyett szűk lista: a böngészős kérések same-origin
  // mennek (nekik nem kell CORS), a natív app streamje viszont a WebView
  // origójáról érkezik. A hitelesítés ott fejléces tokennel történik, nem
  // cookie-val — a natív kérés nem küld `credentials` opciót, tehát nincs
  // szükség `Access-Control-Allow-Credentials`-re, és nem is adunk ilyet.
  await app.register(cors, { origin: NATIVE_APP_ORIGINS });
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
