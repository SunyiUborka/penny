import { SettlementPaymentModel } from '../models/settlementPaymentModel.js';

/**
 * @param {import('mongoose').Document} doc
 */
function serialize(doc) {
  const { _id, __v, eventId, fromId, toId, ...rest } = doc.toObject();
  return {
    id: _id.toString(),
    eventId: eventId.toString(),
    fromId: fromId.toString(),
    toId: toId.toString(),
    ...rest,
  };
}

/**
 * Egy esemény kiegyenlítései, a kiadásokkal azonos rendezésben: dátum szerint
 * csökkenő, egyező dátumon a később rögzített előbb.
 * @param {string} eventId
 */
export async function listForEvent(eventId) {
  const docs = await SettlementPaymentModel.find({ eventId }).sort({ date: -1, createdAt: -1 });
  return docs.map(serialize);
}

/**
 * @param {string} clientId
 * @returns {Promise<object | null>}
 */
export async function findByClientId(clientId) {
  const doc = await SettlementPaymentModel.findOne({ clientId });
  return doc ? serialize(doc) : null;
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function findPaymentById(id) {
  const doc = await SettlementPaymentModel.findById(id);
  return doc ? serialize(doc) : null;
}

/**
 * @param {string} id
 * @param {object} input
 * @returns {Promise<object | null>}
 */
export async function updatePayment(id, input) {
  const doc = await SettlementPaymentModel.findByIdAndUpdate(
    id,
    { $set: input },
    { new: true, runValidators: true },
  );
  return doc ? serialize(doc) : null;
}

/**
 * @param {object} input
 */
export async function createPayment(input) {
  const doc = await SettlementPaymentModel.create(input);
  return serialize(doc);
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function deletePaymentById(id) {
  const doc = await SettlementPaymentModel.findByIdAndDelete(id);
  return doc ? serialize(doc) : null;
}

/**
 * @param {string} eventId
 */
export function deleteAllForEvent(eventId) {
  return SettlementPaymentModel.deleteMany({ eventId });
}

/**
 * Az esemény azon kiegyenlítései, amikben a megadott személyek közül legalább
 * egy fizetőként vagy kedvezményezettként szerepel — a résztvevő-eltávolítás
 * integritási ellenőrzéséhez.
 * @param {string} eventId
 * @param {string[]} personIds
 */
export async function findByEventAndPersonInvolved(eventId, personIds) {
  const docs = await SettlementPaymentModel.find({
    eventId,
    $or: [{ fromId: { $in: personIds } }, { toId: { $in: personIds } }],
  }).select('date fromId toId baseAmountMinor');
  return docs.map(serializeReference);
}

/**
 * A személy törlésének integritási ellenőrzéséhez: minden kiegyenlítés, amiben
 * a személy bármely eseményben szerepel.
 * @param {string} personId
 */
export async function findByPersonInvolved(personId) {
  const docs = await SettlementPaymentModel.find({
    $or: [{ fromId: personId }, { toId: personId }],
  }).select('date fromId toId baseAmountMinor eventId');
  return docs.map(serializeReference);
}

/**
 * A hibaválaszok `details`-ébe kerülő, szűk alak. A kiegyenlítésnek nincs
 * leírása (mint a kiadásnak), amivel a felhasználó azonosítani tudná, ezért a
 * dátum és a két fél azonosítója megy vissza.
 * @param {import('mongoose').Document} doc
 */
function serializeReference(doc) {
  return {
    id: doc._id.toString(),
    date: doc.date,
    fromId: doc.fromId.toString(),
    toId: doc.toId.toString(),
    baseAmountMinor: doc.baseAmountMinor,
  };
}
