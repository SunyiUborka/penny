import { LOGIN_DELAY_MAX_MS, LOGIN_DELAY_STEP_MS, LOGIN_DELAY_WINDOW_MS } from '../config/auth.js';

/**
 * IP-cím szerinti sikertelen belépési kísérletszám, csúszóablakos ürítéssel.
 * A tényleges 5/perc hard limitet a @fastify/rate-limit adja; ez a modul csak
 * a növekvő késleltetést biztosítja a brute force lassítására.
 * @type {Map<string, { count: number, windowStart: number }>}
 */
const attemptsByIp = new Map();

function getOrCreateEntry(ip, now) {
  const existing = attemptsByIp.get(ip);
  if (existing && now - existing.windowStart <= LOGIN_DELAY_WINDOW_MS) {
    return existing;
  }
  const fresh = { count: 0, windowStart: now };
  attemptsByIp.set(ip, fresh);
  return fresh;
}

/**
 * @param {string} ip
 * @returns {number} a válasz elküldése előtt alkalmazandó késleltetés ezredmásodpercben
 */
export function getLoginDelayMs(ip) {
  const entry = getOrCreateEntry(ip, Date.now());
  return Math.min(entry.count * LOGIN_DELAY_STEP_MS, LOGIN_DELAY_MAX_MS);
}

/**
 * @param {string} ip
 */
export function recordFailedLoginAttempt(ip) {
  const entry = getOrCreateEntry(ip, Date.now());
  entry.count += 1;
}

/**
 * @param {string} ip
 */
export function resetLoginAttempts(ip) {
  attemptsByIp.delete(ip);
}
