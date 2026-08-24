import * as categoryRepository from '../repositories/categoryRepository.js';
import * as eventRepository from '../repositories/eventRepository.js';
import * as expenseRepository from '../repositories/expenseRepository.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { publishEventChange } from './eventBus.js';

/**
 * @param {string} eventId
 */
export async function listCategoriesForEvent(eventId) {
  await getEventOrThrow(eventId);
  return categoryRepository.listForEvent(eventId);
}

/**
 * @param {string} eventId
 * @param {{ name: string, color: string }} input
 */
export async function createCategory(eventId, input) {
  const event = await getEventOrThrow(eventId);
  assertNotArchived(event);

  let created;
  try {
    created = await categoryRepository.createCategory({ ...input, eventId });
  } catch (error) {
    throw toConflictOnDuplicateName(error, input.name);
  }

  publishEventChange(eventId, { type: 'category.created', category: created });
  return created;
}

/**
 * @param {string} id
 * @param {{ name?: string, color?: string }} input
 */
export async function updateCategory(id, input) {
  const existing = await getCategoryOrThrow(id);
  const event = await getEventOrThrow(existing.eventId);
  assertNotArchived(event);

  let updated;
  try {
    updated = await categoryRepository.updateCategory(id, input);
  } catch (error) {
    throw toConflictOnDuplicateName(error, input.name ?? existing.name);
  }
  if (!updated) {
    throw new NotFoundError('Nincs ilyen kategória.');
  }

  publishEventChange(updated.eventId, { type: 'category.updated', category: updated });
  return updated;
}

/**
 * A törlés két lépés, tranzakció nélkül, és a SORREND számít: előbb kerül le a
 * kategória a kiadásokról, csak utána tűnik el maga a kategória. Ha a második
 * lépés elbukik, egy árva, senkihez nem kötött kategória marad — az újra
 * törölhető. Fordítva a kiadásokon egy már nem létező kategóriára mutató id
 * maradna, amit semmi nem takarítana el.
 * @param {string} id
 */
export async function deleteCategory(id) {
  const existing = await getCategoryOrThrow(id);
  const event = await getEventOrThrow(existing.eventId);
  assertNotArchived(event);

  await expenseRepository.detachCategory(existing.eventId, id);

  const deleted = await categoryRepository.deleteCategoryById(id);
  if (!deleted) {
    throw new NotFoundError('Nincs ilyen kategória.');
  }

  publishEventChange(deleted.eventId, { type: 'category.deleted', categoryId: deleted.id });
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
 * @param {string} id
 */
async function getCategoryOrThrow(id) {
  const category = await categoryRepository.findCategoryById(id);
  if (!category) {
    throw new NotFoundError('Nincs ilyen kategória.');
  }
  return category;
}

/**
 * @param {{ archived?: boolean }} event
 */
function assertNotArchived(event) {
  if (event.archived) {
    throw new ConflictError(
      'Az esemény archivált: a kategóriái nem hozhatók létre, nem szerkeszthetők és nem törölhetők.',
    );
  }
}

/**
 * @param {unknown} error
 * @param {string} name
 */
function toConflictOnDuplicateName(error, name) {
  if (error?.code === 11000) {
    return new ConflictError(`Már van "${name}" nevű kategória ezen az eseményen.`);
  }
  return error;
}
