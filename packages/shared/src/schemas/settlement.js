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

/**
 * Egy kiegyenlítés a számítás szempontjából: ki adott kinek, mennyi
 * forintot. A `date`/`createdAt` a beszámítás sorrendjét adja (a régebbi
 * szelvény számít be előbb), hogy a szerver és a kliens ugyanarra az
 * eredményre jusson akkor is, ha a listát máshogy rendezve tartja.
 */
const settlementPaymentSchema = z.object({
  fromId: personIdSchema,
  toId: personIdSchema,
  baseAmountMinor: amountMinorSchema.nonnegative(),
  date: z.coerce.date().optional(),
  createdAt: z.coerce.date().optional(),
});

export const computeSettlementInputSchema = z
  .object({
    participantIds: z.array(personIdSchema).min(1),
    expenses: z.array(settlementExpenseSchema),
    payments: z.array(settlementPaymentSchema).default([]),
  })
  .superRefine((input, ctx) => {
    const participantSet = new Set(input.participantIds);

    input.payments.forEach((payment, index) => {
      if (payment.fromId === payment.toId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `A ${index}. kiegyenlítés fizetője és kedvezményezettje ugyanaz a személy.`,
          path: ['payments', index, 'toId'],
        });
      }
      ['fromId', 'toId'].forEach((field) => {
        if (!participantSet.has(payment[field])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `A ${index}. kiegyenlítés egyik résztvevője (${payment[field]}) nem résztvevője az eseménynek.`,
            path: ['payments', index, field],
          });
        }
      });
    });

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
  /**
   * A személy kiegyenlítéseinek előjeles forint-összege: aki fizetett, annak
   * `+`, aki kapta, annak `−`. Külön mező, nem a `paidMinor`-ba olvasztva —
   * a kiegyenlítés nem kiadás, tehát a „kifizette" oszlop nem mozdulhat tőle.
   */
  settledMinor: amountMinorSchema,
  balanceMinor: amountMinorSchema,
});

/**
 * A fizetési jegyzék egy sora. Az `amountMinor` a kiadásokból számolt teljes
 * tartozás ezen a pároson, a `creditedMinor` az eddig beszámított rész, a
 * `remainingMinor` a hátralék. A sor összege NEM változik attól, hogy
 * fizetnek rá — ez a funkció alapszabálya.
 */
export const transferResponseSchema = z.object({
  fromId: personIdSchema,
  toId: personIdSchema,
  amountMinor: amountMinorSchema,
  creditedMinor: amountMinorSchema,
  remainingMinor: amountMinorSchema,
});

/**
 * Szelvényenkénti bontás, a bemeneti `payments` SORRENDJÉBEN: mennyi számított
 * be a jegyzékbe, és mennyi maradt kerekítésként (túlfizetés, illetve olyan
 * páros, ami a mostani jegyzékben már nem szerepel).
 */
export const paymentCreditResponseSchema = z.object({
  creditedMinor: amountMinorSchema,
  roundingMinor: amountMinorSchema,
});

export const settlementResponseSchema = z.object({
  balances: z.array(balanceResponseSchema),
  transfers: z.array(transferResponseSchema),
  paymentCredits: z.array(paymentCreditResponseSchema),
  /** Az összes olyan forint, ami egyetlen jegyzéksorba sem tudott beszámítani. */
  unmatchedCreditMinor: amountMinorSchema,
});
