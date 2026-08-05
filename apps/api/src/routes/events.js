import {
  createEventBodySchema,
  createExpenseBodySchema,
  eventListResponseSchema,
  eventResponseSchema,
  expenseListResponseSchema,
  expenseResponseSchema,
  expenseStreamMessageSchema,
  settlementResponseSchema,
  updateEventBodySchema,
} from '@filler/shared';
import * as eventService from '../services/eventService.js';
import * as expenseService from '../services/expenseService.js';
import * as settlementService from '../services/settlementService.js';
import { subscribeToExpenseChanges } from '../services/eventBus.js';
import { idParamsSchema } from '../schemas/params.js';

/** Heartbeat-ütem: a web/server.js proxyja a néma streamet elvágná. */
const HEARTBEAT_MS = 20_000;

/** Az újrakapcsolódási ütem, amit a klienssel közlünk (böngésző alap: ~3 mp). */
const RETRY_MS = 5000;

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default function eventsRoutes(fastify) {
  fastify.get('/', { schema: { response: { 200: eventListResponseSchema } } }, () => {
    return eventService.listEvents();
  });

  fastify.post(
    '/',
    { schema: { body: createEventBodySchema, response: { 201: eventResponseSchema } } },
    async (request, reply) => {
      const event = await eventService.createEvent(request.body);
      return reply.status(201).send(event);
    },
  );

  fastify.get(
    '/:id',
    { schema: { params: idParamsSchema, response: { 200: eventResponseSchema } } },
    (request) => {
      return eventService.getEvent(request.params.id);
    },
  );

  fastify.patch(
    '/:id',
    {
      schema: {
        params: idParamsSchema,
        body: updateEventBodySchema,
        response: { 200: eventResponseSchema },
      },
    },
    (request) => {
      return eventService.updateEvent(request.params.id, request.body);
    },
  );

  fastify.delete('/:id', { schema: { params: idParamsSchema } }, async (request, reply) => {
    await eventService.deleteEvent(request.params.id);
    return reply.status(204).send();
  });

  fastify.get(
    '/:id/expenses',
    { schema: { params: idParamsSchema, response: { 200: expenseListResponseSchema } } },
    (request) => {
      return expenseService.listExpensesForEvent(request.params.id);
    },
  );

  fastify.post(
    '/:id/expenses',
    {
      schema: {
        params: idParamsSchema,
        body: createExpenseBodySchema,
        response: { 201: expenseResponseSchema },
      },
    },
    async (request, reply) => {
      const expense = await expenseService.createExpense(request.params.id, request.body);
      return reply.status(201).send(expense);
    },
  );

  /**
   * Élő kiadás-frissítés Server-Sent Events-szel. Egyirányú (szerver →
   * kliens), sima HTTP-n, ezért a böngésző EventSource-a magától
   * újrakapcsolódik, és a session cookie same-origin kérésként átmegy — a
   * hitelesítést a védett /api prefix requireAuth hookja adja.
   *
   * Nincs `response` séma: a választ hijackoljuk, tehát Fastify nem
   * szerializálja. Az egyes üzenetek validálása a `send`-ben történik.
   */
  fastify.get('/:id/stream', { schema: { params: idParamsSchema } }, async (request, reply) => {
    // A hijack ELŐTT: nemlétező eseményre rendes 404-es hibaválasz menjen,
    // ne egy üres, örökké nyitva maradó event-stream.
    await eventService.getEvent(request.params.id);

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Ha egyszer bufferelő reverse proxy kerül elénk: SSE-nél a válasz
      // pufferelése teljesen megfogja a streamet.
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`retry: ${RETRY_MS}\n\n`);

    /**
     * @param {object} message
     */
    const send = (message) => {
      try {
        const payload = JSON.stringify(expenseStreamMessageSchema.parse(message));
        reply.raw.write(`data: ${payload}\n\n`);
      } catch (error) {
        // A publish szinkron emit: egy megszakadt kliens-kapcsolat írási hibája
        // enélkül visszabukna arra a kérésre, ami a mutációt végezte, és
        // elbuktatná valaki más mentését.
        request.log.warn({ err: error }, 'SSE üzenet kiírása nem sikerült');
      }
    };

    const unsubscribe = subscribeToExpenseChanges(request.params.id, send);
    const heartbeat = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, HEARTBEAT_MS);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  fastify.get(
    '/:id/settlement',
    { schema: { params: idParamsSchema, response: { 200: settlementResponseSchema } } },
    (request) => {
      return settlementService.getSettlement(request.params.id);
    },
  );
}
