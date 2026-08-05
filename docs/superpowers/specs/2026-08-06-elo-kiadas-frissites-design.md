# Élő kiadás-frissítés (SSE) — design

**Dátum:** 2026-08-06
**Állapot:** elfogadott, implementációra vár

## 1. A probléma

Ha két ember ugyanannak az eseménynek a lapját nyitva tartja, és az egyik
felvesz egy kiadást, a másiknál csak oldalfrissítés (F5) után jelenik meg.
A saját felvett kiadás már most is azonnal látszik — az `expensesStore`
optimista `unshift`-je miatt —, tehát a hiányzó képesség kizárólag a
**több eszköz közötti szinkron**.

Ez egy közös utazás közben rögzített kiadásoknál gyakori helyzet: az asztalnál
mindenki a saját telefonján nézi ugyanazt a főkönyvet.

## 2. Hatókör

**Benne van:**

- Kiadás létrehozása, módosítása és törlése átjön minden más, ugyanazt az
  eseményt néző kliensre.
- Az érkező sor a helyes pozíciójába szúródik be (nem a lista tetejére), és
  rövid ideig diszkréten felvillan.
- Kapcsolatszakadás utáni garantált konzisztencia.

**Nincs benne (tudatos kihagyás):**

- Az Elszámolás fül élő frissítése. A fülváltás `v-if`-je újramountolja a
  `SettlementPanel`-t, ami így is újratölt — nem ér meg külön csatornát.
- Az eseménylista (címlap) és az esemény metaadatainak (név, résztvevők,
  archiválás, törlés) push-olása.
- Elmaradt események visszajátszása `Last-Event-ID` pufferből — lásd 6. pont,
  a teljes újratöltés egyszerűbb és mindig helyes.

## 3. Miért SSE

A kommunikáció egyirányú: szerver → kliens. Ehhez a WebSocket kétirányú
csatornát, új függőséget (`@fastify/websocket`), saját reconnect-logikát és
proxy-konfigot hozna — YAGNI. Az időzített polling nulla backend változással
jár, de 10–15 mp késést és folyamatos üres kéréseket okoz.

Az SSE sima HTTP-n megy, a böngésző `EventSource`-a **magától újrakapcsolódik**,
és mivel a kérés same-origin (`/api`), a session cookie automatikusan
átmegy — a hitelesítés a meglévő `requireAuth` hookkal, extra kód nélkül
működik. Nem kell hozzá se új npm függőség, se SSE-plugin.

Egyetlen `api` konténer fut (lásd `compose.yaml`), ezért a pub/sub
**memóriában** lehet: nincs Redis, nincs külső broker. Ez a döntés ahhoz kötött,
hogy az API egy példányban fut; ha ez egyszer megváltozik, az `eventBus`
implementációját kell kicserélni — a hívói felületét nem.

## 4. Adatfolyam

```
POST/PATCH/DELETE ─► expenseService ──► expenseRepository (Mongo)
                          │
                          │ publishExpenseChange(eventId, message)
                          ▼
                  eventBus (in-memory EventEmitter, csatorna: "event:<eventId>")
                          │
GET /api/events/:id/stream ◄┘   (SSE, a védett /api prefix alatt → requireAuth)
                          │
              EventSource ─► expensesStore ─► ExpenseTable (felvillanás)
```

## 5. Komponensek

### 5.1 `apps/api/src/services/eventBus.js` (új)

Egyetlen felelősség: eseményenkénti témára publikálás és feliratkozás.
Nem tud Mongóról, nem tud HTTP-ről, nem ismeri a kiadás-domaint a
message-en túl.

```js
publishExpenseChange(eventId, message); // → void
subscribeToEvent(eventId, listener); // → unsubscribe fn
```

A csatorna kulcsa `event:<eventId>`, így egy kliens csak annak az eseménynek
a forgalmát kapja, amit néz. Az emitter `setMaxListeners(0)`-t kap, hogy sok
párhuzamos SSE-kliens ne generáljon Node figyelmeztetést.

### 5.2 `apps/api/src/services/expenseService.js`

A három mutáció végén egy-egy publish hívás. A `deleteExpense` már most is
megkapja a törölt dokumentumot (`deleted.eventId`, `deleted.id`), csak eddig
eldobta.

| Művelet | Message                                  |
| ------- | ---------------------------------------- |
| create  | `{ type: 'expense.created', expense }`   |
| update  | `{ type: 'expense.updated', expense }`   |
| delete  | `{ type: 'expense.deleted', expenseId }` |

A publish a sikeres DB-írás **után** történik, tehát hibára dobó mutáció nem
küld ki semmit.

### 5.3 `apps/api/src/routes/events.js` — `GET /:id/stream`

A már létező védett `/api` prefix alatt van, tehát a `requireAuth` hook
érvényes rá.

- Először `eventService.getEvent(id)`: nemlétező eseményre rendes 404-et ad,
  **még a hijack előtt**.
- `reply.hijack()`, majd kézi `writeHead`:
  `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`,
  `Connection: keep-alive`, `X-Accel-Buffering: no`.
- Nincs `response` Zod séma — a hijack miatt nem is szerializálódna.
- Kezdő `retry: 5000` mező: 5 mp-es újrakapcsolódási ütem.
- **20 mp-enként heartbeat komment** (`: ping\n\n`).
- `request.raw.on('close')` → leiratkozás az `eventBus`-ról + a heartbeat
  interval törlése. Szivárgó listener nem maradhat.

A heartbeat nem kozmetika: az `apps/web/server.js` proxyja
(`@fastify/http-proxy` → `@fastify/reply-from` → undici) néma stream esetén
~30 mp után elvághatja a választ. A 20 mp-es ping ez alá visz.

### 5.4 `apps/web/server.js`

A proxy regisztrációja explicit `undici: { bodyTimeout: 0, headersTimeout: 0 }`
opciót kap, hogy a hosszan élő SSE-válaszra ne járjon le időkorlát.
**Ellenőrzés Dockerben kötelező** — nem a dokumentáció alapján fogadjuk el,
hogy a `@fastify/http-proxy` továbbadja ezt az opciót, hanem valós, 1 percnél
hosszabb ideig nyitva tartott streammel.

### 5.5 `apps/web/src/stores/expenses.js`

Új state: `connected` (bool), `flashIds` (Set — a frissen érkezett sorok id-jei).

Új action-ök:

- `subscribe(eventId)` / `unsubscribe()` — az `EventSource` életciklusa.
- `applyRemote(message)` — **idempotens upsert**: ha az id már a listában van,
  helyben cseréli, nem duplikál. Ez oldja meg azt is, hogy a saját POST után
  magamnak is visszajön az `expense.created`: nem lesz dupla sor, és nem
  villan fel a már látott sor (a flash csak akkor indul, ha a sor még nem
  volt a listában).
- `insertSorted(expense)` — a szerver rendezése szerint (`date` desc, majd
  `createdAt` desc) szúr be.

`insertSorted` egy meglévő apró hibát is javít: a mostani `unshift` a lista
tetejére teszi az új kiadást akkor is, ha az régebbi dátumú, tehát F5 után
átugrik máshova. Az optimista create és az SSE-ből érkező create **ugyanezt a
helpert** használja, így a két út nem tud eltérni egymástól.

Az optimista `unshift` (`insertSorted`-re cserélve) **megmarad**: ha az SSE
kapcsolat épp halott, a saját felvitt kiadás akkor is megjelenjen.

### 5.6 `apps/web/src/components/ExpenseTable.vue`

- `onMounted` → `subscribe(event.id)`, `onUnmounted` → `unsubscribe()`.
  A fülváltás `v-if`-je lebontja a komponenst, tehát az Elszámolás fülön nem
  áll fenn nyitott kapcsolat — ez kívánatos.
- Az érkező sor `is-fresh` osztályt kap ~1,6 mp-re: halvány `--forint-soft`
  háttér, ami elhalványul. `prefers-reduced-motion` alatt animáció nélküli,
  statikus árnyalat.
- A toolbarban halk, mono `● élő` / `○ nincs kapcsolat` jelző.

A kapcsolatjelző a néma meghibásodás ellen van: enélkül a felhasználó azt
hiszi, élő listát lát, pedig a stream fél órája halott. Ez a legrosszabb
kimenet, ezért a jelző a design része, nem extra.

## 6. Hibakezelés és konzisztencia

| Helyzet                              | Viselkedés                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| Wifi-szakadás, API újraindul         | `EventSource` 5 mp-enként újrapróbál; `connected = false`, a jelző offline-ra vált |
| Sikeres újrakapcsolódás              | Csendes, teljes lista-újratöltés (`loading` billentése nélkül)                     |
| Mobil-fül felfüggesztve, majd vissza | `visibilitychange` → visible: ugyanaz a csendes újratöltés                         |
| Lejárt session (401 a stream-en)     | A jelző offline-ra vált; a következő rendes API-hívás a login-ra irányít           |
| Törölt esemény                       | 404 a stream nyitásakor, hijack előtt — rendes hibaválasz                          |

**Az elmaradt események kezelése** a kulcsdöntés: nem építünk `Last-Event-ID`
puffert a szerveren. Helyette újrakapcsolódáskor és a fül előtérbe kerülésekor
a store **csendben újratölti a teljes listát**. Így minden szakadás után
garantáltan konzisztens az állapot, jóval kevesebb kóddal és állapottal, mint
egy replay puffer — a lista mérete (egy esemény kiadásai) ezt bőven elbírja.

A „csendes" itt azt jelenti: a `loading` flag nem billen át, hogy ne villanjon
fel a „Betöltés…" szöveg egy amúgy is látható lista helyén.

## 7. Tesztelés

A projektben nincs automatizált teszt (lásd README) — az ellenőrzés
Docker-alapú, kézi. A dev mód váltásához `--build` kell, és a friss
`node_modules` volume-ba `npm ci` (lásd a projekt dev-mode buktatóit).

Kézi ellenőrzési lista:

1. Két böngészőablak ugyanazon az esemény lapján. Az egyikben felvitt kiadás
   a másikban ~1 mp-en belül megjelenik, felvillanással.
2. Módosítás és törlés is átjön mindkét irányban.
3. A saját felvitt kiadás **nem** duplikálódik, és nem villan fel.
4. Régebbi dátumú kiadás felvitele a lista közepébe kerül, és F5 után
   ugyanott marad.
5. Az `api` konténer újraindítása után a stream magától visszaáll, és a
   közben felvitt kiadás megjelenik (csendes újratöltés).
6. A stream 1 percnél hosszabb ideig is nyitva marad a `web` proxyn keresztül
   (produkciós mód, nem csak Vite dev proxy) — ez a heartbeat/undici-timeout
   ellenőrzése.
7. `npm run lint` és `npm run format:check` tisztán fut.

## 8. Dokumentáció

- `docs/ARCHITECTURE.md`: az API-végpontok listája kap egy sort a stream
  végpontról, és egy rövid alfejezet az élő frissítés mechanizmusáról
  (eventBus, memóriában tartott pub/sub, az egy-példányos API kikötése).
- `README.md`: a Funkciók listájában egy sor az élő frissítésről.
