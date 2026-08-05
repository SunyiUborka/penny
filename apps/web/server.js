import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyProxy from '@fastify/http-proxy';
import path from 'node:path';

/**
 * Produkciós frontend szerver: kiszolgálja a buildelt Vue SPA-t (dist/), és
 * a /api útvonalat a backendre proxyzza. Nincs nginx — egy Caddy reverse
 * proxy áll elébe (lásd compose.yaml web service labeljei), ami TLS-t és a
 * domain-routingot adja.
 */
const PORT = Number(process.env.PORT) || 8080;
const API_URL = process.env.API_URL || 'http://api:3000';

// trustProxy: true — így ha egy reverse proxy (pl. Caddy) áll elénk, az ő
// X-Forwarded-Proto headerét vesszük figyelembe (lásd lent), nem a saját
// (mindig plain HTTP) kapcsolatunk protokollját.
const app = Fastify({ logger: true, trustProxy: true });

app.get('/healthz', () => 'ok');

// http-proxy stream-eli a választ és a kéréstörzset is, így a cookie-alapú
// auth és a Zod-validált JSON body-k változatlanul mennek át a backendhez.
// A rewriteRequestHeaders a TÉNYLEGES (Caddy mögötti) protokollt adja tovább
// a backendnek X-Forwarded-Proto-ként — @fastify/http-proxy ezt nem teszi meg
// automatikusan, pedig a backend session cookie-jának Secure jelzője ezen az
// alapon dől el (lásd apps/api/src/routes/auth.js).
await app.register(fastifyProxy, {
  upstream: API_URL,
  prefix: '/api',
  rewritePrefix: '/api',
  replyOptions: {
    rewriteRequestHeaders: (originalReq, headers) => ({
      ...headers,
      'x-forwarded-proto': originalReq.protocol,
    }),
  },
});

await app.register(fastifyStatic, { root: path.join(import.meta.dirname, 'dist') });

// SPA fallback: minden nem talált, nem proxyzott útvonal az index.html-t adja
// vissza, hogy a vue-router history módja frissítésnél/közvetlen linkeknél
// is feloldódjon.
app.setNotFoundHandler((_request, reply) => {
  reply.sendFile('index.html');
});

try {
  await app.listen({ host: '0.0.0.0', port: PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
