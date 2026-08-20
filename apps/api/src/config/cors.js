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
