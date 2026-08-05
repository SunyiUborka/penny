import { Types } from 'mongoose';
import { ExpenseModel } from '../models/expenseModel.js';

/**
 * @param {import('mongoose').Document} doc
 */
function serialize(doc) {
  const { _id, __v, eventId, payerId, sharedWithIds, ...rest } = doc.toObject();
  return {
    id: _id.toString(),
    eventId: eventId.toString(),
    payerId: payerId.toString(),
    sharedWithIds: sharedWithIds.map(String),
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
  const doc = await ExpenseModel.findByIdAndUpdate(id, input, { new: true, runValidators: true });
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
