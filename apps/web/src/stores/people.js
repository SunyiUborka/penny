import { defineStore } from 'pinia';
import { personListResponseSchema, personResponseSchema } from '@filler/shared';
import { apiClient } from '../api/client.js';

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
        this.people = await apiClient.get('/people', { schema: personListResponseSchema });
      } catch (error) {
        this.error = error;
      } finally {
        this.loading = false;
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
