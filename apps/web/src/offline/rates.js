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
 * Igaz, ha a dátum a mai napra esik. UTC szerint hasonlít, nem helyi idő
 * szerint: a szerver a napi árfolyam-cache kulcsát `todayDateOnly()`-vel
 * (`new Date().toISOString().slice(0, 10)`, azaz UTC) képezi, és csak így
 * kapunk ugyanolyan választ estefelé Budapesten, mint amit a szerver ad —
 * helyi időre cserélve ez a két oldal telefonálná szét ugyanazt a napot.
 * @param {Date} date
 * @returns {boolean}
 */
function isToday(date) {
  const todayUtc = new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10) === todayUtc;
}

/**
 * Árfolyam kizárólag a hálózatról. A sorbanállított kiadások feltöltésekor ezt
 * hívjuk: ott már van kapcsolat, és a végleges árfolyamot friss adatból kell
 * meghatározni.
 * @param {string} from
 * @param {string} to
 * @returns {Promise<{ rate: string, fetchedAt: Date }>}
 */
export async function fetchFreshRate(from, to) {
  const result = await apiClient.get(`/rates?from=${from}&to=${to}`, {
    schema: rateResponseSchema,
  });
  await writeCache(cacheKey(from, to), { rate: result.rate, fetchedAt: result.fetchedAt });
  return { rate: result.rate, fetchedAt: result.fetchedAt };
}

/**
 * Árfolyam hálózatról, tartalékként a legutóbb ismert értékkel. Az `estimated`
 * jelzi, hogy becsült (elavult) árfolyamot adtunk vissza — a felület ezt `≈`
 * jelöléssel mutatja, a végleges érték a feltöltéskor dől el.
 *
 * A becslést a `fetchedAt` napja dönti el, nem a szerver válaszának `source`
 * mezője: a szerver naponta legfeljebb egyszer hív ki élő API-t egy adott
 * valutapárra, minden aznapi további lekérés `source: "cache"`-t ad vissza,
 * pedig ez a normál, egészséges eset — ha erre becslés-jelzést tennénk,
 * majdnem mindig látszódna a jelölés, elveszítve az értelmét. Az egyetlen
 * valóban elavult eset az, amikor a szerver saját élő hívása hibázott, és egy
 * korábbi napról származó tartalék árfolyamot adott vissza — ezt viszont a
 * `source` mező önmagában nem különbözteti meg az aznapi cache-től, csak a
 * `fetchedAt` napja árulja el.
 * @param {string} from
 * @param {string} to
 * @returns {Promise<{ rate: string, fetchedAt: Date, estimated: boolean }>}
 */
export async function fetchRateWithCache(from, to) {
  try {
    const fresh = await fetchFreshRate(from, to);
    return { ...fresh, estimated: !isToday(fresh.fetchedAt) };
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
    return {
      rate: cached.value.rate,
      fetchedAt: cached.value.fetchedAt,
      estimated: !isToday(cached.value.fetchedAt),
    };
  }
}

export { SETTLEMENT_CURRENCY };
