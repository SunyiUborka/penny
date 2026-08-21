import { defineStore } from 'pinia';
import {
  settlementPaymentListResponseSchema,
  settlementPaymentResponseSchema,
} from '@filler/shared';
import { apiClient } from '../api/client.js';
import { fetchWithCache, refreshIntoCache } from '../offline/cache.js';
import { settlementPaymentsCacheKey } from '../offline/cacheKeys.js';

/**
 * A kiegyenlítések (tartozás-rendezések) store-ja.
 *
 * Miért nem a kiadás-store-ban: a kiegyenlítés nem kiadás — külön kérés, külön
 * cache-kulcs, más alak, és a Kiadások fülön nem is jelenik meg. Az élő
 * frissítés viszont ugyanazon az egy streamen jön (egy esemény = egy
 * kapcsolat), ezért a kiadás-store irányítja ide a rá vonatkozó üzeneteket
 * (lásd `stores/expenses.js` `applyStreamMessage`).
 *
 * Nincs offline sorbanállítás (outbox): a felvétel hálózatot igényel. A
 * LISTA viszont cache-elt, tehát offline is látszik, amit korábban láttunk.
 */

/**
 * A legutóbb kért esemény azonosítója — ugyanaz a védelem, mint a
 * kiadás-store-ban: egy elkésett válasz ne írjon bele egy másik esemény
 * nézetébe.
 */
let latestFetchEventId = null;

/**
 * A szerverrel azonos rendezés: dátum szerint csökkenő, egyező dátumon a
 * később rögzített előbb (lásd settlementPaymentRepository.listForEvent).
 * @param {{ date: Date, createdAt: Date }} a
 * @param {{ date: Date, createdAt: Date }} b
 */
function comparePayments(a, b) {
  const byDate = b.date.getTime() - a.date.getTime();
  return byDate === 0 ? b.createdAt.getTime() - a.createdAt.getTime() : byDate;
}

export const useSettlementPaymentsStore = defineStore('settlementPayments', {
  state: () => ({
    payments: [],
    loading: false,
    error: null,
  }),
  actions: {
    /**
     * @param {string} eventId
     */
    async fetchPayments(eventId) {
      this.loading = true;
      this.error = null;
      latestFetchEventId = eventId;
      try {
        const result = await fetchWithCache({
          key: settlementPaymentsCacheKey(eventId),
          schema: settlementPaymentListResponseSchema,
          request: () =>
            apiClient.get(`/events/${eventId}/settlement-payments`, {
              schema: settlementPaymentListResponseSchema,
            }),
        });
        if (latestFetchEventId !== eventId) {
          return;
        }
        this.payments = result.value;
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
     * Csendes újratöltés: nincs „Betöltés…” felvillanás, és hiba esetén a
     * jelenleg látszó listát érintetlenül hagyja. Ugyanazokra az alkalmakra
     * fut, mint a kiadásoké (stream-újrakapcsolódás, előtérbe kerülés).
     * @param {string} eventId
     */
    async refreshQuietly(eventId) {
      try {
        const payments = await refreshIntoCache({
          key: settlementPaymentsCacheKey(eventId),
          request: () =>
            apiClient.get(`/events/${eventId}/settlement-payments`, {
              schema: settlementPaymentListResponseSchema,
            }),
        });
        if (latestFetchEventId !== eventId) {
          return;
        }
        this.payments = payments;
        this.error = null;
      } catch {
        // Csendben bukik is: a látható (elavult) lista többet ér egy
        // hibaüzenetnél, a következő frissítés helyrehozza.
      }
    },

    /**
     * @param {string} eventId
     * @param {object} input a `SettlementPaymentModal` beküldött alakja
     */
    async createPayment(eventId, input) {
      const created = await apiClient.post(`/events/${eventId}/settlement-payments`, input, {
        schema: settlementPaymentResponseSchema,
      });
      // Azonnal beszúrjuk, nem várjuk meg a saját SSE-visszhangunkat: a
      // felület a mentés után rögtön a rendezett sort mutassa. Az `upsert`
      // idempotens, tehát a visszhang nem duplikál.
      this.upsertPayment(created);
      return created;
    },

    /**
     * @param {string} id
     * @param {object} input
     */
    async updatePayment(id, input) {
      const updated = await apiClient.patch(`/settlement-payments/${id}`, input, {
        schema: settlementPaymentResponseSchema,
      });
      this.upsertPayment(updated);
      return updated;
    },

    /**
     * @param {string} id
     */
    async deletePayment(id) {
      await apiClient.delete(`/settlement-payments/${id}`);
      this.removePayment(id);
    },

    /**
     * A streamen érkező kiegyenlítés-üzenet alkalmazása. A kiadás-store hívja,
     * mert a stream közös (lásd a fájl fejét).
     * @param {object} message a már validált üzenet
     */
    applyStreamMessage(message) {
      if (message.type === 'settlementPayment.deleted') {
        this.removePayment(message.paymentId);
        return;
      }
      this.upsertPayment(message.payment);
    },

    /**
     * Idempotens beszúrás/csere, a rendezést megtartva: a dátum szerkesztése a
     * sor helyét is megváltoztathatja, ezért kivesszük és rendezetten
     * szúrjuk vissza.
     * @param {object} payment
     */
    upsertPayment(payment) {
      const index = this.payments.findIndex((item) => item.id === payment.id);
      if (index !== -1) {
        this.payments.splice(index, 1);
      }
      const insertAt = this.payments.findIndex((item) => comparePayments(item, payment) > 0);
      this.payments.splice(insertAt === -1 ? this.payments.length : insertAt, 0, payment);
    },

    /**
     * @param {string} id
     */
    removePayment(id) {
      this.payments = this.payments.filter((payment) => payment.id !== id);
    },

    /** Eseményváltásnál: az előző esemény szelvényei ne látszódjanak tovább. */
    reset() {
      this.payments = [];
      this.error = null;
      this.loading = false;
      latestFetchEventId = null;
    },
  },
});
