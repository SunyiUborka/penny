import * as rateCacheRepository from '../repositories/rateCacheRepository.js';
import { fetchRateFromApi } from './currencyApiClient.js';
import { todayDateOnly } from '../utils/dateOnly.js';
import { AppError } from '../errors.js';

/**
 * @typedef {{ rate: string, fetchedAt: Date, source: 'api' | 'cache' | 'stale' | 'manual' }} RateResult
 */

/**
 * Visszaadja egy valutapár árfolyamát a kért napra. Azonos pénznemre "1"-et ad
 * API-hívás nélkül. Egy (pár, nap) hármasra legfeljebb egyszer hív ki élő
 * API-t — utána a cache-elt érték jön vissza. Ha az élő hívás hibázik, a
 * kért napot legfeljebb egy héttel megelőző utolsó cache-elt érték jön vissza
 * source:"stale" jelzéssel; ha az sincs, hibázik.
 * @param {{ baseUrl: string, from: string, to: string, date?: string }} params
 * @returns {Promise<RateResult>}
 */
export async function getRate({ baseUrl, from, to, date }) {
  if (from === to) {
    return { rate: '1', fetchedAt: new Date(), source: 'manual' };
  }

  const today = todayDateOnly();
  const requestedDate = date && date < today ? date : today;
  const isHistorical = requestedDate !== today;

  const cached = await rateCacheRepository.findForDate(from, to, requestedDate);
  if (cached) {
    return { rate: cached.rate, fetchedAt: cached.fetchedAt, source: 'cache' };
  }

  try {
    const live = await fetchRateFromApi({
      baseUrl,
      from,
      to,
      date: isHistorical ? requestedDate : undefined,
    });
    await rateCacheRepository.upsertForDate({ from, to, date: requestedDate, ...live });
    return { rate: live.rate, fetchedAt: live.fetchedAt, source: 'api' };
  } catch (apiError) {
    const fallback = await rateCacheRepository.findFallback(from, to, requestedDate);
    if (fallback) {
      return { rate: fallback.rate, fetchedAt: fallback.fetchedAt, source: 'stale' };
    }
    throw new AppError(
      'RATE_UNAVAILABLE',
      'Nem sikerült lekérni az árfolyamot, és nincs korábbi cache-elt érték.',
      502,
      { cause: apiError.message },
    );
  }
}
