import { geoApiConvertResponseSchema } from '../schemas/currencyApi.js';

const TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 500;

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
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lekéri az árfolyamot a getgeoapi.com API-ról, 5 mp timeouttal és egy
 * újrapróbálkozással exponenciális backoffal.
 * @param {{ apiUrl: string, apiKey: string, from: string, to: string }} params
 * @returns {Promise<{ rate: string, fetchedAt: Date }>}
 */
export async function fetchRateFromApi({ apiUrl, apiKey, from, to }) {
  const url = new URL(apiUrl);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('amount', '1');

  const attempts = 2;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (attempt > 0) {
        await sleep(RETRY_DELAY_MS * 2 ** (attempt - 1));
      }
      return await requestOnce(url.toString(), to);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

/**
 * @param {string} url
 * @param {string} to
 */
async function requestOnce(url, to) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Árfolyam API HTTP hiba: ${response.status}`);
  }

  const json = await response.json();
  const parsed = geoApiConvertResponseSchema.parse(json);

  if (parsed.status !== 'success') {
    throw new Error(`Árfolyam API hiba: status=${parsed.status}`);
  }

  const rateEntry = parsed.rates[to];
  if (!rateEntry) {
    throw new Error(`Árfolyam API válaszban nincs "${to}" pénznem.`);
  }

  return { rate: rateEntry.rate, fetchedAt: new Date() };
}
