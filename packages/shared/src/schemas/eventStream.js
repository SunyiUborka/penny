import { z } from 'zod';
import { personIdSchema } from './money.js';
import { expenseResponseSchema } from './expense.js';
import { settlementPaymentResponseSchema } from './settlementPayment.js';

/**
 * Az élő (SSE) frissítés üzenetformátuma. Ugyanez a séma validál a backenden
 * kimenetkor és a frontenden bejövetkor — a stream is határátlépés, ugyanúgy
 * validált, mint a rendes HTTP válaszok.
 *
 * A csatorna eseményenkénti, és nem csak a kiadásokat szállítja: a
 * kiegyenlítések is ugyanezen az egy streamen jönnek, mert ugyanannak az
 * eseménynek a lapját frissítik. Egy második stream csak egy második
 * kapcsolatot nyitna ugyanahhoz az eseményhez.
 */
export const eventStreamMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('expense.created'), expense: expenseResponseSchema }),
  z.object({ type: z.literal('expense.updated'), expense: expenseResponseSchema }),
  z.object({ type: z.literal('expense.deleted'), expenseId: personIdSchema }),
  z.object({
    type: z.literal('settlementPayment.created'),
    payment: settlementPaymentResponseSchema,
  }),
  z.object({
    type: z.literal('settlementPayment.updated'),
    payment: settlementPaymentResponseSchema,
  }),
  z.object({ type: z.literal('settlementPayment.deleted'), paymentId: personIdSchema }),
]);
