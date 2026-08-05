import { z } from 'zod';

/**
 * A getgeoapi.com /currency/convert válaszának alakja. Külső rendszer —
 * sosem bízunk vakon benne, Zod-dal parse-oljuk.
 */
export const geoApiConvertResponseSchema = z.object({
  status: z.string(),
  updated_date: z.string().optional(),
  rates: z.record(z.string(), z.object({ rate: z.string() })),
});
