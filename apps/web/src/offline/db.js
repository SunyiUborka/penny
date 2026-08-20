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
    });
  }
  return dbPromise;
}
