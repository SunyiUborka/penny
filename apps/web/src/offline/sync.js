import { Network } from '@capacitor/network';
import { expenseResponseSchema, SETTLEMENT_CURRENCY } from '@filler/shared';
import { apiClient, ApiError } from '../api/client.js';
import { listEntries, markFailed, refreshCounts, removeEntry } from './outbox.js';
import { fetchFreshRate } from './rates.js';
import { useExpensesStore } from '../stores/expenses.js';

/** Egyszerre csak egy futás legyen, különben ugyanaz az elem kétszer menne fel. */
let running = false;

/**
 * A sorbanállított módosítások feltöltése, létrehozásuk sorrendjében.
 *
 * A `failed` állapotú elemeket nem próbáljuk újra automatikusan: ezek
 * felhasználói döntést igényelnek (lásd a Szinkronizálás képernyőt).
 * @returns {Promise<{ uploaded: number, failed: number }>}
 */
export async function syncOutbox() {
  if (running) {
    return { uploaded: 0, failed: 0 };
  }
  running = true;
  let uploaded = 0;
  let failed = 0;

  try {
    const entries = await listEntries();
    for (const entry of entries) {
      if (entry.status !== 'pending') {
        continue;
      }
      try {
        await uploadEntry(entry);
        await removeEntry(entry.id);
        if (entry.type === 'create') {
          // A store `upsertExpense`-e az `id` alapján dolgozik, a szerver
          // viszont saját azonosítót ad a létrehozott kiadásnak — emiatt ez
          // sosem cserélné le a listában lévő `pending:<uuid>` szintetikus
          // sort, a felhasználó duplán látná a kiadást. A valódi sort az SSE
          // (vagy egy következő frissítés) hozza be; a szintetikusat nekünk
          // kell eltüntetnünk, itt, a sikeres feltöltés részeként.
          useExpensesStore().removeExpense(`pending:${entry.id}`);
        }
        uploaded += 1;
      } catch (error) {
        if (error instanceof ApiError) {
          // A szerver érdemben válaszolt: az elem így, ebben a formában nem
          // mehet fel. Megtartjuk, de a felhasználó dönt a sorsáról.
          await markFailed(entry.id, error.message);
          failed += 1;
        } else {
          // Hálózathiba: a sor marad pending, a következő futás újrapróbálja.
          break;
        }
      }
    }
  } finally {
    running = false;
    await refreshCounts();
  }

  return { uploaded, failed };
}

/**
 * Egyetlen bejegyzés feltöltése.
 * @param {object} entry
 * @returns {Promise<void>}
 */
async function uploadEntry(entry) {
  if (entry.type === 'delete') {
    await apiClient.delete(`/expenses/${entry.expenseId}`);
    return;
  }

  const payload = await withFreshRate(entry.payload);

  if (entry.type === 'create') {
    await apiClient.post(`/events/${entry.eventId}/expenses`, payload, {
      schema: expenseResponseSchema,
    });
    return;
  }

  await apiClient.patch(`/expenses/${entry.expenseId}`, payload, {
    schema: expenseResponseSchema,
  });
}

/**
 * Devizás kiadásnál a feltöltéskor érvényes árfolyammal dolgozunk: a felvitel
 * pillanatában legfeljebb egy cache-elt becslés állt rendelkezésre.
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function withFreshRate(payload) {
  if (payload.currency === SETTLEMENT_CURRENCY || payload.rateSource === 'manual') {
    return payload;
  }
  try {
    const fresh = await fetchFreshRate(payload.currency, SETTLEMENT_CURRENCY);
    return { ...payload, exchangeRate: fresh.rate, rateFetchedAt: fresh.fetchedAt };
  } catch {
    // Ha most sem sikerül árfolyamot kérni, a becsléssel megyünk tovább —
    // ez még mindig jobb, mint a kiadást a sorban ragasztani.
    return payload;
  }
}

/**
 * Automatikus szinkron: hálózat visszatérésekor és előtérbe kerüléskor.
 * @returns {Promise<void>}
 */
export async function startAutoSync() {
  await Network.addListener('networkStatusChange', (status) => {
    if (status.connected) {
      syncOutbox().catch(() => {
        // A szinkron hibája nem törheti meg az appot; az elemek a sorban
        // maradnak, a következő alkalommal újrapróbáljuk.
      });
    }
  });

  // Előtérbe kerüléskor is szinkronizálunk. Szándékosan `visibilitychange`,
  // nem a `@capacitor/app` `appStateChange`-e: az élő-frissítés kör óta a
  // stream újrakapcsolódása és a pótló újratöltés is ezen az eseményen áll
  // (lásd `apps/web/src/stores/expenses.js`), és két párhuzamos
  // előtérbe-kerülés-mechanizmus csak széttartani tudna.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncOutbox().catch(() => {});
    }
  });

  await syncOutbox();
}
