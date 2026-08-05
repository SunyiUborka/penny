import { router } from '../router/index.js';

const API_BASE = '/api';

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

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && path !== '/auth/me') {
    const redirect = router.currentRoute.value.fullPath;
    if (router.currentRoute.value.name !== 'login') {
      router.push({ name: 'login', query: { redirect } });
    }
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

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
  return `${API_BASE}${path}`;
}

export const apiClient = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  delete: (path, options) => request('DELETE', path, options),
};
