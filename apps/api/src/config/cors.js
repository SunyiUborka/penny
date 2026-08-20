/**
 * A natív Android app WebView-jának origói. Az app HTTP-kérései a Capacitor
 * natív hídján mennek (arra nem érvényes a CORS), de az élő frissítés streamje
 * a WebView `fetch`-én — arra igen, tehát ezt az origót engedélyezni kell.
 *
 * A Capacitor alapértelmezett `androidScheme`-je `https`, ezért `https://localhost`
 * a tényleges origó; a `capacitor://localhost` a régebbi/eltérő séma-beállítás
 * miatt szerepel itt, hogy egy config-változás ne törje el némán a streamet.
 */
export const NATIVE_APP_ORIGINS = ['https://localhost', 'capacitor://localhost'];

/**
 * A hijackolt SSE-válaszra (apps/api/src/routes/events.js) kézzel felírandó
 * CORS-fejlécek egy adott kérés `Origin` fejléce alapján. Ugyanazt a döntést
 * hozza meg, mint a `@fastify/cors` plugin regisztrációja (app.js) —
 * mindkét helynek innen kell hívnia, ne írja újra senki a feltételt, mert
 * onnantól a két hely némán szétcsúszhat (pl. ha az engedélyezett lista
 * mintát vagy env-változót kap).
 *
 * Nincs `Access-Control-Allow-Credentials`: a natív stream-kérés nem küld
 * `credentials` opciót, tehát a böngésző same-origin módban kéri le, és
 * sosem néz utána ennek a fejlécnek egy cross-origin válaszon — fölösleges
 * lenne kiadni.
 * @param {string | undefined} origin a kérés `Origin` fejléce
 * @returns {Record<string, string>} a kiírandó fejlécek; üres objektum, ha
 * nincs `Origin` fejléc, vagy az nem szerepel az engedélyezettek között
 */
export function corsHeadersFor(origin) {
  if (!origin || !NATIVE_APP_ORIGINS.includes(origin)) {
    return {};
  }
  return {
    'Access-Control-Allow-Origin': origin,
    // Az engedélyezett origók listája alapján dől el a válasz — egy
    // megosztott cache enélkül egy másik origónak szánt fejlécet szolgálna
    // ki egy eltérő Origin fejlécű kérésre.
    Vary: 'Origin',
  };
}
