import { Preferences } from '@capacitor/preferences';
import { isNativeApp } from '../utils/platform.js';

/**
 * Annak az egyetlen ténynek a perzisztens jelzője, hogy ezen az eszközön
 * MÁR VOLT sikeres hitelesítés. Nem hitelesítő adat: nem lehet vele kérést
 * küldeni, a szerver felé továbbra is a cookie, illetve natívan a
 * `native/token.js`-ben tárolt token igazol.
 *
 * Miért kell: offline hidegindításkor a `/auth/me` már a `fetch`-en elhasal,
 * tehát a szervertől semmit nem tudunk megkérdezni a munkamenetről. Enélkül
 * a jelző nélkül a store „nem hitelesített”-nek látta magát, a router guard
 * a bejelentkezésre dobott, ott a jelszó POST-ja szintén elhasalt — vagyis a
 * teljes offline réteg (a lemezen ott lévő cache és outbox) elérhetetlen
 * volt minden app-újraindítás után, pedig épp az újraindítás az Android
 * mindennapi esete (lásd a végső review C2 pontját).
 *
 * Miért biztonságos ez: az app egyetlen közös jelszót használ, nincs
 * felhasználó-modell, és a provizórikusan beengedett felhasználó pontosan
 * annyit lát, amennyi már eddig is ott volt az eszközén (IndexedDB-cache).
 * Minden szerverhívás továbbra is hitelesítő adatot igényel, és az első
 * valódi `401` kidobja (lásd `api/client.js`), ami egyúttal ezt a jelzőt is
 * törli. **Ne bővítsük ezt ki bármi olyan elérésére, ami nem volt már eddig
 * is helyben** — akkor ez a jelző hitelesítés-helyettesítővé válna.
 */
const MARKER_KEY = 'authenticated_once';

/** A `localStorage`-ban tárolt igaz érték. */
const MARKER_VALUE = '1';

/**
 * Natívan a `Preferences`-t használjuk, egyezően a munkamenet-token
 * tárolásával (`native/token.js`) — a böngészőben (PWA) `localStorage`, mert
 * ott a Capacitor `Preferences` web-implementációja is ugyanoda írna, csak
 * egy plusz réteggel. Mindkettő túléli a hidegindítást.
 * @returns {Promise<void>}
 */
export async function rememberAuthenticated() {
  try {
    if (isNativeApp()) {
      await Preferences.set({ key: MARKER_KEY, value: MARKER_VALUE });
      return;
    }
    globalThis.localStorage?.setItem(MARKER_KEY, MARKER_VALUE);
  } catch (error) {
    // A jelző elmentése csak egy kényelmi optimalizáció a KÖVETKEZŐ offline
    // indulásra; egy megtagadott tárhely (privát böngészés, betelt kvóta)
    // nem ronthatja el a most sikeres bejelentkezést.
    console.error('A hitelesítés-jelző mentése nem sikerült:', error);
  }
}

/**
 * A jelző törlése. Kijelentkezéskor és minden valódi `401`-nél lefut: onnantól
 * egy offline hidegindulás ismét a bejelentkezésre visz, ahogy kell.
 * @returns {Promise<void>}
 */
export async function forgetAuthenticated() {
  try {
    if (isNativeApp()) {
      await Preferences.remove({ key: MARKER_KEY });
      return;
    }
    globalThis.localStorage?.removeItem(MARKER_KEY);
  } catch (error) {
    console.error('A hitelesítés-jelző törlése nem sikerült:', error);
  }
}

/**
 * Volt-e már sikeres hitelesítés ezen az eszközön. Tárolási hiba esetén
 * szándékosan `false` (zárt irányba tévedünk): ilyenkor a felhasználó a
 * bejelentkezésen landol, ami rosszabb élmény, de nem enged be senkit, aki
 * itt még soha nem hitelesített.
 * @returns {Promise<boolean>}
 */
export async function hasAuthenticatedBefore() {
  try {
    if (isNativeApp()) {
      const { value } = await Preferences.get({ key: MARKER_KEY });
      return value === MARKER_VALUE;
    }
    return globalThis.localStorage?.getItem(MARKER_KEY) === MARKER_VALUE;
  } catch (error) {
    console.error('A hitelesítés-jelző olvasása nem sikerült:', error);
    return false;
  }
}
