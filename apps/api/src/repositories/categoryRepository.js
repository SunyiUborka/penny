import { CategoryModel } from '../models/categoryModel.js';

const NAME_COLLATION = { locale: 'hu', strength: 1 };

/**
 * @param {import('mongoose').Document} doc
 */
function serialize(doc) {
  const { _id, __v, eventId, ...rest } = doc.toObject();
  return { id: _id.toString(), eventId: eventId.toString(), ...rest };
}

/**
 * @param {string} eventId
 */
export async function listForEvent(eventId) {
  const docs = await CategoryModel.find({ eventId }).sort({ name: 1 }).collation(NAME_COLLATION);
  return docs.map(serialize);
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function findCategoryById(id) {
  const doc = await CategoryModel.findById(id);
  return doc ? serialize(doc) : null;
}

/**
 * @param {{ eventId: string, name: string, color: string }} input
 */
export async function createCategory(input) {
  const doc = await CategoryModel.create(input);
  return serialize(doc);
}

/**
 * @param {string} id
 * @param {{ name?: string, color?: string }} input
 * @returns {Promise<object | null>}
 */
export async function updateCategory(id, input) {
  const doc = await CategoryModel.findByIdAndUpdate(id, input, {
    new: true,
    runValidators: true,
  });
  return doc ? serialize(doc) : null;
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function deleteCategoryById(id) {
  const doc = await CategoryModel.findByIdAndDelete(id);
  return doc ? serialize(doc) : null;
}

/**
 * @param {string} eventId
 */
export function deleteAllForEvent(eventId) {
  return CategoryModel.deleteMany({ eventId });
}

/**
 * @param {string} eventId
 * @param {string[]} ids
 * @returns {Promise<number>} hány megadott azonosító tartozik EHHEZ az eseményhez
 */
export function countExistingByEventAndIds(eventId, ids) {
  return CategoryModel.countDocuments({ eventId, _id: { $in: ids } });
}
