# Élő frissítés minden képernyőn — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A más eszközön történt kiadás-változás azonnal megjelenjen a natív Android appban is (nem csak böngészőben), az elszámolás magától kövesse a kiadásokat, és az eseménylista lehúzásra frissíthető legyen.

**Architecture:** Egy új transzport-modul (`apps/web/src/api/eventStream.js`) elrejti, hogy a platform `EventSource`-szal (böngésző) vagy a Capacitor által megtartott, nem patchelt `fetch`-fel (natív app, `Authorization: Bearer` fejléccel) streamel. A kiadás-feliratkozás a fül-komponensből feljebb, az esemény-nézetbe kerül, hogy mindkét fülön éljen; az elszámolás panel innentől nem kér le semmit, hanem a betöltött kiadáslistából számol ugyanazzal a `computeSettlement`-tel, amit a backend használ.

**Tech Stack:** Vue 3 + Vite, Pinia (option store), Fastify + `@fastify/cors`, Capacitor 8.5.0, `packages/shared` (Zod + `computeSettlement`).

**Spec:** `docs/superpowers/specs/2026-08-20-elo-frissites-design.md`

## Global Constraints

- **Nincs automatizált teszt a projektben.** Ne vezess be Vitest/Playwright/Testcontainers-t. Az ellenőrzés: `npm run lint`, `npm run format:check`, `npm run build`, `npm run build:mobile`, plusz a taskban leírt kézi ellenőrzés.
- Sima JavaScript, TypeScript nélkül. JSDoc az exportált függvényekre, Zod-validáció a határátlépéseknél.
- ESLint: `eqeqeq`, `no-implicit-coercion`, `no-var`, `prefer-const`, `no-unused-vars`, `consistent-return`, `require-await`, `promise/catch-or-return`, `promise/always-return`, `promise/no-return-wrap`, `promise/param-names`. A pénzszabály (`parseFloat`, `Number.parseFloat`, `.toFixed(`) csak a `packages/shared/src/currency/format.js`-ben oldható, és `noInlineConfig` miatt inline `eslint-disable`-lel nem kerülhető meg.
- Új fájlok kiterjesztése `.js`, **ne** `.mjs`.
- Backend rétegzés: routes → services → repositories. Mongoose modell nem szivárog a route rétegbe.
- Commit konvenció: Conventional Commits, **magyar commit üzenet**, **`Co-Authored-By` sor nélkül**.
- Minden felhasználónak látszó szöveg magyar.
- Csak a `apps/web/src/assets/theme.css` meglévő tokenjei használhatók: `--paper`, `--paper-raised`, `--ink`, `--ink-soft`, `--forint`, `--forint-soft`, `--stamp`, `--stamp-soft`, `--brass`, `--rule`, `--rule-strong`, `--font-display`, `--font-body`, `--font-mono`, `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-6`, `--space-8`.
- Ellenőrző parancsot **ne** csövezz (`| tail`) — a pipe elnyeli a kilépési kódot, és a bukott ellenőrzés zöldnek látszik.
- **A böngészős viselkedés nem romolhat**: a PWA, a service worker, a cookie-s bejelentkezés és az azonnali SSE-frissítés maradjon pontosan a mai.
- Nincs push értesítés és nincs háttérben futó lekérdezés ebben a körben (lásd a spec „Amit ez a projekt nem tartalmaz" szakaszát).

## Fájlszerkezet

| Fájl                                          | Felelősség                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/api/eventStream.js` _(új)_      | Egy SSE-kapcsolat életciklusa, platformfüggetlen felülettel. Böngészőben `EventSource`, natívban nem patchelt `fetch` + saját újrakapcsolódás. |
| `apps/web/src/stores/expenses.js`             | Kiadáslista-állapot és a stream-üzenetek alkalmazása. A platform-elágazás kikerül belőle.                                                      |
| `apps/web/src/views/EventDetailView.vue`      | Az esemény nézet: innentől ő nyitja/zárja a feliratkozást és tölti a kiadáslistát — mindkét fülre érvényesen.                                  |
| `apps/web/src/components/ExpenseTable.vue`    | Csak megjelenítés: lista, szűrő, modal, lehúzásos gesztus, kapcsolatjelző. Nem tölt és nem iratkozik fel.                                      |
| `apps/web/src/components/SettlementPanel.vue` | Az elszámolás a store kiadáslistájából számolva, saját HTTP-kérés nélkül.                                                                      |
| `apps/web/src/stores/events.js`               | Eseménylista-állapot, csendes újratöltéssel.                                                                                                   |
| `apps/web/src/views/EventsListView.vue`       | Az eseménylista + a lehúzásos gesztus rákötése.                                                                                                |
| `apps/web/src/utils/platform.js`              | Csak `isNativeApp()` marad.                                                                                                                    |
| `apps/api/src/config/cors.js` _(új)_          | A natív app engedélyezett origói egy helyen, kommentelve.                                                                                      |
| `apps/api/src/app.js`                         | A CORS-regisztráció ezt a listát használja.                                                                                                    |

---

### Task 1: Csendes újratöltés és lehúzásos frissítés az eseménylistán

**Files:**

- Modify: `apps/web/src/stores/events.js` (új action a `fetchEvents` után)
- Modify: `apps/web/src/views/EventsListView.vue` (`<script setup>` és a `<template>` teteje)

**Interfaces:**

- Consumes: `attachPullToRefresh({ onRefresh, onProgress })` a `apps/web/src/utils/pullToRefresh.js`-ből (visszatérési értéke a leszerelő függvény), `isNativeApp()` a `apps/web/src/utils/platform.js`-ből.
- Produces: `useEventsStore().refreshQuietly(): Promise<void>` — újratölti az eseménylistát a `loading` felvillantása nélkül, és hiba esetén a meglévő listát hagyja a helyén.

**Háttér:** az eseménylista ma csak `onMounted`-kor tölt, tehát egy másik eszközön létrehozott esemény soha nem jelenik meg. A `refreshQuietly` mintája a `apps/web/src/stores/expenses.js`-ben már megvan — ott is azért van külön a csendes változat, mert a látható elavult lista többet ér egy villogó „Betöltés…"-nél.

- [ ] **Step 1: Csendes újratöltés az events store-ban**

`apps/web/src/stores/events.js` — a `fetchEvents` action **után**:

```js
    /**
     * Újratöltés a „Betöltés…” állapot felvillantása nélkül. Lehúzásos
     * frissítéskor hívjuk: a lista már látszik, és egy villanó betöltés-jelző
     * zavaróbb, mint hasznos.
     * @returns {Promise<void>}
     */
    async refreshQuietly() {
      try {
        this.events = await apiClient.get('/events', { schema: eventListResponseSchema });
      } catch {
        // Csendben bukik is: a látható (elavult) lista többet ér egy
        // hibaüzenetnél, és a következő frissítés helyrehozza.
      }
    },
```

- [ ] **Step 2: A gesztus bekötése az eseménylistába**

`apps/web/src/views/EventsListView.vue` — a `<script setup>` importjaihoz:

```js
import { onMounted, onUnmounted, ref } from 'vue';
import { isNativeApp } from '../utils/platform.js';
import { attachPullToRefresh } from '../utils/pullToRefresh.js';
```

(A meglévő `import { onMounted, ref } from 'vue';` sort cseréld a fentire — az `onUnmounted` új.)

A `formError` deklaráció után:

```js
const pullRatio = ref(0);
let detachPullToRefresh = null;
```

A meglévő `onMounted` blokk **végére**, a `Promise.all` után:

```js
// A lehúzásos gesztus natív affordance: böngészőben nincs rá szükség, ott
// az oldal újratöltése a megszokott mozdulat.
if (isNativeApp()) {
  detachPullToRefresh = attachPullToRefresh({
    onRefresh: () => eventsStore.refreshQuietly(),
    onProgress: (ratio) => {
      pullRatio.value = ratio;
    },
  });
}
```

Új blokk az `onMounted` után:

```js
onUnmounted(() => {
  if (detachPullToRefresh) {
    detachPullToRefresh();
    detachPullToRefresh = null;
  }
});
```

- [ ] **Step 3: A gesztus visszajelzése a sablonban**

`apps/web/src/views/EventsListView.vue` — a `<template>`-ben a `events__header` záró `</div>` után, a „Betöltés…" sor **elé**:

```html
<p v-if="pullRatio > 0" class="events__pull" :style="{ opacity: pullRatio }">
  {{ pullRatio >= 1 ? 'Frissítés…' : 'Húzd lejjebb a frissítéshez' }}
</p>
```

A fájl `<style>` blokkjának végére:

```css
.events__pull {
  margin: 0 0 var(--space-2);
  text-align: center;
  font-size: 0.85rem;
  color: var(--ink-soft);
}
```

- [ ] **Step 4: Ellenőrzés**

Külön parancsokban, csövezés nélkül:

```bash
npm run lint
npm run format:check
npm run build -w @filler/web
```

Elvárt: mind hibátlan.

- [ ] **Step 5: Ellenőrzés — a böngészőben nem jelenik meg a gesztus**

```bash
docker compose up -d --build
```

Nyisd meg a `http://localhost:8090` címet, jelentkezz be. Elvárt: az eseménylista a megszokott, a „Húzd lejjebb…" felirat **nem** látszik, és a lista betöltése változatlan. Ha nincs böngésző a környezetben, igazold a buildből (a `pullRatio` kezdőértéke `0`, tehát a `v-if` hamis), és írd le a riportban, hogy élőben nem tudtad megnézni.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/events.js apps/web/src/views/EventsListView.vue
git commit -m "feat(web): lehúzásos frissítés az eseménylistán"
```

---

### Task 2: CORS-engedély a natív app origójának

**Files:**

- Create: `apps/api/src/config/cors.js`
- Modify: `apps/api/src/app.js` (a `cors` regisztrációja, jelenleg `{ origin: false, credentials: true }`)

**Interfaces:**

- Consumes: semmit korábbi taskból.
- Produces: `NATIVE_APP_ORIGINS: string[]` a `apps/api/src/config/cors.js`-ből. Az API ezekre az origókra ad CORS-fejléceket; minden más cross-origin kérés ugyanúgy elutasított, mint eddig.

**Háttér:** a natív app HTTP-kérései a `CapacitorHttp` natív hídon mennek, amire nem érvényes a CORS — ezért működik ma minden CORS-beállítás nélkül. A stream viszont a WebView `fetch`-én megy (Task 3), tehát arra már érvényes: a WebView origójának szerepelnie kell az engedélyezettek között, különben a böngészőmotor eldobja a választ.

- [ ] **Step 1: Az engedélyezett origók egy helyen**

`apps/api/src/config/cors.js`:

```js
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
```

- [ ] **Step 2: A regisztráció használja a listát**

`apps/api/src/app.js` — az import blokkhoz:

```js
import { NATIVE_APP_ORIGINS } from './config/cors.js';
```

A `cors` regisztrációját cseréld:

```js
// `origin: false` helyett szűk lista: a böngészős kérések same-origin
// mennek (nekik nem kell CORS), a natív app streamje viszont a WebView
// origójáról érkezik. A hitelesítés ott fejléces tokennel történik.
await app.register(cors, { origin: NATIVE_APP_ORIGINS, credentials: true });
```

- [ ] **Step 3: Ellenőrzés — lint és indulás**

```bash
npm run lint
npm run format:check
docker compose up -d --build
docker compose ps
```

Elvárt: minden hibátlan, a service-ek futnak.

- [ ] **Step 4: Ellenőrzés — a CORS-fejléc csak az engedélyezett origóra jön**

A próbához `/api` alatti útvonal kell, mert a `/health` route prefix nélkül van
regisztrálva, és a 8090-es porton a web szervert találná, nem az API-t. Az
`/api/auth/me` hitelesítés nélkül is válaszol, ezért alkalmas:

```bash
curl -s -D - -o /dev/null http://localhost:8090/api/auth/me -H 'Origin: https://localhost'
curl -s -D - -o /dev/null http://localhost:8090/api/auth/me -H 'Origin: https://tamado.example'
```

Elvárt: az elsőnél megjelenik az `access-control-allow-origin: https://localhost` fejléc, a másodiknál **nem** jelenik meg `access-control-allow-origin` fejléc.

- [ ] **Step 5: Ellenőrzés — a böngészős bejelentkezés sértetlen**

Nyisd meg a `http://localhost:8090` címet, jelentkezz be, tölts újra egy oldalt, majd lépj ki. Elvárt: mindhárom a megszokott módon működik (a böngésző same-origin kér, tehát a CORS-változás nem érinti). Ha nincs böngésző, ugyanezt igazold curl-lel cookie-jar-ral, és írd le a riportban, mit nem tudtál élőben megnézni.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config/cors.js apps/api/src/app.js
git commit -m "feat(api): CORS-engedély a natív app WebView origójának"
```

---

### Task 3: SSE-transzport modul és a store átállítása

**Files:**

- Create: `apps/web/src/api/eventStream.js`
- Modify: `apps/web/src/stores/expenses.js` (a modulszintű változók, a `subscribe`, a `subscribeNative` törlése, az `unsubscribe`)
- Modify: `apps/web/src/utils/platform.js` (a `liveUpdatesSupported` törlése)
- Modify: `apps/web/src/components/ExpenseTable.vue` (a kapcsolatjelző mindkét platformon látszik)

**Interfaces:**

- Consumes: `apiStreamUrl(path)` a `apps/web/src/api/client.js`-ből, `getToken()` a `apps/web/src/native/token.js`-ből, `isNativeApp()` a `apps/web/src/utils/platform.js`-ből.
- Produces: `openEventStream({ path, onMessage, onOpen, onClose }): () => void` a `apps/web/src/api/eventStream.js`-ből. A visszatérési érték a lezáró függvény; kétszer meghívni biztonságos. Az `onOpen` minden (újra)kapcsolódásnál lefut, az `onClose` minden kapcsolat-megszűnésnél, az `onMessage` a nyers `data:` törzset kapja stringként.

**Háttér:** a `CapacitorHttp` a `window.fetch`-et a natív HTTP-rétegre irányítja, ami nem streamel — de a Capacitor a natív bridge-ben eltárolja az eredetit `window.CapacitorWebFetch` néven (ez a `apps/mobile/android/.../native-bridge.js`-ben ellenőrizve). Azon a kérés a WebView-ból megy, tehát streamelhető, és fejlécet is tud küldeni: így a meglévő Bearer token használható, és nem kell tokent URL-be tenni.

A szerver a következőket írja a streamre: `retry: 5000\n\n` induláskor, `data: {json}\n\n` üzenetenként, és `: ping\n\n` 20 másodpercenként.

- [ ] **Step 1: A transzport modul**

`apps/web/src/api/eventStream.js`:

```js
import { apiStreamUrl } from './client.js';
import { getToken } from '../native/token.js';
import { isNativeApp } from '../utils/platform.js';

/** Az első újrakapcsolódási várakozás és a felső korlát. */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

/**
 * Egy SSE-kapcsolat életciklusa, platformfüggetlen felülettel.
 *
 * Böngészőben `EventSource`: same-origin kérés, a hitelesítést a httpOnly
 * session cookie adja, az újrakapcsolódás a böngészőé. A natív appban ez nem
 * járható — az `EventSource` nem tud `Authorization` fejlécet küldeni, a
 * `CapacitorHttp` által patchelt `fetch` pedig nem streamel. Ott az eredeti,
 * eltárolt `fetch`-fel olvassuk a streamet, Bearer tokennel, és az
 * újrakapcsolódás a mi dolgunk.
 *
 * @param {{
 *   path: string,
 *   onMessage: (data: string) => void,
 *   onOpen: () => void,
 *   onClose: () => void,
 * }} options
 * @returns {() => void} lezáró függvény (többször is hívható)
 */
export function openEventStream(options) {
  const url = apiStreamUrl(options.path);

  if (!isNativeApp()) {
    return openWithEventSource(url, options);
  }
  return openWithFetch(url, options);
}

/**
 * @param {string} url
 * @param {object} options
 * @returns {() => void}
 */
function openWithEventSource(url, options) {
  const source = new EventSource(url);

  source.onopen = () => {
    options.onOpen();
  };
  source.onerror = () => {
    // Az EventSource magától újrapróbálkozik a szerver `retry` mezője
    // szerint; itt csak jelezzük, hogy épp nincs kapcsolat.
    options.onClose();
  };
  source.onmessage = (message) => {
    options.onMessage(message.data);
  };

  return () => {
    source.close();
  };
}

/**
 * @param {string} url
 * @param {object} options
 * @returns {() => void}
 */
function openWithFetch(url, options) {
  const state = { closed: false, controller: null };

  runFetchStream(url, options, state).catch((error) => {
    // Ide csak váratlan hiba jut: a hálózati hibákat a ciklus maga kezeli.
    console.error('Az élő frissítés streamje leállt:', error);
    options.onClose();
  });

  return () => {
    state.closed = true;
    if (state.controller) {
      state.controller.abort();
    }
  };
}

/**
 * Újrakapcsolódó olvasó ciklus. Növekvő várakozással próbálkozik, hogy egy
 * leállt szerver ne kapjon másodpercenkénti kéréseket.
 * @param {string} url
 * @param {object} options
 * @param {{ closed: boolean, controller: AbortController | null }} state
 * @returns {Promise<void>}
 */
async function runFetchStream(url, options, state) {
  const webFetch = globalThis.CapacitorWebFetch;
  if (typeof webFetch !== 'function') {
    // A Capacitor átnevezte vagy nem tartja meg az eredeti fetch-et. Nem
    // streamelünk vakon a patchelt fetch-en (az nem stream), inkább
    // őszintén jelezzük: a kapcsolatjelző „nincs kapcsolat”-ot mutat, és a
    // lehúzásos frissítés marad az út.
    console.error('Nincs elérhető nem patchelt fetch, az élő frissítés kikapcsol.');
    options.onClose();
    return;
  }

  let attempt = 0;

  while (!state.closed) {
    const token = getToken();
    if (!token) {
      // Token nélkül a stream 401-et kapna. Nem próbálkozunk körbe-körbe: a
      // következő bejelentkezés új feliratkozást nyit.
      options.onClose();
      return;
    }

    state.controller = new AbortController();

    try {
      const response = await webFetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: state.controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Váratlan stream-válasz: ${response.status}`);
      }

      attempt = 0;
      options.onOpen();
      await readStreamBody(response.body, options.onMessage, state);
    } catch {
      // Megszakadt vagy elutasított kapcsolat: alább újrapróbáljuk.
    }

    options.onClose();

    if (state.closed) {
      return;
    }

    await delay(Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS));
    attempt += 1;
  }
}

/**
 * A választörzs olvasása és SSE-blokkokra bontása. Egy blokk üres sorral
 * záródik; a `data:` sorok törzse az üzenet, a `:` kezdetű sor heartbeat, a
 * `retry:` sor a böngésző `EventSource`-ának szól — mindkettőt eldobjuk.
 * @param {ReadableStream} body
 * @param {(data: string) => void} onMessage
 * @param {{ closed: boolean }} state
 * @returns {Promise<void>}
 */
async function readStreamBody(body, onMessage, state) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (!state.closed) {
    const { value, done } = await reader.read();
    if (done) {
      return;
    }

    buffer += decoder.decode(value, { stream: true });

    let separator = buffer.indexOf('\n\n');
    while (separator !== -1) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const payload = dataFromBlock(block);
      if (payload !== '') {
        onMessage(payload);
      }
      separator = buffer.indexOf('\n\n');
    }
  }
}

/**
 * @param {string} block egy SSE-blokk az üres sor nélkül
 * @returns {string} a `data:` sorok összefűzött törzse, vagy üres string
 */
function dataFromBlock(block) {
  return block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n');
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
```

- [ ] **Step 2: A store a transzport modult használja**

`apps/web/src/stores/expenses.js` — az importok: töröld a `@capacitor/app` és a `liveUpdatesSupported` importját, és vedd fel az újat:

```js
import { defineStore } from 'pinia';
import {
  expenseListResponseSchema,
  expenseResponseSchema,
  expenseStreamMessageSchema,
} from '@filler/shared';
import { apiClient } from '../api/client.js';
import { openEventStream } from '../api/eventStream.js';
```

A modulszintű változók blokkját cseréld erre (az `appStateListener` és a `subscriptionGeneration` a hozzá tartozó hosszú kommenttel törlődik — a transzport modul lezárója szinkron, tehát nincs mit generációval védeni):

```js
// Modulszinten, nem a store state-jében: a stream lezárója és a timerek nem
// reaktív adatok, a Pinia state-be téve csak feleslegesen proxyzódnának.
let closeStream = null;
let streamEventId = null;
let visibilityHandler = null;
const freshTimers = new Map();
```

- [ ] **Step 3: A `subscribe` és az `unsubscribe` átírása**

`apps/web/src/stores/expenses.js` — a `subscribe` action és a **teljes** `subscribeNative` action helyére:

```js
    /**
     * Feliratkozás az esemény élő kiadás-frissítéseire. A transzport
     * (EventSource vagy natív fetch-stream) az `openEventStream` dolga — ez a
     * store csak üzeneteket kap.
     * @param {string} eventId
     */
    subscribe(eventId) {
      this.unsubscribe();

      let opened = false;
      streamEventId = eventId;

      closeStream = openEventStream({
        path: `/events/${eventId}/stream`,
        onOpen: () => {
          this.connected = true;
          // Újrakapcsolódás után pótolni kell a szakadás alatt elmaradt
          // üzeneteket — ezért nincs szerveroldali Last-Event-ID puffer.
          if (opened) {
            this.refreshQuietly(eventId);
          }
          opened = true;
        },
        onClose: () => {
          this.connected = false;
        },
        onMessage: (data) => {
          this.applyStreamMessage(data);
        },
      });

      // Előtérbe kerüléskor (fülváltás böngészőben, app-váltás telefonon) a
      // stream lehet, hogy közben elhalt. Ez a frissítés akkor is behozza a
      // kimaradt változásokat, ha az újrakapcsolódás késik.
      visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          this.refreshQuietly(eventId);
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    },
```

Az `unsubscribe` action törzsében a `subscriptionGeneration += 1;` sort és a hozzá tartozó kommentet töröld, a `stream`/`appStateListener` lezárást pedig cseréld:

```js
if (closeStream) {
  closeStream();
  closeStream = null;
}
```

A `streamEventId = null;`, a `visibilityHandler` leszerelése, a `freshTimers` ürítése és a `this.connected = false;` maradnak változatlanul.

- [ ] **Step 4: A `liveUpdatesSupported` törlése**

`apps/web/src/utils/platform.js` — töröld a `liveUpdatesSupported` függvényt és a JSDoc-ját; csak az `isNativeApp` marad. Ok: mindkét platformon van stream, tehát nincs mit szétválasztani.

- [ ] **Step 5: A kapcsolatjelző mindkét platformon látszik**

`apps/web/src/components/ExpenseTable.vue`:

- az importból vedd ki a `liveUpdatesSupported`-ot (az `isNativeApp` marad, a gesztus miatt),
- töröld a `const showLiveIndicator = liveUpdatesSupported();` sort,
- a `<template>`-ben a jelzőn töröld a `v-if="showLiveIndicator"` attribútumot (a `class`, `:class` és `:title` maradnak).

- [ ] **Step 6: Ellenőrzés**

```bash
npm run lint
npm run format:check
npm run build -w @filler/web
npm run build:mobile
```

Elvárt: mind hibátlan. Ezután `grep`-pel igazold, hogy a `apps/web/src` alatt már semmi nem hivatkozik a `liveUpdatesSupported`-ra, a `subscribeNative`-ra és a `@capacitor/app`-ra.

- [ ] **Step 7: Ellenőrzés — a böngészős élő frissítés sértetlen**

```bash
docker compose up -d --build
```

Nyisd meg ugyanazt az eseményt két böngészőfülön, és vegyél fel egy kiadást az egyikben. Elvárt: a másik fülön oldalfrissítés nélkül megjelenik, a jelző „élő" állapotot mutat, és a sor felvillan. Állítsd le a backendet (`docker compose stop api`), és figyeld a jelzőt: „nincs kapcsolat"-ra vált; indítsd újra (`docker compose start api`), és a jelző visszatér „élő"-re, a lista pedig újratöltődik.

Ha nincs böngésző a környezetben, ezt a lépést nem tudod elvégezni — írd le a riportban, és a kód alapján vezesd végig, mi történik a három esetben (első kapcsolódás, szakadás, újrakapcsolódás).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/api/eventStream.js apps/web/src/stores/expenses.js apps/web/src/utils/platform.js apps/web/src/components/ExpenseTable.vue
git commit -m "feat(web): platformfüggetlen SSE-transzport, natív streammel"
```

---

### Task 4: A feliratkozás és a kiadás-betöltés az esemény-nézetbe kerül

**Files:**

- Modify: `apps/web/src/views/EventDetailView.vue` (`<script setup>`: importok, `onMounted`, új `onUnmounted`)
- Modify: `apps/web/src/components/ExpenseTable.vue` (`onMounted`/`onUnmounted` szűkítése)

**Interfaces:**

- Consumes: `useExpensesStore().subscribe(eventId)`, `.unsubscribe(eventId)`, `.fetchExpenses(eventId)` — a Task 3 utáni store.
- Produces: nincs későbbi task által hívott új felület. A garancia: a kiadás-stream és a kiadáslista **mindkét fülön** él, tehát az elszámolás (Task 5) számolhat belőle.

**Háttér:** a két fül `v-if`/`v-else`-szel váltakozik az `EventDetailView`-ban, tehát az `ExpenseTable` lebomlik, amikor az elszámolást nézed — és vele a feliratkozás is. Ezért kell feljebb vinni. A betöltés is vele megy: az az adat, amire mindkét fül épül, ne annak a komponensnek a mellékhatása legyen, ami épp látszik.

- [ ] **Step 1: Az esemény-nézet nyitja a feliratkozást**

`apps/web/src/views/EventDetailView.vue` — az importok:

```js
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useExpensesStore } from '../stores/expenses.js';
```

(A meglévő `import { computed, onMounted, ref } from 'vue';` sort cseréld a fentire.)

A store-példányok mellé:

```js
const expensesStore = useExpensesStore();
```

- [ ] **Step 2: A betöltés és a feliratkozás egy helyen**

`apps/web/src/views/EventDetailView.vue` — keresd meg a meglévő `onMounted` blokkot (ez tölti be az eseményt és a névjegyzéket), és a **végére** fűzd hozzá:

```js
// A feliratkozás és a kiadás-betöltés itt van, nem a kiadás-fül
// komponensében: a két fül `v-if`-fel váltakozik, tehát az ott nyitott
// stream az Elszámolás fülre váltva lezárulna — pedig az elszámolás épp
// ebből a listából számol.
//
// Feliratkozás ELŐBB, mint a lista betöltése: így a két művelet közben
// felvitt kiadás sem maradhat le.
expensesStore.subscribe(route.params.id);
expensesStore.fetchExpenses(route.params.id);
```

Ha a meglévő `onMounted` `async` és `await`-el tölt, akkor ezt a két hívást a `await` **elé** tedd, hogy a stream az esemény betöltésére se várjon. A `route.params.id`-t használd, ne az `event.value?.id`-t — így nem függ a betöltés sikerétől.

Új blokk közvetlenül az `onMounted` után:

```js
onUnmounted(() => {
  expensesStore.unsubscribe(route.params.id);
});
```

- [ ] **Step 3: Az `ExpenseTable` már nem tölt és nem iratkozik fel**

`apps/web/src/components/ExpenseTable.vue` — az `onMounted` blokkból töröld a két sort (`expensesStore.subscribe(...)` és `expensesStore.fetchExpenses(...)`) a hozzájuk tartozó kommenttel; a lehúzásos gesztus bekötése marad. Az `onUnmounted`-ból töröld az `expensesStore.unsubscribe(props.event.id);` sort és a fölötte lévő, fülváltásról szóló kommentet; a gesztus leszerelése marad.

A komponens `onMounted`-je ezután csak ennyi:

```js
onMounted(() => {
  // A lehúzásos gesztus natív affordance, nem az SSE hiányának a
  // helyettesítője — böngészőben ne kapjon touch-gesztust.
  if (isNativeApp()) {
    detachPullToRefresh = attachPullToRefresh({
      onRefresh: () => expensesStore.refreshQuietly(props.event.id),
      onProgress: (ratio) => {
        pullRatio.value = ratio;
      },
    });
  }
});
```

- [ ] **Step 4: Ellenőrzés**

```bash
npm run lint
npm run format:check
npm run build -w @filler/web
```

Elvárt: mind hibátlan. `grep`-pel igazold, hogy a `subscribe(` és a `fetchExpenses(` hívása a `apps/web/src` alatt már csak az `EventDetailView.vue`-ban szerepel (a store definícióján kívül).

- [ ] **Step 5: Ellenőrzés — fülváltás nem szakítja el a streamet**

```bash
docker compose up -d --build
```

Nyisd meg egy eseményt két böngészőfülön. Az egyikben **válts az Elszámolás fülre**, a másikban vegyél fel egy kiadást. Elvárt: az első fülön a hálózati panelen látszik, hogy a stream nyitva marad (a `/stream` kérés nem záródott le a fülváltáskor). Ezután válts vissza a Kiadások fülre: az új kiadás ott van, és nem indult újabb `/stream` kérés.

Ha nincs böngésző, írd le a riportban, és vezesd végig a kódból, hogy a fülváltás miért nem érinti a feliratkozást.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/views/EventDetailView.vue apps/web/src/components/ExpenseTable.vue
git commit -m "refactor(web): a kiadás-stream és -betöltés az esemény-nézetbe kerül"
```

---

### Task 5: Az elszámolás a kiadáslistából számol

**Files:**

- Modify: `apps/web/src/components/SettlementPanel.vue` (`<script setup>`: a `load()` és az `onMounted` helyére számított érték)

**Interfaces:**

- Consumes: `useExpensesStore()` állapota (`expenses`, `loading`, `error`) — a Task 4 után mindkét fülön töltve és streamelve; `computeSettlement` a `@filler/shared`-ből.
- Produces: nincs. Ez a task lezárja a láncot.

**Háttér:** a `GET /api/events/:id/settlement` a szerveren pontosan annyit tesz, hogy meghívja a `computeSettlement`-et az esemény `participantIds`-ára és a kiadások `payerId` / `baseAmountMinor` / `sharedWithIds` hármasaira (lásd `apps/api/src/services/settlementService.js`). Ugyanez a függvény a `packages/shared`-ből a kliensen is fut, tehát a helyi számítás nem közelítés, hanem ugyanaz a logika. A végpont megmarad, csak a frontend nem hívja többé.

- [ ] **Step 1: A panel a store-ból számol**

`apps/web/src/components/SettlementPanel.vue` — az importokat cseréld:

```js
import { computed, ref } from 'vue';
import { Share } from '@capacitor/share';
import { computeSettlement, formatMoney, SETTLEMENT_CURRENCY } from '@filler/shared';
import { useExpensesStore } from '../stores/expenses.js';
import { isNativeApp } from '../utils/platform.js';
```

(Kikerül az `onMounted`, az `apiClient` és a `settlementResponseSchema` — utóbbi kettőre nincs többé szükség, mert nincs HTTP-kérés.)

A `settlement` / `loading` / `loadError` deklarációk és a teljes `load()` függvény, valamint az `onMounted(load);` sor helyére:

```js
const expensesStore = useExpensesStore();

/**
 * Az elszámolás a betöltött kiadáslistából számolva. Ugyanaz a
 * `computeSettlement` fut, amit a backend `/settlement` végpontja használ —
 * ezért nem kell külön kérés, és a stream minden új kiadását azonnal követi.
 */
const settlement = computed(() => {
  return computeSettlement({
    participantIds: props.event.participantIds,
    expenses: expensesStore.expenses.map((expense) => ({
      payerId: expense.payerId,
      baseAmountMinor: expense.baseAmountMinor,
      sharedWithIds: expense.sharedWithIds,
    })),
  });
});

// A betöltés és a hiba állapota a kiadáslistáé: az elszámolásnak nincs saját
// kérése. Hiba esetén nem üres táblát mutatunk, hanem hibaüzenetet.
const loading = computed(() => expensesStore.loading);
const loadError = computed(() => expensesStore.error !== null);
```

A `shareSupported`, a `participantName`, a `money`, a `balanceStatus`, a `hasNothingToSettle`, a `buildShareText` és a `handleShare` **változatlan** marad — a `settlement.value` továbbra is `{ balances, transfers }`.

- [ ] **Step 2: A sablon null-kezelése**

A `<template>` `v-if="loading"` / `v-else-if="loadError"` / `v-else` szerkezete változatlan marad. Egy dolgot ellenőrizz: a `settlement` most **soha nem `null`** (üres kiadáslistára is számol egy nulla egyenlegű eredményt), ezért ha a sablonban van `settlement !== null` jellegű védelem, az feleslegessé vált — hagyd, ha nem zavar, de ne vezess be újat.

- [ ] **Step 3: Ellenőrzés**

```bash
npm run lint
npm run format:check
npm run build -w @filler/web
```

Elvárt: mind hibátlan. `grep`-pel igazold, hogy a `apps/web/src` alatt már semmi nem hívja a `/settlement` végpontot.

- [ ] **Step 4: Ellenőrzés — az elszámolás egyezik a szerverrel**

```bash
docker compose up -d --build
```

Nyiss egy eseményt legalább két résztvevővel és legalább három kiadással, köztük egy devizással. Hasonlítsd össze a felületen látott egyenlegeket és „ki fizet kinek" sorokat a szerver válaszával:

```bash
curl -s "http://localhost:8090/api/events/<EVENT_ID>/settlement" -b <cookie-jar>
```

Elvárt: a két eredmény azonos. Ez a task legfontosabb ellenőrzése — ha eltérés van, a helyi számítás bemenete rossz (nem a `computeSettlement`), tehát a `map` mezőit nézd meg.

- [ ] **Step 5: Ellenőrzés — az elszámolás követi az új kiadást**

Nyisd meg ugyanazt az eseményt két böngészőfülön: az egyiken az **Elszámolás** fül legyen nyitva, a másikon vegyél fel egy új kiadást. Elvárt: az elszámolás fülön az egyenlegek és a transzferek **oldalfrissítés nélkül** frissülnek, mert a stream a kiadáslistát frissíti, a panel pedig abból számol.

Ha nincs böngésző, írd le a riportban, és vezesd végig a kódból: stream-üzenet → `applyStreamMessage` → `upsertExpense` → a store `expenses` listája változik → a számított `settlement` újraértékelődik.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/SettlementPanel.vue
git commit -m "feat(web): az elszámolás a kiadáslistából számol, saját kérés nélkül"
```

---

## Utóellenőrzés (a terv végén, egyszer)

- [ ] `npm run lint`, `npm run format:check`, `npm run build`, `npm run build:mobile` hibátlan
- [ ] Böngészőben: bejelentkezés, eseménylista, esemény megnyitása, kiadás felvitele, élő frissítés két fülön, fülváltás közben is élő stream, elszámolás egyezik a szerver `/settlement` válaszával
- [ ] Böngészőben a lehúzásos felirat nem jelenik meg, a kapcsolatjelző „élő"
- [ ] `git status --short` üres

## Eszközös ellenőrzés (a natív rész csak így hitelesíthető)

A natív stream egyetlen sora sem futott le eszközön a fejlesztés alatt. Sorrendben:

- [ ] **A WebView origója.** Az első és legfontosabb: `adb logcat`-ben vagy egy ideiglenes `console.log`-gal írasd ki a `window.location.origin` értékét. Ha nem `https://localhost`, a Task 2 CORS-listáját ki kell egészíteni a tényleges origóval, különben a stream némán nem indul.
- [ ] **A stream megnyílik.** Nyiss egy eseményt a telefonon, és figyeld a szerver access logját: legyen egy nyitva maradó `GET /api/events/<id>/stream` kérés `Authorization` fejléccel. A kapcsolatjelző „élő".
- [ ] **Az üzenet átér.** Vegyél fel egy kiadást böngészőből — a telefonon oldalfrissítés nélkül jelenjen meg, kiemelve.
- [ ] **Az elszámolás követi.** A telefonon váltsd az Elszámolás fülre, és vegyél fel böngészőből egy újabb kiadást: az egyenlegek frissüljenek.
- [ ] **Újrakapcsolódás.** Tedd repülő üzemmódba a telefont pár másodpercre, majd vissza: a jelző „nincs kapcsolat"-ról térjen vissza „élő"-re, és a lista töltődjön újra. Figyeld, hogy nem indul-e másodpercenkénti kérés-áradat (a növekvő várakozás dolgozik).
- [ ] **Háttér és visszatérés.** Váltts másik appra és vissza: a lista behozza a közben történt változásokat.
- [ ] **Lehúzás az eseménylistán.** A lista tetejéről lehúzva frissüljön; elgörgetve ne induljon.
