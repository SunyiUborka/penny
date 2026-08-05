import { z } from 'zod';
import { exchangeRateStringSchema } from './money.js';

export const rateSourceSchema = z.enum(['api', 'cache', 'manual']);

export const rateResponseSchema = z.object({
  rate: exchangeRateStringSchema,
  // z.coerce.date(): a backend valódi Date instance-t ad, a frontend a
  // fetch().json() után ISO stringet kap — ugyanaz a séma validál mindkettőn.
  fetchedAt: z.coerce.date(),
  source: rateSourceSchema,
});
