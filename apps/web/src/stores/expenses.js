import { defineStore } from 'pinia';
import {
  expenseListResponseSchema,
  expenseResponseSchema,
  expenseStreamMessageSchema,
} from '@filler/shared';
import { apiClient, apiStreamUrl } from '../api/client.js';

/** Meddig van kiemelve egy frissen érkezett sor. */
const FRESH_MS = 1600;

// Modulszinten, nem a store state-jében: az EventSource és a timerek nem
// reaktív adatok, a Pinia state-be téve csak feleslegesen proxyzódnának.
let stream = null;
let streamEventId = null;
let visibilityHandler = null;
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
     * @param {string} [eventId] ha meg van adva, csak akkor zár, ha valóban
     * ehhez az eseményhez tartozik a nyitott stream — így egy későn lefutó
     * onUnmounted nem tudja lezárni a közben már megnyílt új streamet
     */
    unsubscribe(eventId) {
      if (eventId !== undefined && streamEventId !== eventId) {
        return;
      }
      if (stream) {
        stream.close();
        stream = null;
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
