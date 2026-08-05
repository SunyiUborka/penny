import { convertMinorAmount, SETTLEMENT_CURRENCY } from '@filler/shared';
import * as expenseRepository from '../repositories/expenseRepository.js';
import * as eventRepository from '../repositories/eventRepository.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { publishExpenseChange } from './eventBus.js';
import { parseDateOnly } from '../utils/dateOnly.js';

/**
 * @param {string} eventId
 */
export async function listExpensesForEvent(eventId) {
  await getEventOrThrow(eventId);
  return expenseRepository.listForEvent(eventId);
}

/**
 * @param {string} eventId
 * @param {object} input
 */
export async function createExpense(eventId, input) {
  const event = await getEventOrThrow(eventId);
  assertParticipants(event, input);
  const data = buildExpenseData(input);
  const created = await expenseRepository.createExpense({ ...data, eventId });
  publishExpenseChange(eventId, { type: 'expense.created', expense: created });
  return created;
}

/**
 * @param {string} id
 * @param {object} input
 */
export async function updateExpense(id, input) {
  const existing = await expenseRepository.findExpenseById(id);
  if (!existing) {
    throw new NotFoundError('Nincs ilyen kiadás.');
  }
  const event = await getEventOrThrow(existing.eventId);
  assertParticipants(event, input);
  const data = buildExpenseData(input);

  const updated = await expenseRepository.updateExpense(id, data);
  if (!updated) {
    throw new NotFoundError('Nincs ilyen kiadás.');
  }
  publishExpenseChange(updated.eventId, { type: 'expense.updated', expense: updated });
  return updated;
}

/**
 * @param {string} id
 */
export async function deleteExpense(id) {
  const deleted = await expenseRepository.deleteExpenseById(id);
  if (!deleted) {
    throw new NotFoundError('Nincs ilyen kiadás.');
  }
  publishExpenseChange(deleted.eventId, { type: 'expense.deleted', expenseId: deleted.id });
}

/**
 * @param {string} eventId
 */
async function getEventOrThrow(eventId) {
  const event = await eventRepository.findEventById(eventId);
  if (!event) {
    throw new NotFoundError('Nincs ilyen esemény.');
  }
  return event;
}

/**
 * @param {{ participantIds: string[] }} event
 * @param {{ payerId: string, sharedWithIds: string[] }} input
 */
function assertParticipants(event, input) {
  const participantSet = new Set(event.participantIds);
  const invalidIds = [input.payerId, ...input.sharedWithIds].filter(
    (id) => !participantSet.has(id),
  );
  if (invalidIds.length > 0) {
    throw new ValidationError(
      'A kifizető és az osztozók az esemény résztvevői közül kell legyenek.',
      {
        invalidIds,
      },
    );
  }
}

/**
 * A rögzítendő mezőket építi fel: a pénznem/árfolyam szabályokat kényszeríti
 * ki (2. pont), és kiszámítja a forint-összeget. Az elszámolás mindig
 * forintban történik, eseményenkénti alapvaluta-választás nélkül.
 * @param {object} input
 */
function buildExpenseData(input) {
  const isSettlementCurrency = input.currency === SETTLEMENT_CURRENCY;

  const exchangeRate = isSettlementCurrency ? '1' : input.exchangeRate;
  const rateSource = isSettlementCurrency ? 'manual' : input.rateSource;
  const rateFetchedAt = isSettlementCurrency ? new Date() : (input.rateFetchedAt ?? new Date());
  const baseAmountMinor = isSettlementCurrency
    ? input.amountMinor
    : convertMinorAmount({
        amountMinor: input.amountMinor,
        rate: exchangeRate,
        sourceCurrency: input.currency,
        targetCurrency: SETTLEMENT_CURRENCY,
      });

  return {
    date: parseDateOnly(input.date),
    description: input.description,
    payerId: input.payerId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    exchangeRate,
    rateSource,
    rateFetchedAt,
    baseAmountMinor,
    sharedWithIds: input.sharedWithIds,
  };
}
