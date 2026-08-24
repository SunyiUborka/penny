import { defineStore } from 'pinia';
import {
  CATEGORY_COLORS,
  categoryListResponseSchema,
  categoryResponseSchema,
} from '@filler/shared';
import { apiClient } from '../api/client.js';
import { fetchWithCache, refreshIntoCache } from '../offline/cache.js';
import { categoriesCacheKey } from '../offline/cacheKeys.js';

function sortByName(categories) {
  return [...categories].sort((a, b) => a.name.localeCompare(b.name, 'hu'));
}

export const useCategoriesStore = defineStore('categories', {
  state: () => ({
    categories: [],
    loading: false,
    error: null,
  }),
  getters: {
    /**
     * @returns {(id: string) => object | undefined}
     */
    byId: (state) => (id) => {
      return state.categories.find((category) => category.id === id);
    },
    /**
     * A paletta első olyan tintája, amit az esemény még nem használ. Ha mind
     * a hat foglalt, a legkevesebbszer használt nyer, holtversenynél a
     * palettában előrébb álló — így a felvitel közben sosem kell színt
     * választani.
     * @returns {string}
     */
    nextColor: (state) => {
      const counts = new Map(CATEGORY_COLORS.map((color) => [color, 0]));
      state.categories.forEach((category) => {
        counts.set(category.color, (counts.get(category.color) ?? 0) + 1);
      });
      let best = CATEGORY_COLORS[0];
      CATEGORY_COLORS.forEach((color) => {
        if (counts.get(color) < counts.get(best)) {
          best = color;
        }
      });
      return best;
    },
  },
  actions: {
    async fetchCategories(eventId) {
      this.loading = true;
      this.error = null;
      try {
        const result = await fetchWithCache({
          key: categoriesCacheKey(eventId),
          schema: categoryListResponseSchema,
          request: () =>
            apiClient.get(`/events/${eventId}/categories`, {
              schema: categoryListResponseSchema,
            }),
        });
        this.categories = sortByName(result.value);
      } catch (error) {
        this.error = error;
      } finally {
        this.loading = false;
      }
    },

    async refreshQuietly(eventId) {
      try {
        const categories = await refreshIntoCache({
          key: categoriesCacheKey(eventId),
          request: () =>
            apiClient.get(`/events/${eventId}/categories`, {
              schema: categoryListResponseSchema,
            }),
        });
        this.categories = sortByName(categories);
        this.error = null;
      } catch {
        // Csendben bukik is: a látható (elavult) lista többet ér egy
        // hibaüzenetnél, és a következő frissítés helyrehozza.
      }
    },

    async createCategory(eventId, input) {
      const category = await apiClient.post(`/events/${eventId}/categories`, input, {
        schema: categoryResponseSchema,
      });
      this.upsert(category);
      return category;
    },

    async updateCategory(id, input) {
      const updated = await apiClient.patch(`/categories/${id}`, input, {
        schema: categoryResponseSchema,
      });
      this.upsert(updated);
      return updated;
    },

    async deleteCategory(id) {
      await apiClient.delete(`/categories/${id}`);
      this.remove(id);
    },

    upsert(category) {
      const index = this.categories.findIndex((item) => item.id === category.id);
      if (index === -1) {
        this.categories.push(category);
      } else {
        this.categories[index] = category;
      }
      this.categories = sortByName(this.categories);
    },

    remove(id) {
      this.categories = this.categories.filter((category) => category.id !== id);
    },

    applyStreamMessage(message) {
      if (message.type === 'category.deleted') {
        this.remove(message.categoryId);
        return;
      }
      this.upsert(message.category);
    },

    reset() {
      this.categories = [];
      this.loading = false;
      this.error = null;
    },
  },
});
