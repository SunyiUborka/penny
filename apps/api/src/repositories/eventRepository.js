import { EventModel } from '../models/eventModel.js';
import { parseDateOnly } from '../utils/dateOnly.js';

/**
 * @param {import('mongoose').Document} doc
 */
function serialize(doc) {
  const { _id, __v, participantIds, ...rest } = doc.toObject();
  return { id: _id.toString(), participantIds: participantIds.map(String), ...rest };
}

/**
 * ÉÉÉÉ-HH-NN dátum-string mezőket Date-té alakít mentés előtt. A nem
 * megadott (undefined) mezőket érintetlenül hagyja, hogy a részleges
 * frissítés (PATCH) csak a valóban küldött mezőket módosítsa.
 * @param {object} input
 */
function toDocumentData(input) {
  const data = { ...input };
  if (data.startDate !== undefined) {
    data.startDate = parseDateOnly(data.startDate);
  }
  if (data.endDate !== undefined) {
    data.endDate = parseDateOnly(data.endDate);
  }
  return data;
}

export async function listEvents() {
  const docs = await EventModel.find().sort({ createdAt: -1 });
  return docs.map(serialize);
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function findEventById(id) {
  const doc = await EventModel.findById(id);
  return doc ? serialize(doc) : null;
}

/**
 * @param {object} input
 */
export async function createEvent(input) {
  const doc = await EventModel.create(toDocumentData(input));
  return serialize(doc);
}

/**
 * @param {string} id
 * @param {object} input
 * @returns {Promise<object | null>}
 */
export async function updateEvent(id, input) {
  const doc = await EventModel.findByIdAndUpdate(id, toDocumentData(input), {
    new: true,
    runValidators: true,
  });
  return doc ? serialize(doc) : null;
}

/**
 * @param {string} id
 * @returns {Promise<object | null>} a törölt esemény, vagy null, ha nem létezett
 */
export async function deleteEventById(id) {
  const doc = await EventModel.findByIdAndDelete(id);
  return doc ? serialize(doc) : null;
}

/**
 * @param {string} personId
 * @returns {Promise<{ id: string, name: string }[]>} események, amikben a személy résztvevő
 */
export async function findEventsByParticipantId(personId) {
  const docs = await EventModel.find({ participantIds: personId }).select('name');
  return docs.map((doc) => ({ id: doc._id.toString(), name: doc.name }));
}
