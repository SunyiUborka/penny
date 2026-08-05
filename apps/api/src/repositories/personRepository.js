import { PersonModel } from '../models/personModel.js';

const NAME_COLLATION = { locale: 'en', strength: 2 };

/**
 * @param {import('mongoose').Document} doc
 */
function serialize(doc) {
  const { _id, __v, ...rest } = doc.toObject();
  return { id: _id.toString(), ...rest };
}

export async function listPeople() {
  const docs = await PersonModel.find().sort({ name: 1 }).collation(NAME_COLLATION);
  return docs.map(serialize);
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function findPersonById(id) {
  const doc = await PersonModel.findById(id);
  return doc ? serialize(doc) : null;
}

/**
 * @param {{ name: string }} input
 */
export async function createPerson(input) {
  const doc = await PersonModel.create(input);
  return serialize(doc);
}

/**
 * @param {string} id
 * @param {{ name: string }} input
 * @returns {Promise<object | null>}
 */
export async function updatePerson(id, input) {
  const doc = await PersonModel.findByIdAndUpdate(id, input, {
    new: true,
    runValidators: true,
  });
  return doc ? serialize(doc) : null;
}

/**
 * @param {string} id
 * @returns {Promise<object | null>} a törölt személy, vagy null, ha nem létezett
 */
export async function deletePersonById(id) {
  const doc = await PersonModel.findByIdAndDelete(id);
  return doc ? serialize(doc) : null;
}

/**
 * @param {string[]} ids
 * @returns {Promise<number>} a létező személyek száma a megadott azonosítók közül
 */
export function countExistingByIds(ids) {
  return PersonModel.countDocuments({ _id: { $in: ids } });
}
