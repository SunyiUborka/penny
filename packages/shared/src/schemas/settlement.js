import { z } from 'zod';
import { amountMinorSchema, personIdSchema } from './money.js';

const settlementExpenseItemSchema = z.object({
  baseAmountMinor: amountMinorSchema,
  sharedWithIds: z.array(personIdSchema).min(1),
});

const settlementExpenseSchema = z.object({
  payerId: personIdSchema,
  baseAmountMinor: amountMinorSchema,
  sharedWithIds: z.array(personIdSchema).min(1),
  items: z.array(settlementExpenseItemSchema).min(1).optional(),
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

      if (!expense.items) {
        return;
      }

      // A fizető „kifizette" oldalára a kiadás baseAmountMinor-ja kerül, a
      // tartozás oldalára a tételekből számolt részek. Ha a kettő nem ugyanaz
      // az összeg, az egyenlegek nem adnának ki nullát — ilyenkor inkább
      // dobjunk, mint hogy csendben rossz egyenleget mutassunk (a
      // SettlementPanel ezt a hibát üzenetként jeleníti meg).
      const itemsBaseTotalMinor = expense.items.reduce(
        (sum, item) => sum + item.baseAmountMinor,
        0,
      );
      if (itemsBaseTotalMinor !== expense.baseAmountMinor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `A ${index}. kiadás tételeinek alapösszege (${itemsBaseTotalMinor}) nem egyezik a kiadás alapösszegével (${expense.baseAmountMinor}).`,
          path: ['expenses', index, 'items'],
        });
      }

      expense.items.forEach((item, itemIndex) => {
        item.sharedWithIds.forEach((sharerId, sharerIndex) => {
          if (!participantSet.has(sharerId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `A ${index}. kiadás ${itemIndex}. tételének egy osztozója (${sharerId}) nem résztvevője az eseménynek.`,
              path: ['expenses', index, 'items', itemIndex, 'sharedWithIds', sharerIndex],
            });
          }
        });
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
