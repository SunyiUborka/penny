import { z } from 'zod';
import { currencyCodeSchema, rateResponseSchema } from '@filler/shared';
import * as rateService from '../services/rateService.js';

const rateQuerySchema = z.object({
  from: currencyCodeSchema,
  to: currencyCodeSchema,
});

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default function ratesRoutes(fastify) {
  fastify.get(
    '/',
    { schema: { querystring: rateQuerySchema, response: { 200: rateResponseSchema } } },
    (request) => {
      const { from, to } = request.query;
      return rateService.getRate({ baseUrl: fastify.env.FRANKFURTER_URL, from, to });
    },
  );
}
