import { RateCacheModel } from '../models/rateCacheModel.js';

/**
 * @param {string} from
 * @param {string} to
 * @param {string} date ÉÉÉÉ-HH-NN
 */
export function findForDate(from, to, date) {
  return RateCacheModel.findOne({ from, to, date });
}

/**
 * A legutóbb (bármelyik napra) cache-elt árfolyam egy valutapárra —
 * hibatűrő fallbackhez, ha az élő API hívás sikertelen.
 * @param {string} from
 * @param {string} to
 */
export function findLatest(from, to) {
  return RateCacheModel.findOne({ from, to }).sort({ fetchedAt: -1 });
}

/**
 * @param {{ from: string, to: string, date: string, rate: string, fetchedAt: Date }} input
 */
export function upsertForDate({ from, to, date, rate, fetchedAt }) {
  return RateCacheModel.findOneAndUpdate(
    { from, to, date },
    { $set: { rate, fetchedAt } },
    { upsert: true, new: true },
  );
}
