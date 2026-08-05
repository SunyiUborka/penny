import { defineStore } from 'pinia';
import { expenseListResponseSchema, expenseResponseSchema } from '@filler/shared';
import { apiClient } from '../api/client.js';

export const useExpensesStore = defineStore('expenses', {
  state: () => ({
    expenses: [],
    loading: false,
    error: null,
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
     * @param {string} eventId
     * @param {object} input
     */
    async createExpense(eventId, input) {
      const expense = await apiClient.post(`/events/${eventId}/expenses`, input, {
        schema: expenseResponseSchema,
      });
      this.expenses.unshift(expense);
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
      const index = this.expenses.findIndex((expense) => expense.id === id);
      if (index !== -1) {
        this.expenses[index] = updated;
      }
      return updated;
    },

    /**
     * @param {string} id
     */
    async deleteExpense(id) {
      await apiClient.delete(`/expenses/${id}`);
      this.expenses = this.expenses.filter((expense) => expense.id !== id);
    },
  },
});
