import { computeSettlement } from '@filler/shared';
import * as eventRepository from '../repositories/eventRepository.js';
import * as expenseRepository from '../repositories/expenseRepository.js';
import * as settlementPaymentRepository from '../repositories/settlementPaymentRepository.js';
import { NotFoundError } from '../errors.js';

/**
 * @param {string} eventId
 */
export async function getSettlement(eventId) {
  const event = await eventRepository.findEventById(eventId);
  if (!event) {
    throw new NotFoundError('Nincs ilyen esemény.');
  }

  const [expenses, payments] = await Promise.all([
    expenseRepository.listForEvent(eventId),
    settlementPaymentRepository.listForEvent(eventId),
  ]);

  return computeSettlement({
    participantIds: event.participantIds,
    expenses: expenses.map((expense) => ({
      payerId: expense.payerId,
      baseAmountMinor: expense.baseAmountMinor,
      sharedWithIds: expense.sharedWithIds,
      // Csak akkor adjuk át, ha van: az `items: undefined` a sémán átmegy, de
      // az explicit feltétel dokumentálja, hogy a tétel nélküli kiadás
      // szándékosan a régi úton (egyenlő felosztással) számol.
      ...(expense.items ? { items: expense.items } : {}),
    })),
    // A beszámítás sorrendje a dátumból (majd a rögzítés idejéből) jön, nem
    // ebből a tömbből — a `computeSettlement` maga rendez, hogy a kliens
    // (ami a saját, máshogy rendezett listájából számol) ugyanezt kapja.
    payments: payments.map((payment) => ({
      fromId: payment.fromId,
      toId: payment.toId,
      baseAmountMinor: payment.baseAmountMinor,
      date: payment.date,
      createdAt: payment.createdAt,
    })),
  });
}
