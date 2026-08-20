import { ZodError } from 'zod';
import { CACHE_STORE, getDb } from './db.js';
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
  await db.put(CACHE_STORE, { key, value, fetchedAt: new Date() });
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
