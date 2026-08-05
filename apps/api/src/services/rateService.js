import * as rateCacheRepository from '../repositories/rateCacheRepository.js';
import { fetchRateFromApi } from './currencyApiClient.js';
import { todayDateOnly } from '../utils/dateOnly.js';
import { AppError } from '../errors.js';

/**
 * @typedef {{ rate: string, fetchedAt: Date, source: 'api' | 'cache' | 'manual' }} RateResult
 */

/**
 * Visszaadja egy valutapár árfolyamát. Azonos pénznemre "1"-et ad API-hívás
 * nélkül. Naponta legfeljebb egyszer hív ki élő API-t egy adott párra —
 * ugyanazon a napon a korábban cache-elt érték jön vissza. Ha az élő hívás
 * hibázik, a legutóbbi cache-elt érték jön vissza source:"cache" jelzéssel;
 * ha az sincs, hibázik.
 * @param {{ apiUrl: string, apiKey: string, from: string, to: string }} params
 * @returns {Promise<RateResult>}
 */
export async function getRate({ apiUrl, apiKey, from, to }) {
  if (from === to) {
    return { rate: '1', fetchedAt: new Date(), source: 'manual' };
  }

  const date = todayDateOnly();
  const cachedToday = await rateCacheRepository.findForDate(from, to, date);
  if (cachedToday) {
    return { rate: cachedToday.rate, fetchedAt: cachedToday.fetchedAt, source: 'cache' };
  }

  try {
    const live = await fetchRateFromApi({ apiUrl, apiKey, from, to });
    await rateCacheRepository.upsertForDate({ from, to, date, ...live });
    return { rate: live.rate, fetchedAt: live.fetchedAt, source: 'api' };
  } catch (apiError) {
    const fallback = await rateCacheRepository.findLatest(from, to);
    if (fallback) {
      return { rate: fallback.rate, fetchedAt: fallback.fetchedAt, source: 'cache' };
    }
    throw new AppError(
      'RATE_UNAVAILABLE',
      'Nem sikerült lekérni az árfolyamot, és nincs korábbi cache-elt érték.',
      502,
      { cause: apiError.message },
    );
  }
}
