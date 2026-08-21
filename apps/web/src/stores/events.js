import { defineStore } from 'pinia';
import { eventListResponseSchema, eventResponseSchema } from '@filler/shared';
import { apiClient } from '../api/client.js';
import { fetchWithCache, refreshIntoCache } from '../offline/cache.js';
import { EVENTS_CACHE_KEY, eventCacheKey } from '../offline/cacheKeys.js';

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
        const result = await fetchWithCache({
          key: EVENTS_CACHE_KEY,
          schema: eventListResponseSchema,
          request: () => apiClient.get('/events', { schema: eventListResponseSchema }),
        });
        this.events = result.value;
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
        // `refreshIntoCache`, nem közvetlen `apiClient`: a sikeres csendes
        // frissítés a cache-t is felírja, és az `events` kulcsot frissnek
        // jelöli — enélkül a lehúzásos frissítés után a lista látványosan
        // frissült, az offline sáv pedig továbbra is azt állította, hogy
        // elavult adatot néz (lásd a végső review I4 pontját).
        this.events = await refreshIntoCache({
          key: EVENTS_CACHE_KEY,
          request: () => apiClient.get('/events', { schema: eventListResponseSchema }),
        });
        // Egy korábbi sikertelen betöltés hibaüzenete itt már elavult: a
        // sikeres csendes frissítés a bizonyíték, hogy a kapcsolat helyreállt.
        this.error = null;
      } catch {
        // Csendben bukik is: a látható (elavult) lista többet ér egy
        // hibaüzenetnél, és a következő frissítés helyrehozza.
      }
    },

    /**
     * Egyetlen esemény betöltése — az eseményoldal kritikus útja, ezért
     * `fetchWithCache`-en megy, eseményenkénti (`event:<id>`) kulccsal,
     * ugyanúgy, mint a `fetchEvents`/`fetchPeople`/`fetchExpenses`. Enélkül
     * offline az egész eseményoldal (kiadástábla, elszámolás, „+ Új kiadás")
     * egy hibaüzenetre cserélődött, pedig a kiadás-cache és az outbox-visszajátszás
     * addigra már sikerrel lefutott — vagyis az offline OLVASÁS és az offline
     * ÍRÁS is elérhetetlen volt (lásd a végső review C3 pontját).
     * @param {string} id
     * @returns {Promise<object>} maga az esemény (a cache-jelzők nélkül)
     */
    async fetchEvent(id) {
      const result = await fetchWithCache({
        key: eventCacheKey(id),
        schema: eventResponseSchema,
        request: () => apiClient.get('/events/' + id, { schema: eventResponseSchema }),
      });
      return result.value;
    },

    /**
     * Egyetlen esemény újratöltése kizárólag a hálózatról, cache-tartalék
     * NÉLKÜL — a csendes háttérfrissítés hívja (`EventDetailView`).
     * Szándékosan nem `fetchWithCache`: ott már látszik egy esemény a
     * képernyőn, és egy cache-re-esés a láthatót cserélné le egy esetleg
     * régebbi másolatra (pl. egy épp online elvégzett szerkesztés utáni
     * offline előtérbe kerülésnél visszaugrana a szerkesztés előtti névre).
     * A hívó a hibát elnyeli, és a láthatót hagyja — ugyanaz a felosztás,
     * mint a `fetchEvents` és a `refreshQuietly` között.
     *
     * A sikeres választ viszont a cache-be írja és az `event:<id>` kulcsot
     * frissnek jelöli (`refreshIntoCache`): a „nincs cache-tartalék" nem
     * jelenti azt, hogy a cache-t ne is frissítenénk — az offline sáv
     * enélkül a munkamenet végéig elavultat állított volna egy épp
     * frissített eseményről (lásd a végső review I4 pontját).
     * @param {string} id
     * @returns {Promise<object>}
     */
    refreshEvent(id) {
      return refreshIntoCache({
        key: eventCacheKey(id),
        request: () => apiClient.get('/events/' + id, { schema: eventResponseSchema }),
      });
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
