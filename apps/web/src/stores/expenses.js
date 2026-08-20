import { defineStore } from 'pinia';
import {
  expenseListResponseSchema,
  expenseResponseSchema,
  expenseStreamMessageSchema,
} from '@filler/shared';
import { apiClient } from '../api/client.js';
import { openEventStream } from '../api/eventStream.js';
import { fetchWithCache } from '../offline/cache.js';

/** Meddig van kiemelve egy frissen érkezett sor. */
const FRESH_MS = 1600;

// Modulszinten, nem a store state-jében: a stream lezárója és a timerek nem
// reaktív adatok, a Pinia state-be téve csak feleslegesen proxyzódnának.
let closeStream = null;
let streamEventId = null;
let visibilityHandler = null;
const freshTimers = new Map();

/**
 * A legutóbb kért esemény azonosítója a `fetchExpenses`-hez. Egy nagyon
 * gyors, egymást követő navigáció esetén a korábbi kérés válasza később is
 * megérkezhet, mint a következőé — enélkül az a lista beleírna egy másik
 * esemény nézetébe.
 */
let latestFetchEventId = null;

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
        // Egy korábbi sikertelen betöltés hibaüzenete itt már elavult: a
        // sikeres csendes frissítés a bizonyíték, hogy a kapcsolat helyreállt.
        this.error = null;
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
