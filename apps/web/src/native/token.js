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
  cachedToken = value ?? null;
}

/**
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function setToken(token) {
  cachedToken = token;
  await Preferences.set({ key: TOKEN_KEY, value: token });
}

/** @returns {Promise<void>} */
export async function clearToken() {
  cachedToken = null;
  await Preferences.remove({ key: TOKEN_KEY });
}
