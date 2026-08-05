import { computeSettlement } from '@filler/shared';
import * as eventRepository from '../repositories/eventRepository.js';
import * as expenseRepository from '../repositories/expenseRepository.js';
import { NotFoundError } from '../errors.js';

/**
 * @param {string} eventId
 */
export async function getSettlement(eventId) {
  const event = await eventRepository.findEventById(eventId);
  if (!event) {
    throw new NotFoundError('Nincs ilyen esemény.');
  }

  const expenses = await expenseRepository.listForEvent(eventId);

  return computeSettlement({
    participantIds: event.participantIds,
    expenses: expenses.map((expense) => ({
      payerId: expense.payerId,
      baseAmountMinor: expense.baseAmountMinor,
      sharedWithIds: expense.sharedWithIds,
    })),
  });
}
