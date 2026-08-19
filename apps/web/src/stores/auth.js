import { defineStore } from 'pinia';
import { z } from 'zod';
import { apiClient, ApiError } from '../api/client.js';
import { clearToken, setToken } from '../native/token.js';
import { isNativeApp } from '../utils/platform.js';

const authStatusSchema = z.object({ authenticated: z.boolean(), token: z.string().optional() });

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
        if (isNativeApp() && result.token) {
          // A tokenmentés hibája a natív perzisztenciát érinti, nem a
          // hitelesítést: a szerver már elfogadta a jelszót, ezért ez nem
          // futhat bele a lenti catch ágba, ami "Hibás jelszó"-t jelentene.
          try {
            await setToken(result.token);
          } catch (storageError) {
            console.error('A munkamenet-token mentése nem sikerült:', storageError);
          }
        }
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
      // A helyi hitelesítő adatok törlése kliensoldali művelet: nem
      // függhet a szerver elérhetőségétől. A `finally` biztosítja, hogy a
      // token és az állapot akkor is törlődjön, ha a szerveres kijelentkezés
      // elhasal (nincs hálózat, szerverhiba, 401) — az eredeti hibát viszont
      // nem nyeljük el, az továbbterjed a hívóhoz.
      try {
        await apiClient.post('/auth/logout');
      } finally {
        if (isNativeApp()) {
          await clearToken();
        }
        this.authenticated = false;
        this.checked = true;
      }
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
