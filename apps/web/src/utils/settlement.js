import { computeSettlement } from '@filler/shared';

/**
 * Az esemény elszámolása a betöltött kiadás- és kiegyenlítés-listából, a
 * szerverrel azonos `computeSettlement`-tel. `null`, ha a bemenet (átmenetileg)
 * nem konzisztens — pl. egy másik eszközön felvett résztvevő miatt a
 * `participantIds` még elavult.
 * @param {{ event: { participantIds: string[] }, expenses: object[], payments: object[] }} input
 * @returns {ReturnType<typeof computeSettlement> | null}
 */
export function computeEventSettlement(input) {
  const { event, expenses, payments } = input;
  try {
    return computeSettlement({
      participantIds: event.participantIds,
      expenses: expenses.map((expense) => ({
        payerId: expense.payerId,
        baseAmountMinor: expense.baseAmountMinor,
        sharedWithIds: expense.sharedWithIds,
        ...(expense.items ? { items: expense.items } : {}),
      })),
      payments: payments.map((payment) => ({
        fromId: payment.fromId,
        toId: payment.toId,
        baseAmountMinor: payment.baseAmountMinor,
        date: payment.date,
        createdAt: payment.createdAt,
      })),
    });
  } catch {
    return null;
  }
}
