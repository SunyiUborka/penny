import { expenseResponseSchema, updateExpenseBodySchema } from '@filler/shared';
import * as expenseService from '../services/expenseService.js';
import { idParamsSchema } from '../schemas/params.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default function expensesRoutes(fastify) {
  fastify.patch(
    '/:id',
    {
      schema: {
        params: idParamsSchema,
        body: updateExpenseBodySchema,
        response: { 200: expenseResponseSchema },
      },
    },
    (request) => {
      return expenseService.updateExpense(request.params.id, request.body);
    },
  );

  fastify.delete('/:id', { schema: { params: idParamsSchema } }, async (request, reply) => {
    await expenseService.deleteExpense(request.params.id);
    return reply.status(204).send();
  });
}
