import { Preferences } from '@capacitor/preferences';
import { applyApiBaseOverride, getApiBaseOverride, normalizeApiBase } from '../api/baseUrl.js';

const API_BASE_KEY = 'api_base';

/**
 * A tárolt szerver-cím betöltése a memóriába. Az app indulásakor, az első
 * API-kérés ELŐTT kell lefutnia (lásd `native/runtime.js`).
 * @returns {Promise<void>}
 */
export async function loadApiBase() {
  const { value } = await Preferences.get({ key: API_BASE_KEY });
  applyApiBaseOverride(value || null);
}

/**
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function saveApiBase(value) {
  const normalized = normalizeApiBase(value);
  applyApiBaseOverride(normalized);
  await Preferences.set({ key: API_BASE_KEY, value: normalized });
}

/**
 * Visszaállás az alapértelmezett (fordítási időben beégetett) címre. A
 * memóriabeli érték itt is előbb ürül, mint a lemez: ha a törlés elhasal, a
 * folyamatban lévő munkamenet akkor se a régi címre küldjön.
 * @returns {Promise<void>}
 */
export async function clearApiBase() {
  applyApiBaseOverride(null);
  try {
    await Preferences.remove({ key: API_BASE_KEY });
  } catch (removeError) {
    try {
      await Preferences.set({ key: API_BASE_KEY, value: '' });
    } catch {
      throw removeError;
    }
  }
}

/** @returns {boolean} */
export function hasApiBaseOverride() {
  return getApiBaseOverride() !== null;
}
