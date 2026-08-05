import { defineStore } from 'pinia';
import { z } from 'zod';
import { apiClient, ApiError } from '../api/client.js';

const authStatusSchema = z.object({ authenticated: z.boolean() });

export const useAuthStore = defineStore('auth', {
  state: () => ({
    authenticated: false,
    checked: false,
    isLoggingIn: false,
    loginError: null,
  }),
  actions: {
    /**
     * Lekéri a jelenlegi bejelentkezési állapotot a szervertől. Ezzel indul
     * az app, és a router guard is ezt hívja, ha még nem tudja az állapotot.
     * @returns {Promise<boolean>}
     */
    async checkAuth() {
      const result = await apiClient.get('/auth/me', { schema: authStatusSchema });
      this.authenticated = result.authenticated;
      this.checked = true;
      return this.authenticated;
    },

    /**
     * @param {string} password
     * @returns {Promise<boolean>} sikeres volt-e a belépés
     */
    async login(password) {
      this.isLoggingIn = true;
      this.loginError = null;
      try {
        const result = await apiClient.post(
          '/auth/login',
          { password },
          { schema: authStatusSchema },
        );
        this.authenticated = result.authenticated;
        this.checked = true;
        return true;
      } catch (error) {
        this.authenticated = false;
        this.checked = true;
        this.loginError = describeLoginError(error);
        return false;
      } finally {
        this.isLoggingIn = false;
      }
    },

    async logout() {
      await apiClient.post('/auth/logout');
      this.authenticated = false;
      this.checked = true;
    },
  },
});

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeLoginError(error) {
  if (error instanceof ApiError && error.statusCode === 429) {
    return 'Túl sok próbálkozás. Kérlek, várj egy percet, majd próbáld újra.';
  }
  return 'Hibás jelszó.';
}
