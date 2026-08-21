/**
 * Az API bázisútvonala. A webes buildben relatív (`/api`), mert a frontendet
 * ugyanaz a szerver szolgálja ki, ami a `/api`-t proxyzza. A natív appban
 * abszolút URL kell, mert ott a WebView a helyi assetekről tölt be — az
 * alapértéket a `VITE_API_BASE_URL` adja meg fordítási időben.
 *
 * A natív app ezt felülírhatja saját címre (lásd `native/apiBase.js`): a
 * felülírás a bejelentkezéskor állítható, és az indulásnál — az első kérés
 * előtt — töltődik be. A `getApiBase()` szinkron marad, mert a kérések
 * fejlécének/URL-jének összeállítása sem lehet aszinkron.
 */

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeApiBase(value) {
  return value.trim().replace(/\/+$/, '');
}

export const DEFAULT_API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE_URL ?? '/api');

/** @type {string | null} */
let override = null;

/** @returns {string} */
export function getApiBase() {
  return override ?? DEFAULT_API_BASE;
}

/** @returns {string | null} */
export function getApiBaseOverride() {
  return override;
}

/**
 * @param {string | null} value
 * @returns {void}
 */
export function applyApiBaseOverride(value) {
  override = value ? normalizeApiBase(value) : null;
}
