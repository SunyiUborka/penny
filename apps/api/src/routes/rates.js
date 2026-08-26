import { z } from 'zod';
import { currencyCodeSchema, dateOnlyStringSchema, rateResponseSchema } from '@filler/shared';
import * as rateService from '../services/rateService.js';

const rateQuerySchema = z.object({
  from: currencyCodeSchema,
  to: currencyCodeSchema,
  date: dateOnlyStringSchema.optional(),
});

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default function ratesRoutes(fastify) {
  fastify.get(
    '/',
    { schema: { querystring: rateQuerySchema, response: { 200: rateResponseSchema } } },
    (request) => {
      const { from, to, date } = request.query;
      return rateService.getRate({ baseUrl: fastify.env.FRANKFURTER_URL, from, to, date });
    },
  );
}
