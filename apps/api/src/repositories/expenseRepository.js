import { Types } from 'mongoose';
import { ExpenseModel } from '../models/expenseModel.js';

/**
 * A tétel osztozói a Mongo-ból `ObjectId` példányként jönnek, a válaszséma
 * `personIdSchema`-ja viszont stringet vár — enélkül a séma-validáció a
 * kimenetnél hasal el.
 * @param {object} item
 */
function serializeItem(item) {
  return { ...item, sharedWithIds: item.sharedWithIds.map(String) };
}

/**
 * @param {import('mongoose').Document} doc
 */
function serialize(doc) {
  const { _id, __v, eventId, payerId, sharedWithIds, items, ...rest } = doc.toObject();
  return {
    id: _id.toString(),
    eventId: eventId.toString(),
    payerId: payerId.toString(),
    sharedWithIds: sharedWithIds.map(String),
    // Üres/hiányzó tétellistánál a mezőt KI SEM írjuk: a válaszséma az
    // `items`-et opcionálisnak, de nem üresnek fogadja el — a tételezés
    // hiányát a mező elhagyása jelenti.
    ...(items?.length ? { items: items.map(serializeItem) } : {}),
    ...rest,
  };
}

/**
 * @param {string} eventId
 */
export async function listForEvent(eventId) {
  const docs = await ExpenseModel.find({ eventId }).sort({ date: -1, createdAt: -1 });
  return docs.map(serialize);
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function findExpenseById(id) {
  const doc = await ExpenseModel.findById(id);
  return doc ? serialize(doc) : null;
}

/**
 * @param {string} clientId
 * @returns {Promise<object | null>}
 */
export async function findExpenseByClientId(clientId) {
  const doc = await ExpenseModel.findOne({ clientId });
  return doc ? serialize(doc) : null;
}

/**
 * @param {object} input
 */
export async function createExpense(input) {
  const doc = await ExpenseModel.create(input);
  return serialize(doc);
}

/**
 * @param {string} id
 * @param {object} input
 * @returns {Promise<object | null>}
 */
export async function updateExpense(id, input) {
  const { items, ...withoutItems } = input;
  // A `findByIdAndUpdate` az undefined mezőket kihagyja a `$set`-ből (erre
  // támaszkodik a `clientId` megőrzése is, lásd `expenseService`), tehát egy
  // tételes → egyszerű szerkesztésnél a régi `items` bent maradna: a lista a
  // helyes végösszeget mutatná, az elszámolás viszont a megmaradt tételekből
  // számolna. Ezért a tételek hiánya kifejezett `$unset`.
  const update = items ? { $set: input } : { $set: withoutItems, $unset: { items: 1 } };
  const doc = await ExpenseModel.findByIdAndUpdate(id, update, {
    new: true,
    runValidators: true,
  });
  return doc ? serialize(doc) : null;
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function deleteExpenseById(id) {
  const doc = await ExpenseModel.findByIdAndDelete(id);
  return doc ? serialize(doc) : null;
}

/**
 * @param {string} eventId
 */
export function deleteAllForEvent(eventId) {
  return ExpenseModel.deleteMany({ eventId });
}

/**
 * Az esemény azon kiadásai, amikben a megadott személyek közül legalább egy
 * fizetőként vagy osztozóként szerepel — a résztvevő-eltávolítás
 * integritási ellenőrzéséhez.
 * @param {string} eventId
 * @param {string[]} personIds
 */
export async function findByEventAndPersonInvolved(eventId, personIds) {
  const docs = await ExpenseModel.find({
    eventId,
    $or: [{ payerId: { $in: personIds } }, { sharedWithIds: { $in: personIds } }],
  }).select('description');
  return docs.map((doc) => ({ id: doc._id.toString(), description: doc.description }));
}

/**
 * A személy törlésének integritási ellenőrzéséhez: az összes olyan kiadás,
 * amiben a személy bármely eseményben fizetőként vagy osztozóként szerepel.
 * @param {string} personId
 */
export async function findByPersonInvolved(personId) {
  const docs = await ExpenseModel.find({
    $or: [{ payerId: personId }, { sharedWithIds: personId }],
  }).select('description eventId');
  return docs.map((doc) => ({ id: doc._id.toString(), description: doc.description }));
}

/**
 * @param {string[]} eventIds
 * @returns {Promise<Map<string, object[]>>} eseményenkénti kiadáslisták
 */
export async function listByEventIds(eventIds) {
  const docs = await ExpenseModel.find({
    eventId: { $in: eventIds.map((id) => new Types.ObjectId(id)) },
  }).sort({ date: -1, createdAt: -1 });

  const byEvent = new Map(eventIds.map((id) => [id, []]));
  for (const doc of docs) {
    byEvent.get(doc.eventId.toString())?.push(serialize(doc));
  }
  return byEvent;
}

/**
 * Eseményenkénti kiadás-összköltség (alapvalutában), az események
 * listázásához.
 * @param {string[]} eventIds
 * @returns {Promise<Map<string, number>>}
 */
export async function sumBaseAmountByEvent(eventIds) {
  const rows = await ExpenseModel.aggregate([
    { $match: { eventId: { $in: eventIds.map((id) => new Types.ObjectId(id)) } } },
    { $group: { _id: '$eventId', total: { $sum: '$baseAmountMinor' } } },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), row.total]));
}
