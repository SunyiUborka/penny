# Android APK (Capacitor) — design

## Cél

A Fillér frontendjéből telepíthető Android APK, ami saját ikonnal, app-váltóban
külön appként, böngészősáv nélkül fut, offline is használható (olvasás és
kiadás-írás sorbanállással), és natív megosztást kínál az elszámoláshoz.

A meglévő PWA nem szűnik meg: a böngészős telepítés és a service worker
változatlanul marad, a webes viselkedésen ez a projekt nem változtat.

## Amit ez a projekt nem tartalmaz

- Push értesítés (Firebase projektet és backend küldő réteget igényelne).
- Blokk-fotó / kamera (fájltárolást, méretezést és mentési stratégiát
  igényelne).
- Biometrikus zár.
- iOS build.
- Play Store publikálás.

## Technológiai döntés

**Capacitor**, a `apps/web` meglévő Vite buildjét csomagolva natív WebView-ba.

Elvetett alternatívák:

- **TWA / PWABuilder**: nem tud natív plugint, kötelező hozzá HTTPS és
  `assetlinks.json`, az offline logikát pedig ugyanúgy meg kellene írni —
  vagyis a munka nagy részét nem spórolja meg, csak a natív funkciókat veszi
  el.
- **Natív app (Kotlin/Compose)**: teljes újraírás, aránytalan a
  funkcióhalmazhoz képest.

## Felépítés

Új workspace: `apps/mobile` — kizárólag a Capacitor projekt (config +
`android/` natív mappa), **nem** új frontend. A `webDir` a
`apps/web/dist`-re mutat, tehát ugyanaz a Vue kód fut a telefonon, mint a
böngészőben.

A mobil build két lépés: a web build a mobilra szánt környezeti változókkal,
majd `cap sync`. Ezt egy `npm run build:mobile` script fogja össze.

A `android/` mappa verziókövetett (ikonok, `AndroidManifest.xml`,
`build.gradle` módosítások élnek benne).

## Hálózat és auth

### API bázis-URL

Ma az `apps/web/src/api/client.js` relatív `/api`-t hív; a WebView-ban ez a
helyi assetekre mutatna, ezért abszolút URL kell.

```
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';
```

A webes build viselkedése így nem változik (a változó nincs beállítva → `/api`),
a mobil build a szerver címét kapja fordítási időben.

A cím **fordítási időben eldől, és futásidőben nem írható át** (a döntés a
Task 5 review-ja után született): az appon belül nincs „szerver címe" mező.
Következmény: ha a szerver máshova költözik, vagy LAN-on szeretnéd elérni, új
APK-t kell építeni a megfelelő `MOBILE_API_BASE_URL` értékkel. Az indoklás,
hogy egy szabadon átírható cím némán félre tudja küldeni a kéréseket (pl.
protokoll nélkül megadva a saját oldal origójára esik vissza), és ez a hiba
nehezen felismerhető.

### Transport

A HTTP kérések a `CapacitorHttp` natív hídon mennek (a plugin a `fetch`-et és
az `XHR`-t patcheli). Következmény: nincs CORS-konfiguráció a backenden, és
nincs harmadik-fél-cookie probléma.

### Hitelesítés

Az app tokent használ cookie helyett — WebView-ban a cross-origin cookie
törékeny.

- A `POST /api/auth/login` válaszába bekerül a token: ugyanaz az aláírt érték,
  amit ma a session cookie hordoz.
- Az app `Authorization: Bearer <token>` headerben küldi vissza.
- Backend oldalon egyetlen pont változik: `isRequestAuthenticated` a cookie
  mellett a headert is elfogadja, ugyanazzal az aláírás-ellenőrzéssel
  (`@fastify/cookie` unsign, változatlan `SESSION_SECRET`).
- A webes, cookie-alapú bejelentkezés érintetlen marad.
- A token a `@capacitor/preferences`-be kerül, a cookie-val azonos, 365 napos
  élettartammal. Kijelentkezéskor törlődik.

A login IP-alapú rate limitje változatlanul érvényes az appból érkező
kérésekre is.

### SSE

Az élő frissítés (`EventSource`) a mobil buildben kikapcsol: a natív hídon nem
megy át, és egy állandóan nyitott kapcsolat mobilon feleslegesen fogyasztja az
akkut. Helyette az app előtérbe kerüléskor (`App.appStateChange`) és lehúzásra
(pull-to-refresh) frissít. A böngészős verzióban az SSE változatlanul marad.

## Offline réteg

### Tároló

IndexedDB, két store:

- `cache` — a szervertől kapott listák (személyek, események, eseményenként a
  kiadások), `fetchedAt` bélyeggel.
- `outbox` — a még fel nem töltött módosítások.

### Olvasás

Az `apiClient.get` köré réteg kerül: először hálózat (rövid timeouttal), sikerre
cache-írás; hálózathiba esetén a cache-ből olvas, és `stale` jelzéssel adja
vissza. A UI ilyenkor egy halk sávot mutat: „Offline — utoljára frissítve: …".

Az elszámolás offline is számolható, mert a `computeSettlement` a
`packages/shared`-ből a kliensen is fut.

### Írás

- Online: mint eddig.
- Offline: az elem az `outbox`-ba kerül generált `clientId`-vel, és azonnal
  megjelenik a listában „függőben" jelzéssel.

**Offline írásra csak a kiadás megy** (felvétel, módosítás, törlés). A személy-
és eseménykezelés online marad: ritka művelet, és offline sorbanállítva a
hivatkozási szabályokat (résztvevő-ellenőrzés, törlés-blokkolás) nem lehet
tisztességesen kikényszeríteni.

### Duplikáció elleni védelem

A kiadás kap egy `clientId` mezőt (ritka egyedi index). Ha ugyanazzal a
`clientId`-vel érkezik újra POST, a szerver a meglévőt adja vissza, nem hoz
létre másodikat. Enélkül egy félbeszakadt kérés — mobilhálón megszokott —
dupla kiadást csinálna.

Érintett rétegek: `packages/shared/src/schemas/expense.js` (opcionális
`clientId`), `apps/api/src/models/expenseModel.js` (mező + sparse unique index),
`apps/api/src/services/expenseService.js` (létező `clientId` esetén a meglévő
visszaadása).

A `clientId` opcionális marad, hogy a webes kliens változatlanul működjön.

### Függőben lévő kiadás és az elszámolás

Az élő-frissítés kör (`docs/superpowers/specs/2026-08-20-elo-frissites-design.md`)
óta az elszámolás panel a betöltött kiadáslistából számol, saját kérés nélkül.
Ennek két következménye az offline írásra:

- Az „offline elszámolás" külön mechanizmus nélkül megvan: amint a kiadáslista a
  cache-ből jön, az elszámolás is offline működik.
- A sorbanállított kiadás **beleszámít** az egyenlegekbe (döntés: enélkül az
  offline felvitt kiadás némán kimaradna az elszámolásból). Ezért a függőben
  lévő elem forintos értékét ugyanazzal a `convertMinorAmount`-tal kell
  kiszámolni, amit a szerver használ — a felvitelkor ismert (esetleg cache-elt)
  árfolyammal, **nem** a nyers összeggel. A panel jelzi, ha az elszámolás fel
  nem töltött elemet is tartalmaz, és hogy a devizás összegek becsültek.

### Devizás kiadás offline

Az árfolyam-végpont csak aktuális árfolyamot ad, offline pedig nincs mit
lekérni. Ezért:

- a helyi előnézet az utoljára cache-elt árfolyammal becsül, `≈` jelöléssel;
- a végleges árfolyamot feltöltéskor kéri le az app, és az kerül a szerverre.

Forintos kiadásnál a kérdés fel sem merül (a szerver `1`-es árfolyammal
számol).

### Szinkron

Fut hálózat visszatérésekor (`@capacitor/network` listener), előtérbe
kerüléskor, és kézi gombra. Az `outbox` elemei sorrendben mennek fel.

Hibakezelés: ha egy elem elbukik (közben törölték az eseményt, kikerült egy
résztvevő), nem tűnik el és nem próbálkozik a végtelenségig — `failed`
állapotban marad, és egy „Szinkronizálás" képernyőn kilistázva a felhasználó
dönt: javítja vagy eldobja. Néma adatvesztés nincs.

## Natív funkciók

**Megosztás** (`@capacitor/share`): az elszámolás fülre kerül egy „Megosztás"
gomb, ami a „ki kinek mennyit fizet" listát adja át szövegként az Android
megosztó lapjának. A webes verzióban ott működik, ahol a böngésző támogatja a
Web Share API-t; ahol nem, a gomb nem jelenik meg.

**Ikonok**: a meglévő `scripts/generate-icons.js` kimenetéből a
`@capacitor/assets` generálja az Android ikon- és splash-készletet. A vizuális
arculat nem változik.

## Build és aláírás

**SDK**: helyben, Android Studio nélkül — `cmdline-tools` + platform +
build-tools a `~/Android` alatt. Az `ANDROID_HOME` a shell profilba kerül.

**Aláírás**: saját release kulcs a repón kívül (`~/.android-keystore/`), a
jelszavak gitignore-olt helyi fájlban (`apps/mobile/keystore.properties`).

> A kulcsot menteni kell. Ha elvész, a következő APK-t nem lehet a régi fölé
> telepíteni, csak törlés után — és a törléssel az app adatai (token, offline
> outbox) is elvesznek.

**Verziózás**: a `versionCode` kiadásonként kézzel emelkedik.

**CI**: az APK-build nem kerül a GitHub Actionsbe (aláíró kulcsot kellene
titokként feltölteni, a haszon nem éri meg). A CI marad lint + format + build.
A release APK kézzel készül.

## Kockázatok

- **`CapacitorHttp` és a Zod-validáció**: a natív híd válaszait ugyanúgy át kell
  engedni a meglévő response sémákon; ha a plugin más alakban adja vissza a
  törzset (pl. már parse-olt objektumként), a `client.js`-ben ezt kezelni kell.
- **Sorbanálló módosítás törölt kiadáson**: ha egy offline `PATCH` olyan
  kiadásra vonatkozik, amit közben más törölt, a művelet `failed` lesz — ezt a
  Szinkronizálás képernyő mutatja meg, automatikus feltámasztás nincs.
- **Elavult árfolyam-becslés**: a „függőben" állapotú devizás kiadás forintos
  értéke a feltöltéskor változhat a helyi előnézethez képest. A UI ezt az `≈`
  jelöléssel jelzi előre.
