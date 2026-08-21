import { defineStore } from 'pinia';
import { ZodError } from 'zod';
import {
  convertMinorAmount,
  expenseListResponseSchema,
  expenseResponseSchema,
  expenseStreamMessageSchema,
  SETTLEMENT_CURRENCY,
} from '@filler/shared';
import { apiClient, ApiError } from '../api/client.js';
import { openEventStream } from '../api/eventStream.js';
import { fetchWithCache, refreshIntoCache } from '../offline/cache.js';
import { enqueue, listByEvent, refreshCounts } from '../offline/outbox.js';

/** Meddig van kiemelve egy frissen érkezett sor. */
const FRESH_MS = 1600;

// Modulszinten, nem a store state-jében: a stream lezárója és a timerek nem
// reaktív adatok, a Pinia state-be téve csak feleslegesen proxyzódnának.
let closeStream = null;
let streamEventId = null;
let visibilityHandler = null;
const freshTimers = new Map();

/**
 * A legutóbb kért esemény azonosítója. A `fetchExpenses` állítja be minden
 * hívásakor — ez az egyetlen hely, ami a „jelenleg látott esemény”-t
 * deklarálja. Egy nagyon gyors, egymást követő navigáció esetén a korábbi
 * kérés válasza később is megérkezhet, mint a következőé — enélkül az a
 * lista beleírna egy másik esemény nézetébe. A `refreshQuietly` is ezt
 * olvassa (lásd `isCurrentEvent`), hogy egy elkésett csendes frissítés se
 * írhassa felül, sem játszhassa vissza az outbox-ot egy már elhagyott
 * esemény nézetében.
 */
let latestFetchEventId = null;

/**
 * Igaz, ha `eventId` még mindig a ténylegesen látott esemény — tehát egy rá
 * vonatkozó, korábban elindított kérés válasza nem elkésett.
 * @param {string} eventId
 * @returns {boolean}
 */
function isCurrentEvent(eventId) {
  return latestFetchEventId === eventId;
}

/**
 * A szerverrel azonos rendezés: dátum szerint csökkenő, egyező dátumon a
 * később rögzített előbb (lásd expenseRepository.listForEvent).
 * @param {{ date: Date, createdAt: Date }} a
 * @param {{ date: Date, createdAt: Date }} b
 */
function compareExpenses(a, b) {
  const byDate = b.date.getTime() - a.date.getTime();
  return byDate === 0 ? b.createdAt.getTime() - a.createdAt.getTime() : byDate;
}

/**
 * Hova kell beszúrni a kiadást, hogy a lista rendezett maradjon.
 * @param {Array<object>} expenses
 * @param {object} expense
 */
function insertIndexFor(expenses, expense) {
  const index = expenses.findIndex((item) => compareExpenses(item, expense) > 0);
  return index === -1 ? expenses.length : index;
}

/**
 * Ugyanaz a számítás, amit a szerver `buildExpenseData`-ja végez — csak
 * (deviza esetén) a felvitelkor/szerkesztéskor ismert, esetleg cache-elt
 * árfolyammal. NE a nyers `amountMinor` kerüljön a listába: az elszámolás
 * ebből a listából számol, tehát egy 10 EUR-os kiadás 10 forintként rontaná el
 * az egyenlegeket. A végleges érték a feltöltéskor, friss árfolyammal dől el.
 *
 * Ezt hívja mind a létrehozás (`toPendingExpense`), mind a szerkesztés
 * (`toPendingUpdate`) sorbaállított alakja — egy helyen, hogy a két út ne
 * csúszhasson szét a forint-átváltás számításában.
 * @param {{ amountMinor: number, currency: string, exchangeRate: string }} payload
 * @returns {number}
 */
function computePendingBaseAmountMinor({ amountMinor, currency, exchangeRate }) {
  return currency === SETTLEMENT_CURRENCY
    ? amountMinor
    : convertMinorAmount({
        amountMinor,
        rate: exchangeRate,
        sourceCurrency: currency,
        targetCurrency: SETTLEMENT_CURRENCY,
      });
}

/**
 * A sorbanállított, újonnan létrehozott kiadás listában megjelenítendő
 * alakja. Az `id` prefixe megkülönbözteti a szervertől kapott kiadásoktól, a
 * `pending` jelzőt pedig a felület használja.
 * @param {object} entry outbox bejegyzés
 * @returns {object}
 */
function toPendingExpense(entry) {
  return {
    ...entry.payload,
    id: `pending:${entry.id}`,
    eventId: entry.eventId,
    date: new Date(entry.payload.date),
    baseAmountMinor: computePendingBaseAmountMinor(entry.payload),
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    pending: true,
  };
}

/**
 * Egy meglévő (szinkronizált vagy már pending) kiadásra alkalmazott,
 * sorbaállított szerkesztés listában megjelenítendő alakja. A forint-érték itt
 * is `computePendingBaseAmountMinor`-ral számol, nem a régi (vagy nyers)
 * összegből marad bent — így egy devizás szerkesztés is helyesen látszik az
 * elszámolásban a feltöltésig.
 * @param {object} existing a listában lévő kiadás
 * @param {object} payload a szerkesztés bemenete (`ExpenseModal` alakja)
 * @returns {object}
 */
function toPendingUpdate(existing, payload) {
  return {
    ...existing,
    ...payload,
    // A `date` az űrlapról (és az outbox payload-ból) ÉÉÉÉ-HH-NN string, a
    // listában viszont Date — a rendezés (compareExpenses) getTime()-ot hív
    // rá.
    date: new Date(payload.date),
    baseAmountMinor: computePendingBaseAmountMinor(payload),
    pending: true,
  };
}

export const useExpensesStore = defineStore('expenses', {
  state: () => ({
    expenses: [],
    loading: false,
    error: null,
    /** Áll-e élő kapcsolat a szerverrel (a UI kapcsolatjelzőjéhez). */
    connected: false,
    /** A frissen érkezett, kiemelt sorok azonosítói. */
    freshIds: new Set(),
  }),
  actions: {
    /**
     * Igaz, ha `eventId` a ténylegesen megnyitott esemény ebben a lapban —
     * ugyanaz a nyilvántartás, amit a modul belül az elkésett válaszok
     * kiszűrésére használ (lásd a modulszintű `isCurrentEvent`-et). Ez az
     * egyetlen hivatalos forrás arra, hogy "melyik eseményt nézi éppen ez a
     * lap" — külső hívók (pl. a szinkron-motor) ezt kérdezzék le, ne egy
     * saját, a lista tartalmából kitalált közelítést vezessenek be
     * (a `expenses` tömb ugyanis nem particionál eseményenként).
     * @param {string} eventId
     * @returns {boolean}
     */
    isViewingEvent(eventId) {
      return isCurrentEvent(eventId);
    },

    /**
     * @param {string} eventId
     */
    async fetchExpenses(eventId) {
      this.loading = true;
      this.error = null;
      latestFetchEventId = eventId;
      try {
        const result = await fetchWithCache({
          key: `expenses:${eventId}`,
          schema: expenseListResponseSchema,
          request: () =>
            apiClient.get(`/events/${eventId}/expenses`, { schema: expenseListResponseSchema }),
        });
        if (latestFetchEventId !== eventId) {
          // Közben egy másik eseményre navigáltunk, és az a hívás már
          // felülírta, melyik esemény számít „aktuálisnak” — ez a válasz
          // elkésett, nem írhatja felül egy másik esemény listáját.
          return;
        }
        this.expenses = result.value;
      } catch (error) {
        if (latestFetchEventId !== eventId) {
          return;
        }
        this.error = error;
      } finally {
        if (latestFetchEventId === eventId) {
          this.loading = false;
        }
      }
    },

    /**
     * Az app újraindítása után a sorbanállított kiadásoknak is látszaniuk kell
     * a listában, nem csak a szinkron képernyőn.
     * @param {string} eventId
     */
    async loadPending(eventId) {
      const entries = await listByEvent(eventId);
      for (const entry of entries) {
        if (entry.type === 'create') {
          this.upsertExpense(toPendingExpense(entry));
        }
        if (entry.type === 'update' && entry.expenseId) {
          const existing = this.expenses.find((expense) => expense.id === entry.expenseId);
          // Ha a célkiadás nincs (még) a listában — másutt törölték, vagy a
          // lista még nem töltötte be —, nem találunk ki egy sort a
          // semmiből: a feltöltés (és a szinkron képernyő) dönti majd el, mi
          // legyen ezzel a bejegyzéssel.
          if (existing) {
            this.upsertExpense(toPendingUpdate(existing, entry.payload));
          }
        }
        if (entry.type === 'delete' && entry.expenseId) {
          this.removeExpense(entry.expenseId);
        }
      }
      // Az app újraindítása után az outbox számlálói (pending/failed) nulláról
      // indulnának a következő sorbaállításig — enélkül a szinkron képernyő
      // (következő feladat) egy elavult, hamis nulla-állapotot örökölne.
      await refreshCounts();
    },

    /**
     * Újratöltés a „Betöltés…” állapot felvillantása nélkül. Újrakapcsolódás
     * és fül-előtérbe-kerülés után hívjuk: ilyenkor a lista már látszik, és
     * egy villanó betöltés-jelző zavaróbb, mint hasznos.
     *
     * Ez a művelet pótolja a szakadás alatt elmaradt üzeneteket — ezért nincs
     * szerveroldali Last-Event-ID puffer.
     *
     * A kapcsolat pontosan akkor tér vissza, amikor ez lefut (stream
     * újrakapcsolódás, fül előtérbe kerülése, lehúzásos frissítés) — ha csak a
     * szerver listáját tennénk be, egy sorbaálló létrehozás/törlés/szerkesztés
     * sora eltűnne/visszaállna a képernyőn, miközben az outbox (és a pending
     * számláló) még mindig tartalmazza. A `loadPending` visszajátszása ezért
     * ugyanúgy idetartozik ide, mint az `EventDetailView` `fetchExpenses`-t
     * követő láncába.
     *
     * A hívó (stream, `visibilitychange`, lehúzásos frissítés) egy adott
     * eseményhez van kötve az indításkor — ha a felhasználó időközben másik
     * eseményre navigál, mire ez a kérés visszaér, se a lista felülírása, se
     * az outbox visszajátszása nem történhet meg: az `isCurrentEvent`
     * ellenőrzés (a `fetchExpenses` mintájára) mindkét lépés előtt kizárja
     * ezt, nem csak a lista beírása előtt.
     * @param {string} eventId
     */
    async refreshQuietly(eventId) {
      try {
        // `refreshIntoCache`, nem közvetlen `apiClient`: a sikeres csendes
        // frissítés a cache-t is felírja, és az `expenses:<eseményId>`
        // kulcsot frissnek jelöli. Enélkül minden helyreállási út (stream
        // újrakapcsolódás, előtérbe kerülés, lehúzásos frissítés) elkerülte
        // a `setFresh`-t, tehát az offline sáv a munkamenet végéig azt
        // állította, hogy elavult adat látszik — miközben a felhasználó
        // szeme előtt frissült a lista (lásd a végső review I4 pontját).
        // Bukáskor dob, és a `catch` hagyja a láthatót: itt továbbra sincs
        // cache-tartalék, tehát a képernyőn lévő listát nem cserélheti le
        // egy nála régebbi másolat.
        const expenses = await refreshIntoCache({
          key: `expenses:${eventId}`,
          request: () =>
            apiClient.get(`/events/${eventId}/expenses`, { schema: expenseListResponseSchema }),
        });
        if (!isCurrentEvent(eventId)) {
          // Közben másik eseményre navigáltunk (ugyanaz a helyzet, mint a
          // `fetchExpenses`-nél): ez a válasz elkésett, nem írhatja felül,
          // ami épp látszik.
          return;
        }
        this.expenses = expenses;
        // Egy korábbi sikertelen betöltés hibaüzenete itt már elavult: a
        // sikeres csendes frissítés a bizonyíték, hogy a kapcsolat helyreállt.
        this.error = null;
        if (!isCurrentEvent(eventId)) {
          // Ugyanaz az ellenőrzés a visszajátszás előtt is: a `loadPending`
          // se játszhassa vissza egy már elhagyott esemény outbox-bejegyzéseit
          // a jelenlegi (más eseményhez tartozó) nézetbe.
          return;
        }
        await this.loadPending(eventId);
      } catch {
        // Csendben bukik is: a látható (elavult) lista többet ér egy
        // hibaüzenetnél, és a következő újratöltés helyrehozza.
      }
    },

    /**
     * Feliratkozás az esemény élő kiadás-frissítéseire. A transzport
     * (EventSource vagy natív fetch-stream) az `openEventStream` dolga — ez a
     * store csak üzeneteket kap.
     * @param {string} eventId
     */
    subscribe(eventId) {
      this.unsubscribe();

      let opened = false;
      streamEventId = eventId;

      closeStream = openEventStream({
        path: `/events/${eventId}/stream`,
        onOpen: () => {
          this.connected = true;
          // Újrakapcsolódás után pótolni kell a szakadás alatt elmaradt
          // üzeneteket — ezért nincs szerveroldali Last-Event-ID puffer.
          if (opened) {
            this.refreshQuietly(eventId);
          }
          opened = true;
        },
        onClose: () => {
          this.connected = false;
        },
        onMessage: (data) => {
          this.applyStreamMessage(data);
        },
      });

      // Előtérbe kerüléskor (fülváltás böngészőben, app-váltás telefonon) a
      // stream lehet, hogy közben elhalt. Ez a frissítés akkor is behozza a
      // kimaradt változásokat, ha az újrakapcsolódás késik.
      visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          this.refreshQuietly(eventId);
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    },

    /**
     * @param {string} [eventId] ha meg van adva, csak akkor zár, ha valóban
     * ehhez az eseményhez tartozik a nyitott stream — így egy későn lefutó
     * onUnmounted nem tudja lezárni a közben már megnyílt új streamet
     */
    unsubscribe(eventId) {
      if (eventId !== undefined && streamEventId !== eventId) {
        return;
      }
      if (closeStream) {
        closeStream();
        closeStream = null;
      }
      streamEventId = null;
      if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
      }
      for (const timer of freshTimers.values()) {
        clearTimeout(timer);
      }
      freshTimers.clear();
      this.freshIds.clear();
      this.connected = false;
      // Enélkül az előző esemény kiadásai látszódnának a következő esemény
      // nézetén, amíg annak `fetchExpenses`-e le nem fut.
      this.expenses = [];
      this.error = null;
    },

    /**
     * @param {string} data az SSE üzenet nyers JSON törzse
     */
    applyStreamMessage(data) {
      let message;
      try {
        message = expenseStreamMessageSchema.parse(JSON.parse(data));
      } catch {
        // Értelmezhetetlen üzenetet eldobunk, nem rontjuk el vele a listát.
        return;
      }

      if (message.type === 'expense.deleted') {
        this.removeExpense(message.expenseId);
        return;
      }

      this.upsertExpense(message.expense, { highlight: true });
    },

    /**
     * Idempotens beszúrás/csere, a lista rendezését megtartva.
     *
     * A saját mutációk után ugyanaz a kiadás az SSE-n is visszajön hozzánk —
     * ezért kell az idempotencia (nem duplikálhat), és ezért nem villantjuk
     * fel újra: az `updatedAt` egyezése azt jelenti, hogy ezt a változást már
     * mi magunk alkalmaztuk.
     * @param {object} expense
     * @param {{ highlight?: boolean }} [options]
     */
    upsertExpense(expense, options = {}) {
      const index = this.expenses.findIndex((item) => item.id === expense.id);
      const alreadyApplied =
        index !== -1 && this.expenses[index].updatedAt.getTime() === expense.updatedAt.getTime();

      // Kivesszük és rendezetten visszaszúrjuk, mert egy távoli szerkesztés a
      // dátumot is megváltoztathatta, tehát a sor helye is változhat.
      if (index !== -1) {
        this.expenses.splice(index, 1);
      }
      this.expenses.splice(insertIndexFor(this.expenses, expense), 0, expense);

      if (options.highlight && !alreadyApplied) {
        this.markFresh(expense.id);
      }
    },

    /**
     * @param {string} id
     */
    removeExpense(id) {
      this.expenses = this.expenses.filter((expense) => expense.id !== id);
      this.freshIds.delete(id);
      clearTimeout(freshTimers.get(id));
      freshTimers.delete(id);
    },

    /**
     * @param {string} id
     */
    markFresh(id) {
      this.freshIds.add(id);
      clearTimeout(freshTimers.get(id));
      freshTimers.set(
        id,
        setTimeout(() => {
          this.freshIds.delete(id);
          freshTimers.delete(id);
        }, FRESH_MS),
      );
    },

    /**
     * @param {string} eventId
     * @param {object} input
     */
    async createExpense(eventId, input) {
      const clientId = crypto.randomUUID();
      const body = { ...input, clientId };
      try {
        const expense = await apiClient.post(`/events/${eventId}/expenses`, body, {
          schema: expenseResponseSchema,
        });
        this.upsertExpense(expense);
        return expense;
      } catch (error) {
        if (error instanceof ApiError || error instanceof ZodError) {
          // A szerver válaszolt (validációs hiba, 404), vagy 2xx-et adott,
          // amit nem tudunk a várt sémaként értelmezni: egyik sem
          // hálózathiba, ezt a felhasználónak most kell megoldania, nem
          // sorbanállítással — egy ténylegesen sikerült írást így sem
          // állítanánk sorba még egyszer.
          throw error;
        }
        const entry = await enqueue({ type: 'create', eventId, clientId, payload: body });
        this.upsertExpense(toPendingExpense(entry));
        return null;
      }
    },

    /**
     * @param {string} id
     * @param {object} input
     */
    async updateExpense(id, input) {
      try {
        const updated = await apiClient.patch(`/expenses/${id}`, input, {
          schema: expenseResponseSchema,
        });
        this.upsertExpense(updated);
        return updated;
      } catch (error) {
        if (error instanceof ApiError || error instanceof ZodError) {
          throw error;
        }
        const existing = this.expenses.find((expense) => expense.id === id);
        if (!existing) {
          // Nincs ismert eseményazonosító, amire a bejegyzést rá tudnánk
          // kötni: a `listByEvent` sosem találná meg, a feltöltő sosem tudná
          // hova irányítani. Inkább hibát mutatunk, mint hogy egy ilyen,
          // soha nem szinkronizálódó bejegyzésben veszne el a módosítás.
          throw error;
        }
        await enqueue({
          type: 'update',
          eventId: existing.eventId,
          expenseId: id,
          payload: input,
        });
        this.upsertExpense(toPendingUpdate(existing, input));
        return null;
      }
    },

    /**
     * @param {string} id
     */
    async deleteExpense(id) {
      const existing = this.expenses.find((expense) => expense.id === id);
      try {
        await apiClient.delete(`/expenses/${id}`);
        this.removeExpense(id);
      } catch (error) {
        if (error instanceof ApiError || error instanceof ZodError) {
          throw error;
        }
        if (!existing) {
          // Ugyanaz az elv, mint a szerkesztésnél: ismert eseményazonosító
          // nélkül a bejegyzés soha nem szinkronizálódna — inkább hibát
          // mutatunk.
          throw error;
        }
        await enqueue({ type: 'delete', eventId: existing.eventId, expenseId: id });
        this.removeExpense(id);
      }
    },
  },
});
