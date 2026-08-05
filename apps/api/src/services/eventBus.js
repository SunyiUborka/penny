import { EventEmitter } from 'node:events';

/**
 * Folyamaton belüli pub/sub az élő (SSE) frissítésekhez: a kiadás-mutációk
 * publikálnak, a stream route feliratkozik.
 *
 * Szándékosan memóriában tartott, külső broker (Redis) nélkül — egyetlen `api`
 * konténer fut (lásd compose.yaml), így nincs mit szinkronizálni példányok
 * között. Ha ez egyszer megváltozik, ennek a modulnak a belsejét kell
 * kicserélni; a két exportált függvény felületét nem.
 */
const bus = new EventEmitter();

// Eseményenként annyi listener van, ahány kliens éppen az adott esemény lapját
// nézi — a Node 10-es alapértelmezett limitje ehhez kevés, és csak felesleges
// figyelmeztetést írna a logba.
bus.setMaxListeners(0);

/**
 * @param {string} eventId
 * @returns {string} eseményenkénti csatornanév, hogy egy kliens csak annak az
 * eseménynek a forgalmát kapja, amit néz
 */
function channelFor(eventId) {
  return `event:${eventId}`;
}

/**
 * @param {string} eventId
 * @param {{ type: string, expense?: object, expenseId?: string }} message
 */
export function publishExpenseChange(eventId, message) {
  bus.emit(channelFor(eventId), message);
}

/**
 * @param {string} eventId
 * @param {(message: object) => void} listener
 * @returns {() => void} leiratkozó függvény — a stream bezárásakor hívni kell,
 * különben a listener a lezárt kapcsolathoz tapadva szivárog
 */
export function subscribeToExpenseChanges(eventId, listener) {
  const channel = channelFor(eventId);
  bus.on(channel, listener);
  return () => {
    bus.off(channel, listener);
  };
}
