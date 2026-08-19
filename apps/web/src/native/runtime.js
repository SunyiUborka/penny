import { Preferences } from '@capacitor/preferences';
import { getDefaultApiBase, setApiBase } from '../api/baseUrl.js';
import { isNativeApp } from '../utils/platform.js';

const SERVER_URL_KEY = 'server_url';

/**
 * A natív app indulási teendői, még az első render előtt: a felhasználó által
 * beállított szervercím visszatöltése. A weben no-op.
 * @returns {Promise<void>}
 */
export async function initNativeRuntime() {
  if (!isNativeApp()) {
    return;
  }
  const { value } = await Preferences.get({ key: SERVER_URL_KEY });
  if (value) {
    setApiBase(value);
  }
}

/**
 * A beállított szervercím elmentése és azonnali alkalmazása. Üres értékre a
 * beépített (fordítási idejű) alapértelmezés áll vissza.
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function saveServerUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) {
    await Preferences.remove({ key: SERVER_URL_KEY });
    setApiBase(getDefaultApiBase());
    return;
  }
  await Preferences.set({ key: SERVER_URL_KEY, value: trimmed });
  setApiBase(trimmed);
}
