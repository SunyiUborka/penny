/**
 * Natív Capacitor appban futunk-e. A `Capacitor` globálist a natív híd
 * injektálja a bundle betöltése előtt; a böngészőben nem létezik.
 * @returns {boolean}
 */
export function isNativeApp() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}
