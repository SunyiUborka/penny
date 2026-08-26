import { RateCacheModel } from '../models/rateCacheModel.js';
import { shiftDateOnly } from '../utils/dateOnly.js';

const FALLBACK_MAX_AGE_DAYS = 7;

/**
 * @param {string} from
 * @param {string} to
 * @param {string} date ÉÉÉÉ-HH-NN
 */
export function findForDate(from, to, date) {
  return RateCacheModel.findOne({ from, to, date });
}

/**
 * @param {string} from
 * @param {string} to
 * @param {string} date ÉÉÉÉ-HH-NN
 */
export function findFallback(from, to, date) {
  return RateCacheModel.findOne({
    from,
    to,
    date: { $lte: date, $gte: shiftDateOnly(date, -FALLBACK_MAX_AGE_DAYS) },
  }).sort({ date: -1 });
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
