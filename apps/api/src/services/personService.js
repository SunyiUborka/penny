import * as personRepository from '../repositories/personRepository.js';
import * as eventRepository from '../repositories/eventRepository.js';
import * as expenseRepository from '../repositories/expenseRepository.js';
import { ConflictError, NotFoundError } from '../errors.js';

export function listPeople() {
  return personRepository.listPeople();
}

/**
 * @param {{ name: string }} input
 */
export async function createPerson(input) {
  try {
    return await personRepository.createPerson(input);
  } catch (error) {
    throw toConflictOnDuplicateName(error, input.name);
  }
}

/**
 * @param {string} id
 * @param {{ name: string }} input
 */
export async function updatePerson(id, input) {
  let updated;
  try {
    updated = await personRepository.updatePerson(id, input);
  } catch (error) {
    throw toConflictOnDuplicateName(error, input.name);
  }
  if (!updated) {
    throw new NotFoundError('Nincs ilyen személy.');
  }
  return updated;
}

/**
 * @param {string} id
 */
export async function deletePerson(id) {
  const usedInEvents = await eventRepository.findEventsByParticipantId(id);
  if (usedInEvents.length > 0) {
    throw new ConflictError('A személy nem törölhető, mert résztvevője az alábbi eseményeknek.', {
      events: usedInEvents,
    });
  }

  const usedInExpenses = await expenseRepository.findByPersonInvolved(id);
  if (usedInExpenses.length > 0) {
    throw new ConflictError(
      'A személy nem törölhető, mert fizetőként vagy osztozóként szerepel az alábbi kiadásokban.',
      { expenses: usedInExpenses },
    );
  }

  const deleted = await personRepository.deletePersonById(id);
  if (!deleted) {
    throw new NotFoundError('Nincs ilyen személy.');
  }
}

/**
 * @param {unknown} error
 * @param {string} name
 */
function toConflictOnDuplicateName(error, name) {
  if (error?.code === 11000) {
    return new ConflictError(`Már létezik "${name}" nevű személy.`);
  }
  return error;
}
