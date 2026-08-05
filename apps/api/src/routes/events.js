import {
  createEventBodySchema,
  createExpenseBodySchema,
  eventListResponseSchema,
  eventResponseSchema,
  expenseListResponseSchema,
  expenseResponseSchema,
  settlementResponseSchema,
  updateEventBodySchema,
} from '@filler/shared';
import * as eventService from '../services/eventService.js';
import * as expenseService from '../services/expenseService.js';
import * as settlementService from '../services/settlementService.js';
import { idParamsSchema } from '../schemas/params.js';

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

  fastify.get(
    '/:id/settlement',
    { schema: { params: idParamsSchema, response: { 200: settlementResponseSchema } } },
    (request) => {
      return settlementService.getSettlement(request.params.id);
    },
  );
}
