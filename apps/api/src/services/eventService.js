import * as eventRepository from '../repositories/eventRepository.js';
import * as personRepository from '../repositories/personRepository.js';
import * as expenseRepository from '../repositories/expenseRepository.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';

export async function listEvents() {
  const events = await eventRepository.listEvents();
  const totals = await expenseRepository.sumBaseAmountByEvent(events.map((event) => event.id));
  return events.map((event) => withTotalCost(event, totals));
}

/**
 * @param {string} id
 */
export async function getEvent(id) {
  const event = await eventRepository.findEventById(id);
  if (!event) {
    throw new NotFoundError('Nincs ilyen esemény.');
  }
  const totals = await expenseRepository.sumBaseAmountByEvent([id]);
  return withTotalCost(event, totals);
}

/**
 * @param {object} input
 */
export async function createEvent(input) {
  await assertParticipantsExist(input.participantIds);
  const event = await eventRepository.createEvent(input);
  return withTotalCost(event, new Map());
}

/**
 * @param {string} id
 * @param {object} input
 */
export async function updateEvent(id, input) {
  if (input.participantIds) {
    await assertParticipantsExist(input.participantIds);
    await assertRemovedParticipantsNotInUse(id, input.participantIds);
  }

  const updated = await eventRepository.updateEvent(id, input);
  if (!updated) {
    throw new NotFoundError('Nincs ilyen esemény.');
  }
  const totals = await expenseRepository.sumBaseAmountByEvent([id]);
  return withTotalCost(updated, totals);
}

/**
 * @param {object} event
 * @param {Map<string, number>} totals
 */
function withTotalCost(event, totals) {
  return { ...event, totalBaseAmountMinor: totals.get(event.id) ?? 0 };
}

/**
 * @param {string} id
 */
export async function deleteEvent(id) {
  const deleted = await eventRepository.deleteEventById(id);
  if (!deleted) {
    throw new NotFoundError('Nincs ilyen esemény.');
  }
  await expenseRepository.deleteAllForEvent(id);
}

/**
 * @param {string} eventId
 * @param {string[]} newParticipantIds
 */
async function assertRemovedParticipantsNotInUse(eventId, newParticipantIds) {
  const current = await eventRepository.findEventById(eventId);
  if (!current) {
    return;
  }
  const newParticipantSet = new Set(newParticipantIds);
  const removedIds = current.participantIds.filter((id) => !newParticipantSet.has(id));
  if (removedIds.length === 0) {
    return;
  }

  const blockingExpenses = await expenseRepository.findByEventAndPersonInvolved(
    eventId,
    removedIds,
  );
  if (blockingExpenses.length > 0) {
    throw new ConflictError(
      'Résztvevő nem távolítható el, mert az alábbi kiadások fizetőjeként vagy osztozójaként szerepel.',
      { expenses: blockingExpenses },
    );
  }
}

/**
 * @param {string[]} participantIds
 */
async function assertParticipantsExist(participantIds) {
  const existingCount = await personRepository.countExistingByIds(participantIds);
  if (existingCount !== participantIds.length) {
    throw new ValidationError('Egy vagy több megadott résztvevő nem létezik a névjegyzékben.');
  }
}
