import {
  categoryListResponseSchema,
  categoryResponseSchema,
  createCategoryBodySchema,
  createEventBodySchema,
  createExpenseBodySchema,
  createSettlementPaymentBodySchema,
  eventListResponseSchema,
  eventResponseSchema,
  eventStreamMessageSchema,
  expenseListResponseSchema,
  expenseResponseSchema,
  settlementPaymentListResponseSchema,
  settlementPaymentResponseSchema,
  settlementResponseSchema,
  updateEventBodySchema,
} from '@filler/shared';
import * as categoryService from '../services/categoryService.js';
import * as eventService from '../services/eventService.js';
import * as expenseService from '../services/expenseService.js';
import * as settlementService from '../services/settlementService.js';
import * as settlementPaymentService from '../services/settlementPaymentService.js';
import { subscribeToEventChanges } from '../services/eventBus.js';
import { idParamsSchema } from '../schemas/params.js';
import { corsHeadersFor } from '../config/cors.js';

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
    '/:id/categories',
    { schema: { params: idParamsSchema, response: { 200: categoryListResponseSchema } } },
    (request) => {
      return categoryService.listCategoriesForEvent(request.params.id);
    },
  );

  fastify.post(
    '/:id/categories',
    {
      schema: {
        params: idParamsSchema,
        body: createCategoryBodySchema,
        response: { 201: categoryResponseSchema },
      },
    },
    async (request, reply) => {
      const category = await categoryService.createCategory(request.params.id, request.body);
      return reply.status(201).send(category);
    },
  );

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

  fastify.get(
    '/:id/settlement-payments',
    { schema: { params: idParamsSchema, response: { 200: settlementPaymentListResponseSchema } } },
    (request) => {
      return settlementPaymentService.listPaymentsForEvent(request.params.id);
    },
  );

  fastify.post(
    '/:id/settlement-payments',
    {
      schema: {
        params: idParamsSchema,
        body: createSettlementPaymentBodySchema,
        response: { 201: settlementPaymentResponseSchema },
      },
    },
    async (request, reply) => {
      const payment = await settlementPaymentService.createPayment(request.params.id, request.body);
      return reply.status(201).send(payment);
    },
  );

  /**
   * Élő frissítés Server-Sent Events-szel: kiadás- és kiegyenlítés-üzenetek
   * ugyanezen az egy, eseményenkénti csatornán. Egyirányú (szerver →
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

    const headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Ha egyszer bufferelő reverse proxy kerül elénk: SSE-nél a válasz
      // pufferelése teljesen megfogja a streamet.
      'X-Accel-Buffering': 'no',
      // A @fastify/cors a fejléceket reply.header(...)-rel csak "eltárolja" —
      // azok a normál send()/onSend folyamatban kerülnek ki a socketre. A
      // hijack() pontosan ezt a folyamatot kerüli meg, tehát a plugin által
      // beállított Access-Control-Allow-Origin sosem jutna ki innen: a natív
      // app kérése cross-origin (a WebView origója https://localhost, az API
      // egy távoli abszolút URL), a válasz fejléc nélkül a WebView elutasítja.
      // Ezért itt KÉZZEL pótoljuk, amit a plugin tenne — a döntést (mely
      // origin engedélyezett, milyen fejlécekkel) a `corsHeadersFor()` hozza
      // meg, ugyanabból a listából, amit az app.js plugin-regisztrációja is
      // használ, hogy a két hely ne tudjon szétcsúszni.
      ...corsHeadersFor(request.headers.origin),
    };

    reply.hijack();
    reply.raw.writeHead(200, headers);
    reply.raw.write(`retry: ${RETRY_MS}\n\n`);

    /**
     * @param {object} message
     */
    const send = (message) => {
      try {
        const payload = JSON.stringify(eventStreamMessageSchema.parse(message));
        reply.raw.write(`data: ${payload}\n\n`);
      } catch (error) {
        // A publish szinkron emit: egy megszakadt kliens-kapcsolat írási hibája
        // enélkül visszabukna arra a kérésre, ami a mutációt végezte, és
        // elbuktatná valaki más mentését.
        request.log.warn({ err: error }, 'SSE üzenet kiírása nem sikerült');
      }
    };

    const unsubscribe = subscribeToEventChanges(request.params.id, send);
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
