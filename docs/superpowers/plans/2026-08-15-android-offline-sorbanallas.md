# Offline működés sorbanállással — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Előfeltétel:** a `docs/superpowers/plans/2026-08-15-android-apk-csomagolas.md`
**és** a `docs/superpowers/plans/2026-08-20-elo-frissites.md` terv végig végrehajtva. Innen származik az `isNativeApp()`, a natív runtime, a token-alapú hitelesítés és a működő APK-build.

**Goal:** Az app adatkapcsolat nélkül is használható: a korábban látott adatok olvashatók, új kiadás felvehető, és a hálózat visszatérésekor minden feltöltődik — duplikáció és néma adatvesztés nélkül.

**Architecture:** Egy IndexedDB-alapú réteg (`apps/web/src/offline/`) ül a Pinia store-ok és az `apiClient` között. Olvasásnál a hálózat az elsődleges, hálózathiba esetén a cache szolgál ki `stale` jelzéssel. Íráskor a kiadás-mutációk offline az `outbox` store-ba kerülnek, és egy szinkron-motor dolgozza fel őket a hálózat visszatértekor. A duplikációt szerveroldali `clientId`-alapú idempotencia zárja ki.

**Tech Stack:** `idb` (IndexedDB wrapper), `@capacitor/network`, Vue 3 + Pinia, Mongoose, Zod.

## Global Constraints

- **Nincs automatizált teszt a projektben.** Ne vezess be Vitest/Playwright/Testcontainers-t. Minden task ellenőrzése: `npm run lint`, `npm run format:check`, `npm run build`, plusz a taskban leírt kézi ellenőrzés.
- Sima JavaScript, TypeScript nélkül. Határátlépésnél Zod-validáció, domain típusokra JSDoc.
- ESLint: `eqeqeq`, `no-var`, `prefer-const`, `consistent-return`, `require-await`, `promise/*`. Az `no-restricted-syntax` pénzszabály (`parseFloat`, `Number.parseFloat`, `.toFixed(`) inline `eslint-disable`-lel **nem** kerülhető meg.
- Új scriptek kiterjesztése `.js` legyen, **ne** `.mjs`.
- Backend rétegzés: routes → services → repositories. Mongoose modell nem szivárog ki a route rétegbe.
- Commit konvenció: Conventional Commits. **Ne** tegyél `Co-Authored-By` sort a commit üzenetbe.
- Minden felhasználónak látszó szöveg magyar.
- **Offline írásra csak a kiadás megy** (felvétel, módosítás, törlés). A személy- és eseménykezelés online marad.
- A webes (böngészős) viselkedés nem romolhat: az offline réteg ott is aktív lehet, de az élő SSE-frissítés és a szerveroldali elszámolás marad az elsődleges út.

---

### Task 1: `clientId` idempotencia a backenden

**Files:**

- Modify: `packages/shared/src/schemas/expense.js:13-34` (`createExpenseBodySchema`), `packages/shared/src/schemas/expense.js:38-53` (`expenseResponseSchema`)
- Modify: `apps/api/src/models/expenseModel.js:6-30` (séma), `apps/api/src/repositories/expenseRepository.js` (új lekérdezés), `apps/api/src/services/expenseService.js:20-27` (`createExpense`), `apps/api/src/services/expenseService.js:97-124` (`buildExpenseData`)

**Interfaces:**

- Consumes: semmit.
- Produces:
  - `createExpenseBodySchema` opcionális `clientId` mezővel (UUID string),
  - `expenseResponseSchema` opcionális `clientId` mezővel,
  - `findExpenseByClientId(clientId: string): Promise<object | null>` a repositoryból,
  - `POST /api/events/:id/expenses` ismételt `clientId`-re a meglévő kiadást adja vissza, új rekord létrehozása nélkül.

**Háttér:** mobilhálón megszokott, hogy a kérés elmegy, a válasz nem érkezik vissza. Újrapróbálkozáskor `clientId` nélkül dupla kiadás keletkezne. A mező opcionális, hogy a webes kliens változatlanul működjön.

- [ ] **Step 1: Séma bővítése**

`packages/shared/src/schemas/expense.js` — a `createExpenseBodySchema` `z.object({...})` blokkjába, a `date` elé:

```js
    /**
     * A kliens által generált azonosító. Offline sorbanállított kiadásnál a
     * megszakadt kérés újraküldése enélkül duplikálna; a szerver ez alapján
     * ismeri fel, hogy ugyanarról a kiadásról van szó.
     */
    clientId: z.string().uuid().optional(),
```

Az `expenseResponseSchema`-ba, az `id` után:

```js
  clientId: z.string().uuid().optional(),
```

- [ ] **Step 2: Mongoose modell**

`apps/api/src/models/expenseModel.js` — az `eventId` mező elé:

```js
    clientId: { type: String, required: false },
```

A `expenseSchema.index(...)` sor mellé:

```js
// Ritka egyedi index: a clientId nélküli (webes) kiadásokat nem érinti, de
// ugyanazt a clientId-t kétszer nem engedi be.
expenseSchema.index({ clientId: 1 }, { unique: true, sparse: true });
```

- [ ] **Step 3: Repository lekérdezés**

`apps/api/src/repositories/expenseRepository.js` — a `findExpenseById` után:

```js
/**
 * @param {string} clientId
 * @returns {Promise<object | null>}
 */
export async function findExpenseByClientId(clientId) {
  const doc = await ExpenseModel.findOne({ clientId });
  return doc ? serialize(doc) : null;
}
```

- [ ] **Step 4: Idempotens létrehozás a service-ben**

`apps/api/src/services/expenseService.js` — a `createExpense` cseréje:

```js
/**
 * @param {string} eventId
 * @param {object} input
 */
export async function createExpense(eventId, input) {
  if (input.clientId) {
    const existing = await expenseRepository.findExpenseByClientId(input.clientId);
    if (existing) {
      // Idempotencia: a kliens újraküldte egy már befogadott kiadását (pl. a
      // válasz veszett el). Nem hozunk létre másodikat, és nem is publikálunk
      // új eseményt — a többi kliens ezt már megkapta.
      return existing;
    }
  }

  const event = await getEventOrThrow(eventId);
  assertParticipants(event, input);
  const data = buildExpenseData(input);

  let created;
  try {
    created = await expenseRepository.createExpense({ ...data, eventId });
  } catch (error) {
    // Verseny két egyidejű újraküldés között: az egyedi index elkapja, és a
    // már létrejött rekordot adjuk vissza.
    const duplicate = input.clientId && error?.code === 11000;
    if (!duplicate) {
      throw error;
    }
    const existing = await expenseRepository.findExpenseByClientId(input.clientId);
    if (!existing) {
      throw error;
    }
    return existing;
  }

  publishExpenseChange(eventId, { type: 'expense.created', expense: created });
  return created;
}
```

A `buildExpenseData` visszatérési objektumába, a `date` elé:

```js
    clientId: input.clientId,
```

- [ ] **Step 5: Ellenőrzés — lint és indulás**

```bash
npm run lint
npm run format:check
docker compose up -d --build
docker compose ps
```

Elvárt: minden hibátlan, a service-ek futnak.

- [ ] **Step 6: Ellenőrzés — az idempotencia működik**

Jelentkezz be és szerezz tokent (`<JELSZO>` az `.env`-ből), majd vegyél egy létező esemény- és személy-azonosítót a `GET /api/events`, `GET /api/people` válaszaiból:

```bash
TOKEN=$(curl -s -X POST http://localhost:8090/api/auth/login -H 'Content-Type: application/json' -H 'X-Client: app' -d '{"password":"<JELSZO>"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
CID=$(uuidgen)
curl -s -X POST "http://localhost:8090/api/events/<EVENT_ID>/expenses" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"clientId\":\"$CID\",\"date\":\"2026-08-15\",\"description\":\"idempotencia teszt\",\"payerId\":\"<PERSON_ID>\",\"amountMinor\":1000,\"currency\":\"HUF\",\"exchangeRate\":\"1\",\"rateSource\":\"manual\",\"sharedWithIds\":[\"<PERSON_ID>\"]}"
curl -s -X POST "http://localhost:8090/api/events/<EVENT_ID>/expenses" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"clientId\":\"$CID\",\"date\":\"2026-08-15\",\"description\":\"idempotencia teszt\",\"payerId\":\"<PERSON_ID>\",\"amountMinor\":1000,\"currency\":\"HUF\",\"exchangeRate\":\"1\",\"rateSource\":\"manual\",\"sharedWithIds\":[\"<PERSON_ID>\"]}"
curl -s "http://localhost:8090/api/events/<EVENT_ID>/expenses" -H "Authorization: Bearer $TOKEN" | grep -o "idempotencia teszt" | wc -l
```

Elvárt: a két POST **ugyanazt** az `id`-t adja vissza, és a lista pontosan **egy** „idempotencia teszt" kiadást tartalmaz. Töröld utána a tesztadatot a felületen.

- [ ] **Step 7: Ellenőrzés — a webes felvitel változatlan**

Böngészőben vegyél fel egy kiadást (a webes kliens nem küld `clientId`-t). Elvárt: létrejön, megjelenik, a másik fülön is (SSE).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/schemas/expense.js apps/api/src/models/expenseModel.js apps/api/src/repositories/expenseRepository.js apps/api/src/services/expenseService.js
git commit -m "feat(api): clientId-alapú idempotencia a kiadás létrehozásán"
```

---

### Task 2: IndexedDB alapréteg és offline állapot-store

**Files:**

- Create: `apps/web/src/offline/db.js`, `apps/web/src/stores/offline.js`
- Modify: `apps/web/package.json` (`dependencies`: `idb`)

**Interfaces:**

- Consumes: semmit korábbi taskból.
- Produces:
  - `getDb(): Promise<IDBPDatabase>` a `apps/web/src/offline/db.js`-ből, két store-ral: `cache` (keyPath `key`) és `outbox` (keyPath `id`, `status` index),
  - `useOfflineStore()` a `apps/web/src/stores/offline.js`-ből, `{ stale, lastFetchedAt, pendingCount, failedCount }` state-tel és `setStale(fetchedAt)`, `setFresh(fetchedAt)`, `setCounts({ pending, failed })` action-ökkel.

- [ ] **Step 1: Telepítsd az `idb` csomagot**

```bash
npm install -w @filler/web idb@latest
```

- [ ] **Step 2: Adatbázis modul**

`apps/web/src/offline/db.js`:

```js
import { openDB } from 'idb';

const DB_NAME = 'filler-offline';
const DB_VERSION = 1;

export const CACHE_STORE = 'cache';
export const OUTBOX_STORE = 'outbox';

/** @type {Promise<import('idb').IDBPDatabase> | null} */
let dbPromise = null;

/**
 * Az offline adatbázis. Két store: a `cache` a szervertől kapott listák
 * legutóbbi állapotát tartja, az `outbox` a még fel nem töltött
 * kiadás-módosításokat.
 * @returns {Promise<import('idb').IDBPDatabase>}
 */
export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          const outbox = db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
          outbox.createIndex('status', 'status');
        }
      },
    });
  }
  return dbPromise;
}
```

- [ ] **Step 3: Offline állapot-store**

`apps/web/src/stores/offline.js`:

```js
import { defineStore } from 'pinia';

export const useOfflineStore = defineStore('offline', {
  state: () => ({
    /** A megjelenített adat cache-ből jön-e (tehát elavult lehet). */
    stale: false,
    /** @type {Date | null} */
    lastFetchedAt: null,
    /** Feltöltésre váró elemek száma. */
    pendingCount: 0,
    /** Elbukott, felhasználói döntésre váró elemek száma. */
    failedCount: 0,
  }),
  actions: {
    /**
     * @param {Date} fetchedAt
     */
    setFresh(fetchedAt) {
      this.stale = false;
      this.lastFetchedAt = fetchedAt;
    },

    /**
     * @param {Date | null} fetchedAt a cache-elt adat kora
     */
    setStale(fetchedAt) {
      this.stale = true;
      this.lastFetchedAt = fetchedAt;
    },

    /**
     * @param {{ pending: number, failed: number }} counts
     */
    setCounts(counts) {
      this.pendingCount = counts.pending;
      this.failedCount = counts.failed;
    },
  },
});
```

- [ ] **Step 4: Ellenőrzés**

```bash
npm run lint
npm run format:check
npm run build -w @filler/web
docker compose up -d --build
```

Böngészőben nyisd meg az appot, majd a DevTools → Application → IndexedDB alatt ellenőrizd. Elvárt: az app a megszokott módon működik; a `filler-offline` adatbázis még **nem** jelenik meg (a `getDb()`-t még senki nem hívja) — ez ebben a taskban rendben van.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/offline/db.js apps/web/src/stores/offline.js apps/web/package.json package-lock.json
git commit -m "feat(web): IndexedDB alapréteg és offline állapot-store"
```

---

### Task 3: Cache-elt olvasás és offline sáv

**Files:**

- Create: `apps/web/src/offline/cache.js`, `apps/web/src/components/OfflineBanner.vue`
- Modify: `apps/web/src/stores/events.js` (`fetchEvents`), `apps/web/src/stores/people.js` (`fetchPeople`), `apps/web/src/stores/expenses.js` (`fetchExpenses`), `apps/web/src/App.vue` (a sáv beillesztése)

**Interfaces:**

- Consumes: Task 2 (`getDb`, `CACHE_STORE`, `useOfflineStore`).
- Produces: `fetchWithCache({ key, schema, request }): Promise<{ value: unknown, stale: boolean, fetchedAt: Date }>` a `apps/web/src/offline/cache.js`-ből, továbbá `readCache(key, schema)` és `writeCache(key, value)`.

- [ ] **Step 1: Cache modul**

`apps/web/src/offline/cache.js`:

```js
import { CACHE_STORE, getDb } from './db.js';
import { ApiError } from '../api/client.js';
import { useOfflineStore } from '../stores/offline.js';

/**
 * @param {string} key
 * @param {import('zod').ZodType} schema
 * @returns {Promise<{ value: unknown, fetchedAt: Date } | null>}
 */
export async function readCache(key, schema) {
  const db = await getDb();
  const row = await db.get(CACHE_STORE, key);
  if (!row) {
    return null;
  }
  try {
    // Újravalidálás: egy app-frissítés után a régi cache alakja már nem
    // feltétlenül illik a mai sémára — ilyenkor inkább nincs cache.
    return { value: schema.parse(row.value), fetchedAt: row.fetchedAt };
  } catch {
    await db.delete(CACHE_STORE, key);
    return null;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
export async function writeCache(key, value) {
  const db = await getDb();
  await db.put(CACHE_STORE, { key, value, fetchedAt: new Date() });
}

/**
 * Hálózat-először olvasás cache-tartalékkal.
 *
 * A szerver által adott hibát (ApiError) továbbdobjuk: az nem hálózathiba,
 * hanem valódi válasz (404, 401, validációs hiba), amit a hívónak kezelnie
 * kell. Csak a hálózat elérhetetlenségére esünk vissza a cache-re.
 *
 * @param {{ key: string, schema: import('zod').ZodType, request: () => Promise<unknown> }} options
 * @returns {Promise<{ value: unknown, stale: boolean, fetchedAt: Date }>}
 */
export async function fetchWithCache(options) {
  const { key, schema, request } = options;
  const offlineStore = useOfflineStore();

  try {
    const value = await request();
    await writeCache(key, value);
    const fetchedAt = new Date();
    offlineStore.setFresh(fetchedAt);
    return { value, stale: false, fetchedAt };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const cached = await readCache(key, schema);
    if (!cached) {
      throw error;
    }
    offlineStore.setStale(cached.fetchedAt);
    return { value: cached.value, stale: true, fetchedAt: cached.fetchedAt };
  }
}
```

- [ ] **Step 2: Kösd be az események listáját**

`apps/web/src/stores/events.js` — import és a `fetchEvents` cseréje:

```js
import { fetchWithCache } from '../offline/cache.js';
```

```js
    async fetchEvents() {
      this.loading = true;
      this.error = null;
      try {
        const result = await fetchWithCache({
          key: 'events',
          schema: eventListResponseSchema,
          request: () => apiClient.get('/events', { schema: eventListResponseSchema }),
        });
        this.events = result.value;
      } catch (error) {
        this.error = error;
      } finally {
        this.loading = false;
      }
    },
```

- [ ] **Step 3: Kösd be a névjegyzéket**

`apps/web/src/stores/people.js` — ugyanezzel a mintával a `fetchPeople` action-t, `key: 'people'` kulccsal és a fájlban már importált lista-sémával. Ha az action neve vagy szerkezete eltér, igazodj a fájl tényleges tartalmához — a lényeg, hogy az `apiClient.get` hívás a `fetchWithCache` `request` callbackjébe kerüljön, és a store a `result.value`-t kapja.

- [ ] **Step 4: Kösd be a kiadáslistát**

`apps/web/src/stores/expenses.js` — a `fetchExpenses` action:

```js
    async fetchExpenses(eventId) {
      this.loading = true;
      this.error = null;
      try {
        const result = await fetchWithCache({
          key: `expenses:${eventId}`,
          schema: expenseListResponseSchema,
          request: () =>
            apiClient.get(`/events/${eventId}/expenses`, { schema: expenseListResponseSchema }),
        });
        this.expenses = result.value;
      } catch (error) {
        this.error = error;
      } finally {
        this.loading = false;
      }
    },
```

A `refreshQuietly` maradjon változatlan: az szándékosan csendben bukik, és nem szabad, hogy egy sikertelen frissítés cache-re váltással felülírja a friss listát.

- [ ] **Step 5: Offline sáv komponens**

`apps/web/src/components/OfflineBanner.vue`:

```vue
<script setup>
import { computed } from 'vue';
import { useOfflineStore } from '../stores/offline.js';
import { formatDate } from '../utils/format.js';

const offlineStore = useOfflineStore();

const lastFetchedLabel = computed(() => {
  if (!offlineStore.lastFetchedAt) {
    return 'ismeretlen időpont';
  }
  const time = offlineStore.lastFetchedAt.toLocaleTimeString('hu-HU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formatDate(offlineStore.lastFetchedAt)} ${time}`;
});
</script>

<template>
  <p v-if="offlineStore.stale" class="offline-banner" role="status">
    Offline — utoljára frissítve: {{ lastFetchedLabel }}
  </p>
</template>

<style scoped>
.offline-banner {
  margin: 0;
  padding: var(--space-2) var(--space-4);
  text-align: center;
  font-size: 0.85rem;
  background: var(--stamp-soft);
  color: var(--ink);
}
</style>
```

A `formatDate` `Date`-et is elfogad (`apps/web/src/utils/format.js`), ezért a fenti hívás közvetlenül működik.

- [ ] **Step 6: Illeszd be a sávot**

`apps/web/src/App.vue` — a `<script setup>`-ba:

```js
import OfflineBanner from './components/OfflineBanner.vue';
```

A `<template>`-ben a `<header>` után, a `<router-view />` elé:

```html
<OfflineBanner />
```

> **Az eredeti Step 7 törölve.** Az „elszámolás offline, a cache-elt
> kiadásokból" lépés elavult: az élő-frissítés kör után a
> `apps/web/src/components/SettlementPanel.vue` **mindig** helyben számol a
> `expensesStore.expenses` listából, saját HTTP-kérés nélkül. Amint a
> kiadáslista a cache-ből jön (Step 2-6), az elszámolás offline is működik —
> nincs mit külön megírni.

- [ ] **Step 7: Ellenőrzés — online viselkedés változatlan**

```bash
npm run lint
npm run format:check
docker compose up -d --build
```

Böngészőben: események lista, esemény megnyitása, elszámolás fül. Elvárt: minden a megszokott, az offline sáv nem látszik.

- [ ] **Step 8: Ellenőrzés — offline olvasás**

Böngészőben tölts be egy eseményt a kiadásaival és az elszámolással (hogy a cache feltöltődjön). Ezután DevTools → Network → „Offline" bekapcsolása, majd oldalfrissítés helyett navigálj vissza az eseménylistára és újra be az eseménybe.

Elvárt: a lista és a kiadások megjelennek, felül az „Offline — utoljára frissítve: …" sáv, és az Elszámolás fül a cache-elt kiadásokból számolt egyenlegeket mutatja.

Kapcsold vissza a hálózatot. Elvárt: a következő betöltés után a sáv eltűnik.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/offline/cache.js apps/web/src/components/OfflineBanner.vue apps/web/src/stores/events.js apps/web/src/stores/people.js apps/web/src/stores/expenses.js apps/web/src/App.vue
git commit -m "feat(web): offline olvasás cache-ből"
```

---

### Task 4: Árfolyam-cache és becslés az űrlapon

**Files:**

- Create: `apps/web/src/offline/rates.js`
- Modify: `apps/web/src/components/ExpenseModal.vue:139-160` (`fetchRate`) és a hozzá tartozó sablonrész

**Interfaces:**

- Consumes: Task 2 (`getDb`, `CACHE_STORE`), Task 3 (`readCache`, `writeCache`).
- Produces:
  - `fetchRateWithCache(from: string, to: string): Promise<{ rate: string, fetchedAt: Date, estimated: boolean }>`,
  - `fetchFreshRate(from: string, to: string): Promise<{ rate: string, fetchedAt: Date }>` (csak hálózatról, cache nélkül — a Task 6 szinkron-motorja használja).

- [ ] **Step 1: Árfolyam-modul**

`apps/web/src/offline/rates.js`:

```js
import { rateResponseSchema, SETTLEMENT_CURRENCY } from '@filler/shared';
import { apiClient } from '../api/client.js';
import { readCache, writeCache } from './cache.js';

/**
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
function cacheKey(from, to) {
  return `rate:${from}:${to}`;
}

/**
 * Árfolyam kizárólag a hálózatról. A sorbanállított kiadások feltöltésekor ezt
 * hívjuk: ott már van kapcsolat, és a végleges árfolyamot friss adatból kell
 * meghatározni.
 * @param {string} from
 * @param {string} to
 * @returns {Promise<{ rate: string, fetchedAt: Date }>}
 */
export async function fetchFreshRate(from, to) {
  const result = await apiClient.get(`/rates?from=${from}&to=${to}`, {
    schema: rateResponseSchema,
  });
  await writeCache(cacheKey(from, to), { rate: result.rate, fetchedAt: result.fetchedAt });
  return { rate: result.rate, fetchedAt: result.fetchedAt };
}

/**
 * Árfolyam hálózatról, tartalékként a legutóbb ismert értékkel. Az `estimated`
 * jelzi, hogy becsült (elavult) árfolyamot adtunk vissza — a felület ezt `≈`
 * jelöléssel mutatja, a végleges érték a feltöltéskor dől el.
 * @param {string} from
 * @param {string} to
 * @returns {Promise<{ rate: string, fetchedAt: Date, estimated: boolean }>}
 */
export async function fetchRateWithCache(from, to) {
  try {
    const fresh = await fetchFreshRate(from, to);
    // A becslést a `fetchedAt` NAPJA dönti el, nem a szerver `source` mezője:
    // a szerver naponta legfeljebb egyszer hív ki élő API-t egy valutapárra,
    // minden aznapi további lekérés `source: "cache"`-t ad — ez a normál eset.
    // Az egyetlen valóban elavult eset az, amikor a szerver élő hívása bukott,
    // és korábbi napról származó tartalékot adott vissza; ezt csak a
    // `fetchedAt` napja árulja el. Az összehasonlítás UTC szerint megy, mint a
    // szerver `todayDateOnly()`-ja, különben este egy napot csúszhatnának.
    return { ...fresh, estimated: !isToday(fresh.fetchedAt) };
  } catch (error) {
    // Ugyanaz a szabály, mint a `cache.js` `fetchWithCache`-ében: a szerver
    // válasza (ApiError) és a sémát nem teljesítő törzs (ZodError) hangosan
    // bukik, nem rejtjük el becsléssel. Csak a besorolatlan
    // (átvitel-szintű) hiba esik vissza a legutóbb ismert árfolyamra.
    if (error instanceof ApiError || error instanceof ZodError) {
      throw error;
    }
    const cached = await readCache(cacheKey(from, to), cachedRateSchema);
    if (!cached) {
      throw error;
    }
    return {
      rate: cached.value.rate,
      fetchedAt: cached.value.fetchedAt,
      estimated: !isToday(cached.value.fetchedAt),
    };
  }
}

export { SETTLEMENT_CURRENCY };
```

> **Frissítve a leszállított kódhoz.** Az eredeti snippet mindent elnyelt a
> `catch`-ben, és a `estimated`-et fixen `false`-ra állította a friss ágon. Ez
> két hibát okozott: a szerver saját tartalék-válaszát (200, `source: "cache"`,
> régebbi `fetchedAt`) friss árfolyamnak vette, és a hibaosztályokat sem
> különítette el. A `isToday` segédfüggvényt és az `ApiError`/`ZodError`
> importokat a fájl tetejére kell felvenni.

A séma a fájl tetejére (a `zod` importtal együtt):

```js
import { z } from 'zod';

const cachedRateSchema = z.object({
  rate: z.string(),
  fetchedAt: z.coerce.date(),
});
```

- [ ] **Step 2: Használd az űrlapon**

`apps/web/src/components/ExpenseModal.vue` — import:

```js
import { fetchRateWithCache } from '../offline/rates.js';
```

Új ref a többi mellé:

```js
const rateEstimated = ref(false);
```

A `fetchRate` függvény törzse (a HUF-ág változatlan):

```js
rateLoading.value = true;
rateError.value = '';
rateEstimated.value = false;
try {
  const result = await fetchRateWithCache(currency.value, SETTLEMENT_CURRENCY);
  exchangeRate.value = result.rate;
  rateFetchedAt.value = result.fetchedAt;
  rateSource.value = 'api';
  rateEstimated.value = result.estimated;
} catch {
  rateError.value = 'Nem sikerült lekérni az árfolyamot. Add meg kézzel.';
  rateSource.value = 'manual';
} finally {
  rateLoading.value = false;
}
```

A `handleRateInput`-ba, a `rateSource.value = 'manual';` mellé:

```js
rateEstimated.value = false;
```

- [ ] **Step 3: Jelezd a becslést a felületen**

Az árfolyam mező (`expense-modal__rate-field`) alá:

```html
<p v-if="rateEstimated" class="expense-modal__rate-note">
  ≈ Becsült árfolyam a legutóbb letöltött adatból. A végleges érték a kiadás feltöltésekor dől el.
</p>
```

A `<style>` blokk végére a meglévő tokenekkel:

```css
.expense-modal__rate-note {
  margin: var(--space-1) 0 0;
  font-size: 0.8rem;
  color: var(--ink-soft);
}
```

- [ ] **Step 4: Ellenőrzés — online árfolyam**

```bash
npm run lint
npm run format:check
docker compose up -d --build
```

Böngészőben nyiss új kiadás űrlapot, válts EUR-ra. Elvárt: az árfolyam betöltődik, a becslés-felirat **nem** jelenik meg, a forintos előnézet a megszokott.

- [ ] **Step 5: Ellenőrzés — becsült árfolyam offline**

Ugyanezen az űrlapon, EUR-ral (hogy a cache feltöltődjön), zárd be a modalt. Kapcsold be a DevTools „Offline" módot, nyisd meg újra az űrlapot, válts EUR-ra.

Elvárt: az árfolyam a cache-ből jön, megjelenik a „≈ Becsült árfolyam…" felirat, és nem a „Nem sikerült lekérni" hibaüzenet.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/offline/rates.js apps/web/src/components/ExpenseModal.vue
git commit -m "feat(web): árfolyam-cache és becsült árfolyam offline"
```

---

### Task 5: Outbox — offline kiadás-írás sorbanállítással

**Files:**

- Create: `apps/web/src/offline/outbox.js`
- Modify: `apps/web/src/stores/expenses.js` (`createExpense`, `updateExpense`, `deleteExpense`, új `loadPending` action), `apps/web/src/components/ExpenseTable.vue` (függőben jelzés, művelet-gombok elrejtése)

**Interfaces:**

- Consumes: Task 2 (`getDb`, `OUTBOX_STORE`, `useOfflineStore`), Task 1 (`clientId` a szerveren).
- Produces a `apps/web/src/offline/outbox.js`-ből:
  - `enqueue(entry: { type: 'create'|'update'|'delete', eventId: string, expenseId?: string, clientId?: string, payload?: object }): Promise<object>` — a mentett bejegyzést adja vissza,
  - `listEntries(): Promise<object[]>`, `listByEvent(eventId: string): Promise<object[]>`,
  - `markFailed(id: string, message: string): Promise<void>`, `removeEntry(id: string): Promise<void>`, `markPending(id: string): Promise<void>`,
  - `refreshCounts(): Promise<void>` — frissíti az offline store számlálóit.
  - Bejegyzés alakja: `{ id, type, eventId, expenseId, clientId, payload, status: 'pending'|'failed', error, createdAt }`.

- [ ] **Step 1: Outbox modul**

`apps/web/src/offline/outbox.js`:

```js
import { getDb, OUTBOX_STORE } from './db.js';
import { useOfflineStore } from '../stores/offline.js';

/**
 * Sorbanállított kiadás-módosítás felvétele.
 * @param {{ type: 'create'|'update'|'delete', eventId: string, expenseId?: string, clientId?: string, payload?: object }} entry
 * @returns {Promise<object>}
 */
export async function enqueue(entry) {
  const db = await getDb();
  const row = {
    id: crypto.randomUUID(),
    type: entry.type,
    eventId: entry.eventId,
    expenseId: entry.expenseId ?? null,
    clientId: entry.clientId ?? null,
    payload: entry.payload ?? null,
    status: 'pending',
    error: null,
    createdAt: new Date(),
  };
  await db.put(OUTBOX_STORE, row);
  await refreshCounts();
  return row;
}

/** @returns {Promise<object[]>} */
export async function listEntries() {
  const db = await getDb();
  const rows = await db.getAll(OUTBOX_STORE);
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * @param {string} eventId
 * @returns {Promise<object[]>}
 */
export async function listByEvent(eventId) {
  const rows = await listEntries();
  return rows.filter((row) => row.eventId === eventId);
}

/**
 * @param {string} id
 * @param {string} message
 * @returns {Promise<void>}
 */
export async function markFailed(id, message) {
  await updateStatus(id, 'failed', message);
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function markPending(id) {
  await updateStatus(id, 'pending', null);
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function removeEntry(id) {
  const db = await getDb();
  await db.delete(OUTBOX_STORE, id);
  await refreshCounts();
}

/** @returns {Promise<void>} */
export async function refreshCounts() {
  const rows = await listEntries();
  useOfflineStore().setCounts({
    pending: rows.filter((row) => row.status === 'pending').length,
    failed: rows.filter((row) => row.status === 'failed').length,
  });
}

/**
 * @param {string} id
 * @param {'pending'|'failed'} status
 * @param {string | null} message
 * @returns {Promise<void>}
 */
async function updateStatus(id, status, message) {
  const db = await getDb();
  const row = await db.get(OUTBOX_STORE, id);
  if (!row) {
    return;
  }
  await db.put(OUTBOX_STORE, { ...row, status, error: message });
  await refreshCounts();
}
```

- [ ] **Step 2: Sorbanállítás a kiadás-store-ban**

`apps/web/src/stores/expenses.js` — importok:

```js
import { ApiError } from '../api/client.js';
import { enqueue, listByEvent } from '../offline/outbox.js';
```

A `createExpense` action cseréje:

```js
    /**
     * @param {string} eventId
     * @param {object} input
     */
    async createExpense(eventId, input) {
      const clientId = crypto.randomUUID();
      const body = { ...input, clientId };
      try {
        const expense = await apiClient.post(`/events/${eventId}/expenses`, body, {
          schema: expenseResponseSchema,
        });
        this.upsertExpense(expense);
        return expense;
      } catch (error) {
        if (error instanceof ApiError) {
          // A szerver válaszolt (validációs hiba, 404): ezt a felhasználónak
          // most kell megoldania, nem sorbanállítással.
          throw error;
        }
        const entry = await enqueue({ type: 'create', eventId, clientId, payload: body });
        this.upsertExpense(toPendingExpense(entry));
        return null;
      }
    },
```

Az `updateExpense` és `deleteExpense` ugyanezzel a mintával:

```js
    /**
     * @param {string} id
     * @param {object} input
     */
    async updateExpense(id, input) {
      try {
        const updated = await apiClient.patch(`/expenses/${id}`, input, {
          schema: expenseResponseSchema,
        });
        this.upsertExpense(updated);
        return updated;
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        const existing = this.expenses.find((expense) => expense.id === id);
        await enqueue({
          type: 'update',
          eventId: existing?.eventId ?? '',
          expenseId: id,
          payload: input,
        });
        if (existing) {
          // A `date` az űrlapról ÉÉÉÉ-HH-NN string, a listában viszont Date —
          // a rendezés (compareExpenses) getTime()-ot hív rá.
          this.upsertExpense({ ...existing, ...input, date: new Date(input.date), pending: true });
        }
        return null;
      }
    },

    /**
     * @param {string} id
     */
    async deleteExpense(id) {
      const existing = this.expenses.find((expense) => expense.id === id);
      try {
        await apiClient.delete(`/expenses/${id}`);
        this.removeExpense(id);
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        await enqueue({ type: 'delete', eventId: existing?.eventId ?? '', expenseId: id });
        this.removeExpense(id);
      }
    },
```

Modulszintű segédfüggvény a fájl tetején, az `insertIndexFor` mellé:

```js
/**
 * A sorbanállított kiadás listában megjelenítendő alakja. Az `id` prefixe
 * megkülönbözteti a szervertől kapott kiadásoktól, a `pending` jelzőt pedig a
 * felület használja.
 * @param {object} entry outbox bejegyzés
 * @returns {object}
 */
function toPendingExpense(entry) {
  const { amountMinor, currency, exchangeRate } = entry.payload;
  return {
    ...entry.payload,
    id: `pending:${entry.id}`,
    eventId: entry.eventId,
    date: new Date(entry.payload.date),
    // Ugyanaz a számítás, amit a szerver `buildExpenseData`-ja végez — csak
    // (deviza esetén) a felvitelkor ismert, esetleg cache-elt árfolyammal.
    // NE a nyers `amountMinor` kerüljön ide: az elszámolás ebből a listából
    // számol, tehát egy 10 EUR-os kiadás 10 forintként rontaná el az
    // egyenlegeket. A végleges érték a feltöltéskor, friss árfolyammal dől el.
    baseAmountMinor:
      currency === SETTLEMENT_CURRENCY
        ? amountMinor
        : convertMinorAmount({
            amountMinor,
            rate: exchangeRate,
            sourceCurrency: currency,
            targetCurrency: SETTLEMENT_CURRENCY,
          }),
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    pending: true,
  };
}
```

A store importjaihoz ehhez kell a két shared helper:

```js
import { convertMinorAmount, SETTLEMENT_CURRENCY } from '@filler/shared';
```

A `baseAmountMinor` itt szándékosan a nyers összeg: devizás kiadásnál csak becslés, a végleges értéket a szerver számolja a feltöltéskor. A felület ezért `≈` jelzéssel mutatja (lásd Step 4).

- [ ] **Step 3: Töltsd vissza a függőben lévőket a listába**

`apps/web/src/stores/expenses.js` — új action a `fetchExpenses` után:

```js
    /**
     * Az app újraindítása után a sorbanállított kiadásoknak is látszaniuk kell
     * a listában, nem csak a szinkron képernyőn.
     * @param {string} eventId
     */
    async loadPending(eventId) {
      const entries = await listByEvent(eventId);
      for (const entry of entries) {
        if (entry.type === 'create') {
          this.upsertExpense(toPendingExpense(entry));
        }
        if (entry.type === 'delete' && entry.expenseId) {
          this.removeExpense(entry.expenseId);
        }
      }
    },
```

`apps/web/src/views/EventDetailView.vue` — **nem** az `ExpenseTable`-ben: az
élő-frissítés kör áthelyezte a feliratkozást és a kiadás-betöltést ide, hogy
mindkét fülön éljen. A `loadPending` ugyanoda tartozik, a `fetchExpenses`
**után**, különben a lista betöltése felülírná a függőben lévő sorokat:

```js
expensesStore.fetchExpenses(route.params.id).then(() => {
  return expensesStore.loadPending(route.params.id);
});
```

Figyelj a `promise/catch-or-return` és a `promise/always-return` szabályra: a
lánc `return`-öl a `.then`-ben, és kap egy `.catch`-et, ami — a
`fetchExpenses` mintájára — csendben elnyeli a hibát, mert a store már
beállította a saját `error` állapotát.

- [ ] **Step 4: Jelöld a függőben lévő sorokat**

`apps/web/src/components/ExpenseTable.vue` — a kiadás-sorok (`<tr>`) osztályába:

```html
:class="{ 'is-pending': expense.pending }"
```

A leírás-cellába, a szöveg mellé:

```html
<span v-if="expense.pending" class="expense-table__pending-badge">függőben</span>
```

A művelet-gombokat tartalmazó cellába vedd fel a feltételt, hogy függőben lévő soron ne látszódjanak:

```html
<td v-if="!expense.pending"></td>
```

Ellenőrizd a fájl tényleges sorszerkezetét (asztali táblázat és mobil kártyás nézet is van), és mindkét nézetben jelöld a függőben lévő sort. A `<style>` blokkba a meglévő tokenekkel:

```css
.expense-table__pending-badge {
  margin-left: var(--space-1);
  padding: 0.05rem 0.35rem;
  border-radius: 0.2rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--brass);
  color: var(--paper);
}
```

- [ ] **Step 5: Az elszámolás jelezze, hogy függőben lévő elemet is számol**

Az élő-frissítés kör óta a `apps/web/src/components/SettlementPanel.vue`
közvetlenül a `expensesStore.expenses` listából számol — tehát a függőben lévő
kiadások **automatikusan beleszámítanak** az egyenlegekbe. Ez a kívánt
viselkedés (különben az offline felvitt kiadás némán kimaradna), de a
felhasználónak tudnia kell róla.

A `<script setup>`-ba:

```js
const hasPendingExpense = computed(() => {
  return expensesStore.expenses.some((expense) => expense.pending === true);
});
```

A `<template>`-ben, a „Ki fizet kinek" felirat **fölé**:

```html
<p v-if="hasPendingExpense" class="settlement__status">
  Az elszámolás még fel nem töltött kiadást is tartalmaz. A devizás összegek a felvitelkori
  árfolyammal becsültek — a végleges érték a feltöltéskor dől el.
</p>
```

A `settlement__status` osztály már létezik a fájlban; ne vezess be új stílust.

- [ ] **Step 6: Ellenőrzés — online felvitel változatlan**

```bash
npm run lint
npm run format:check
docker compose up -d --build
```

Böngészőben vegyél fel egy kiadást. Elvárt: azonnal megjelenik, **nincs** rajta „függőben" jelzés, a másik fülön is megjelenik.

- [ ] **Step 7: Ellenőrzés — offline felvitel sorbanáll**

Kapcsold be a DevTools „Offline" módot, vegyél fel egy kiadást. Elvárt: a modal bezárul, a sor megjelenik „függőben" jelzéssel, művelet-gombok nélkül. A DevTools → Application → IndexedDB → `filler-offline` → `outbox` alatt látszik egy `pending` bejegyzés.

Tölts újra (még offline). Elvárt: a függőben lévő sor a cache-elt lista mellett újra megjelenik.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/offline/outbox.js apps/web/src/stores/expenses.js apps/web/src/views/EventDetailView.vue apps/web/src/components/ExpenseTable.vue apps/web/src/components/SettlementPanel.vue
git commit -m "feat(web): offline kiadás-írás outbox sorbanállítással"
```

---

### Task 6: Szinkron-motor

**Files:**

- Create: `apps/web/src/offline/sync.js`
- Modify: `apps/web/src/native/runtime.js` (a szinkron indítása), `apps/web/package.json` (`dependencies`: `@capacitor/network`)

**Interfaces:**

- Consumes: Task 4 (`fetchFreshRate`), Task 5 (`listEntries`, `markFailed`, `removeEntry`, `refreshCounts`), Task 1 (`clientId` idempotencia).
- Produces a `apps/web/src/offline/sync.js`-ből:
  - `syncOutbox(): Promise<{ uploaded: number, failed: number }>` — egyszeri feldolgozás,
  - `startAutoSync(): Promise<void>` — hálózat- és előtérbe-kerülés-figyelő regisztrálása.

- [ ] **Step 1: Telepítsd a Network plugint**

```bash
npm install -w @filler/web @capacitor/network@latest
```

- [ ] **Step 2: Szinkron modul**

`apps/web/src/offline/sync.js`:

```js
import { Network } from '@capacitor/network';
import { expenseResponseSchema, SETTLEMENT_CURRENCY } from '@filler/shared';
import { apiClient, ApiError } from '../api/client.js';
import { listEntries, markFailed, refreshCounts, removeEntry } from './outbox.js';
import { fetchFreshRate } from './rates.js';
import { isNativeApp } from '../utils/platform.js';

/** Egyszerre csak egy futás legyen, különben ugyanaz az elem kétszer menne fel. */
let running = false;

/**
 * A sorbanállított módosítások feltöltése, létrehozásuk sorrendjében.
 *
 * A `failed` állapotú elemeket nem próbáljuk újra automatikusan: ezek
 * felhasználói döntést igényelnek (lásd a Szinkronizálás képernyőt).
 * @returns {Promise<{ uploaded: number, failed: number }>}
 */
export async function syncOutbox() {
  if (running) {
    return { uploaded: 0, failed: 0 };
  }
  running = true;
  let uploaded = 0;
  let failed = 0;

  try {
    const entries = await listEntries();
    for (const entry of entries) {
      if (entry.status !== 'pending') {
        continue;
      }
      try {
        await uploadEntry(entry);
        await removeEntry(entry.id);
        uploaded += 1;
      } catch (error) {
        if (error instanceof ApiError) {
          // A szerver érdemben válaszolt: az elem így, ebben a formában nem
          // mehet fel. Megtartjuk, de a felhasználó dönt a sorsáról.
          await markFailed(entry.id, error.message);
          failed += 1;
        } else {
          // Hálózathiba: a sor marad pending, a következő futás újrapróbálja.
          break;
        }
      }
    }
  } finally {
    running = false;
    await refreshCounts();
  }

  return { uploaded, failed };
}

/**
 * Egyetlen bejegyzés feltöltése.
 * @param {object} entry
 * @returns {Promise<void>}
 */
async function uploadEntry(entry) {
  if (entry.type === 'delete') {
    await apiClient.delete(`/expenses/${entry.expenseId}`);
    return;
  }

  const payload = await withFreshRate(entry.payload);

  if (entry.type === 'create') {
    await apiClient.post(`/events/${entry.eventId}/expenses`, payload, {
      schema: expenseResponseSchema,
    });
    return;
  }

  await apiClient.patch(`/expenses/${entry.expenseId}`, payload, {
    schema: expenseResponseSchema,
  });
}

/**
 * Devizás kiadásnál a feltöltéskor érvényes árfolyammal dolgozunk: a felvitel
 * pillanatában legfeljebb egy cache-elt becslés állt rendelkezésre.
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function withFreshRate(payload) {
  if (payload.currency === SETTLEMENT_CURRENCY || payload.rateSource === 'manual') {
    return payload;
  }
  try {
    const fresh = await fetchFreshRate(payload.currency, SETTLEMENT_CURRENCY);
    return { ...payload, exchangeRate: fresh.rate, rateFetchedAt: fresh.fetchedAt };
  } catch {
    // Ha most sem sikerül árfolyamot kérni, a becsléssel megyünk tovább —
    // ez még mindig jobb, mint a kiadást a sorban ragasztani.
    return payload;
  }
}

/**
 * Automatikus szinkron: hálózat visszatérésekor és előtérbe kerüléskor.
 * @returns {Promise<void>}
 */
export async function startAutoSync() {
  await Network.addListener('networkStatusChange', (status) => {
    if (status.connected) {
      syncOutbox().catch(() => {
        // A szinkron hibája nem törheti meg az appot; az elemek a sorban
        // maradnak, a következő alkalommal újrapróbáljuk.
      });
    }
  });

  // Előtérbe kerüléskor is szinkronizálunk. Szándékosan `visibilitychange`,
  // nem a `@capacitor/app` `appStateChange`-e: az élő-frissítés kör óta a
  // stream újrakapcsolódása és a pótló újratöltés is ezen az eseményen áll
  // (lásd `apps/web/src/stores/expenses.js`), és két párhuzamos
  // előtérbe-kerülés-mechanizmus csak széttartani tudna.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncOutbox().catch(() => {});
    }
  });

  await syncOutbox();
}
```

- [ ] **Step 3: Indítsd a szinkront az app indulásakor**

`apps/web/src/native/runtime.js` — bővítés. A szinkron a böngészőben is hasznos, ezért **nem** csak natívban indul; a natív-specifikus rész (szervercím, token) marad az `isNativeApp()` ága mögött:

```js
import { startAutoSync } from '../offline/sync.js';
```

Az `initNativeRuntime` szerkezete átalakul: a korai `return` helyett a natív ág feltételes blokkba kerül, hogy a szinkron a böngészőben is elinduljon. A függvény teljes új alakja:

```js
export async function initNativeRuntime() {
  if (isNativeApp()) {
    const { value } = await Preferences.get({ key: SERVER_URL_KEY });
    if (value) {
      setApiBase(value);
    }
    await loadToken();
  }
  await startAutoSync();
}
```

- [ ] **Step 4: Ellenőrzés — az online működés változatlan**

```bash
npm run lint
npm run format:check
docker compose up -d --build
```

Böngészőben: bejelentkezés, kiadás felvitele, törlés. Elvárt: minden a megszokott, hibaüzenet nélkül.

- [ ] **Step 5: Ellenőrzés — a sorbanállított kiadás feltöltődik**

DevTools „Offline" mód, vegyél fel két kiadást (egy forintosat és egy EUR-osat). Elvárt: mindkettő „függőben". Kapcsold vissza a hálózatot, majd tölts újra.

Elvárt: mindkét kiadás felkerül, a „függőben" jelzés eltűnik, az `outbox` store kiürül, és a másik böngészőfülön (SSE-vel) is megjelennek. Az EUR-os kiadás forintos értéke a feltöltéskori árfolyammal számolt.

- [ ] **Step 6: Ellenőrzés — nincs duplikáció ismételt szinkronon**

Offline vegyél fel egy kiadást, kapcsold vissza a hálózatot, tölts újra kétszer egymás után. Elvárt: a listában pontosan **egy** példány szerepel belőle.

- [ ] **Step 7: Ellenőrzés — az elbukott elem nem vész el**

Offline vegyél fel egy kiadást egy eseményhez. Még offline állapotban, egy másik gépről vagy böngészőből töröld ugyanazt az eseményt. Kapcsold vissza a hálózatot, tölts újra.

Elvárt: a bejegyzés `failed` állapotba kerül az `outbox`-ban (DevTools → IndexedDB), és nem tűnik el, illetve nem próbálkozik végtelenül.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/offline/sync.js apps/web/src/native/runtime.js apps/web/package.json package-lock.json
git commit -m "feat(web): szinkron-motor a sorbanállított kiadások feltöltésére"
```

---

### Task 7: Szinkronizálás képernyő

**Files:**

- Create: `apps/web/src/views/SyncView.vue`
- Modify: `apps/web/src/router/index.js` (új útvonal), `apps/web/src/App.vue` (menüpont a számlálóval)

**Interfaces:**

- Consumes: Task 5 (`listEntries`, `markPending`, `removeEntry`, `refreshCounts`), Task 6 (`syncOutbox`), Task 2 (`useOfflineStore`).
- Produces: `/sync` útvonal `sync` néven.

- [ ] **Step 1: A képernyő**

`apps/web/src/views/SyncView.vue`:

```vue
<script setup>
import { onMounted, ref } from 'vue';
import { listEntries, markPending, removeEntry } from '../offline/outbox.js';
import { syncOutbox } from '../offline/sync.js';
import { formatDate } from '../utils/format.js';

const entries = ref([]);
const busy = ref(false);
const message = ref('');

async function load() {
  entries.value = await listEntries();
}

onMounted(load);

async function handleSyncNow() {
  busy.value = true;
  message.value = '';
  try {
    const result = await syncOutbox();
    message.value = `${result.uploaded} elem feltöltve, ${result.failed} elakadt.`;
  } finally {
    busy.value = false;
    await load();
  }
}

/**
 * @param {object} entry
 */
async function handleRetry(entry) {
  await markPending(entry.id);
  await handleSyncNow();
}

/**
 * @param {object} entry
 */
async function handleDiscard(entry) {
  const confirmed = window.confirm(
    'Biztosan eldobod ezt a módosítást? Ez véglegesen elvész, és nem kerül fel a szerverre.',
  );
  if (!confirmed) {
    return;
  }
  await removeEntry(entry.id);
  await load();
}

/**
 * @param {object} entry
 * @returns {string}
 */
function describe(entry) {
  const label = entry.payload?.description ?? 'kiadás';
  if (entry.type === 'create') {
    return `Új kiadás: ${label}`;
  }
  if (entry.type === 'update') {
    return `Módosítás: ${label}`;
  }
  return 'Törlés';
}
</script>

<template>
  <main class="sync">
    <span class="eyebrow">Fillér</span>
    <h1>Szinkronizálás</h1>

    <p v-if="entries.length === 0" class="sync__status">
      Minden feltöltve. Nincs várakozó módosítás.
    </p>

    <template v-else>
      <button type="button" class="btn btn--primary" :disabled="busy" @click="handleSyncNow">
        {{ busy ? 'Feltöltés…' : 'Feltöltés most' }}
      </button>
      <p v-if="message" class="sync__status">{{ message }}</p>

      <ul class="sync__list">
        <li v-for="entry in entries" :key="entry.id" class="sync__item">
          <span class="sync__description">{{ describe(entry) }}</span>
          <span class="sync__meta">{{ formatDate(entry.createdAt) }}</span>
          <span v-if="entry.status === 'failed'" class="sync__error" role="alert">
            Elakadt: {{ entry.error }}
          </span>
          <span v-else class="sync__meta">Feltöltésre vár</span>
          <span v-if="entry.status === 'failed'" class="sync__actions">
            <button type="button" class="btn btn--ghost btn--small" @click="handleRetry(entry)">
              Újra
            </button>
            <button type="button" class="btn btn--danger btn--small" @click="handleDiscard(entry)">
              Eldobás
            </button>
          </span>
        </li>
      </ul>
    </template>
  </main>
</template>

<style scoped>
.sync__list {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}

.sync__item {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 0.3rem;
}

.sync__meta {
  font-size: 0.8rem;
  color: var(--ink-soft);
}

.sync__error {
  font-size: 0.85rem;
  color: var(--stamp);
}

.sync__actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-1);
}
</style>
```

A `btn btn--primary`, `btn`, `eyebrow` osztályok és a hivatkozott tokenek a `theme.css` meglévő készletéből valók. A `<main class="sync">` a többi nézet mintáját követi (`settings`, `events`). A gombokon a művelet jellegéhez igazodva használd a meglévő `btn--ghost` (Újra) és `btn--danger` (Eldobás) változatokat.

- [ ] **Step 2: Útvonal**

`apps/web/src/router/index.js` — import és új route a `settings` mellé:

```js
import SyncView from '../views/SyncView.vue';
```

```js
    { path: '/sync', name: 'sync', component: SyncView, meta: { requiresAuth: true } },
```

- [ ] **Step 3: Menüpont a számlálóval**

`apps/web/src/App.vue` — a `<script setup>`-ba:

```js
import { useOfflineStore } from './stores/offline.js';

const offlineStore = useOfflineStore();
```

A navigációs fülek közé, a Beállítások elé:

```html
<router-link
  v-if="offlineStore.pendingCount + offlineStore.failedCount > 0"
  to="/sync"
  class="app-nav__tab"
>
  Szinkronizálás ({{ offlineStore.pendingCount + offlineStore.failedCount }})
</router-link>
```

- [ ] **Step 4: Ellenőrzés — üres állapot**

```bash
npm run lint
npm run format:check
docker compose up -d --build
```

Böngészőben nyisd meg a `/sync` címet közvetlenül. Elvárt: „Minden feltöltve. Nincs várakozó módosítás.", és a menüben **nem** jelenik meg a Szinkronizálás fül.

- [ ] **Step 5: Ellenőrzés — elakadt elem kezelése**

Ismételd meg a Task 6 Step 7 forgatókönyvét (offline felvitt kiadás egy közben törölt eseményhez), majd nyisd meg a Szinkronizálás képernyőt.

Elvárt: a menüben megjelenik a számláló, a listában az elem „Elakadt: …" hibaüzenettel, „Újra" és „Eldobás" gombokkal. Az „Eldobás" megerősítést kér, és utána eltűnik a lista és a számláló is.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/views/SyncView.vue apps/web/src/router/index.js apps/web/src/App.vue
git commit -m "feat(web): szinkronizálás képernyő az elakadt módosításokhoz"
```

---

### Task 8: Végpróba az eszközön és dokumentáció

**Files:**

- Modify: `README.md` (az „Android APK" szakasz bővítése)

**Interfaces:**

- Consumes: minden korábbi task.
- Produces: nincs.

- [ ] **Step 1: Telepítsd a release APK-t**

```bash
npm run release:mobile
adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

- [ ] **Step 2: Ellenőrzés — offline forgatókönyv végig, eszközön**

A telefonon, sorrendben:

1. Jelentkezz be, nyiss meg egy eseményt, nézd meg a kiadásokat és az elszámolást (ez tölti fel a cache-t).
2. Kapcsold repülő üzemmódba a telefont.
3. Nyisd meg újra az appot: elvárt, hogy a lista látszódjon, felül az „Offline — utoljára frissítve: …" sávval.
4. Vegyél fel egy forintos és egy EUR-os kiadást: elvárt, hogy „függőben" jelzéssel megjelenjenek, az EUR-osnál a becsült árfolyam feliratával.
5. Zárd be teljesen az appot, indítsd újra (még offline): elvárt, hogy a függőben lévő sorok megmaradjanak.
6. Nézd meg az Elszámolás fület: elvárt, hogy offline számolt elszámolást mutasson.
7. Kapcsold ki a repülő üzemmódot, hozd előtérbe az appot.
8. Elvárt: a „függőben" jelzések eltűnnek, a kiadások felkerülnek, a Szinkronizálás menüpont eltűnik, és egy böngészőből ellenőrizve pontosan egy-egy példány létezik belőlük.

- [ ] **Step 3: Dokumentáció**

A README „Android APK" szakaszát bővítsd egy „Offline működés" alszakasszal, ami leírja:

- mi működik offline (olvasás a legutóbb letöltött adatokból, kiadás felvétele/módosítása/törlése, elszámolás helyi számolással) és mi nem (személy- és eseménykezelés, friss árfolyam);
- hogy a sorbanállított kiadások a hálózat visszatértekor, előtérbe kerüléskor, illetve a Szinkronizálás képernyő gombjára töltődnek fel;
- hogy a duplikációt a `clientId` mező zárja ki, ezért egy megszakadt kérés újraküldése biztonságos;
- hogy a devizás kiadás forintos értéke a **feltöltéskori** árfolyammal dől el, a felvitelkor mutatott `≈` érték csak becslés;
- hogy az elakadt elemek a Szinkronizálás képernyőn kezelhetők (Újra / Eldobás), és nem vesznek el maguktól;
- hogy az app törlése (vagy aláíráscsere miatti újratelepítés) a fel nem töltött sorbanállított módosításokat is elviszi.

- [ ] **Step 4: Ellenőrzés**

```bash
npm run lint
npm run format:check
npm run build
git status --short
```

Elvárt: minden hibátlan, a `git status` csak a README módosítását mutatja.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: offline működés dokumentálása az Android appban"
```

---

## Utóellenőrzés (a terv végén, egyszer)

- [ ] `npm run lint`, `npm run format:check`, `npm run build` hibátlan
- [ ] Böngészőben: bejelentkezés, esemény, kiadás felvitele, élő SSE-frissítés két fülön, elszámolás — mind a megszokott módon
- [ ] Böngészőben offline módban: cache-elt olvasás, sorbanállított felvitel, visszakapcsolás után feltöltés duplikáció nélkül
- [ ] Telefonon repülő üzemmódban: a Task 8 Step 2 teljes forgatókönyve hibátlanul lefut
- [ ] Az `outbox` üres állapotban a Szinkronizálás menüpont nem látszik
- [ ] `git status --short` üres
