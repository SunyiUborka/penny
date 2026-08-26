import { Decimal } from 'decimal.js';
import { exchangeRateStringSchema } from '@filler/shared';
import { frankfurterRateSchema } from '../schemas/currencyApi.js';

const TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 500;
const PERMANENT_STATUS_CODES = new Set([400, 404, 422]);

class RateApiError extends Error {
  /**
   * @param {string} message
   * @param {boolean} permanent
   */
  constructor(message, permanent) {
    super(message);
    this.name = 'RateApiError';
    this.permanent = permanent;
  }
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {string} url
 */
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} url
 * @returns {Promise<{ rate: string, fetchedAt: Date }>}
 */
async function requestOnce(url) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new RateApiError(
      `Árfolyam API HTTP hiba: ${response.status}`,
      PERMANENT_STATUS_CODES.has(response.status),
    );
  }

  const row = frankfurterRateSchema.parse(await response.json());

  const rate = exchangeRateStringSchema.parse(new Decimal(row.rate).toString());

  return { rate, fetchedAt: new Date() };
}

/**
 * @param {{ baseUrl: string, from: string, to: string }} params
 * @returns {Promise<{ rate: string, fetchedAt: Date }>}
 */
export async function fetchRateFromApi({ baseUrl, from, to }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/v2/rate/${from}/${to}`;

  const attempts = 2;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (attempt > 0) {
        await sleep(RETRY_DELAY_MS * 2 ** (attempt - 1));
      }
      return await requestOnce(url);
    } catch (error) {
      lastError = error;
      if (error instanceof RateApiError && error.permanent) {
        break;
      }
    }
  }

  throw lastError;
}
