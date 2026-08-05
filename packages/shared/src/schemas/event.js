import { z } from 'zod';
import { amountMinorSchema, currencyCodeSchema, personIdSchema } from './money.js';
import { dateOnlyStringSchema } from './date.js';
import { SETTLEMENT_CURRENCY } from '../currency/exponents.js';

const uniqueParticipantIdsSchema = z
  .array(personIdSchema)
  .min(2, 'Legalább 2 résztvevő szükséges.')
  .refine(
    (ids) => new Set(ids).size === ids.length,
    'A résztvevők nem szerepelhetnek duplikáltan.',
  );

export const createEventBodySchema = z.object({
  name: z.string().trim().min(1, 'A név nem lehet üres.'),
  participantIds: uniqueParticipantIdsSchema,
  // Csak azt határozza meg, milyen pénznem legyen előre kijelölve egy új
  // kiadás felvételekor — az elszámolás mindig forintban történik,
  // ettől függetlenül (lásd SETTLEMENT_CURRENCY).
  defaultCurrency: currencyCodeSchema.default(SETTLEMENT_CURRENCY),
  startDate: dateOnlyStringSchema.nullable().optional(),
  endDate: dateOnlyStringSchema.nullable().optional(),
});

export const updateEventBodySchema = z.object({
  name: z.string().trim().min(1, 'A név nem lehet üres.').optional(),
  participantIds: uniqueParticipantIdsSchema.optional(),
  defaultCurrency: currencyCodeSchema.optional(),
  startDate: dateOnlyStringSchema.nullable().optional(),
  endDate: dateOnlyStringSchema.nullable().optional(),
  archived: z.boolean().optional(),
});

export const eventResponseSchema = z.object({
  id: personIdSchema,
  name: z.string(),
  participantIds: z.array(personIdSchema),
  defaultCurrency: currencyCodeSchema,
  // z.coerce.date(): a backend valódi Date instance-t ad, a frontend a
  // fetch().json() után ISO stringet kap — ugyanaz a séma validál mindkettőn.
  startDate: z.coerce.date().nullable(),
  endDate: z.coerce.date().nullable(),
  archived: z.boolean(),
  totalBaseAmountMinor: amountMinorSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const eventListResponseSchema = z.array(eventResponseSchema);
