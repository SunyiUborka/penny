/**
 * Natív Capacitor appban futunk-e. A `Capacitor` globálist a natív híd
 * injektálja a bundle betöltése előtt; a böngészőben nem létezik.
 * @returns {boolean}
 */
export function isNativeApp() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

/**
 * Van-e élő (SSE) frissítés ezen a platformon. A natív appban nincs: az
 * EventSource nem megy át a natív HTTP-rétegen, és a nyitva tartott kapcsolat
 * mobilon feleslegesen fogyasztaná az akkut.
 * @returns {boolean}
 */
export function liveUpdatesSupported() {
  return !isNativeApp();
}
