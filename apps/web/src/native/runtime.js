import { isNativeApp } from '../utils/platform.js';
import { loadToken } from './token.js';

/**
 * Natív indulási teendők. Böngészőben nincs teendő. Az egyetlen feladat a
 * korábban elmentett munkamenet-token memóriába töltése, mielőtt az első
 * API-kérés kimenne — a szerver címe fordítási időben rögzített, azt itt
 * nem kell (és nem is szabad) módosítani.
 *
 * Ha ez a függvény elutasított Promise-t ad vissza (pl. a Preferences
 * olvasása hibázik), a hívónak akkor is mountolnia kell az appot — lásd
 * `main.js` bootstrap-ját.
 * @returns {Promise<void>}
 */
export async function initNativeRuntime() {
  if (!isNativeApp()) {
    return;
  }
  await loadToken();
}
