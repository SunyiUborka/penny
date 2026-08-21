import { convertMinorAmount, SETTLEMENT_CURRENCY } from '@filler/shared';
import * as settlementPaymentRepository from '../repositories/settlementPaymentRepository.js';
import * as eventRepository from '../repositories/eventRepository.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { publishEventChange } from './eventBus.js';
import { parseDateOnly } from '../utils/dateOnly.js';

/**
 * @param {string} eventId
 */
export async function listPaymentsForEvent(eventId) {
  await getEventOrThrow(eventId);
  return settlementPaymentRepository.listForEvent(eventId);
}

/**
 * @param {string} eventId
 * @param {object} input
 */
export async function createPayment(eventId, input) {
  if (input.clientId) {
    const existing = await settlementPaymentRepository.findByClientId(input.clientId);
    if (existing) {
      // Idempotencia, a kiadásokkal azonos módon: a kliens újraküldte egy már
      // befogadott kiegyenlítését (pl. a válasz veszett el). Nem hozunk létre
      // másodikat, és nem publikálunk új eseményt — azt a többi kliens már
      // megkapta.
      assertSameEvent(existing, eventId, input.clientId);
      return existing;
    }
  }

  const event = await getEventOrThrow(eventId);
  assertParticipants(event, input);
  const data = buildPaymentData(input);

  let created;
  try {
    created = await settlementPaymentRepository.createPayment({ ...data, eventId });
  } catch (error) {
    const duplicate = input.clientId && error?.code === 11000;
    if (!duplicate) {
      throw error;
    }
    const existing = await settlementPaymentRepository.findByClientId(input.clientId);
    if (!existing) {
      throw error;
    }
    assertSameEvent(existing, eventId, input.clientId);
    return existing;
  }

  publishEventChange(eventId, { type: 'settlementPayment.created', payment: created });
  return created;
}

/**
 * @param {string} id
 * @param {object} input
 */
export async function updatePayment(id, input) {
  const existing = await settlementPaymentRepository.findPaymentById(id);
  if (!existing) {
    throw new NotFoundError('Nincs ilyen kiegyenlítés.');
  }
  const event = await getEventOrThrow(existing.eventId);
  assertParticipants(event, input);
  const data = buildPaymentData(input);

  const updated = await settlementPaymentRepository.updatePayment(id, {
    ...data,
    clientId: existing.clientId,
  });
  if (!updated) {
    throw new NotFoundError('Nincs ilyen kiegyenlítés.');
  }
  publishEventChange(updated.eventId, {
    type: 'settlementPayment.updated',
    payment: updated,
  });
  return updated;
}

/**
 * @param {string} id
 */
export async function deletePayment(id) {
  const deleted = await settlementPaymentRepository.deletePaymentById(id);
  if (!deleted) {
    throw new NotFoundError('Nincs ilyen kiegyenlítés.');
  }
  publishEventChange(deleted.eventId, {
    type: 'settlementPayment.deleted',
    paymentId: deleted.id,
  });
}

/**
 * @param {{ eventId: string }} existing
 * @param {string} eventId
 * @param {string} clientId
 */
function assertSameEvent(existing, eventId, clientId) {
  if (existing.eventId !== eventId) {
    throw new ConflictError(
      `A(z) "${clientId}" clientId már egy másik eseményhez tartozó kiegyenlítéshez van rendelve.`,
      { clientId, paymentEventId: existing.eventId, requestedEventId: eventId },
    );
  }
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
 * A `fromId !== toId` ellenőrzést a kérés Zod sémája végzi; itt a
 * résztvevőség a kérdés, ugyanúgy, ahogy a kiadás fizetőjénél és osztozóinál.
 * @param {{ participantIds: string[] }} event
 * @param {{ fromId: string, toId: string }} input
 */
function assertParticipants(event, input) {
  const participantSet = new Set(event.participantIds);
  const invalidIds = [input.fromId, input.toId].filter((id) => !participantSet.has(id));
  if (invalidIds.length > 0) {
    throw new ValidationError(
      'A fizető és a kedvezményezett az esemény résztvevői közül kell legyenek.',
      { invalidIds },
    );
  }
}

/**
 * A rögzítendő mezők: a pénznem/árfolyam szabályokat kényszeríti ki, és
 * kiszámítja a forint-értéket. Ugyanaz a szabály, mint a kiadásoknál
 * (`expenseService.buildExpenseData`) — forintnál nincs árfolyam, tehát az
 * érték fix `'1'`, és a kliens által küldött bármilyen más árfolyamot
 * eldobjuk.
 * @param {object} input
 */
function buildPaymentData(input) {
  const isSettlementCurrency = input.currency === SETTLEMENT_CURRENCY;

  const exchangeRate = isSettlementCurrency ? '1' : input.exchangeRate;
  const rateSource = isSettlementCurrency ? 'manual' : input.rateSource;
  const rateFetchedAt = isSettlementCurrency ? new Date() : (input.rateFetchedAt ?? new Date());

  const baseAmountMinor = convertMinorAmount({
    amountMinor: input.amountMinor,
    rate: exchangeRate,
    sourceCurrency: input.currency,
    targetCurrency: SETTLEMENT_CURRENCY,
  });

  return {
    clientId: input.clientId,
    date: parseDateOnly(input.date),
    fromId: input.fromId,
    toId: input.toId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    exchangeRate,
    rateSource,
    rateFetchedAt,
    baseAmountMinor,
    note: input.note,
  };
}
