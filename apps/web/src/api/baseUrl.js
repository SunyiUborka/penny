/**
 * Az API bázisútvonala. A webes buildben relatív (`/api`), mert a frontendet
 * ugyanaz a szerver szolgálja ki, ami a `/api`-t proxyzza. A natív appban
 * abszolút URL kell, mert ott a WebView a helyi assetekről tölt be — ezt a
 * `VITE_API_BASE_URL` adja meg fordítási időben. Az érték fordítási időben
 * rögzített: ha a szerver máshova költözik, az APK-t újra kell fordítani.
 */

/**
 * @param {string} value
 * @returns {string}
 */
function normalize(value) {
  const trimmed = value.trim();
  // A build-időben megadott cím több záró perjelet is tartalmazhat.
  return trimmed.replace(/\/+$/, '');
}

const API_BASE = normalize(import.meta.env.VITE_API_BASE_URL ?? '/api');

/** @returns {string} */
export function getApiBase() {
  return API_BASE;
}
