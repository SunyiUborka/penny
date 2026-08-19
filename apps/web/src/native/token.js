import { Preferences } from '@capacitor/preferences';

const TOKEN_KEY = 'session_token';

/**
 * Szinkron elérhető másolat: a HTTP-kérések fejlécének összeállítása nem
 * lehet aszinkron, a Preferences olvasása viszont az.
 * @type {string | null}
 */
let cachedToken = null;

/** @returns {string | null} */
export function getToken() {
  return cachedToken;
}

/** @returns {Promise<void>} */
export async function loadToken() {
  const { value } = await Preferences.get({ key: TOKEN_KEY });
  // A `clearToken` sikertelen törlés esetén üres stringgel írja felül a
  // tárolt értéket (lásd lent) — azt itt is "nincs token"-ként kell
  // kezelni, különben egy korábbi hibás törlés után az app üres stringet
  // próbálna Bearer tokenként elküldeni.
  cachedToken = value || null;
}

/**
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function setToken(token) {
  cachedToken = token;
  await Preferences.set({ key: TOKEN_KEY, value: token });
}

/**
 * A memóriabeli másolatot azonnal nullázzuk, mielőtt a lemezre írnánk: a
 * hívó (auth store) ettől kezdve nem küld Authorization fejlécet akkor sem,
 * ha a lenti írás elhasal — a folyamatban lévő munkamenet legalább nem
 * használja tovább a törölni kívánt tokent.
 *
 * Ha maga a `Preferences.remove` elhasal, egy második próbálkozással üres
 * stringre írjuk felül a tárolt értéket — egy korábban elmentett, még
 * érvényes token ne maradjon olvasható a lemezen egy sikertelen törlés
 * után, mert különben egy újraindításkor a `loadToken` csendben
 * visszatöltené, és a felhasználó kijelentkezés után is bejelentkezve
 * maradna (lásd a review 2. pontját). Ha mindkét írás elhasal, a hívónak
 * jeleznünk kell: az eredeti hibát továbbdobjuk.
 * @returns {Promise<void>}
 */
export async function clearToken() {
  cachedToken = null;
  try {
    await Preferences.remove({ key: TOKEN_KEY });
  } catch (removeError) {
    try {
      await Preferences.set({ key: TOKEN_KEY, value: '' });
    } catch {
      throw removeError;
    }
  }
}
