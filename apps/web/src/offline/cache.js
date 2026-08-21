import { ZodError } from 'zod';
import { CACHE_STORE, getDb } from './db.js';
import { toPlain } from './plain.js';
import { ApiError } from '../api/client.js';
import { useOfflineStore } from '../stores/offline.js';

/**
 * @param {string} key
 * @param {import('zod').ZodType} schema
 * @returns {Promise<{ value: unknown, fetchedAt: Date } | null>}
 */
export async function readCache(key, schema) {
  const db = await getDb();
  const row = await db.get(CACHE_STORE, key);
  if (!row) {
    return null;
  }
  try {
    // Újravalidálás: egy app-frissítés után a régi cache alakja már nem
    // feltétlenül illik a mai sémára — ilyenkor inkább nincs cache.
    return { value: schema.parse(row.value), fetchedAt: row.fetchedAt };
  } catch {
    await db.delete(CACHE_STORE, key);
    return null;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
export async function writeCache(key, value) {
  const db = await getDb();
  // `toPlain`: ugyanaz a védelem, mint az outboxban — az IndexedDB nem tud
  // `Proxy`-t klónozni, és egy jövőbeli hívó könnyen reaktív store-adatot
  // adna ide (a cache írása ma hálózat-friss választ kap, de a határt akkor
  // is itt kell tartani). Lásd `offline/plain.js`.
  await db.put(CACHE_STORE, { key, value: toPlain(value), fetchedAt: new Date() });
}

/**
 * Csendes háttérfrissítés: **kizárólag hálózat**, cache-tartalék NÉLKÜL — de a
 * sikeres választ ugyanúgy a cache-be írja és a kulcsot frissnek jelöli, mint a
 * `fetchWithCache`.
 *
 * Miért nem elég erre az `apiClient` közvetlen hívása: a `setFresh` egyedül a
 * `fetchWithCache`-ből futott, viszont a helyreállási utak (stream
 * újrakapcsolódás, előtérbe kerülés, lehúzásos frissítés) MIND csendes
 * frissítést hívnak. Egy egyszer elavultra jelölt kulcs így a munkamenet
 * végéig elavult maradt: a felhasználó látta frissülni a listát, miközben az
 * `OfflineBanner` továbbra is azt állította, hogy régi adatot néz — két,
 * egymásnak ellentmondó jelzés ugyanazon a képernyőn, és a hangosabbik hamis
 * (lásd a végső review I4 pontját). A cache írása ugyanezt a rést zárja a
 * lemezen lévő másolaton: enélkül a csendes frissítéssel behozott sorok soha
 * nem kerültek offline másolatba.
 *
 * Bukáskor szándékosan **dob**, és semmit nem változtat: a hívó nyeli el a
 * hibát, és a képernyőn hagyja a láthatót. Cache-re esni itt tilos lenne —
 * ott már látszik adat, egy cache-re-esés csak lecserélhetné egy régebbi
 * másolatra (a `fetchWithCache`-csel szembeni szándékos különbség).
 *
 * @param {{ key: string, request: () => Promise<unknown> }} options
 * @returns {Promise<unknown>} a hálózatról kapott érték
 */
export async function refreshIntoCache(options) {
  const { key, request } = options;
  const value = await request();
  const fetchedAt = new Date();
  try {
    await writeCache(key, value);
  } catch (writeError) {
    // Ugyanaz a szabály, mint a `fetchWithCache`-ben: egy írási hiba (betelt
    // vagy megtagadott tárhely) nem ronthatja el egy már sikeres hálózati
    // választ — ekkor a cache csak degradált, nem a lekérés bukott el.
    console.error('Nem sikerült a csendes frissítés válaszát a cache-be írni:', writeError);
  }
  // A frissesség a KULCSRA vonatkozik, nem arra, hogy a hívó felhasználja-e a
  // választ: ha közben másik eseményre navigáltunk, ez az adat akkor is friss
  // (és a cache-ben is friss), csak nem ezen a képernyőn látszik.
  useOfflineStore().setFresh(key, fetchedAt);
  return value;
}

/**
 * Hálózat-először olvasás cache-tartalékkal.
 *
 * Csak a hálózat tényleges elérhetetlensége esik vissza a cache-re. Két
 * hibatípust szándékosan nem kezelünk tartalékként:
 *  - `ApiError`: a szerver ténylegesen válaszolt (404, 401, validációs hiba)
 *    — ez nem hálózathiba, a hívónak kell kezelnie;
 *  - `ZodError`: a válasz 2xx volt, de a törzse nem illik a várt sémára —
 *    ez azt jelenti, hogy a szerver és a kliens elvárása szétcsúszott. Ezt
 *    hangosan kell jelezni, mert egy csendes cache-re-esés örökre elrejtené
 *    ezt a szerződés-eltérést.
 *
 * @param {{ key: string, schema: import('zod').ZodType, request: () => Promise<unknown> }} options
 * @returns {Promise<{ value: unknown, stale: boolean, fetchedAt: Date }>}
 */
export async function fetchWithCache(options) {
  const { key, schema, request } = options;
  const offlineStore = useOfflineStore();

  try {
    const value = await request();
    const fetchedAt = new Date();
    try {
      await writeCache(key, value);
    } catch (writeError) {
      // Egy írási hiba (betelt vagy megtagadott tárhely) nem ronthatja el
      // egy már sikeres hálózati választ — ekkor a cache csak degradált,
      // nem a lekérés bukott el.
      console.error('Nem sikerült a választ a cache-be írni:', writeError);
    }
    offlineStore.setFresh(key, fetchedAt);
    return { value, stale: false, fetchedAt };
  } catch (error) {
    if (error instanceof ApiError || error instanceof ZodError) {
      throw error;
    }
    const cached = await readCache(key, schema);
    if (!cached) {
      throw error;
    }
    offlineStore.setStale(key, cached.fetchedAt);
    return { value: cached.value, stale: true, fetchedAt: cached.fetchedAt };
  }
}
