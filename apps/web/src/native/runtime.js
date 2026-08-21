import { isNativeApp } from '../utils/platform.js';
import { loadApiBase } from './apiBase.js';
import { loadToken } from './token.js';

/**
 * Natív indulási teendők. Böngészőben nincs teendő. Mindkét feladatnak az
 * első API-kérés ELŐTT kell lefutnia: a szerver címe (a bejelentkezésen
 * beállítható felülírás) és a korábban elmentett munkamenet-token.
 *
 * A cím előbb, a token utána: a token a címhez tartozik, egy fordított
 * sorrendű hiba esetén (ha a cím olvasása bukik) legalább ne induljon el
 * kérés a rossz szerverre.
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
  await loadApiBase();
  await loadToken();
}
