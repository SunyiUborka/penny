import { z } from 'zod';
import {
  amountMinorSchema,
  currencyCodeSchema,
  exchangeRateStringSchema,
  personIdSchema,
} from './money.js';
import { dateOnlyStringSchema } from './date.js';
import { getCurrencyExponent, MAX_EXPENSE_MAJOR_AMOUNT } from '../currency/exponents.js';
import { expenseCategoryIdsSchema } from './category.js';

export const rateSourceEnumSchema = z.enum(['api', 'manual']);

/**
 * Egy számla egy tétele. A megnevezés elhagyható (a felület „—"-t mutat
 * helyette); az összeg a SZÁMLA pénznemének legkisebb egységében értendő,
 * mert egy számla egy pénznem és egy árfolyam.
 */
export const expenseItemInputSchema = z.object({
  description: z
    .string()
    .trim()
    .max(120, 'A tétel megnevezése legfeljebb 120 karakter lehet.')
    .optional(),
  amountMinor: amountMinorSchema.positive('A tétel összege pozitív kell legyen.'),
  sharedWithIds: z.array(personIdSchema).min(1, 'A tételen legalább egy osztozó szükséges.'),
});

/**
 * Ugyanaz, kimenetkor: a forint-összeget a szerver számolja (a kérés nem
 * tartalmazza), pontosan úgy, ahogy a kiadás szintjén sem.
 */
export const expenseItemResponseSchema = expenseItemInputSchema.extend({
  baseAmountMinor: amountMinorSchema,
});

const MAX_EXPENSE_ITEMS = 50;

export const createExpenseBodySchema = z
  .object({
    /**
     * A kliens által generált azonosító. Offline sorbanállított kiadásnál a
     * megszakadt kérés újraküldése enélkül duplikálna; a szerver ez alapján
     * ismeri fel, hogy ugyanarról a kiadásról van szó.
     */
    clientId: z.string().uuid().optional(),
    date: dateOnlyStringSchema,
    description: z.string().trim().min(1, 'A leírás nem lehet üres.'),
    payerId: personIdSchema,
    amountMinor: amountMinorSchema.positive('Az összeg pozitív kell legyen.'),
    currency: currencyCodeSchema,
    exchangeRate: exchangeRateStringSchema,
    rateSource: rateSourceEnumSchema,
    rateFetchedAt: z.coerce.date().optional(),
    sharedWithIds: z.array(personIdSchema).min(1, 'Legalább egy osztozó szükséges.'),
    categoryIds: expenseCategoryIdsSchema.optional(),
    /**
     * Tételes felosztás. A mező ELHAGYÁSA jelenti azt, hogy a kiadás nem
     * tételezett (a mai, egyenlő felosztás a `sharedWithIds` között) — egy
     * üres tömb nem érvényes állapot. Tételes módban a `sharedWithIds` a
     * SZÁMLA résztvevőit jelenti, a tételek ezen belül szűkítenek.
     */
    items: z
      .array(expenseItemInputSchema)
      .min(1, 'Legalább egy tétel szükséges.')
      .max(MAX_EXPENSE_ITEMS, `Legfeljebb ${MAX_EXPENSE_ITEMS} tétel adható meg.`)
      .optional(),
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

    if (!data.items) {
      return;
    }

    const itemsTotalMinor = data.items.reduce((sum, item) => sum + item.amountMinor, 0);
    if (itemsTotalMinor !== data.amountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A tételek összege nem egyezik a végösszeggel.',
        path: ['items'],
      });
    }

    // A tételek osztozói a SZÁMLA résztvevői közül kell legyenek. Ez adja az
    // `items ⊆ sharedWithIds ⊆ event.participantIds` láncot, amire a szerver
    // `assertParticipants`-a és a személytörlés/résztvevő-eltávolítás
    // védőkorlátjai (mind `sharedWithIds`-re kérdeznek) változtatás nélkül
    // támaszkodhatnak.
    const billParticipants = new Set(data.sharedWithIds);
    data.items.forEach((item, index) => {
      item.sharedWithIds.forEach((personId, sharerIndex) => {
        if (!billParticipants.has(personId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'A tétel osztozója nem szerepel a számla résztvevői között.',
            path: ['items', index, 'sharedWithIds', sharerIndex],
          });
        }
      });
    });
  });

export const updateExpenseBodySchema = createExpenseBodySchema;

export const expenseResponseSchema = z.object({
  id: personIdSchema,
  clientId: z.string().uuid().optional(),
  eventId: personIdSchema,
  date: z.coerce.date(),
  description: z.string(),
  payerId: personIdSchema,
  amountMinor: amountMinorSchema,
  currency: currencyCodeSchema,
  exchangeRate: exchangeRateStringSchema,
  rateSource: rateSourceEnumSchema,
  rateFetchedAt: z.coerce.date(),
  baseAmountMinor: amountMinorSchema,
  sharedWithIds: z.array(personIdSchema),
  categoryIds: z.array(personIdSchema),
  items: z.array(expenseItemResponseSchema).min(1).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const expenseListResponseSchema = z.array(expenseResponseSchema);
