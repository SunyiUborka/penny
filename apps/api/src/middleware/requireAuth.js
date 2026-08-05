import { UnauthorizedError } from '../errors.js';
import { isRequestAuthenticated } from '../services/authService.js';

/**
 * Fastify onRequest hook: minden ide tartozó route csak érvényes session
 * cookie-val hívható. Explicit Promise-t ad vissza (nem async/await), hogy
 * Fastify egyértelműen promise-alapú hookként ismerje fel, és ne várjon egy
 * sosem érkező callback-style done()-ra.
 * @param {import('fastify').FastifyRequest} request
 * @returns {Promise<void>}
 */
export function requireAuth(request) {
  if (!isRequestAuthenticated(request)) {
    return Promise.reject(new UnauthorizedError());
  }
  return Promise.resolve();
}
