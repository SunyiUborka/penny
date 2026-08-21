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
  try {
    await writeCache(cacheKey(from, to), { rate: result.rate, fetchedAt: result.fetchedAt });
  } catch (writeError) {
    // Ugyanaz a védett írás, mint az `offline/cache.js` `fetchWithCache`-ében
    // (és a `refreshIntoCache`-ében): egy írási hiba (betelt vagy megtagadott
    // tárhely, privát böngészés) nem ronthatja el egy MÁR SIKERES hálózati
    // választ. Enélkül egy sikeres `/rates` hívás retryable hibává változott:
    // a `withFreshRate` `RateResolutionError`-ba csomagolta, a `syncOutbox`
    // megállt — vagyis a tárhelyhiba a teljes sort megállította, pedig a friss
    // árfolyam ott volt a kezünkben (végső review M9).
    console.error('Nem sikerült az árfolyamot a cache-be írni:', writeError);
  }
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

/**
 * Igaz, ha a payloadban lévő árfolyam **becslés**: devizás a kiadás, az
 * árfolyam a szervertől jött (`api`), de nem a mai napról — vagyis pontosan
 * az az eset, amit a felület `≈`-vel jelöl (lásd a 10.3 szakaszt: a becslést
 * a `fetchedAt` NAPJA dönti el, nem a válasz `source` mezője).
 *
 * Ez a döntés szándékosan itt, az árfolyam-modulban él, és nem a hívóknál:
 * a „mi számít becslésnek" szabálynak egyetlen helye lehet, különben a
 * felület jelölése és a feltöltés újra-feloldása széttarthat.
 *
 * **Csak olyan árfolyamra értelmes, amit az űrlap maga oldott fel** (lásd
 * `ExpenseModal.vue` `rateResolvedByForm`). Egy szerkesztésre betöltött,
 * hónapokkal korábbi kiadás öröklött árfolyama ugyanígy `api` eredetű és
 * ugyanígy nem mai — ez a függvény tehát becslésnek látná, pedig az a kiadás
 * korabeli, végleges árfolyama. Ezért a hívóknak ELŐBB a
 * `rateResolvedByForm` tényt kell megkérdezniük, és csak azon belül ezt
 * (végső re-review U2).
 *
 * @param {{ currency: string, rateSource?: string, rateFetchedAt?: Date | string | null }} payload
 * @returns {boolean}
 */
export function isEstimatedRate(payload) {
  if (payload.currency === SETTLEMENT_CURRENCY || payload.rateSource !== 'api') {
    return false;
  }
  if (!payload.rateFetchedAt) {
    // Nem tudjuk, mikori az árfolyam — a zárt irányba tévedünk, és
    // becslésnek tekintjük (inkább kérjük le újra, mint hogy egy ismeretlen
    // korú érték maradjon véglegesként).
    return true;
  }
  const fetchedAt = new Date(payload.rateFetchedAt);
  return Number.isNaN(fetchedAt.getTime()) || !isToday(fetchedAt);
}

/**
 * Azok a HTTP-státuszkódok, amik magáról az ÁRFOLYAMRÓL szóló, végleges
 * verdiktet jelentenek: `400` (a kérés érvénytelen, pl. nem támogatott
 * devizapár) és `404`. Ugyanezzel a kéréssel újra próbálkozva ez mindig
 * ugyanígy elbukna — az `offline/sync.js` `PAYLOAD_VERDICT_STATUS_CODES`
 * halmazának megfelelője, csak a `409` nélkül (annak a `/rates`-en nincs
 * értelme: nincs `clientId`, amivel ütközhetne).
 *
 * **Minden más `ApiError` átmeneti.** Ez nem elméleti: a `/rates` elsőrangú
 * átmeneti hibája az `502 RATE_UNAVAILABLE`, amit a szerver akkor ad, ha a
 * külső árfolyam-szolgáltató hívása hibázott ÉS a szerver saját cache-e sem
 * segít — az pedig romlandó, a `rateCacheModel` 24 órás TTL-indexe miatt.
 * Ha a `502`-t végleges verdiktnek vennénk, egy kimerült API-kvóta mellett
 * minden sorbanálló devizás kiadás a napokkal korábbi becsléssel menne fel
 * `rateSource: 'api'`-ként, és a sor a feltöltés után már nem `pending`,
 * tehát a `≈` és az elszámolás figyelmeztetése is eltűnne: a felhasználó egy
 * elavult becslésből számolt egyenleget látna véglegesként (végső review I6).
 * Ugyanezt a `502`-t az OLVASÁSI út (`fetchRateWithCache`) hangosan
 * továbbdobja, és kézi árfolyam-megadást kér — az ÍRÁSI út, ami a számot
 * örökre eltárolja, nem lehet ennél engedékenyebb.
 * @type {ReadonlySet<number>}
 */
const RATE_VERDICT_STATUS_CODES = new Set([400, 404]);

/**
 * Igaz, ha a hiba magáról az árfolyamról szóló végleges verdikt (lásd fent).
 * @param {ApiError} error
 * @returns {boolean}
 */
function isRateVerdict(error) {
  return RATE_VERDICT_STATUS_CODES.has(error.statusCode);
}

/**
 * Az árfolyam frissítése közben történt, a kiadás írásáról semmit nem
 * mondó, **átmeneti** hiba (hálózathiba a `/rates` felé, a válasza nem illik
 * a sémára, vagy a szerver egy nem az árfolyamról szóló hibát adott — pl.
 * `502 RATE_UNAVAILABLE`). Szándékosan külön típus, nem puszta továbbdobás: a `syncOutbox`
 * osztályozója enélkül a kiváltó kivétel TÍPUSA alapján döntene — egy innen
 * származó `ZodError`-t tévesen a KIADÁS-válasz kontraktus-töréseként
 * kezelne, és véglegesen `failed`-be tenne egy olyan kiadást, amit még fel
 * sem küldtünk. Ez a típus a hiba EREDETE alapján osztályoz, nem a
 * TÍPUSA alapján — a `syncOutbox` ezt ugyanúgy retryable-nek veszi, mint
 * egy sima hálózathibát. Ne egyszerűsítsük vissza puszta `throw error`-ra;
 * az eredeti hiba a `cause`-ban megmarad diagnosztikai célra.
 */
export class RateResolutionError extends Error {
  /**
   * @param {unknown} cause
   */
  constructor(cause) {
    super('Az árfolyam frissítése nem sikerült.');
    this.name = 'RateResolutionError';
    this.cause = cause;
  }
}

/**
 * Devizás kiadás payloadja **frissen lekért** árfolyammal: a felvitel
 * pillanatában legfeljebb egy cache-elt becslés állt rendelkezésre.
 *
 * Ez a függvény szándékosan itt lakik, és nem a szinkron-motorban: **mindkét
 * írási út** hívja — a `stores/expenses.js` `createExpense`-e a mentés
 * pillanatában (ha az űrlapon becsült árfolyam van), és az `offline/sync.js`
 * a sorbanállított tétel feltöltésekor (ha a bejegyzés árfolyamát az űrlap
 * oldotta fel, lásd `needsFreshRate`). Amíg csak a szinkron-motorban élt,
 * egy közvetlenül sikeres POST teljesen kihagyta, tehát egy becsült árfolyam
 * VÉGLEGESEN tárolt értékké válhatott — miközben a modal jegyzete és a
 * dokumentáció is az ellenkezőjét ígérte (végső review I5). Az
 * `offline/rates.js` az a hely, ahonnan mindkét hívó elérheti anélkül, hogy
 * import-kört hoznánk létre (a `sync.js` a kiadás-store-t importálja, tehát
 * a store nem importálhatja a `sync.js`-t).
 *
 * @param {object} payload
 * @returns {Promise<object>} a payload friss árfolyammal (vagy változatlanul,
 * ha nincs mit frissíteni, illetve ha a szerver véglegesen nemet mondott)
 * @throws {RateResolutionError} ha az árfolyam nem dőlt el véglegesen — ilyenkor
 * a hívónak sorban kell hagynia a tételt, nem szabad becslést véglegesíteni
 */
export async function withFreshRate(payload) {
  if (payload.currency === SETTLEMENT_CURRENCY || payload.rateSource === 'manual') {
    return payload;
  }
  try {
    const fresh = await fetchFreshRate(payload.currency, SETTLEMENT_CURRENCY);
    return { ...payload, exchangeRate: fresh.rate, rateFetchedAt: fresh.fetchedAt };
  } catch (error) {
    if (error instanceof ApiError && isRateVerdict(error)) {
      // A szerver ténylegesen nemet mondott MAGÁRA AZ ÁRFOLYAMRA (pl. nem
      // támogatott devizapár) — ez végleges verdikt, a becsléssel megyünk
      // tovább: ez még mindig jobb, mint a kiadást a sorban ragasztani.
      return payload;
    }
    // Átmeneti hiba: hálózathiba, sémaeltérés, vagy a szerver egy nem az
    // árfolyamról szóló válasza (`401`/`403` lejárt munkamenet, `408`/`429`,
    // és minden `5xx` — köztük a `/rates` `502 RATE_UNAVAILABLE`-je). Nem
    // tudjuk, mi a friss árfolyam, de ez nem végleges — nem szabad csendben
    // ráfogni a becslésre, hogy az a végleges érték. A tételnek `pending`-en kell maradnia, hogy a
    // következő (remélhetőleg sikeres) próbálkozáskor valódi árfolyammal
    // menjen fel. A `RateResolutionError`-ba csomagolva dobjuk tovább, nem
    // nyersen: a `syncOutbox` osztályozója különben a kiváltó kivétel
    // TÍPUSA (pl. egy itteni `ZodError`) alapján tévesen a KIADÁS-válasz
    // kontraktus-töréseként kezelné, és véglegesen `failed`-be tenne egy
    // olyan kiadást, amit még fel sem küldtünk.
    throw new RateResolutionError(error);
  }
}

export { SETTLEMENT_CURRENCY };
