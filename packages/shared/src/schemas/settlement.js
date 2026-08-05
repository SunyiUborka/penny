import { z } from 'zod';
import { amountMinorSchema, personIdSchema } from './money.js';

const settlementExpenseSchema = z.object({
  payerId: personIdSchema,
  baseAmountMinor: amountMinorSchema,
  sharedWithIds: z.array(personIdSchema).min(1),
});

export const computeSettlementInputSchema = z
  .object({
    participantIds: z.array(personIdSchema).min(1),
    expenses: z.array(settlementExpenseSchema),
  })
  .superRefine((input, ctx) => {
    const participantSet = new Set(input.participantIds);

    input.expenses.forEach((expense, index) => {
      if (!participantSet.has(expense.payerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `A ${index}. kiadás kifizetője (${expense.payerId}) nem résztvevője az eseménynek.`,
          path: ['expenses', index, 'payerId'],
        });
      }

      expense.sharedWithIds.forEach((sharerId, sharerIndex) => {
        if (!participantSet.has(sharerId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `A ${index}. kiadás egy osztozója (${sharerId}) nem résztvevője az eseménynek.`,
            path: ['expenses', index, 'sharedWithIds', sharerIndex],
          });
        }
      });
    });
  });

export const balanceResponseSchema = z.object({
  personId: personIdSchema,
  paidMinor: amountMinorSchema,
  owedMinor: amountMinorSchema,
  balanceMinor: amountMinorSchema,
});

export const transferResponseSchema = z.object({
  fromId: personIdSchema,
  toId: personIdSchema,
  amountMinor: amountMinorSchema,
});

export const settlementResponseSchema = z.object({
  balances: z.array(balanceResponseSchema),
  transfers: z.array(transferResponseSchema),
});
