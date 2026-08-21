import { defineStore } from 'pinia';
import { personListResponseSchema, personResponseSchema } from '@filler/shared';
import { apiClient } from '../api/client.js';
import { fetchWithCache, refreshIntoCache } from '../offline/cache.js';
import { PEOPLE_CACHE_KEY } from '../offline/cacheKeys.js';

export const usePeopleStore = defineStore('people', {
  state: () => ({
    people: [],
    loading: false,
    error: null,
  }),
  getters: {
    /**
     * @returns {(id: string) => string}
     */
    nameById: (state) => (id) => {
      return state.people.find((person) => person.id === id)?.name ?? 'Ismeretlen';
    },
  },
  actions: {
    async fetchPeople() {
      this.loading = true;
      this.error = null;
      try {
        const result = await fetchWithCache({
          key: PEOPLE_CACHE_KEY,
          schema: personListResponseSchema,
          request: () => apiClient.get('/people', { schema: personListResponseSchema }),
        });
        this.people = result.value;
      } catch (error) {
        this.error = error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Újratöltés a „Betöltés…” állapot felvillantása nélkül — ugyanaz a
     * filozófia, mint az `events.js` és az `expenses.js` `refreshQuietly`-jénél:
     * a névjegyzék már látszik (minden képernyőn ez adja a neveket), egy
     * villanó betöltés-jelző zavaróbb, mint hasznos, és egy bukás a láthatót
     * hagyja.
     *
     * Miért kell a névjegyzéknek is csendes út: a `people` volt az egyetlen
     * követett cache-kulcs, aminek EGYETLEN frissítési útja sem létezett a
     * komponens-mountokon kívül. Egy offline mount után tehát elavultra
     * jelölve maradt, és mivel a nevek minden képernyőn látszanak, a
     * lehúzásos frissítés — ami láthatóan frissítette a listát — nem tudta
     * levenni az offline sávot: a felület a szeme előtt frissült adatról
     * állította, hogy régi (lásd a végső re-review U1 pontját).
     *
     * Szándékosan `refreshIntoCache`, nem közvetlen `apiClient`: a sikeres
     * frissítés a lemezes másolatot is felírja és a kulcsot frissnek jelöli.
     * @returns {Promise<void>}
     */
    async refreshQuietly() {
      try {
        this.people = await refreshIntoCache({
          key: PEOPLE_CACHE_KEY,
          request: () => apiClient.get('/people', { schema: personListResponseSchema }),
        });
        // Egy korábbi sikertelen betöltés hibaüzenete itt már elavult: a
        // sikeres csendes frissítés a bizonyíték, hogy a kapcsolat helyreállt.
        this.error = null;
      } catch {
        // Csendben bukik is: a látható (elavult) névjegyzék többet ér egy
        // hibaüzenetnél, és a következő frissítés helyrehozza.
      }
    },

    /**
     * @param {string} name
     */
    async createPerson(name) {
      const person = await apiClient.post('/people', { name }, { schema: personResponseSchema });
      this.people.push(person);
      this.people.sort((a, b) => a.name.localeCompare(b.name, 'hu'));
      return person;
    },

    /**
     * @param {string} id
     * @param {string} name
     */
    async renamePerson(id, name) {
      const updated = await apiClient.patch(
        '/people/' + id,
        { name },
        { schema: personResponseSchema },
      );
      const index = this.people.findIndex((person) => person.id === id);
      if (index !== -1) {
        this.people[index] = updated;
      }
      this.people.sort((a, b) => a.name.localeCompare(b.name, 'hu'));
      return updated;
    },

    /**
     * @param {string} id
     */
    async deletePerson(id) {
      await apiClient.delete('/people/' + id);
      this.people = this.people.filter((person) => person.id !== id);
    },
  },
});
