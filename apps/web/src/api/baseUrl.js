/**
 * Az API bázisútvonala. A webes buildben relatív (`/api`), mert a frontendet
 * ugyanaz a szerver szolgálja ki, ami a `/api`-t proxyzza. A natív appban
 * abszolút URL kell, mert ott a WebView a helyi assetekről tölt be — ezt a
 * `VITE_API_BASE_URL` adja fordítási időben, és a felhasználó futásidőben
 * felül tudja írni (lásd Task 5).
 */

/**
 * @param {string} value
 * @returns {string}
 */
function normalize(value) {
  const trimmed = value.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

const DEFAULT_BASE = normalize(import.meta.env.VITE_API_BASE_URL ?? '/api');

let currentBase = DEFAULT_BASE;

/** @returns {string} */
export function getDefaultApiBase() {
  return DEFAULT_BASE;
}

/** @returns {string} */
export function getApiBase() {
  return currentBase;
}

/**
 * @param {string} value
 */
export function setApiBase(value) {
  currentBase = normalize(value);
}
