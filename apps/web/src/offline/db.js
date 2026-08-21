import { openDB } from 'idb';

const DB_NAME = 'filler-offline';
const DB_VERSION = 1;

export const CACHE_STORE = 'cache';
export const OUTBOX_STORE = 'outbox';

/** @type {Promise<import('idb').IDBPDatabase> | null} */
let dbPromise = null;

/**
 * Az offline adatbázis. Két store: a `cache` a szervertől kapott listák
 * legutóbbi állapotát tartja, az `outbox` a még fel nem töltött
 * kiadás-módosításokat.
 * @returns {Promise<import('idb').IDBPDatabase>}
 */
export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          const outbox = db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
          outbox.createIndex('status', 'status');
        }
      },
    }).catch((error) => {
      // Egy elutasított promise is truthy: ha bent hagynánk a cache-ben, egy
      // elsőre bukott megnyitás (privát böngészés, letiltott tárolás) után az
      // offline réteg soha nem állna helyre. Nullázzuk, hogy a következő hívás
      // újra megpróbálhassa.
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/**
 * A teljes helyi tár ürítése: a cache-elt olvasások ÉS a még fel nem
 * töltött írások. Szerverváltáskor hívjuk — a másik szerver adatai mások,
 * egy ott felvett kiadás feltöltése pedig idegen eseményre mutatna.
 * @returns {Promise<void>}
 */
export async function clearOfflineData() {
  const db = await getDb();
  await db.clear(CACHE_STORE);
  await db.clear(OUTBOX_STORE);
}
