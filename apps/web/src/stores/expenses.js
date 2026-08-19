import { defineStore } from 'pinia';
import { App as CapacitorApp } from '@capacitor/app';
import {
  expenseListResponseSchema,
  expenseResponseSchema,
  expenseStreamMessageSchema,
} from '@filler/shared';
import { apiClient, apiStreamUrl } from '../api/client.js';
import { liveUpdatesSupported } from '../utils/platform.js';

/** Meddig van kiemelve egy frissen érkezett sor. */
const FRESH_MS = 1600;

// Modulszinten, nem a store state-jében: az EventSource és a timerek nem
// reaktív adatok, a Pinia state-be téve csak feleslegesen proxyzódnának.
let stream = null;
let streamEventId = null;
let visibilityHandler = null;
let appStateListener = null;
// Minden subscribe()/unsubscribe() hívás új „generációt” nyit. A natív
// CapacitorApp.addListener(...) hívás aszinkron (natív hídon megy át), ezért
// mire a promise-a lefut, a feliratkozás már túlhaladott lehet (másik
// eseményre navigáltunk, vagy közben leiratkoztunk). A .then()-ben ezt a
// számlálót hasonlítjuk össze a feliratkozáskor elmentett értékkel: ha
// eltér, a későn megérkezett listenert azonnal el kell távolítani, különben
// örökre bent ragadna, és egy már elhagyott eseményhez próbálna frissíteni.
// NE egyszerűsítsd ezt le egy sima null-ellenőrzésre — az nem különbözteti
// meg „még nincs eredmény” és „már túlhaladott eredmény” eseteit.
let subscriptionGeneration = 0;
const freshTimers = new Map();

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
     * @param {string} eventId
     */
    async fetchExpenses(eventId) {
      this.loading = true;
      this.error = null;
      try {
        this.expenses = await apiClient.get(`/events/${eventId}/expenses`, {
          schema: expenseListResponseSchema,
        });
      } catch (error) {
        this.error = error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Újratöltés a „Betöltés…” állapot felvillantása nélkül. Újrakapcsolódás
     * és fül-előtérbe-kerülés után hívjuk: ilyenkor a lista már látszik, és
     * egy villanó betöltés-jelző zavaróbb, mint hasznos.
     *
     * Ez a művelet pótolja a szakadás alatt elmaradt üzeneteket — ezért nincs
     * szerveroldali Last-Event-ID puffer.
     * @param {string} eventId
     */
    async refreshQuietly(eventId) {
      try {
        this.expenses = await apiClient.get(`/events/${eventId}/expenses`, {
          schema: expenseListResponseSchema,
        });
      } catch {
        // Csendben bukik is: a látható (elavult) lista többet ér egy
        // hibaüzenetnél, és a következő újratöltés helyrehozza.
      }
    },

    /**
     * Feliratkozás az esemény élő kiadás-frissítéseire.
     * @param {string} eventId
     */
    subscribe(eventId) {
      this.unsubscribe();

      // Új feliratkozás — új generáció, hogy egy korábbi (esetleg még
      // folyamatban lévő) natív addListener-promise fel tudja ismerni magát
      // elavultként, amikor később lefut. Lásd a subscriptionGeneration
      // kommentjét a modul tetején.
      subscriptionGeneration += 1;
      const generation = subscriptionGeneration;

      if (!liveUpdatesSupported()) {
        this.subscribeNative(eventId, generation);
        return;
      }

      let opened = false;
      stream = new EventSource(apiStreamUrl(`/events/${eventId}/stream`));
      streamEventId = eventId;

      stream.onopen = () => {
        this.connected = true;
        if (opened) {
          this.refreshQuietly(eventId);
        }
        opened = true;
      };

      stream.onerror = () => {
        // Az EventSource magától újrapróbálkozik (a szerver `retry` mezője
        // szerint), itt csak a kapcsolatjelzőt állítjuk át.
        this.connected = false;
      };

      stream.onmessage = (message) => {
        this.applyStreamMessage(message.data);
      };

      visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          this.refreshQuietly(eventId);
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    },

    /**
     * A natív app „élő frissítése”: stream helyett minden előtérbe kerüléskor
     * újratöltjük a listát. Ez pótolja a háttérben töltött idő alatt történt
     * változásokat.
     * @param {string} eventId
     * @param {number} generation a feliratkozáskori subscriptionGeneration —
     * ezzel ismeri fel a később lefutó promise, hogy időközben túlhaladottá
     * vált-e (ld. a subscriptionGeneration kommentjét a modul tetején)
     */
    subscribeNative(eventId, generation) {
      streamEventId = eventId;
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          this.refreshQuietly(eventId);
        }
      })
        .then((listener) => {
          // A natív híd válasza aszinkron: mire megérkezik, lehet, hogy már
          // egy újabb subscribe()/unsubscribe() futott le. Ilyenkor ez a
          // listener egy már elhagyott eseményhez tartozna — azonnal el kell
          // távolítani, nem szabad eltárolni.
          if (generation !== subscriptionGeneration) {
            listener.remove();
            return listener;
          }
          appStateListener = listener;
          return listener;
        })
        .catch(() => {
          // Ha a listener regisztrációja elbukik, marad a kézi újratöltés —
          // ez nem indokolja a lista elrontását egy hibaüzenettel.
        });
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
      // Lezárjuk a jelenlegi generációt — így egy még folyamatban lévő natív
      // addListener-promise a lefutásakor elavultként ismeri fel magát (lásd
      // subscriptionGeneration a modul tetején), és eltávolítja saját magát.
      subscriptionGeneration += 1;
      if (stream) {
        stream.close();
        stream = null;
      }
      if (appStateListener) {
        appStateListener.remove();
        appStateListener = null;
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
      const expense = await apiClient.post(`/events/${eventId}/expenses`, input, {
        schema: expenseResponseSchema,
      });
      // Optimista beszúrás: ha épp nincs élő kapcsolat, a saját felvitt kiadás
      // akkor is azonnal látszódjon.
      this.upsertExpense(expense);
      return expense;
    },

    /**
     * @param {string} id
     * @param {object} input
     */
    async updateExpense(id, input) {
      const updated = await apiClient.patch(`/expenses/${id}`, input, {
        schema: expenseResponseSchema,
      });
      this.upsertExpense(updated);
      return updated;
    },

    /**
     * @param {string} id
     */
    async deleteExpense(id) {
      await apiClient.delete(`/expenses/${id}`);
      this.removeExpense(id);
    },
  },
});
