# Android APK csomagolás (Capacitor) — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A meglévő Vue frontendből telepíthető, aláírt Android APK, ami saját ikonnal, natív HTTP-vel és token-alapú hitelesítéssel éri el a self-hosted backendet.

**Architecture:** A `apps/web` Vite buildje változatlanul kerül a telefonra; egy új `apps/mobile` workspace tartalmazza a Capacitor konfigot és az `android/` natív projektet. A frontend futásidőben ismeri fel, hogy natív appban fut-e (`Capacitor.isNativePlatform()`), és ilyenkor abszolút API-URL-t, `Authorization: Bearer` tokent és SSE helyett előtérbe-kerüléses frissítést használ. A webes viselkedés minden ponton változatlan marad.

**Tech Stack:** Capacitor (CLI + core + android), `@capacitor/preferences`, `@capacitor/app`, `@capacitor/share`, `@capacitor/assets`, Vue 3 + Vite, Fastify + `@fastify/cookie`.

## Global Constraints

- **Nincs automatizált teszt a projektben.** Ne vezess be Vitest/Playwright/Testcontainers-t. Minden task ellenőrzése: `npm run lint`, `npm run format:check`, `npm run build`, plusz a taskban leírt kézi ellenőrzés.
- Sima JavaScript, TypeScript nélkül. Határátlépésnél Zod-validáció, domain típusokra JSDoc.
- ESLint: `eqeqeq`, `no-var`, `prefer-const`, `consistent-return`, `require-await`, `promise/*`. Az `no-restricted-syntax` pénzszabály (`parseFloat`, `Number.parseFloat`, `.toFixed(`) inline `eslint-disable`-lel **nem** kerülhető meg.
- Új scriptek kiterjesztése `.js` legyen, **ne** `.mjs` — az ESLint config csak `**/*.js`-re ad Node globálisokat.
- Commit konvenció: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`). **Ne** tegyél `Co-Authored-By` sort a commit üzenetbe.
- Minden felhasználónak látszó szöveg magyar.
- Titkot (jelszó, keystore jelszó, API kulcs) soha ne commitolj.
- A webes build viselkedése egyik taskban sem változhat: `VITE_API_BASE_URL` nélkül minden pontosan úgy működik, ahogy ma.

---

### Task 1: API bázis-URL kiemelése konfigurálható modulba

**Files:**

- Create: `apps/web/src/api/baseUrl.js`
- Modify: `apps/web/src/api/client.js:3` (az `API_BASE` konstans), `apps/web/src/api/client.js:29` (a `fetch` hívás), `apps/web/src/api/client.js:68-70` (`apiStreamUrl`)

**Interfaces:**

- Consumes: semmit korábbi taskból.
- Produces: `getApiBase(): string`, `setApiBase(value: string): void`, `getDefaultApiBase(): string` a `apps/web/src/api/baseUrl.js`-ből. A `getApiBase()` visszatérési értéke sosem végződik `/`-re.

- [ ] **Step 1: Hozd létre a bázis-URL modult**

`apps/web/src/api/baseUrl.js`:

```js
/**
 * Az API bázisútvonala. A webes buildben relatív (`/api`), mert a frontendet
 * ugyanaz a szerver szolgálja ki, ami a `/api`-t proxyzza. A natív appban
 * abszolút URL kell, mert ott a WebView a helyi assetekről tölt be — ezt a
 * `VITE_API_BASE_URL` adja fordítási időben, és a felhasználó futásidőben
 * felül tudja írni (lásd Task 5).
 */

/**
 * @param {string} value
 * @returns {string}
 */
function normalize(value) {
  const trimmed = value.trim();
  // A felhasználó által beírt cím több záró perjelet is tartalmazhat.
  return trimmed.replace(/\/+$/, '');
}

const DEFAULT_BASE = normalize(import.meta.env.VITE_API_BASE_URL ?? '/api');

let currentBase = DEFAULT_BASE;

/** @returns {string} */
export function getDefaultApiBase() {
  return DEFAULT_BASE;
}

/** @returns {string} */
export function getApiBase() {
  return currentBase;
}

/**
 * @param {string} value
 */
export function setApiBase(value) {
  currentBase = normalize(value);
}
```

- [ ] **Step 2: Használd a modult a klienszben**

`apps/web/src/api/client.js` — cseréld le a `const API_BASE = '/api';` sort az importra, és a két felhasználási helyet a függvényhívásra. A bázist **kéréskor** kell kiolvasni (nem modulbetöltéskor), hogy a futásidejű felülírás érvényesüljön:

```js
import { router } from '../router/index.js';
import { getApiBase } from './baseUrl.js';
```

A `request` függvényben:

```js
  const response = await fetch(`${getApiBase()}${path}`, {
```

Az `apiStreamUrl`-ben:

```js
export function apiStreamUrl(path) {
  return `${getApiBase()}${path}`;
}
```

- [ ] **Step 3: Ellenőrzés — a webes build változatlan**

Futtasd (külön parancsokban, csövezés nélkül, hogy a kilépési kód látszódjon):

```bash
npm run lint
npm run format:check
npm run build -w @filler/web
grep -rc "\"/api\"\|'/api'" apps/web/dist/assets/*.js
```

Elvárt: a lint és a format:check hibátlan, a build sikeres, és a dist tartalmazza a relatív `/api` bázist.

- [ ] **Step 4: Ellenőrzés — a fordítási idejű felülírás működik**

```bash
VITE_API_BASE_URL=https://pelda.hu/api npm run build -w @filler/web
grep -rl "https://pelda.hu/api" apps/web/dist/assets/
npm run build -w @filler/web
```

Elvárt: a második parancs kiír legalább egy fájlt (a felülírás bekerült a buildbe); a harmadik visszaállítja a normál webes buildet.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/baseUrl.js apps/web/src/api/client.js
git commit -m "feat(web): konfigurálható API bázis-URL a natív buildhez"
```

---

### Task 2: Token-alapú hitelesítés a backenden

**Files:**

- Modify: `apps/api/src/services/authService.js:71-79` (`isRequestAuthenticated`)
- Modify: `apps/api/src/routes/auth.js:17` (`authStatusResponseSchema`), `apps/api/src/routes/auth.js:36-55` (login handler)

**Interfaces:**

- Consumes: semmit korábbi taskból.
- Produces: `POST /api/auth/login` az `X-Client: app` fejléc jelenlétében a válaszban egy `token` mezőt is ad (string). Minden védett végpont elfogadja az `Authorization: Bearer <token>` fejlécet a session cookie helyett.

**Háttér:** a `@fastify/cookie` `request.signCookie(value)` / `request.unsignCookie(value)` metódusokat is dekorál (nem csak a reply-t), ugyanazzal a `SESSION_SECRET`-tel, amit a cookie használ. A token tehát pontosan az az aláírt érték, amit ma a cookie hordoz — nem kell új titok, új tárolás, új lejárati logika.

- [ ] **Step 1: Fogadja el a Bearer tokent az `isRequestAuthenticated`**

`apps/api/src/services/authService.js` — cseréld le a függvényt:

```js
/**
 * A natív app nem cookie-t, hanem `Authorization: Bearer` fejlécet küld: a
 * WebView-ban a cross-origin cookie törékeny. A token ugyanaz az aláírt
 * érték, amit a cookie hordoz, ezért ugyanaz az ellenőrzés érvényes rá.
 * @param {import('fastify').FastifyRequest} request
 * @returns {boolean}
 */
export function isRequestAuthenticated(request) {
  const header = request.headers.authorization;
  if (header !== undefined && header.startsWith(BEARER_PREFIX)) {
    return isSignedValueValid(request, header.slice(BEARER_PREFIX.length));
  }

  const rawCookie = request.cookies[SESSION_COOKIE_NAME];
  if (!rawCookie) {
    return false;
  }
  return isSignedValueValid(request, rawCookie);
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {string} signedValue
 * @returns {boolean}
 */
function isSignedValueValid(request, signedValue) {
  const unsigned = request.unsignCookie(signedValue);
  return unsigned.valid && unsigned.value === SESSION_COOKIE_VALUE;
}
```

A fájl tetejére, az importok alá:

```js
const BEARER_PREFIX = 'Bearer ';
```

- [ ] **Step 2: Adja vissza a tokent a login az appnak**

`apps/api/src/routes/auth.js` — a válasz-séma bővítése:

```js
const authStatusResponseSchema = z.object({
  authenticated: z.boolean(),
  /** Csak a natív appnak (X-Client: app) megy vissza; a böngésző a cookie-t kapja. */
  token: z.string().optional(),
});
```

A login handler végén a `return { authenticated: true };` helyett:

```js
resetLoginAttempts(ip);
setSessionCookie(reply, request.protocol === 'https');

// A böngésző szándékosan nem kapja meg a tokent: neki a httpOnly cookie
// jár, amit JS-ből nem lehet kiolvasni.
if (request.headers['x-client'] !== 'app') {
  return { authenticated: true };
}
return { authenticated: true, token: request.signCookie(SESSION_COOKIE_VALUE) };
```

Az importot is bővítsd a fájl tetején:

```js
import {
  LOGIN_RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_WINDOW,
  SESSION_COOKIE_VALUE,
} from '../config/auth.js';
```

- [ ] **Step 3: Ellenőrzés — lint és a szerver indulása**

```bash
npm run lint
npm run format:check
docker compose up -d --build
docker compose ps
```

Elvárt: minden service `healthy`/`running`.

- [ ] **Step 4: Ellenőrzés — a három hitelesítési út**

Cseréld a `<JELSZO>` helyére az `.env` `APP_PASSWORD` értékét:

```bash
curl -s -X POST http://localhost:8090/api/auth/login -H 'Content-Type: application/json' -H 'X-Client: app' -d '{"password":"<JELSZO>"}'
```

Elvárt: `{"authenticated":true,"token":"authenticated.<aláírás>"}`.

```bash
curl -s -X POST http://localhost:8090/api/auth/login -H 'Content-Type: application/json' -d '{"password":"<JELSZO>"}'
```

Elvárt: `{"authenticated":true}` — **token nélkül**.

A kapott tokennel (`<TOKEN>` helyére másold be):

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8090/api/people -H 'Authorization: Bearer <TOKEN>'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8090/api/people -H 'Authorization: Bearer authenticated.hamis'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8090/api/people
```

Elvárt sorrendben: `200`, `401`, `401`.

- [ ] **Step 5: Ellenőrzés — a böngészős bejelentkezés sértetlen**

Nyisd meg a `http://localhost:8090` címet, jelentkezz be, tölts újra egy oldalt. Elvárt: a bejelentkezés megmarad, a lista betölt.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/authService.js apps/api/src/routes/auth.js
git commit -m "feat(api): Bearer token hitelesítés a natív app számára"
```

---

### Task 3: Android SDK telepítése a fejlesztői gépre

**Files:**

- Modify: `~/.bashrc` (nem verziókövetett)

**Interfaces:**

- Consumes: semmit.
- Produces: működő `sdkmanager` és `adb`, `ANDROID_HOME=$HOME/Android/Sdk` a shell környezetben. A konkrét platform- és build-tools verzió telepítése a Task 4-ben történik, amikor a Capacitor megmondja, melyik kell.

**Háttér:** Android SDK nincs a gépen. Android Studio nem kell, a
`commandlinetools` csomag elég.

**JDK, ne csak JRE:** a `java -version` önmagában megtévesztő — a gépen a
`java-21-openjdk` (+ headless) volt fent, ami futtatókörnyezet: `javac` nélkül
a Gradle build elbukik. Telepítsd a fejlesztői csomagot:

```bash
sudo dnf install java-21-openjdk-devel
```

Az ellenőrzés ezért a `javac -version`, nem a `java -version`.

- [ ] **Step 1: Töltsd le és pakold ki a command line toolsot**

A letöltési URL a <https://developer.android.com/studio#command-line-tools-only> oldalról való (Linux, „Command line tools only"). Írd be az aktuális URL-t a `<URL>` helyére:

```bash
mkdir -p ~/Android/Sdk/cmdline-tools
cd /tmp && curl -L -o cmdline-tools.zip '<URL>'
unzip -q cmdline-tools.zip -d ~/Android/Sdk/cmdline-tools
mv ~/Android/Sdk/cmdline-tools/cmdline-tools ~/Android/Sdk/cmdline-tools/latest
```

- [ ] **Step 2: Vedd fel a környezeti változókat**

Fűzd a `~/.bashrc` végére:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
```

Majd `source ~/.bashrc`.

- [ ] **Step 3: Fogadd el a licenceket, majd telepítsd az alapcsomagokat**

A sorrend számít: elfogadatlan licencekkel a telepítés **némán** kihagyja a
csomagot (0-s kilépési kóddal), tehát előbb a licencek:

```bash
yes | sdkmanager --licenses
sdkmanager --install "platform-tools"
```

A `sdkmanager` deprecation-figyelmeztetést ír ki (az utódja az `android sdk`),
de működik. Ha egy csomag telepítése után hiányzik a könyvtára, ez a néma
kihagyás történt — futtasd újra a licenc-elfogadást.

- [ ] **Step 4: Ellenőrzés**

```bash
echo $ANDROID_HOME
sdkmanager --version
adb version
javac -version
```

Elvárt: az `ANDROID_HOME` a `~/Android/Sdk`-ra mutat, és mindhárom parancs
verziót ír ki hiba nélkül. A `javac` külön fontos: ha ez hiányzik, csak JRE van
fent, és a Task 4 Gradle buildje elbukik.

- [ ] **Step 5: Nincs commit**

Ez a task a gépet állítja be, nem a repót. A telepítés lépései a Task 10-ben kerülnek a README-be.

---

### Task 4: `apps/mobile` Capacitor projekt és Android platform

**Files:**

- Create: `apps/mobile/package.json`, `apps/mobile/capacitor.config.json`, `apps/mobile/.gitignore`
- Create (generált): `apps/mobile/android/**`
- Modify: `package.json` (gyökér, `scripts`), `eslint.config.js:41-43` (`ignores`), `.prettierignore`
- Modify: `apps/web/package.json` (`dependencies`: `@capacitor/core`)

**Interfaces:**

- Consumes: Task 3 (`sdkmanager`, `ANDROID_HOME`).
- Produces: `npm run build:mobile` a gyökérben — beépíti a webet a mobil bázis-URL-lel és szinkronizálja a natív projektbe. Az `apps/mobile/android/` gradle projekt, amiből `./gradlew assembleDebug` APK-t készít.

- [ ] **Step 1: Hozd létre a workspace-t és telepítsd a Capacitort**

```bash
mkdir -p apps/mobile
```

`apps/mobile/package.json`:

```json
{
  "name": "@filler/mobile",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "sync": "cap sync android"
  }
}
```

Telepítés (a legfrissebb Capacitor major verziót használjuk; a pontos verziót a `npm ls` majd kiírja):

```bash
npm install -w @filler/mobile -D @capacitor/cli@latest
npm install -w @filler/mobile @capacitor/core@latest @capacitor/android@latest
npm install -w @filler/web @capacitor/core@latest
npm ls @capacitor/core
```

Jegyezd fel a kiírt verziót — a Step 4 ellenőrzésénél kell.

- [ ] **Step 2: Írd meg a Capacitor konfigot**

`apps/mobile/capacitor.config.json`:

```json
{
  "appId": "xyz.p1ckle.filler",
  "appName": "Fillér",
  "webDir": "../web/dist",
  "plugins": {
    "CapacitorHttp": {
      "enabled": true
    }
  }
}
```

A `CapacitorHttp` engedélyezése a `fetch`-et és az `XHR`-t a natív HTTP-rétegre irányítja: így nincs CORS-korlát és nincs harmadik-fél-cookie probléma.

- [ ] **Step 3: Generáld a natív Android projektet**

```bash
VITE_API_BASE_URL=https://bill.p1ckle.xyz/api npm run build -w @filler/web
cd apps/mobile && npx cap add android
```

- [ ] **Step 4: Telepítsd a projekt által kért SDK-platformot**

```bash
grep -E "compileSdkVersion|targetSdkVersion|minSdkVersion" apps/mobile/android/variables.gradle
```

A kiírt `compileSdkVersion` értékkel (pl. `35`):

```bash
sdkmanager --install "platforms;android-<VERZIÓ>" "build-tools;<VERZIÓ>.0.0"
```

- [ ] **Step 5: Vedd fel a build scriptet és az ignore-okat**

A gyökér `package.json` `scripts` blokkjába:

```json
    "build:mobile": "VITE_API_BASE_URL=${MOBILE_API_BASE_URL:-https://bill.p1ckle.xyz/api} npm run build -w @filler/web && npm run sync -w @filler/mobile",
```

`eslint.config.js` — az `ignores` tömb bővítése:

```js
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'apps/web/dist/**',
      'apps/mobile/android/**',
      'mongo-data/**',
    ],
```

`.prettierignore` végére:

```
apps/mobile/android
```

`apps/mobile/.gitignore` (a natív projekt build-kimenete és a helyi SDK-útvonal nem való a repóba, a projekt forrása igen):

```
android/app/build/
android/build/
android/.gradle/
android/local.properties
android/app/src/main/assets/public/
android/app/src/main/res/xml/config.xml
android/capacitor-cordova-android-plugins/
keystore.properties
```

- [ ] **Step 6: Ellenőrzés — debug APK készül**

```bash
npm run build:mobile
cd apps/mobile/android && ./gradlew assembleDebug
ls -la apps/mobile/android/app/build/outputs/apk/debug/
```

Elvárt: `BUILD SUCCESSFUL`, és létezik az `app-debug.apk`.

- [ ] **Step 7: Ellenőrzés — a repó tiszta és a lint fut**

```bash
npm run lint
npm run format:check
git status --short
```

Elvárt: a lint és a formázás hibátlan; a `git status` nem sorol fel `android/app/build/`, `.gradle/` vagy `local.properties` bejegyzéseket.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile package.json eslint.config.js .prettierignore apps/web/package.json package-lock.json
git commit -m "feat(mobile): Capacitor projekt és Android platform"
```

---

### Task 5: Natív platform-felismerés

> **Módosított terjedelem.** Az eredeti Task 5 egy appon belül átírható
> szervercímet is tartalmazott. A review után a döntés: a cím fordítási időben
> fix, futásidőben nem állítható. Ez a task ezért csak a platform-felismerést
> és a service worker natív kihagyását tartalmazza; a `@capacitor/preferences`
> és a natív init modul a Task 6-ba került, ahol a token miatt tényleg kell.

**Files:**

- Create: `apps/web/src/utils/platform.js`
- Modify: `apps/web/src/main.js` (service worker feltétele), `apps/web/src/api/baseUrl.js` (a futásidejű felülírás eltávolítása)

**Interfaces:**

- Consumes: Task 1 (`getApiBase`).
- Produces: `isNativeApp(): boolean` a `apps/web/src/utils/platform.js`-ből.
  A `apps/web/src/api/baseUrl.js` a `setApiBase` és `getDefaultApiBase`
  exportokat **nem** tartalmazza — a bázis-URL a build után nem változik.

- [ ] **Step 1: Platform-felismerő util**

`apps/web/src/utils/platform.js`:

```js
/**
 * Natív Capacitor appban futunk-e. A `Capacitor` globálist a natív híd
 * injektálja a bundle betöltése előtt; a böngészőben nem létezik.
 * @returns {boolean}
 */
export function isNativeApp() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}
```

- [ ] **Step 2: A bázis-URL fix a build után**

`apps/web/src/api/baseUrl.js` — töröld a `setApiBase` és `getDefaultApiBase`
exportokat, és vond össze a két konstanst egyre. A fájl fejkommentje ne állítsa,
hogy a felhasználó futásidőben felülírhatja — mondja azt, hogy az érték
fordítási időben, a `VITE_API_BASE_URL`-ből dől el, tehát szervercím-váltáshoz
új APK kell.

- [ ] **Step 3: Service worker kihagyása a natív appban**

`apps/web/src/main.js` — a regisztráció feltétele kapja meg a `!isNativeApp()`
tagot is (az `import.meta.env.PROD` marad):

```js
import { isNativeApp } from './utils/platform.js';
```

```js
// Service worker csak a böngészős produkciós buildben: fejlesztői módban a
// Vite HMR-jével akadna össze, a natív appban pedig felesleges — ott a
// WebView helyi fájlokról tölt.
if (import.meta.env.PROD && !isNativeApp() && 'serviceWorker' in navigator) {
```

- [ ] **Step 4: Ellenőrzés**

```bash
npm run lint
npm run format:check
npm run build -w @filler/web
npm run build:mobile
```

Elvárt: mind hibátlan. Ezen felül `grep`-pel igazold, hogy a `apps/web/src`
alatt semmi nem importálja a `setApiBase`-t vagy a `getDefaultApiBase`-t, és
hogy a webes build kimenete továbbra is a relatív `/api` bázist tartalmazza.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/platform.js apps/web/src/main.js apps/web/src/api/baseUrl.js
git commit -m "feat(web): natív platform-felismerés, fix bázis-URL"
```

---

### Task 6: Token-tárolás és -küldés a kliensen

**Files:**

- Create: `apps/web/src/native/token.js`
- Create: `apps/web/src/native/runtime.js` (a natív indulási teendők; a Task 5 már nem hozza létre)
- Modify: `apps/web/src/api/client.js` (a `request` fejlécei), `apps/web/src/stores/auth.js` (login/logout), `apps/web/src/main.js` (aszinkron indítás a token betöltéséhez)

**Interfaces:**

- Consumes: Task 2 (`token` a login válaszban, `Authorization: Bearer` elfogadása), Task 5 (`isNativeApp`).
- **Ez a task hozza létre** a `apps/web/src/native/runtime.js`-t és az
  aszinkron indítást a `main.js`-ben (a Task 5 terjedelem-szűkítése miatt), és
  ez telepíti a `@capacitor/preferences`-t. Az `initNativeRuntime()` egyetlen
  teendője a token betöltése.
- **Kötelező robusztussági kikötés:** ha az `initNativeRuntime()` elbukik (pl. a
  Preferences olvasása hibázik), az app **akkor is mountoljon** — token nélkül,
  bejelentkezést kérve. Üres, fehér képernyő nem elfogadható kimenet, mert a
  felhasználónak nincs miből kilábalnia.
- Produces: `getToken(): string | null`, `loadToken(): Promise<void>`, `setToken(token: string): Promise<void>`, `clearToken(): Promise<void>` a `apps/web/src/native/token.js`-ből.

- [ ] **Step 1: Token modul**

`apps/web/src/native/token.js`:

```js
import { Preferences } from '@capacitor/preferences';

const TOKEN_KEY = 'session_token';

/**
 * Szinkron elérhető másolat: a HTTP-kérések fejlécének összeállítása nem
 * lehet aszinkron, a Preferences olvasása viszont az.
 * @type {string | null}
 */
let cachedToken = null;

/** @returns {string | null} */
export function getToken() {
  return cachedToken;
}

/** @returns {Promise<void>} */
export async function loadToken() {
  const { value } = await Preferences.get({ key: TOKEN_KEY });
  cachedToken = value ?? null;
}

/**
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function setToken(token) {
  cachedToken = token;
  await Preferences.set({ key: TOKEN_KEY, value: token });
}

/** @returns {Promise<void>} */
export async function clearToken() {
  cachedToken = null;
  await Preferences.remove({ key: TOKEN_KEY });
}
```

- [ ] **Step 2: Töltsd be a tokent induláskor**

`apps/web/src/native/runtime.js` — az `initNativeRuntime` bővítése (az import is):

```js
import { loadToken } from './token.js';
```

```js
export async function initNativeRuntime() {
  if (!isNativeApp()) {
    return;
  }
  const { value } = await Preferences.get({ key: SERVER_URL_KEY });
  if (value) {
    setApiBase(value);
  }
  await loadToken();
}
```

- [ ] **Step 3: Küldd a fejléceket a kliensben**

`apps/web/src/api/client.js` — importok bővítése:

```js
import { getToken } from '../native/token.js';
import { isNativeApp } from '../utils/platform.js';
```

A `request` függvényben a `fetch` hívás előtt:

```js
const headers = {};
if (body !== undefined) {
  headers['Content-Type'] = 'application/json';
}
if (isNativeApp()) {
  // A szerver ebből tudja, hogy a login válaszába tokent is tegyen.
  headers['X-Client'] = 'app';
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
}

const response = await fetch(`${getApiBase()}${path}`, {
  method,
  credentials: 'include',
  headers,
  body: body === undefined ? undefined : JSON.stringify(body),
});
```

- [ ] **Step 4: Mentsd és töröld a tokent a bejelentkezéskor**

`apps/web/src/stores/auth.js` — importok bővítése:

```js
import { clearToken, setToken } from '../native/token.js';
import { isNativeApp } from '../utils/platform.js';
```

A séma bővítése:

```js
const authStatusSchema = z.object({ authenticated: z.boolean(), token: z.string().optional() });
```

A `login` action `try` ágában, a `this.checked = true;` sor elé. **A token
mentése saját `try`/`catch`-et kap:** ha a tárolás hibázik, az nem eshet bele a
külső `catch`-be, mert az `describeLoginError`-on keresztül „Hibás jelszó."-t
írna ki egy helyes jelszó után is:

```js
if (isNativeApp() && result.token) {
  try {
    await setToken(result.token);
  } catch (storageError) {
    // A bejelentkezés a szerveren már megtörtént: egy tárolási hiba nem
    // minősítheti át hibás jelszóvá. A következő indításnál újra kell majd
    // jelentkezni, de ez a munkamenet érvényes.
    console.error('A munkamenet-token mentése nem sikerült:', storageError);
  }
}
```

A `logout` action. **A helyi hitelesítő adat törlése `finally`-ben van:** ez
kliensoldali művelet, nem függhet a szerver elérhetőségétől — enélkül egy
offline kilépés érvényes tokent hagyna a telefonon:

```js
    async logout() {
      try {
        await apiClient.post('/auth/logout');
      } finally {
        if (isNativeApp()) {
          await clearToken();
        }
        this.authenticated = false;
        this.checked = true;
      }
    },
```

Mivel a szerverhiba így továbbterjed a hívóhoz, a hívó oldalát is kezelni kell:
a `apps/web/src/App.vue` `handleLogout` függvénye **mindig navigáljon** a
bejelentkezőre, különben a helyi munkamenet törlődik, de a felhasználó a régi
felületen marad, és a következő kattintás magyarázat nélkül dobja ki:

```js
async function handleLogout() {
  try {
    await authStore.logout();
  } catch (error) {
    // A helyi munkamenet ekkor is megszűnt; a szerveroldali kijelentkezés
    // hibája nem tarthatja fogva a felhasználót ezen a képernyőn.
    console.error('A szerveroldali kijelentkezés nem sikerült:', error);
  } finally {
    router.push({ name: 'login' });
  }
}
```

- [ ] **Step 5: Ellenőrzés — a webes viselkedés változatlan**

```bash
npm run lint
npm run format:check
npm run build -w @filler/web
docker compose up -d --build
```

Böngészőben: bejelentkezés, oldalfrissítés, kilépés. Elvárt: mindhárom a megszokott módon működik, és a DevTools Application → Local Storage alatt **nem** jelenik meg session token (a böngésző továbbra is cookie-t használ).

- [ ] **Step 6: Ellenőrzés — az app bejelentkezése megmarad újraindítás után**

```bash
MOBILE_API_BASE_URL=https://bill.p1ckle.xyz/api npm run build:mobile
cd apps/mobile/android && ./gradlew installDebug
```

A telefonon: jelentkezz be, zárd be teljesen az appot (app-váltóból kisöpörve), indítsd újra. Elvárt: nem kér újra jelszót, a lista betölt. Ezután lépj ki az appból a „Kilépés" gombbal, és indítsd újra: elvárt, hogy jelszót kérjen.

- [ ] **Step 7: Ellenőrzés — a natív HTTP-híd válaszkezelése**

A `CapacitorHttp` a natív rétegen adja vissza a válaszokat, ami a `response.text()` + `JSON.parse` utat és az üres törzsű válaszokat is érintheti. Ezért mind a négy választípust ki kell próbálni a telefonon:

1. **Hibás jelszó** a bejelentkezésnél. Elvárt: „Hibás jelszó." üzenet (a szerver JSON hibatörzse megérkezett és értelmeződött), nem néma elakadás.
2. **Sikeres lekérés**: esemény megnyitása, kiadáslista betöltése.
3. **Üres törzsű válasz (204)**: egy kiadás törlése. Elvárt: a sor eltűnik, nincs JSON-értelmezési hiba.
4. **Validációs hiba (400)**: nyisd meg az új kiadás űrlapot, és próbálj 999999-nél nagyobb összeget menteni. Elvárt: a szerver hibaüzenete megjelenik a modalban.

Ha bármelyik pont elhasal, `adb logcat | grep -i "capacitor\|chromium"` mutatja a WebView hibáját; a javítás helye a `apps/web/src/api/client.js` válaszfeldolgozása (43-59. sor).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/native/token.js apps/web/src/native/runtime.js apps/web/src/api/client.js apps/web/src/stores/auth.js
git commit -m "feat(web): token-alapú bejelentkezés a natív appban"
```

---

### Task 7: SSE kikapcsolása a natív appban, frissítés előtérbe kerüléskor

**Files:**

- Modify: `apps/web/src/stores/expenses.js:87-160` (`subscribe` / `unsubscribe`)
- Modify: `apps/web/src/components/ExpenseTable.vue:95-106` (a kapcsolatjelző)
- Modify: `apps/web/package.json` (`dependencies`: `@capacitor/app`)

**Interfaces:**

- Consumes: Task 5 (`isNativeApp`), a meglévő `refreshQuietly(eventId)` action.
- Produces: `liveUpdatesSupported(): boolean` a `apps/web/src/utils/platform.js`-ből (`!isNativeApp()`).

**Háttér:** az `EventSource` nem megy át a `CapacitorHttp` natív rétegén, és egy állandóan nyitott kapcsolat mobilon feleslegesen fogyaszt. Natívban ezért nincs stream; helyette az app előtérbe kerülésekor frissítünk.

- [ ] **Step 1: Élő frissítés támogatottságának lekérdezése**

`apps/web/src/utils/platform.js` végére:

```js
/**
 * Van-e élő (SSE) frissítés ezen a platformon. A natív appban nincs: az
 * EventSource nem megy át a natív HTTP-rétegen, és a nyitva tartott kapcsolat
 * mobilon feleslegesen fogyasztaná az akkut.
 * @returns {boolean}
 */
export function liveUpdatesSupported() {
  return !isNativeApp();
}
```

- [ ] **Step 2: Telepítsd az App plugint**

```bash
npm install -w @filler/web @capacitor/app@latest
```

- [ ] **Step 3: Natív ág a `subscribe`-ban**

`apps/web/src/stores/expenses.js` — importok bővítése:

```js
import { App as CapacitorApp } from '@capacitor/app';
import { liveUpdatesSupported } from '../utils/platform.js';
```

A modulszintű változók közé (a `visibilityHandler` mellé):

```js
let appStateListener = null;
```

A `subscribe(eventId)` elejére, az `this.unsubscribe();` után:

```js
if (!liveUpdatesSupported()) {
  this.subscribeNative(eventId);
  return;
}
```

Új action a `subscribe` után:

```js
    /**
     * A natív app „élő frissítése”: stream helyett minden előtérbe kerüléskor
     * újratöltjük a listát. Ez pótolja a háttérben töltött idő alatt történt
     * változásokat.
     * @param {string} eventId
     */
    subscribeNative(eventId) {
      streamEventId = eventId;
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          this.refreshQuietly(eventId);
        }
      })
        .then((listener) => {
          appStateListener = listener;
          return listener;
        })
        .catch(() => {
          // Ha a listener regisztrációja elbukik, marad a kézi újratöltés —
          // ez nem indokolja a lista elrontását egy hibaüzenettel.
        });
    },
```

Az `unsubscribe(eventId)` action-ben, a `stream` lezárása után:

```js
if (appStateListener) {
  appStateListener.remove();
  appStateListener = null;
}
```

- [ ] **Step 4: A kapcsolatjelző csak ott jelenjen meg, ahol értelme van**

`apps/web/src/components/ExpenseTable.vue` — a `<script setup>`-ba:

```js
import { liveUpdatesSupported } from '../utils/platform.js';

const showLiveIndicator = liveUpdatesSupported();
```

A `<template>`-ben a jelző elemére vedd fel a feltételt:

```html
      <p
        v-if="showLiveIndicator"
        class="expense-table__live"
```

- [ ] **Step 5: Ellenőrzés — a böngészős élő frissítés sértetlen**

```bash
npm run lint
npm run format:check
docker compose up -d --build
```

Nyisd meg ugyanazt az eseményt két böngészőfülön. Vegyél fel egy kiadást az egyikben. Elvárt: a másik fülön oldalfrissítés nélkül megjelenik, és a jelző „élő" állapotot mutat.

- [ ] **Step 6: Ellenőrzés — a natív app frissül előtérbe kerüléskor**

```bash
MOBILE_API_BASE_URL=https://bill.p1ckle.xyz/api npm run build:mobile
cd apps/mobile/android && ./gradlew installDebug
```

A telefonon nyiss meg egy eseményt. Elvárt: a „élő / nincs kapcsolat" jelző **nem** látszik. Vedd fel közben egy böngészőből ugyanahhoz az eseményhez egy kiadást, majd a telefonon válts másik appra és vissza. Elvárt: a lista tartalmazza az új kiadást.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/utils/platform.js apps/web/src/stores/expenses.js apps/web/src/components/ExpenseTable.vue apps/web/package.json package-lock.json
git commit -m "feat(web): natív appban előtérbe-kerüléses frissítés SSE helyett"
```

---

### Task 8: Lehúzásos frissítés (pull-to-refresh) a natív appban

**Files:**

- Create: `apps/web/src/utils/pullToRefresh.js`
- Modify: `apps/web/src/components/ExpenseTable.vue` (a gesztus bekötése és a jelzés)

**Interfaces:**

- Consumes: Task 7 (`liveUpdatesSupported`), a `refreshQuietly(eventId)` action.
- Produces: `attachPullToRefresh(options: { onRefresh: () => Promise<void>, onProgress: (ratio: number) => void }): () => void` — a visszatérési érték a leszereléshez hívandó függvény.

- [ ] **Step 1: A gesztus modul**

`apps/web/src/utils/pullToRefresh.js`:

```js
/** Ennyi képpontnyi lehúzás után indul a frissítés. */
const TRIGGER_PX = 72;

/** Ennél laposabb (vízszintesebb) mozdulatot nem tekintünk lehúzásnak. */
const HORIZONTAL_TOLERANCE_PX = 24;

/**
 * Lehúzásos frissítés az oldal tetején. Csak akkor aktiválódik, ha a görgetés
 * már legfelül áll, és a mozdulat túlnyomóan függőleges — így nem üti el a
 * vízszintes gesztusokat és a rendes görgetést.
 *
 * @param {{ onRefresh: () => Promise<void>, onProgress: (ratio: number) => void }} options
 * @returns {() => void} a leszerelő függvény
 */
export function attachPullToRefresh(options) {
  const { onRefresh, onProgress } = options;

  let startY = null;
  let startX = 0;
  let refreshing = false;

  /** @param {TouchEvent} event */
  const handleStart = (event) => {
    if (refreshing || window.scrollY > 0) {
      // Frissítés közben vagy legfelülről elgörgetve egy új érintés nem
      // indíthat lehúzást, de a látható jelzést sem szabad bántani: itt
      // úgysem folyt lehúzás, amit vissza kellene állítani.
      startY = null;
      return;
    }
    if (event.touches.length !== 1) {
      // Egy második ujj (csippentés) menet közben is idekerülhet: ha épp
      // folyt egy lehúzás, a jelzést is vissza kell állítani, különben
      // beragad a képernyőn.
      if (startY !== null) {
        onProgress(0);
      }
      startY = null;
      return;
    }
    startY = event.touches[0].clientY;
    startX = event.touches[0].clientX;
  };

  /** @param {TouchEvent} event */
  const handleMove = (event) => {
    if (startY === null) {
      return;
    }
    const deltaY = event.touches[0].clientY - startY;
    const deltaX = Math.abs(event.touches[0].clientX - startX);
    if (deltaY <= 0 || deltaX > HORIZONTAL_TOLERANCE_PX) {
      startY = null;
      onProgress(0);
      return;
    }
    onProgress(Math.min(deltaY / TRIGGER_PX, 1));
  };

  /**
   * Lefuttatja a frissítést, majd a kimenetelétől (siker vagy hiba)
   * függetlenül visszaállítja a gesztus állapotát.
   *
   * Külön függvény, `try`/`catch`/`finally`-vel: a `.catch().finally()` lánc
   * elbukik a `promise/catch-or-return` szabályon (a `.finally()` nem számít
   * lezárónak), és a config `noInlineConfig`-ja miatt inline kivétellel sem
   * kerülhető meg.
   */
  const finishRefresh = async () => {
    try {
      await onRefresh();
    } catch {
      // A hívó dolga eldönteni, mit kezd a hibával; itt csak a gesztus
      // állapotát kell visszaállítani.
    } finally {
      refreshing = false;
      onProgress(0);
    }
  };

  /** @param {TouchEvent} event */
  const handleEnd = (event) => {
    if (startY === null) {
      return;
    }
    const deltaY = event.changedTouches[0].clientY - startY;
    startY = null;
    if (deltaY < TRIGGER_PX) {
      onProgress(0);
      return;
    }
    refreshing = true;
    onProgress(1);
    finishRefresh();
  };

  window.addEventListener('touchstart', handleStart, { passive: true });
  window.addEventListener('touchmove', handleMove, { passive: true });
  window.addEventListener('touchend', handleEnd, { passive: true });

  return () => {
    window.removeEventListener('touchstart', handleStart);
    window.removeEventListener('touchmove', handleMove);
    window.removeEventListener('touchend', handleEnd);
  };
}
```

- [ ] **Step 2: Kösd be a kiadáslistába**

`apps/web/src/components/ExpenseTable.vue` — a `<script setup>` bővítése:

```js
import { attachPullToRefresh } from '../utils/pullToRefresh.js';

const pullRatio = ref(0);
let detachPullToRefresh = null;
```

Az `onMounted` blokk végére:

```js
if (!showLiveIndicator) {
  detachPullToRefresh = attachPullToRefresh({
    onRefresh: () => expensesStore.refreshQuietly(props.event.id),
    onProgress: (ratio) => {
      pullRatio.value = ratio;
    },
  });
}
```

Az `onUnmounted` blokk végére:

```js
if (detachPullToRefresh) {
  detachPullToRefresh();
  detachPullToRefresh = null;
}
```

- [ ] **Step 3: Jelezd a gesztust a felületen**

A `<template>` legelejére, a `<div class="expense-table">` nyitótag után:

```html
<p v-if="pullRatio > 0" class="expense-table__pull" :style="{ opacity: pullRatio }">
  {{ pullRatio >= 1 ? 'Frissítés…' : 'Húzd lejjebb a frissítéshez' }}
</p>
```

A `<style>` blokk végére:

```css
.expense-table__pull {
  margin: 0 0 var(--space-2);
  text-align: center;
  font-size: 0.85rem;
  color: var(--ink-soft);
}
```

- [ ] **Step 4: Ellenőrzés — a böngészőt nem érinti**

```bash
npm run lint
npm run format:check
docker compose up -d --build
```

Böngészőben nyiss meg egy eseményt. Elvárt: a lista a megszokott, a „Húzd lejjebb…" felirat nem jelenik meg (a gesztus csak natívban aktiválódik).

- [ ] **Step 5: Ellenőrzés — a gesztus működik a telefonon**

```bash
MOBILE_API_BASE_URL=https://bill.p1ckle.xyz/api npm run build:mobile
cd apps/mobile/android && ./gradlew installDebug
```

A telefonon nyiss meg egy eseményt, és húzd le a lista tetejéről. Elvárt: megjelenik a felirat, elengedéskor a lista újratöltődik. Görgesd le a listát, majd húzz lefelé: elvárt, hogy **ne** induljon frissítés (csak legfelül aktiválódjon).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/utils/pullToRefresh.js apps/web/src/components/ExpenseTable.vue
git commit -m "feat(web): lehúzásos frissítés a natív appban"
```

---

### Task 9: Natív megosztás az elszámoláson és app-ikonok

**Files:**

- Modify: `apps/web/src/components/SettlementPanel.vue` (megosztás gomb és szövegépítés)
- Modify: `apps/web/package.json` (`dependencies`: `@capacitor/share`)
- Create: `apps/mobile/assets/icon.png` (a meglévő 512-es ikon másolata)
- Modify: `apps/mobile/android/app/src/main/res/**` (generált ikonok)

**Interfaces:**

- Consumes: Task 5 (`isNativeApp`), a `settlementResponseSchema` (`balances`, `transfers` — a transfer mezői: `fromId`, `toId`, `amountMinor`).
- Produces: nincs későbbi task által használt interfész.

- [ ] **Step 1: Telepítsd a Share plugint**

```bash
npm install -w @filler/web @capacitor/share@latest
```

- [ ] **Step 2: Megosztás gomb az elszámoláson**

`apps/web/src/components/SettlementPanel.vue` — a `<script setup>` bővítése:

```js
import { Share } from '@capacitor/share';

const shareSupported = Boolean(globalThis.navigator?.share) || isNativeApp();
const shareError = ref('');
```

Az import sorokhoz:

```js
import { isNativeApp } from '../utils/platform.js';
```

A szövegépítő és a kezelő függvény (a meglévő `participantName` és `money` helperekre épít):

```js
/**
 * A megosztható összefoglaló: ki kinek mennyit fizet. Egyszerű szöveg, hogy
 * bármelyik célalkalmazásban olvasható maradjon.
 * @returns {string}
 */
function buildShareText() {
  const lines = settlement.value.transfers.map((transfer) => {
    return `${participantName(transfer.fromId)} → ${participantName(transfer.toId)}: ${money(transfer.amountMinor)}`;
  });
  return [`${props.event.name} — elszámolás`, '', ...lines].join('\n');
}

async function handleShare() {
  shareError.value = '';
  try {
    await Share.share({
      title: `${props.event.name} — elszámolás`,
      text: buildShareText(),
      dialogTitle: 'Elszámolás megosztása',
    });
  } catch {
    // A megosztó lap bezárása is hibaként jön vissza; ezt nem jelezzük
    // hibaüzenettel, csak a tényleges küldési hibát.
    shareError.value = '';
  }
}
```

Ellenőrizd a `props.event` mezőnevét: ha az eseménynek nem `name`, hanem más mezője a megnevezés, azt használd (nézd meg a `packages/shared/src/schemas/event.js` `eventResponseSchema`-ját).

- [ ] **Step 3: A gomb a sablonban**

A `<template>`-ben a „Ki fizet kinek" lista (`settlement__transfers`) záró `</ul>` tagje után:

```html
<button
  v-if="shareSupported && !hasNothingToSettle"
  type="button"
  class="btn settlement__share"
  @click="handleShare"
>
  Megosztás
</button>
<p v-if="shareError" role="alert" class="settlement__status">{{ shareError }}</p>
```

- [ ] **Step 4: App-ikonok generálása**

```bash
npm install -w @filler/mobile -D @capacitor/assets@latest
mkdir -p apps/mobile/assets
cp apps/web/public/icons/icon-512.png apps/mobile/assets/icon.png
cp apps/web/public/icons/icon-maskable-512.png apps/mobile/assets/icon-foreground.png
cd apps/mobile && npx capacitor-assets generate --android
```

Ha az eszköz háttérszínt is kér (`icon-background.png`), a bankjegyzöld `#2F6B4F` egyszínű 512×512-es PNG-t generálj a `scripts/generate-icons.js` mintájára, vagy add meg a `--iconBackgroundColor '#2F6B4F'` kapcsolót.

- [ ] **Step 5: Ellenőrzés — a webes megosztás**

```bash
npm run lint
npm run format:check
docker compose up -d --build
```

Böngészőben nyisd meg egy esemény Elszámolás fülét. Elvárt: asztali Chrome-ban (ahol nincs Web Share API) a gomb nem jelenik meg, és semmi nem törik el; a lista és a táblázat a megszokott.

- [ ] **Step 6: Ellenőrzés — a natív megosztás és az ikon**

```bash
MOBILE_API_BASE_URL=https://bill.p1ckle.xyz/api npm run build:mobile
cd apps/mobile/android && ./gradlew installDebug
```

A telefonon: az app ikonja a Fillér ikon (nem az alapértelmezett Capacitor ikon), a neve „Fillér". Nyisd meg egy esemény Elszámolás fülét, nyomd meg a „Megosztás" gombot. Elvárt: megnyílik az Android megosztó lapja, és a beillesztett szöveg tartalmazza a „ki fizet kinek" sorokat.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/SettlementPanel.vue apps/web/package.json apps/mobile package-lock.json
git commit -m "feat: natív megosztás az elszámoláson és Android app-ikonok"
```

---

### Task 10: Release aláírás, verziózás és dokumentáció

**Files:**

- Create: `apps/mobile/keystore.properties.example`
- Modify: `apps/mobile/android/app/build.gradle` (signing config), `apps/mobile/android/variables.gradle` vagy `app/build.gradle` (versionCode/versionName)
- Modify: `README.md` (új szakasz), `package.json` (gyökér, `release:mobile` script)

**Interfaces:**

- Consumes: Task 4 (gradle projekt), Task 3 (SDK).
- Produces: `npm run release:mobile` — aláírt release APK-t készít az `apps/mobile/android/app/build/outputs/apk/release/` alá.

- [ ] **Step 1: Készíts release kulcsot**

```bash
mkdir -p ~/.android-keystore
keytool -genkey -v -keystore ~/.android-keystore/filler.jks -keyalg RSA -keysize 2048 -validity 10000 -alias filler
```

Írd fel a megadott jelszavakat. **Ezt a fájlt mentsd el egy másik eszközre is** — ha elvész, a következő APK-t nem lehet a régi fölé telepíteni, csak az app törlésével, és a törléssel az app minden helyi adata elvész.

- [ ] **Step 2: Helyi (nem verziókövetett) jelszófájl**

`apps/mobile/keystore.properties` (a Task 4-ben már gitignore-olt):

```properties
storeFile=/home/bubooo/.android-keystore/filler.jks
storePassword=<a keystore jelszava>
keyAlias=filler
keyPassword=<a kulcs jelszava>
```

`apps/mobile/keystore.properties.example` (ez commitolható):

```properties
# Másold `keystore.properties` néven, és töltsd ki a valódi értékekkel.
# A valódi fájl gitignore-olt — a jelszavak nem kerülhetnek a repóba.
storeFile=/abszolut/ut/a/filler.jks
storePassword=
keyAlias=filler
keyPassword=
```

- [ ] **Step 3: Signing config a gradle-ben**

`apps/mobile/android/app/build.gradle` — az `android { ... }` blokk **elé**:

```gradle
def keystorePropertiesFile = rootProject.file("../keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

Az `android { ... }` blokkon belülre:

```gradle
    signingConfigs {
        release {
            if (keystoreProperties.containsKey('storeFile')) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
```

A meglévő `buildTypes { release { ... } }` blokkba:

```gradle
            signingConfig signingConfigs.release
```

- [ ] **Step 4: Release build script**

A gyökér `package.json` `scripts` blokkjába, a `build:mobile` mellé:

```json
    "release:mobile": "npm run build:mobile && cd apps/mobile/android && ./gradlew assembleRelease",
```

- [ ] **Step 5: Ellenőrzés — aláírt APK készül**

```bash
npm run release:mobile
ls -la apps/mobile/android/app/build/outputs/apk/release/
$ANDROID_HOME/build-tools/*/apksigner verify --print-certs apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Elvárt: `BUILD SUCCESSFUL`, létezik az `app-release.apk`, és az `apksigner` kiírja a tanúsítvány adatait hiba nélkül.

- [ ] **Step 6: Ellenőrzés — a release APK telepíthető és működik**

Előbb távolítsd el a debug változatot (más aláírással készült, nem írható felül):

```bash
adb uninstall xyz.p1ckle.filler
adb install apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

A telefonon: jelentkezz be, nyiss meg egy eseményt, vegyél fel egy kiadást, nézd meg az Elszámolás fület. Elvárt: mind működik.

- [ ] **Step 7: Dokumentáció a README-be**

A README „Telepítés Androidra" szakasza után új szakasz, „Android APK" címmel. Tartalmazza:

- hogy az APK a PWA **mellett** létezik, nem helyette;
- az Android SDK telepítésének lépéseit (Task 3), az `ANDROID_HOME` beállításával;
- a `npm run build:mobile` és `npm run release:mobile` scripteket, és hogy a szerver címét a `MOBILE_API_BASE_URL` környezeti változó állítja (alapértelmezés: `https://bill.p1ckle.xyz/api`);
- hogy a szerver címe fordítási időben fix: az appon belül **nem** átírható, tehát domain- vagy hálózatváltáshoz új APK kell a megfelelő `MOBILE_API_BASE_URL` értékkel;
- hogy a Bearer tokennek nincs szerveroldali lejárata, ezért a visszavonás módja a `.env` `SESSION_SECRET` cseréje — ez egyszerre érvénytelenít minden böngészős sessiont és minden appban tárolt tokent;
- a keystore-ra vonatkozó figyelmeztetést (elvesztése esetén csak az app törlésével telepíthető új verzió), és a `keystore.properties.example` másolásának lépését;
- hogy a `versionCode` értékét minden kiadás előtt kézzel kell emelni az `apps/mobile/android/app/build.gradle`-ben;
- hogy a natív appban nincs SSE — a lista előtérbe kerüléskor és lehúzásra frissül;
- hogy az APK-build szándékosan nincs a CI-ban (aláíró kulcsot kellene titokként feltölteni).

- [ ] **Step 8: Ellenőrzés — formázás és lint**

```bash
npm run lint
npm run format:check
git status --short
```

Elvárt: hibátlan lint és formázás; a `git status` nem sorolja fel a `keystore.properties` fájlt.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/keystore.properties.example apps/mobile/android/app/build.gradle package.json README.md
git commit -m "feat(mobile): release aláírás, build script és dokumentáció"
```

---

## Utóellenőrzés (a terv végén, egyszer)

- [ ] `npm run lint` és `npm run format:check` hibátlan
- [ ] `npm run build` (mindhárom workspace) sikeres
- [ ] `docker compose up -d --build` után a böngészős app működik: bejelentkezés, esemény, kiadás felvitele, élő frissítés két fülön, elszámolás
- [ ] A telefonra telepített release APK működik: bejelentkezés, esemény, kiadás felvitele, elszámolás, megosztás
- [ ] Az app teljes bezárása után is bejelentkezve marad
- [ ] `git status --short` üres
