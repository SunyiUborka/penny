import { defineStore } from 'pinia';
import { z, ZodError } from 'zod';
import { apiClient, ApiError } from '../api/client.js';
import { clearToken, setToken } from '../native/token.js';
import {
  forgetAuthenticated,
  hasAuthenticatedBefore,
  rememberAuthenticated,
} from '../offline/session.js';
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
     *
     * Offline (átvitel-szintű hiba) esetén NEM dob és nem tekinti
     * kijelentkezettnek a felhasználót, ha ezen az eszközön már volt sikeres
     * hitelesítés — lásd `offline/session.js`-t arról, miért kell ez és
     * miért biztonságos. E nélkül minden offline hidegindulás a
     * bejelentkezésen landolt, ahonnan offline nincs kiút, és az egész
     * offline réteg (a lemezen ott lévő cache és outbox) elérhetetlen volt.
     * @returns {Promise<boolean>}
     */
    async checkAuth() {
      let result;
      try {
        result = await apiClient.get('/auth/me', { schema: authStatusSchema });
      } catch (error) {
        if (error instanceof ApiError || error instanceof ZodError) {
          // A szerver ténylegesen válaszolt (vagy a kontraktusa törött) —
          // ez nem offline eset, tehát nem szabad rá provizórikusan
          // beengedni senkit. Ugyanaz a besorolás, amit az offline réteg
          // mindenhol máshol is használ (lásd `offline/cache.js`). Az
          // állapotot szándékosan érintetlenül hagyjuk (`checked` marad
          // `false`), hogy a következő navigáció újra megkérdezze a
          // szervert — egy 5xx nem tartós verdikt.
          throw error;
        }
        // Átvitel-szintű hiba: a szervertől semmit nem tudunk. Ha ezen az
        // eszközön már volt sikeres hitelesítés, beengedjük — a hitelesítő
        // adat (cookie/token) megvan, minden szerverhívás azzal megy, és az
        // első valódi 401 kidobja (`api/client.js`). Ha még soha nem
        // hitelesített itt, marad a `false`, és a bejelentkezésen landol.
        this.authenticated = await hasAuthenticatedBefore();
        this.checked = true;
        return this.authenticated;
      }

      this.authenticated = result.authenticated;
      this.checked = true;
      if (result.authenticated) {
        await rememberAuthenticated();
      } else {
        // A szerver kimondta, hogy nincs érvényes munkamenet — a jelzőnek is
        // el kell tűnnie, különben a következő offline indulás beengedne.
        await forgetAuthenticated();
      }
      return this.authenticated;
    },

    /**
     * Egy valódi szerveroldali `401` feldolgozása; az `api/client.js` hívja.
     * @returns {Promise<void>}
     */
    async markUnauthenticated() {
      // Az `authenticated` nullázása szinkron, az első utasításban történik:
      // a hívó ezután a bejelentkezésre navigál, és a router guard csak
      // akkor nem dobja azonnal vissza, ha a store már hitelesítetlennek
      // látja magát (lásd a review 1. pontját).
      this.authenticated = false;
      this.checked = true;
      // A szerver kimondta: ez a munkamenet érvénytelen. A „volt már itt
      // sikeres hitelesítés" jelzőnek is el kell tűnnie, különben a
      // következő offline hidegindulás provizórikusan újra beengedné a
      // felhasználót egy már visszavont munkamenettel.
      await forgetAuthenticated();
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
        // Innentől ez az eszköz „már hitelesített" — ettől tud egy offline
        // hidegindulás a bejelentkezési képernyő megkerülésével a cache-elt
        // adathoz és az outboxhoz jutni (lásd `offline/session.js`).
        await rememberAuthenticated();
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
      // helyi takarítások (állapot, hitelesítés-jelző, token) után
      // újradobjuk, hogy a hívó (App.vue) naplózni tudja — de csak AZUTÁN,
      // hogy mindegyik takarítás lefutott, különben egy `try`/`finally`-on
      // átdobott hiba kihagyná a rá következő kódot.
      let logoutError = null;
      try {
        await apiClient.post('/auth/logout');
      } catch (error) {
        logoutError = error;
      } finally {
        this.authenticated = false;
        this.checked = true;
      }

      // A „már hitelesített ezen az eszközön" jelző törlése ugyanilyen
      // feltétel nélküli helyi takarítás, mindkét platformon: nélküle egy
      // kijelentkezés után a következő offline indulás provizórikusan
      // visszaengedné a felhasználót az appba.
      await forgetAuthenticated();

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

    /**
     * Kizárólag helyi munkamenet-takarítás, szerverhívás nélkül: a
     * szerverváltás pillanatában a régi szerver már nem elérhető (vagy nem
     * releváns), egy `logout` hívás pedig a RÉGI címre menne.
     * @returns {Promise<void>}
     */
    async resetLocalSession() {
      this.authenticated = false;
      this.checked = true;
      this.loginError = null;
      await forgetAuthenticated();
      if (isNativeApp()) {
        try {
          await clearToken();
        } catch (error) {
          console.error('A munkamenet-token törlése nem sikerült:', error);
        }
      }
    },
  },
});

/**
 * A bejelentkezési hiba lefordítása arra, ami a felhasználón múlik.
 *
 * A besorolás ugyanaz, mint az offline rétegben (`offline/cache.js`): az
 * `ApiError`/`ZodError` azt jelenti, hogy a szerver válaszolt (vagy a
 * kontraktus törött), minden más átvitel-szintű hiba. Egy átvitel-szintű
 * hibára SOSEM mondhatjuk, hogy „Hibás jelszó" — offline ez volt a legrosszabb
 * pontja a hidegindulásnak: a felhasználó a jelszavát kezdte keresni, miközben
 * csak kapcsolata nem volt (lásd a végső review C2 pontját).
 * @param {unknown} error
 * @returns {string}
 */
function describeLoginError(error) {
  if (error instanceof ApiError && error.statusCode === 429) {
    return 'Túl sok próbálkozás. Kérlek, várj egy percet, majd próbáld újra.';
  }
  if (error instanceof ApiError && error.statusCode >= 500) {
    return 'A szerver hibát jelzett a bejelentkezéskor. Próbáld újra kicsit később.';
  }
  if (error instanceof ZodError) {
    return 'A szerver váratlan választ adott a bejelentkezésre. Valószínűleg frissíteni kell az appot vagy a szervert.';
  }
  if (error instanceof ApiError) {
    return 'Hibás jelszó.';
  }
  return 'Nincs kapcsolat a szerverrel. Ellenőrizd az internetkapcsolatot vagy a szerver elérhetőségét, majd próbáld újra.';
}
