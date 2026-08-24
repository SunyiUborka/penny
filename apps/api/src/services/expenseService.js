import { convertExpenseAmounts, SETTLEMENT_CURRENCY } from '@filler/shared';
import * as expenseRepository from '../repositories/expenseRepository.js';
import * as eventRepository from '../repositories/eventRepository.js';
import * as categoryRepository from '../repositories/categoryRepository.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { publishEventChange } from './eventBus.js';
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
  if (input.clientId) {
    const existing = await expenseRepository.findExpenseByClientId(input.clientId);
    if (existing) {
      // Idempotencia: a kliens újraküldte egy már befogadott kiadását (pl. a
      // válasz veszett el). Nem hozunk létre másodikat, és nem is publikálunk
      // új eseményt — a többi kliens ezt már megkapta.
      assertSameEvent(existing, eventId, input.clientId);
      return existing;
    }
  }

  const event = await getEventOrThrow(eventId);
  assertNotArchived(event);
  assertParticipants(event, input);
  await assertCategories(eventId, input);
  const data = buildExpenseData(input);

  let created;
  try {
    created = await expenseRepository.createExpense({ ...data, eventId });
  } catch (error) {
    // Verseny két egyidejű újraküldés között: az egyedi index elkapja, és a
    // már létrejött rekordot adjuk vissza. A re-query attól helyes akkor is,
    // ha egyszer egy második egyedi index is kerül a kollekcióra: az csak
    // akkor talál egyezést, ha valóban létezik ilyen clientId-jű dokumentum,
    // tehát a duplikátumkénti kezelés helyes marad függetlenül attól, hogy
    // melyik index dobta az E11000-et.
    const duplicate = input.clientId && error?.code === 11000;
    if (!duplicate) {
      throw error;
    }
    const existing = await expenseRepository.findExpenseByClientId(input.clientId);
    if (!existing) {
      throw error;
    }
    assertSameEvent(existing, eventId, input.clientId);
    return existing;
  }

  publishEventChange(eventId, { type: 'expense.created', expense: created });
  return created;
}

/**
 * A clientId globálisan egyedi (az index csak a clientId mezőn van, eventId
 * nélkül), tehát pontosan egy kiadáshoz — és ezzel egy eseményhez — tartozhat.
 * Ha a kérés egy másik esemény alatt hivatkozik rá, az kliensi hiba: nem
 * csendes idempotens találat, hanem 409-et kell dobni, különben a hívó egy
 * másik esemény kiadását kapná vissza sikeres válaszként.
 * @param {{ eventId: string }} existing
 * @param {string} eventId
 * @param {string} clientId
 */
function assertSameEvent(existing, eventId, clientId) {
  if (existing.eventId !== eventId) {
    throw new ConflictError(
      `A(z) "${clientId}" clientId már egy másik eseményhez tartozó kiadáshoz van rendelve.`,
      { clientId, expenseEventId: existing.eventId, requestedEventId: eventId },
    );
  }
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
  assertNotArchived(event);
  assertParticipants(event, input);
  await assertCategories(existing.eventId, input);
  const data = buildExpenseData(input);

  const updated = await expenseRepository.updateExpense(id, data);
  if (!updated) {
    throw new NotFoundError('Nincs ilyen kiadás.');
  }
  publishEventChange(updated.eventId, { type: 'expense.updated', expense: updated });
  return updated;
}

/**
 * @param {string} id
 */
export async function deleteExpense(id) {
  const existing = await expenseRepository.findExpenseById(id);
  if (!existing) {
    throw new NotFoundError('Nincs ilyen kiadás.');
  }
  const event = await getEventOrThrow(existing.eventId);
  assertNotArchived(event);

  const deleted = await expenseRepository.deleteExpenseById(id);
  if (!deleted) {
    throw new NotFoundError('Nincs ilyen kiadás.');
  }
  publishEventChange(deleted.eventId, { type: 'expense.deleted', expenseId: deleted.id });
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
 * @param {{ archived?: boolean }} event
 */
function assertNotArchived(event) {
  if (event.archived) {
    throw new ConflictError(
      'Az esemény archivált: a kiadásai nem hozhatók létre, nem szerkeszthetők és nem törölhetők.',
    );
  }
}

/**
 * A tételekre nincs külön ellenőrzés, és ez nem kihagyás: a kérés sémája
 * megköveteli, hogy minden tétel osztozója a kiadás `sharedWithIds`-ében
 * legyen, ez a függvény pedig a `sharedWithIds`-et az esemény résztvevőihez
 * méri. Az `items ⊆ sharedWithIds ⊆ event.participantIds` láncból következik,
 * hogy egy tétel-osztozó sem lehet kívülálló.
 *
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
 * @param {string} eventId
 * @param {{ categoryIds?: string[] }} input
 */
async function assertCategories(eventId, input) {
  const categoryIds = input.categoryIds ?? [];
  if (categoryIds.length === 0) {
    return;
  }
  const existing = await categoryRepository.countExistingByEventAndIds(eventId, categoryIds);
  if (existing !== categoryIds.length) {
    throw new ValidationError('A kategóriák az esemény kategóriái közül kell legyenek.', {
      categoryIds,
    });
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
  // Egy helyen, a shared csomagban: minden tétel külön váltódik a kiadás
  // egyetlen (itt már kikényszerített) árfolyamával, és a kiadás
  // `baseAmountMinor`-ja a tételek forint-összegeinek összege.
  const { baseAmountMinor, items } = convertExpenseAmounts({
    amountMinor: input.amountMinor,
    items: input.items,
    currency: input.currency,
    exchangeRate,
  });

  return {
    // Update-hívásnál (updateExpenseBodySchema === createExpenseBodySchema)
    // input.clientId jellemzően undefined — ez szándékosan marad undefined,
    // nem null. A Mongoose (jelenleg 8.24.2) az undefined mezőket kihagyja a
    // $set-ből findByIdAndUpdate-nél, tehát ez ma nem-op, nem törli a meglévő
    // clientId-t. Ha ezt "rendbe tennénk" null alapértékre, egy második ilyen
    // update már $set: { clientId: null }-t küldene, ami a sparse-unique
    // clientId indexbe ütközne (a null nem "hiányzó" a sparse szempontjából).
    clientId: input.clientId,
    date: parseDateOnly(input.date),
    description: input.description,
    payerId: input.payerId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    exchangeRate,
    rateSource,
    rateFetchedAt,
    baseAmountMinor,
    items,
    sharedWithIds: input.sharedWithIds,
    categoryIds: input.categoryIds ?? [],
  };
}
