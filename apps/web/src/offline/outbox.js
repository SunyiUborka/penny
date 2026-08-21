import { toPlain } from './plain.js';
import { getDb, OUTBOX_STORE } from './db.js';
import { useOfflineStore } from '../stores/offline.js';

/**
 * Sorbanállított kiadás-módosítás felvétele.
 *
 * A `rateResolvedByForm` **kliensoldali kísérő tény**, nem a kiadás adata: a
 * bejegyzés mellett utazik, a `payload`-on KÍVÜL — így szerkezetileg kizárt,
 * hogy a feltöltéskor a szerverre kerüljön (a feltöltő a `payload`-ot küldi,
 * változatlanul). Azt mondja meg, hogy a payloadban lévő árfolyamot az űrlap
 * oldotta-e fel a beküldés pillanatában (jelenkori árfolyam), vagy a
 * szerkesztett kiadás korabeli, eltárolt árfolyamát örököltük — ebből tudja a
 * szinkron-motor, hogy szabad-e feltöltéskor újra feloldani (lásd
 * `offline/sync.js` `needsFreshRate`).
 * @param {{ type: 'create'|'update'|'delete', eventId: string, expenseId?: string, clientId?: string, payload?: object, rateResolvedByForm?: boolean }} entry
 * @returns {Promise<object>}
 */
export async function enqueue(entry) {
  const db = await getDb();
  const row = {
    id: crypto.randomUUID(),
    type: entry.type,
    eventId: entry.eventId,
    expenseId: entry.expenseId ?? null,
    clientId: entry.clientId ?? null,
    // `toPlain`: a payload az űrlapról jön, ahol a `sharedWithIds` reaktív
    // tömb (Vue `Proxy`) — azt az IndexedDB strukturált klónozása nem tudja
    // lemásolni, és a `put` DataCloneError-ral elhasal. Lásd `offline/plain.js`.
    payload: entry.payload ? toPlain(entry.payload) : null,
    rateResolvedByForm: entry.rateResolvedByForm ?? false,
    status: 'pending',
    error: null,
    createdAt: new Date(),
  };
  await db.put(OUTBOX_STORE, row);
  await refreshCounts();
  return row;
}

/** @returns {Promise<object[]>} */
export async function listEntries() {
  const db = await getDb();
  const rows = await db.getAll(OUTBOX_STORE);
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * @param {string} eventId
 * @returns {Promise<object[]>}
 */
export async function listByEvent(eventId) {
  const rows = await listEntries();
  return rows.filter((row) => row.eventId === eventId);
}

/**
 * @param {string} id
 * @param {string} message
 * @returns {Promise<void>}
 */
export async function markFailed(id, message) {
  await updateStatus(id, 'failed', message);
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function markPending(id) {
  await updateStatus(id, 'pending', null);
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function removeEntry(id) {
  const db = await getDb();
  await db.delete(OUTBOX_STORE, id);
  await refreshCounts();
}

/** @returns {Promise<void>} */
export async function refreshCounts() {
  const rows = await listEntries();
  useOfflineStore().setCounts({
    pending: rows.filter((row) => row.status === 'pending').length,
    failed: rows.filter((row) => row.status === 'failed').length,
  });
}

/**
 * @param {string} id
 * @param {'pending'|'failed'} status
 * @param {string | null} message
 * @returns {Promise<void>}
 */
async function updateStatus(id, status, message) {
  const db = await getDb();
  const row = await db.get(OUTBOX_STORE, id);
  if (!row) {
    return;
  }
  await db.put(OUTBOX_STORE, { ...row, status, error: message });
  await refreshCounts();
}
