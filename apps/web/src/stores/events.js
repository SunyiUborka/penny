import { defineStore } from 'pinia';
import { eventListResponseSchema, eventResponseSchema } from '@filler/shared';
import { apiClient } from '../api/client.js';

export const useEventsStore = defineStore('events', {
  state: () => ({
    events: [],
    loading: false,
    error: null,
  }),
  actions: {
    async fetchEvents() {
      this.loading = true;
      this.error = null;
      try {
        this.events = await apiClient.get('/events', { schema: eventListResponseSchema });
      } catch (error) {
        this.error = error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Újratöltés a „Betöltés…" állapot felvillantása nélkül. Lehúzásos
     * frissítéskor hívjuk: a lista már látszik, és egy villanó betöltés-jelző
     * zavaróbb, mint hasznos.
     * @returns {Promise<void>}
     */
    async refreshQuietly() {
      try {
        this.events = await apiClient.get('/events', { schema: eventListResponseSchema });
        // Egy korábbi sikertelen betöltés hibaüzenete itt már elavult: a
        // sikeres csendes frissítés a bizonyíték, hogy a kapcsolat helyreállt.
        this.error = null;
      } catch {
        // Csendben bukik is: a látható (elavult) lista többet ér egy
        // hibaüzenetnél, és a következő frissítés helyrehozza.
      }
    },

    /**
     * @param {string} id
     */
    fetchEvent(id) {
      return apiClient.get('/events/' + id, { schema: eventResponseSchema });
    },

    /**
     * @param {{ name: string, participantIds: string[], startDate?: string|null, endDate?: string|null }} input
     */
    async createEvent(input) {
      const event = await apiClient.post('/events', input, { schema: eventResponseSchema });
      this.events.unshift(event);
      return event;
    },

    /**
     * @param {string} id
     * @param {object} input
     */
    async updateEvent(id, input) {
      const updated = await apiClient.patch('/events/' + id, input, {
        schema: eventResponseSchema,
      });
      const index = this.events.findIndex((event) => event.id === id);
      if (index !== -1) {
        this.events[index] = updated;
      }
      return updated;
    },

    /**
     * @param {string} id
     */
    async deleteEvent(id) {
      await apiClient.delete('/events/' + id);
      this.events = this.events.filter((event) => event.id !== id);
    },
  },
});
