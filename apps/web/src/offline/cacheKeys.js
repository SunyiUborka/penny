/**
 * A `cache` object store kulcsai, **egy helyen**.
 *
 * Miért nem a hívási helyeken, kézzel összefűzve: ugyanezeket a kulcsokat két
 * oldal használja. A store-ok írják/olvassák őket (`fetchWithCache`,
 * `refreshIntoCache`), a nézetek pedig **bejelentik**, melyik kulcsot mutatják
 * éppen a képernyőn (`stores/offline.js` `setVisibleKeys`). Ha a két oldal
 * külön-külön írná le a string alakját, egy elírás vagy egy későbbi
 * kulcs-átnevezés némán széttartana: a nézet egy soha nem létező kulcsot
 * jelentene be, a sáv pedig örökre hallgatna arról, hogy elavult adat
 * látszik. A kulcs alakja ezért innen, függvényből jön.
 */

/** Az eseménylista kulcsa. */
export const EVENTS_CACHE_KEY = 'events';

/** A névjegyzék kulcsa. */
export const PEOPLE_CACHE_KEY = 'people';

/**
 * Egyetlen esemény kulcsa.
 * @param {string} eventId
 * @returns {string}
 */
export function eventCacheKey(eventId) {
  return `event:${eventId}`;
}

/**
 * Egy esemény kiadáslistájának kulcsa.
 * @param {string} eventId
 * @returns {string}
 */
export function expensesCacheKey(eventId) {
  return `expenses:${eventId}`;
}

/**
 * Egy esemény kiegyenlítés-listájának kulcsa. Külön kulcs a kiadásokétól: a
 * két lista két külön kérés, és offline egyikük megléte nem jelenti a másikét.
 * @param {string} eventId
 * @returns {string}
 */
export function settlementPaymentsCacheKey(eventId) {
  return `settlement-payments:${eventId}`;
}

/**
 * Egy esemény kategórialistájának kulcsa. Külön kulcs a kiadásokétól: két
 * külön kérés, és offline egyikük megléte nem jelenti a másikét.
 * @param {string} eventId
 * @returns {string}
 */
export function categoriesCacheKey(eventId) {
  return `categories:${eventId}`;
}
