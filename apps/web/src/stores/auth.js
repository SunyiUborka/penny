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

        if (isNativeApp() && !result.token) {
          // Natív appban tokent kell kapnunk: cookie-t a WebView nem tud a
          // hídon átküldött kérésekhez felhasználni, tehát token nélkül
          // nincs mivel hitelesíteni a további kéréseket. Ha ilyenkor
          // mégis "authenticated: true"-t hinnénk, a store hitelesítettnek
          // látszana hitelesítő adat nélkül: minden kérés 401-et kapna,
          // ami a login route-ra dobna, a router guard pedig onnan azonnal
          // visszadobna, mert authenticated === true — végtelen hurok
          // (lásd a review 1. pontját). Ez akkor fordulhat elő, ha a
          // szerver a 721e2c4 előtti verzión fut, vagy egy proxy elnyeli az
          // X-Client fejlécet.
          this.authenticated = false;
          this.checked = true;
          this.loginError =
            'A szerver nem küldött munkamenet-tokent, ezért az app natívan nem tud bejelentkezni. A backendet frissíteni kell.';
          return false;
        }

        this.authenticated = result.authenticated;
        if (isNativeApp()) {
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
      // A helyi állapot törlése kliensoldali művelet: nem függhet a szerver
      // elérhetőségétől. Az állapotot MINDIG a tokentörlés előtt állítjuk
      // vissza, és a tokentörlés MINDIG lefut, függetlenül attól, hogy a
      // szerveres kijelentkezés sikerült-e — ha bármelyik itt blokkolná
      // (vagy kihagyná) a másikat, a router guard "authenticated: true"
      // mellett, illetve egy lemezen maradt érvényes tokennel visszadobná a
      // felhasználót az appba egy explicit kijelentkezés után (lásd a
      // review 2. pontját).
      //
      // Az eredeti szerverhibát ez a metódus nem nyeli el: elmentjük, és a
      // két helyi takarítás után újradobjuk, hogy a hívó (App.vue) naplózni
      // tudja — de csak AZUTÁN, hogy mindkét takarítás lefutott, különben
      // egy `try`/`finally`-on átdobott hiba kihagyná a rá következő kódot.
      let logoutError = null;
      try {
        await apiClient.post('/auth/logout');
      } catch (error) {
        logoutError = error;
      } finally {
        this.authenticated = false;
        this.checked = true;
      }

      if (isNativeApp()) {
        try {
          await clearToken();
        } catch (error) {
          console.error('A munkamenet-token törlése nem sikerült:', error);
        }
      }

      if (logoutError) {
        throw logoutError;
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
