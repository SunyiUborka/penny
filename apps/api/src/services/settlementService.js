import {
  computeSettlement,
  settlementProgressOf,
  UNKNOWN_SETTLEMENT_PROGRESS,
} from '@filler/shared';
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
    expenses: toSettlementExpenses(expenses),
    payments: toSettlementPayments(payments),
  });
}

/**
 * @param {{ id: string, participantIds: string[] }[]} events
 * @returns {Promise<Map<string, import('@filler/shared').SettlementProgress>>}
 */
export async function getSettlementProgressByEvent(events) {
  const eventIds = events.map((event) => event.id);
  const [expensesByEvent, paymentsByEvent] = await Promise.all([
    expenseRepository.listByEventIds(eventIds),
    settlementPaymentRepository.listByEventIds(eventIds),
  ]);

  return new Map(
    events.map((event) => [
      event.id,
      progressFor(event, expensesByEvent.get(event.id) ?? [], paymentsByEvent.get(event.id) ?? []),
    ]),
  );
}

/**
 * @param {{ participantIds: string[] }} event
 * @param {object[]} expenses
 * @param {object[]} payments
 * @returns {import('@filler/shared').SettlementProgress}
 */
function progressFor(event, expenses, payments) {
  try {
    const { transfers } = computeSettlement({
      participantIds: event.participantIds,
      expenses: toSettlementExpenses(expenses),
      payments: toSettlementPayments(payments),
    });
    return settlementProgressOf(transfers);
  } catch {
    return UNKNOWN_SETTLEMENT_PROGRESS;
  }
}

/**
 * @param {object[]} expenses
 */
function toSettlementExpenses(expenses) {
  return expenses.map((expense) => ({
    payerId: expense.payerId,
    baseAmountMinor: expense.baseAmountMinor,
    sharedWithIds: expense.sharedWithIds,
    // Csak akkor adjuk át, ha van: az `items: undefined` a sémán átmegy, de
    // az explicit feltétel dokumentálja, hogy a tétel nélküli kiadás
    // szándékosan a régi úton (egyenlő felosztással) számol.
    ...(expense.items ? { items: expense.items } : {}),
  }));
}

/**
 * A beszámítás sorrendje a dátumból (majd a rögzítés idejéből) jön, nem ebből
 * a tömbből — a `computeSettlement` maga rendez, hogy a kliens (ami a saját,
 * máshogy rendezett listájából számol) ugyanezt kapja.
 * @param {object[]} payments
 */
function toSettlementPayments(payments) {
  return payments.map((payment) => ({
    fromId: payment.fromId,
    toId: payment.toId,
    baseAmountMinor: payment.baseAmountMinor,
    date: payment.date,
    createdAt: payment.createdAt,
  }));
}
