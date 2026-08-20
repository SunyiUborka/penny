import { router } from '../router/index.js';
import { getApiBase } from './baseUrl.js';
import { getToken } from '../native/token.js';
import { isNativeApp } from '../utils/platform.js';

export class ApiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} statusCode
   * @param {unknown} [details]
   */
  constructor(code, message, statusCode, details) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * @param {string} method
 * @param {string} path /-jel nélküli /api alatti útvonal, pl. "/people"
 * @param {{ body?: unknown, schema?: import('zod').ZodType }} [options]
 */
async function request(method, path, options = {}) {
  const { body, schema } = options;

  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (isNativeApp()) {
    // A szerver ebből tudja, hogy a login válaszába tokent is tegyen.
    headers['X-Client'] = 'app';
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${getApiBase()}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && path !== '/auth/me') {
    // A store-t itt, hívás pillanatában (dinamikusan) importáljuk, nem a
    // fájl tetején: az auth.js maga importálja ezt a modult (`apiClient`),
    // egy statikus import kör tehát a modulbetöltés sorrendjétől függő,
    // törékeny inicializálást eredményezne.
    const { useAuthStore } = await import('../stores/auth.js');
    const authStore = useAuthStore();
    // Előbb jelöljük hitelesítetlennek a store-t, csak utána navigálunk —
    // különben a router guard "authenticated: true" mellett azonnal
    // visszadobná ide a felhasználót, végtelen kérés-hurkot okozva (lásd a
    // review 1. pontját). A store `markUnauthenticated`-je ugyanezt teszi,
    // és emellett törli a „volt már itt sikeres hitelesítés" jelzőt is
    // (`offline/session.js`) — enélkül egy visszavont munkamenet után a
    // következő offline hidegindulás provizórikusan újra beengedne.
    await authStore.markUnauthenticated();
    const redirect = router.currentRoute.value.fullPath;
    if (router.currentRoute.value.name !== 'login') {
      router.push({ name: 'login', query: { redirect } });
    }
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // Egy nem JSON törzs (pl. egy proxy HTML 502/504-es hibaoldala, vagy egy
      // rossz kapura tévedt kapcsolat) itt még nem dobhat `SyntaxError`-t:
      // az egy valódi (bár rosszul formázott) szerverválaszt átvitel-szintű
      // hibának mutatna, és a hívók (pl. az outbox) ez alapján sorba
      // állítanák egy olyan írást, amit a szerver ténylegesen elutasított.
      // Payload hiányában a lenti `!response.ok` ág a válasz valódi
      // státuszkódjával dob majd `ApiError`-t; egy 2xx, de értelmezhetetlen
      // törzs pedig a séma-ellenőrzésen bukik hangosan.
      payload = null;
    }
  }

  if (!response.ok) {
    const errorPayload = payload?.error ?? {
      code: 'UNKNOWN_ERROR',
      message: 'Ismeretlen hiba történt.',
    };
    throw new ApiError(
      errorPayload.code,
      errorPayload.message,
      response.status,
      errorPayload.details,
    );
  }

  return schema ? schema.parse(payload) : payload;
}

/**
 * Az SSE streamek teljes URL-je. Az EventSource nem a fetch-alapú `request`
 * helperen megy át (ezért a 401-kezelés sem érvényes rá), de az API
 * bázisútvonal így is egy helyen marad.
 * @param {string} path
 */
export function apiStreamUrl(path) {
  return `${getApiBase()}${path}`;
}

export const apiClient = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  delete: (path, options) => request('DELETE', path, options),
};
