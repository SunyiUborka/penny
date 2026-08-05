import argon2 from 'argon2';
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_VALUE,
  SESSION_MAX_AGE_SECONDS,
} from '../config/auth.js';

/**
 * Az induláskor egyszer kiszámolt argon2id hash a megosztott jelszóhoz. Az
 * .env-ben ember-olvashatóan tárolt jelszót itt hasheljük memóriában, hogy a
 * bejelentkezés-ellenőrzés ne plaintext összehasonlítással történjen.
 * @type {string | null}
 */
let cachedPasswordHash = null;

/**
 * @param {string} plainPassword
 * @returns {Promise<void>}
 */
export async function initPasswordHash(plainPassword) {
  cachedPasswordHash = await argon2.hash(plainPassword, { type: argon2.argon2id });
}

/**
 * @param {string} password
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password) {
  if (!cachedPasswordHash) {
    return false;
  }
  try {
    return await argon2.verify(cachedPasswordHash, password);
  } catch {
    return false;
  }
}

/**
 * A "secure" jelzőt a tényleges kapcsolat alapján kell megadni (HTTPS-en
 * true), nem a NODE_ENV alapján — egy "secure" cookie-t a böngésző eldobja
 * plain HTTP felett, kivéve a localhost speciális esetét. Self-hosted LAN
 * IP-n (pl. 192.168.x.x) TLS nélkül elérve ez false kell legyen, különben a
 * bejelentkezés minden következő kérésen elvész.
 * @param {import('fastify').FastifyReply} reply
 * @param {boolean} isSecureConnection
 */
export function setSessionCookie(reply, isSecureConnection) {
  reply.setCookie(SESSION_COOKIE_NAME, SESSION_COOKIE_VALUE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureConnection,
    signed: true,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * @param {import('fastify').FastifyReply} reply
 * @param {boolean} isSecureConnection
 */
export function clearSessionCookie(reply, isSecureConnection) {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureConnection,
  });
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @returns {boolean}
 */
export function isRequestAuthenticated(request) {
  const rawCookie = request.cookies[SESSION_COOKIE_NAME];
  if (!rawCookie) {
    return false;
  }
  const unsigned = request.unsignCookie(rawCookie);
  return unsigned.valid && unsigned.value === SESSION_COOKIE_VALUE;
}
