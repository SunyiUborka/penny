import { z } from 'zod';
import {
  amountMinorSchema,
  currencyCodeSchema,
  exchangeRateStringSchema,
  personIdSchema,
} from './money.js';
import { dateOnlyStringSchema } from './date.js';
import { rateSourceEnumSchema } from './expense.js';
import { getCurrencyExponent, MAX_EXPENSE_MAJOR_AMOUNT } from '../currency/exponents.js';

/**
 * Egy kiegyenlítés (tartozás-rendezés): `fromId` átadott `toId`-nak pénzt.
 *
 * NEM kiadás: az esemény összköltségét nem növeli, a Kiadások fülön nem
 * jelenik meg, és az egyenlegtábla „Kifizette" oszlopához sem ér hozzá — csak
 * a tartozást mozgatja. Ezért van saját kollekciója és saját sémája, a
 * `payerId`/`sharedWithIds` páros helyett egy `fromId`/`toId` párossal.
 *
 * A rögzített összeg az, ami TÖRTÉNT. Hogy ebből mennyi számít be egy
 * jegyzéksorba, azt a `computeSettlement` számolja — nem tárolt adat.
 */
export const createSettlementPaymentBodySchema = z
  .object({
    /**
     * A kliens által generált azonosító. Ma a webes felület nem küldi; a mező
     * a későbbi offline sorbanállítás idempotenciájához van előkészítve,
     * pontosan úgy, mint a kiadásoknál.
     */
    clientId: z.string().uuid().optional(),
    date: dateOnlyStringSchema,
    fromId: personIdSchema,
    toId: personIdSchema,
    amountMinor: amountMinorSchema.positive('Az összeg pozitív kell legyen.'),
    currency: currencyCodeSchema,
    exchangeRate: exchangeRateStringSchema,
    rateSource: rateSourceEnumSchema,
    rateFetchedAt: z.coerce.date().optional(),
    note: z.string().trim().max(120, 'A megjegyzés legfeljebb 120 karakter lehet.').optional(),
  })
  .superRefine((data, ctx) => {
    const maxAmountMinor = MAX_EXPENSE_MAJOR_AMOUNT * 10 ** getCurrencyExponent(data.currency);
    if (data.amountMinor > maxAmountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Az összeg legfeljebb ${MAX_EXPENSE_MAJOR_AMOUNT} lehet.`,
        path: ['amountMinor'],
      });
    }

    if (data.fromId === data.toId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A fizető és a kedvezményezett nem lehet ugyanaz a személy.',
        path: ['toId'],
      });
    }
  });

export const updateSettlementPaymentBodySchema = createSettlementPaymentBodySchema;

export const settlementPaymentResponseSchema = z.object({
  id: personIdSchema,
  clientId: z.string().uuid().optional(),
  eventId: personIdSchema,
  date: z.coerce.date(),
  fromId: personIdSchema,
  toId: personIdSchema,
  amountMinor: amountMinorSchema,
  currency: currencyCodeSchema,
  exchangeRate: exchangeRateStringSchema,
  rateSource: rateSourceEnumSchema,
  rateFetchedAt: z.coerce.date(),
  baseAmountMinor: amountMinorSchema,
  note: z.string().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const settlementPaymentListResponseSchema = z.array(settlementPaymentResponseSchema);
