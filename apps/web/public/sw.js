/*
 * Minimális service worker. Két célt szolgál: a PWA telepíthetőségét, és hogy
 * az app héja (index.html + a hashelt assetek) gyorsítótárból induljon.
 *
 * Amit szándékosan NEM tesz: nem nyúl az /api hívásokhoz. Az élő frissítés egy
 * órákig nyitva tartott SSE streamen megy (/api/events/:id/stream), amit egy
 * cache-elési kísérlet elvágna; a session cookie-val hitelesített válaszoknak
 * pedig nincs helye osztott cache-ben.
 *
 * Nincs skipWaiting sem: egy új service worker a következő indításnál veszi át
 * a szerepet, így nem cserélheti ki a futó oldal alól a lusta betöltésű
 * chunkokat.
 */
const CACHE = 'filler-v1';
const NAVIGATION_FALLBACK = '/';

/**
 * @param {Request | string} key
 * @param {Response} response
 */
async function putInCache(key, response) {
  const cache = await caches.open(CACHE);
  await cache.put(key, response);
}

/**
 * A navigációs fallback előtöltése. Ez az egyetlen előre cache-elt bejegyzés —
 * minden más futásidőben, kérés alapján kerül be, így nem kell a build hashelt
 * fájlneveit ide injektálni.
 */
async function precacheShell() {
  const cache = await caches.open(CACHE);
  await cache.add(NAVIGATION_FALLBACK);
}

/** A korábbi verziók cache-einek törlése. */
async function dropOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
}

/**
 * Network-first: egy deploy azonnal látszik, a cache csak offline fallback.
 * @param {Event & { request: Request, waitUntil: (promise: Promise<unknown>) => void }} event
 * @returns {Promise<Response>}
 */
async function navigationStrategy(event) {
  try {
    const response = await fetch(event.request);
    if (response.ok) {
      event.waitUntil(putInCache(NAVIGATION_FALLBACK, response.clone()));
    }
    return response;
  } catch {
    const cached = await caches.match(NAVIGATION_FALLBACK);
    return cached ?? Response.error();
  }
}

/**
 * Cache-first: a Vite hasht tesz a fájlnévbe, tehát a tartalom nem avulhat.
 * @param {Event & { request: Request, waitUntil: (promise: Promise<unknown>) => void }} event
 * @returns {Promise<Response>}
 */
async function assetStrategy(event) {
  const cached = await caches.match(event.request);
  if (cached) {
    return cached;
  }
  const response = await fetch(event.request);
  if (response.ok) {
    event.waitUntil(putInCache(event.request, response.clone()));
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(dropOldCaches());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  // A legfontosabb szabály: az /api hívások érintetlenül mennek át.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationStrategy(event));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(assetStrategy(event));
  }
});
