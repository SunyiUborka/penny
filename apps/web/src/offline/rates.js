import { z, ZodError } from 'zod';
import { rateResponseSchema, SETTLEMENT_CURRENCY } from '@filler/shared';
import { apiClient, ApiError } from '../api/client.js';
import { readCache, writeCache } from './cache.js';

const cachedRateSchema = z.object({
  rate: z.string(),
  fetchedAt: z.coerce.date(),
});

/**
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
function cacheKey(from, to) {
  return `rate:${from}:${to}`;
}

/**
 * Árfolyam kizárólag a hálózatról. A sorbanállított kiadások feltöltésekor ezt
 * hívjuk: ott már van kapcsolat, és a végleges árfolyamot friss adatból kell
 * meghatározni. A `source` mezőt is visszaadja: a szerver 200-as, sémahelyes
 * válasza mögött állhat a szerver saját, órákkal-napokkal korábbi
 * tartalék-árfolyama is (lásd `fetchRateWithCache`).
 * @param {string} from
 * @param {string} to
 * @returns {Promise<{ rate: string, fetchedAt: Date, source: 'api' | 'cache' | 'manual' }>}
 */
export async function fetchFreshRate(from, to) {
  const result = await apiClient.get(`/rates?from=${from}&to=${to}`, {
    schema: rateResponseSchema,
  });
  await writeCache(cacheKey(from, to), { rate: result.rate, fetchedAt: result.fetchedAt });
  return { rate: result.rate, fetchedAt: result.fetchedAt, source: result.source };
}

/**
 * Árfolyam hálózatról, tartalékként a legutóbb ismert értékkel. Az `estimated`
 * jelzi, hogy becsült (elavult) árfolyamot adtunk vissza — a felület ezt `≈`
 * jelöléssel mutatja, a végleges érték a feltöltéskor dől el.
 * @param {string} from
 * @param {string} to
 * @returns {Promise<{ rate: string, fetchedAt: Date, estimated: boolean }>}
 */
export async function fetchRateWithCache(from, to) {
  try {
    const fresh = await fetchFreshRate(from, to);
    // A 200-as, sémahelyes válasz önmagában nem jelenti, hogy élő árfolyamot
    // kaptunk: ha a szerver saját élő API-hívása hibázott, a rateService.js
    // a nála korábban eltárolt (akár napokkal ezelőtti) árfolyamot adja
    // vissza `source: 'cache'` jelzéssel — ez a mi szempontunkból ugyanúgy
    // becslés, mint a saját helyi cache-tartalékunk, csak a hiba a szerver
    // oldalán történt, nem a mi hálózatunkban. Ezért csak a `source: 'api'`
    // számít valóban frissnek.
    return { rate: fresh.rate, fetchedAt: fresh.fetchedAt, estimated: fresh.source !== 'api' };
  } catch (error) {
    // A cache.js `fetchWithCache`-ével azonos szabály: ha a szerver ténylegesen
    // válaszolt (ApiError) vagy a válasz alakja nem illik a sémára (ZodError),
    // az nem hálózathiba — ezt hangosan kell jelezni, nem elrejteni egy
    // becsléssel. Csak a besorolatlan (átvitel-szintű) hibáknál esünk vissza
    // a legutóbb ismert árfolyamra.
    if (error instanceof ApiError || error instanceof ZodError) {
      throw error;
    }
    const cached = await readCache(cacheKey(from, to), cachedRateSchema);
    if (!cached) {
      throw error;
    }
    return { rate: cached.value.rate, fetchedAt: cached.value.fetchedAt, estimated: true };
  }
}

export { SETTLEMENT_CURRENCY };
