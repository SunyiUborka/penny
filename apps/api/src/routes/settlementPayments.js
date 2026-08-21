import { settlementPaymentResponseSchema, updateSettlementPaymentBodySchema } from '@filler/shared';
import * as settlementPaymentService from '../services/settlementPaymentService.js';
import { idParamsSchema } from '../schemas/params.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default function settlementPaymentsRoutes(fastify) {
  fastify.patch(
    '/:id',
    {
      schema: {
        params: idParamsSchema,
        body: updateSettlementPaymentBodySchema,
        response: { 200: settlementPaymentResponseSchema },
      },
    },
    (request) => {
      return settlementPaymentService.updatePayment(request.params.id, request.body);
    },
  );

  fastify.delete('/:id', { schema: { params: idParamsSchema } }, async (request, reply) => {
    await settlementPaymentService.deletePayment(request.params.id);
    return reply.status(204).send();
  });
}
