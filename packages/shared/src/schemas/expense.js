import { z } from 'zod';
import {
  amountMinorSchema,
  currencyCodeSchema,
  exchangeRateStringSchema,
  personIdSchema,
} from './money.js';
import { dateOnlyStringSchema } from './date.js';
import { getCurrencyExponent, MAX_EXPENSE_MAJOR_AMOUNT } from '../currency/exponents.js';

export const rateSourceEnumSchema = z.enum(['api', 'manual']);

export const createExpenseBodySchema = z
  .object({
    date: dateOnlyStringSchema,
    description: z.string().trim().min(1, 'A leírás nem lehet üres.'),
    payerId: personIdSchema,
    amountMinor: amountMinorSchema.positive('Az összeg pozitív kell legyen.'),
    currency: currencyCodeSchema,
    exchangeRate: exchangeRateStringSchema,
    rateSource: rateSourceEnumSchema,
    rateFetchedAt: z.coerce.date().optional(),
    sharedWithIds: z.array(personIdSchema).min(1, 'Legalább egy osztozó szükséges.'),
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
  });

export const updateExpenseBodySchema = createExpenseBodySchema;

export const expenseResponseSchema = z.object({
  id: personIdSchema,
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
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const expenseListResponseSchema = z.array(expenseResponseSchema);
