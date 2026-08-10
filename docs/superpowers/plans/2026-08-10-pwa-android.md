# PWA alapok (androidos appszerű megjelenés) — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A meglévő Vue frontend telepíthető PWA-vá tétele, hogy Androidon saját ikonnal, böngészősáv nélkül, teljes képernyőn induljon.

**Architecture:** Négy, egymásra épülő darab az `apps/web` alatt: generált ikonkészlet, web app manifest, a status bar színét a témával szinkronban tartó `theme-color` meta, és egy minimális service worker, ami az `/api` hívásokhoz nem nyúl. A `server.js` `Cache-Control` fejlécet kap a nem hashelt fájlokra, hogy egy deploy után a frissítés le tudjon jönni. A backend, az adatmodell és a `compose.yaml` érintetlen.

**Tech Stack:** Vue 3 + Vite 6, Fastify 5 (a frontend statikus szervere), sima JavaScript JSDoc-kal, Node 22. Új dependency nincs.

**Spec:** `docs/superpowers/specs/2026-08-10-pwa-android-design.md`

## Global Constraints

- **Nincs automatizált teszt ebben a projektben, és ne is vezess be.** Se Vitest, se Testcontainers, se Playwright. Az ellenőrzés kézi és CLI-alapú; minden taskban konkrét parancsok és elvárt kimenetek szerepelnek. Egy task akkor kész, ha azok teljesülnek.
- **Nincs új npm dependency.** Sem `vite-plugin-pwa`, sem Workbox, sem `sharp`. A hoston nincs ImageMagick, librsvg vagy Python PIL sem, ezért az ikonokat a Node beépített `node:zlib` moduljával írjuk ki.
- **Sima JavaScript, TypeScript nélkül.** A típusokat JSDoc adja, a validációt Zod a határátlépéseknél. Kommentek és felhasználói szövegek magyarul.
- **Node >= 22** (`package.json` `engines`). `import.meta.dirname` használható, a `server.js` már ma is használja.
- **Prettier:** `singleQuote: true`, `trailingComma: "all"`, `printWidth: 100`, `semi: true`. A `npm run format:check` legyen zöld. **Figyelem:** a prettier a `.webmanifest` fájlt is formázza (JSON-ként), tehát a manifestet a lentebb megadott, pontos tördeléssel kell létrehozni.
- **Az eslint a node globálisokat és a `baseRules`-t csak `**/*.js`-re alkalmazza, `.mjs`-re nem.** Ezért az ikongenerátor kiterjesztése `.js` (a root `package.json` `"type": "module"`, tehát ESM így is).
- **A commit üzenetekben NINCS `Co-Authored-By` trailer.** Formátum: `feat:` / `fix:` / `docs:` + magyar leírás, a `git log` mintájára.
- **A `compose.yaml`-hoz ne nyúlj.** Van rajta commitolatlan felhasználói változás, és a `npm run format:check` emiatt már a munka kezdetén is jelez rá — ez nem a te dolgod, és ne is formázd meg.
- **Pontos színek** (a `apps/web/src/assets/theme.css`-ből): `--forint` világos `#2f6b4f`, `--paper` `#edeee6`, `--paper-raised` világos `#f7f7f2` / sötét `#222f28`, `--brass` `#a9832e`.

---

### Task 1: Ikonkészlet és generátor

Az ikonok minden további task előfeltétele: a manifest hivatkozik rájuk, és egy hiányzó ikonfájl a manifestet érvénytelenné teszi.

**Files:**

- Create: `scripts/generate-icons.js`
- Create: `apps/web/public/icons/icon-192.png` (generált)
- Create: `apps/web/public/icons/icon-512.png` (generált)
- Create: `apps/web/public/icons/icon-maskable-512.png` (generált)
- Test: nincs automatizált teszt — a 3. és 4. lépés parancsai az ellenőrzés

**Interfaces:**

- Consumes: semmit
- Produces: három PNG a `/icons/` útvonalon — `icon-192.png` (192×192), `icon-512.png` (512×512), `icon-maskable-512.png` (512×512). A Task 2 manifestje pontosan ezekre a nevekre hivatkozik.

- [ ] **Step 1: Hozd létre a generátor scriptet**

`scripts/generate-icons.js`:

```js
#!/usr/bin/env node
/**
 * A Fillér PWA ikonjait állítja elő: bankjegyzöld alapon papírszínű „F",
 * alatta rézszínű vonal. Se npm dependency, se rendszereszköz (ImageMagick,
 * librsvg) nem kell — a PNG-t maga írja ki a node:zlib deflate-jével.
 *
 * A generált fájlokat committeljük, tehát a build nem futtatja ezt a scriptet;
 * csak akkor kell újra lefuttatni, ha az ikon színén vagy formáján
 * változtatunk.
 *
 * Futtatás: node scripts/generate-icons.js
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(import.meta.dirname, '..', 'apps', 'web', 'public', 'icons');

const GREEN = [0x2f, 0x6b, 0x4f]; // --forint
const PAPER = [0xed, 0xee, 0xe6]; // --paper
const BRASS = [0xa9, 0x83, 0x2e]; // --brass

/** Sarokrádiusz a képméret százalékában. */
const CORNER_RADIUS_PCT = 22;

/**
 * A grafika a képméret százalékában (lásd a design spec 6. pontjának
 * táblázatát). Rajzolási sorrendben: a későbbi elem a korábbi fölé kerül.
 */
const SHAPES = [
  { color: PAPER, x0: 36, x1: 46, y0: 20, y1: 68 }, // az „F" szára
  { color: PAPER, x0: 36, x1: 68, y0: 20, y1: 29 }, // az „F" felső szára
  { color: PAPER, x0: 36, x1: 61, y0: 39, y1: 48 }, // az „F" középső szára
  { color: BRASS, x0: 32, x1: 68, y0: 74, y1: 79 }, // rézvonal
];

/** Élsimítás: ennyi × ennyi mintát veszünk pixelenként. */
const SUPERSAMPLE = 4;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

/**
 * @param {Buffer} buffer
 * @returns {number}
 */
function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

/**
 * Egy PNG chunk: hossz, típus, adat, CRC.
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * 8 bites RGBA pixelekből PNG fájl.
 * @param {number} size
 * @param {Buffer} rgba size * size * 4 byte
 * @returns {Buffer}
 */
function encodePng(size, rgba) {
  const stride = size * 4;
  // Minden képsor egy szűrő-byte-tal kezdődik; a 0 azt jelenti: nincs szűrés.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bitmélység
  ihdr[9] = 6; // színtípus: truecolor + alpha
  ihdr[10] = 0; // tömörítés: deflate
  ihdr[11] = 0; // szűrés: adaptív
  ihdr[12] = 0; // nincs interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Benne van-e a pont a lekerekített négyzetben? `radius === 0` esetén ez sima
 * négyzet-teszt.
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} radius
 * @returns {boolean}
 */
function insideRoundedRect(x, y, size, radius) {
  if (x < 0 || y < 0 || x > size || y > size) {
    return false;
  }
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Százalékos koordináta nagyítása a középpont (50%) körül.
 * @param {number} value
 * @param {number} scale
 * @returns {number}
 */
function scaleAbout(value, scale) {
  return 50 + (value - 50) * scale;
}

/**
 * Egyetlen mintavételi pont színe, vagy `null` ha átlátszó.
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} radius
 * @param {Array<{ color: number[], x0: number, x1: number, y0: number, y1: number }>} shapes
 * @returns {number[] | null}
 */
function colorAt(x, y, size, radius, shapes) {
  if (!insideRoundedRect(x, y, size, radius)) {
    return null;
  }
  // Visszafelé megyünk: az utolsó illeszkedő alakzat van legfelül.
  for (let i = shapes.length - 1; i >= 0; i -= 1) {
    const s = shapes[i];
    if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) {
      return s.color;
    }
  }
  return GREEN;
}

/**
 * @param {number} size
 * @param {{ rounded: boolean, scale: number }} options
 * @returns {Buffer} PNG
 */
function render(size, { rounded, scale }) {
  const radius = rounded ? (CORNER_RADIUS_PCT / 100) * size : 0;
  const shapes = SHAPES.map((s) => ({
    color: s.color,
    x0: (scaleAbout(s.x0, scale) / 100) * size,
    x1: (scaleAbout(s.x1, scale) / 100) * size,
    y0: (scaleAbout(s.y0, scale) / 100) * size,
    y1: (scaleAbout(s.y1, scale) / 100) * size,
  }));

  const rgba = Buffer.alloc(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let covered = 0;
      let r = 0;
      let g = 0;
      let b = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        const y = py + (sy + 0.5) / SUPERSAMPLE;
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = px + (sx + 0.5) / SUPERSAMPLE;
          const color = colorAt(x, y, size, radius, shapes);
          if (color !== null) {
            covered += 1;
            r += color[0];
            g += color[1];
            b += color[2];
          }
        }
      }

      if (covered === 0) {
        continue; // marad átlátszó
      }

      const offset = (py * size + px) * 4;
      rgba[offset] = Math.round(r / covered);
      rgba[offset + 1] = Math.round(g / covered);
      rgba[offset + 2] = Math.round(b / covered);
      rgba[offset + 3] = Math.round((covered / samples) * 255);
    }
  }

  return encodePng(size, rgba);
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 1 },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 1 },
  // Maskable: teljes kitöltésű négyzet (a launcher vágja a saját formájára),
  // a grafika 0,75×-re húzva, hogy a biztonságos zónán belül maradjon.
  { file: 'icon-maskable-512.png', size: 512, rounded: false, scale: 0.75 },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const target of TARGETS) {
  const png = render(target.size, { rounded: target.rounded, scale: target.scale });
  const outPath = path.join(OUT_DIR, target.file);
  writeFileSync(outPath, png);
  console.log(`${target.file} — ${target.size}×${target.size}, ${png.length} byte`);
}
```

- [ ] **Step 2: Futtasd le a generátort**

Run: `node scripts/generate-icons.js`

Elvárt kimenet (a byte-méretek pár byte-tal eltérhetnek a zlib verziójától):

```
icon-192.png — 192×192, 1256 byte
icon-512.png — 512×512, 4087 byte
icon-maskable-512.png — 512×512, 2414 byte
```

- [ ] **Step 3: Ellenőrizd, hogy érvényes PNG-k készültek**

Run: `file apps/web/public/icons/*.png`

Elvárt kimenet:

```
apps/web/public/icons/icon-192.png:          PNG image data, 192 x 192, 8-bit/color RGBA, non-interlaced
apps/web/public/icons/icon-512.png:          PNG image data, 512 x 512, 8-bit/color RGBA, non-interlaced
apps/web/public/icons/icon-maskable-512.png: PNG image data, 512 x 512, 8-bit/color RGBA, non-interlaced
```

Ha a `file` bármelyikre nem PNG-t ír, a chunk-írás sérült — ne menj tovább.

- [ ] **Step 4: Nézd meg szemmel is**

Nyisd meg az `apps/web/public/icons/icon-512.png`-t egy képmegjelenítőben vagy böngészőben (`file:///` útvonalon is jó).

Elvárt: bankjegyzöld, lekerekített sarkú négyzet, benne bal-középen egy világos, papírszínű „F", alatta egy vízszintes rézszínű vonal. A sarkok átlátszók (nem fehérek, nem feketék). A `icon-maskable-512.png` ugyanez, de éles sarkú, teljesen kitöltött négyzet, és a grafika kisebb, jobban középen.

A geometriát a design spec 6. pontja adja; tervezéskor mérve a maskable grafika legtávolabbi pontja a középponttól 26,3%-ra van, a megengedett 40% helyett — tehát bármelyik launcher-forma sértetlenül hagyja.

- [ ] **Step 5: Lint és formázás**

Run: `npx eslint scripts/generate-icons.js && npx prettier --check scripts/generate-icons.js`

Elvárt: mindkettő hibátlan (a PNG-ket a prettier az `--ignore-unknown` miatt kihagyja).

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-icons.js apps/web/public/icons
git commit -m "feat: PWA ikonkészlet és dependency nélküli generátor script"
```

---

### Task 2: Manifest, favicon és a status bar színe

Ez a task önmagában is működő eredményt ad: a manifest után a főképernyőre helyezett app már `standalone` módban, böngészősáv nélkül indul.

**Files:**

- Create: `apps/web/public/manifest.webmanifest`
- Modify: `apps/web/index.html` (a `<head>` tartalma)
- Modify: `apps/web/src/utils/theme.js` (új `THEME_COLORS` konstans és `applyThemeColor` függvény, hívás az `initTheme`-ből és a `toggleTheme`-ből)
- Test: nincs automatizált teszt — a 4–6. lépés parancsai az ellenőrzés

**Interfaces:**

- Consumes: a Task 1 három ikonja a `/icons/` útvonalon
- Produces: egy `<meta name="theme-color">` elem az `index.html`-ben, amit a `theme.js` `applyThemeColor()` függvénye `document.querySelector('meta[name="theme-color"]')`-lel keres meg és a `content` attribútumát írja. A `theme.js` exportált felülete nem változik: `initTheme()`, `getTheme()`, `toggleTheme()` marad, változatlan szignatúrával — az `applyThemeColor` modulon belüli, nem exportált.

- [ ] **Step 1: Hozd létre a manifestet**

`apps/web/public/manifest.webmanifest` — **pontosan ezzel a tördeléssel** (a prettier `.webmanifest`-et is ellenőriz, és ez a kanonikus kimenete):

```json
{
  "id": "/",
  "name": "Fillér",
  "short_name": "Fillér",
  "description": "Közös költségek elszámolása",
  "lang": "hu",
  "dir": "ltr",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#edeee6",
  "theme_color": "#f7f7f2",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

`orientation` szándékosan nincs benne: a felület reszponzív, a fekvő tájolás működik, egy portré-zár csak elvenne egy ma meglévő képességet.

- [ ] **Step 2: Kösd be az `index.html`-be**

`apps/web/index.html` teljes új tartalma:

```html
<!doctype html>
<html lang="hu">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="/icons/icon-192.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <!--
      A status bar színe standalone (telepített) módban. Itt a világos téma
      --paper-raised értéke áll, ami a JS betöltése előtti pillanatot fedi;
      onnantól a src/utils/theme.js tartja szinkronban az aktív témával.
    -->
    <meta name="theme-color" content="#f7f7f2" />
    <title>Fillér</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 3: A `theme.js` tartsa szinkronban a status bar színét**

`apps/web/src/utils/theme.js` teljes új tartalma:

```js
const STORAGE_KEY = 'filler-theme';

/**
 * A status bar színe telepített appban (standalone mód): a --paper-raised két
 * értéke. A <meta name="theme-color"> tartalmát ehhez igazítjuk, hogy a status
 * bar és az App.vue fejléce egy színű legyen.
 */
const THEME_COLORS = { light: '#f7f7f2', dark: '#222f28' };

/**
 * Az induláskor tárolt preferenciát azonnal alkalmazza, mielőtt az app
 * felrenderelődik, hogy ne legyen "villanás" a rossz témával.
 */
export function initTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.dataset.theme = stored;
  }
  applyThemeColor();
}

/**
 * @returns {'light' | 'dark'}
 */
export function getTheme() {
  if (document.documentElement.dataset.theme === 'dark') {
    return 'dark';
  }
  if (document.documentElement.dataset.theme === 'light') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * A <meta name="theme-color"> tartalmát az aktív témához igazítja. A meta a
 * betöltéskor a világos értéket tartalmazza (lásd index.html); ez a függvény
 * onnantól tartja szinkronban.
 */
function applyThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', THEME_COLORS[getTheme()]);
  }
}

/**
 * @returns {'light' | 'dark'} az új, aktív téma
 */
export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(STORAGE_KEY, next);
  applyThemeColor();
  return next;
}
```

- [ ] **Step 4: Build, lint, formázás**

Run: `npm run build --workspace @filler/web && npx eslint apps/web && npx prettier --check apps/web/index.html apps/web/public/manifest.webmanifest apps/web/src/utils/theme.js`

Elvárt: mindhárom hibátlanul lefut. Ha a prettier a manifestre jelez, futtasd rá a `--write`-ot és nézd meg a diffet — a fent megadott tördelés a kanonikus.

- [ ] **Step 5: Ellenőrizd, hogy a manifest és az ikonok a build kimenetébe kerültek**

Run: `ls apps/web/dist apps/web/dist/icons`

Elvárt: a `dist/` gyökerében ott van a `manifest.webmanifest` és az `index.html`, a `dist/icons/` alatt pedig mindhárom PNG. A Vite a `public/` tartalmát változatlanul másolja — ha nincs ott, akkor a fájl nem a `public/` alá került.

- [ ] **Step 6: Ellenőrizd a kiszolgálást**

Run:

```bash
docker compose up --build -d
curl -sI http://localhost:8090/manifest.webmanifest
curl -sI http://localhost:8090/icons/icon-512.png
```

Elvárt: mindkettő `200`, a manifest `content-type`-ja `application/manifest+json`, az ikoné `image/png`.

Ezután Chrome DevTools → Application → Manifest: nincs hibajelzés, a név „Fillér", mindhárom ikon betöltődik, és a maskable előnézet nem vágja le a grafikát.

- [ ] **Step 7: Commit**

```bash
git add apps/web/public/manifest.webmanifest apps/web/index.html apps/web/src/utils/theme.js
git commit -m "feat: web app manifest és a témát követő status bar szín"
```

---

### Task 3: Service worker és a frissítést biztosító cache fejlécek

Ez a két változás egy taskba tartozik, mert együtt adják a „telepíthető, de deploy után nem ragad be" eredményt, és csak együtt ellenőrizhetők.

**Files:**

- Create: `apps/web/public/sw.js`
- Modify: `apps/web/src/main.js` (regisztráció a fájl végén, az `app.mount` után)
- Modify: `apps/web/server.js` (a `fastifyStatic` regisztrációja `setHeaders`-t kap)
- Test: nincs automatizált teszt — a 4–7. lépés parancsai az ellenőrzés

**Interfaces:**

- Consumes: a Task 2 `index.html`-je és manifestje (a service worker a `/` navigációs választ cache-eli, a manifest telepíthetősége pedig ettől a service workertől lesz biztos)
- Produces: egy `/sw.js` a `dist/` gyökerében, `filler-v1` nevű cache-szel. A `main.js` `navigator.serviceWorker.register('/sw.js')`-szel regisztrálja. Későbbi verzióváltásnál a `CACHE` konstans értékét kell növelni (`filler-v2`), az `activate` hook a régit magától törli.

- [ ] **Step 1: Hozd létre a service workert**

`apps/web/public/sw.js`:

```js
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
```

Figyelj arra, hogy a `response.ok` ellenőrzések benne maradjanak: az SPA fallback (`setNotFoundHandler`) 404-es státusszal is adhat vissza `index.html`-t, és egy ilyen választ nem szabad a navigációs fallback helyére cache-elni.

- [ ] **Step 2: Regisztráld a service workert**

`apps/web/src/main.js` — a meglévő tartalom végére, az `app.mount('#app');` után:

```js
// Service worker csak produkciós buildben: fejlesztői módban összeakadna a
// Vite HMR-jével. A regisztráció a load esemény után fut, hogy ne versenyezzen
// az app első renderelésével.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('A service worker regisztrációja nem sikerült:', error);
    });
  });
}
```

- [ ] **Step 3: Cache fejlécek a nem hashelt fájlokra**

`apps/web/server.js` — cseréld le ezt az egy sort:

```js
await app.register(fastifyStatic, { root: path.join(import.meta.dirname, 'dist') });
```

erre:

```js
// A hashelt nevű assetek (/assets/*) hosszan cache-elhetők, a nem hashelt
// fájlok viszont nem: különben a böngésző HTTP cache-e ugyanúgy beragadt
// frontendet szolgálna ki, mint egy elrontott service worker.
await app.register(fastifyStatic, {
  root: path.join(import.meta.dirname, 'dist'),
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
});
```

A `setNotFoundHandler`-hez ne nyúlj: a `setHeaders` az `@fastify/static` által kiszolgált fájlokra vonatkozik, a `reply.sendFile('index.html')`-re is. A 6. lépés ellenőrzi, hogy tényleg így van-e.

- [ ] **Step 4: Build, lint, formázás**

Run: `npm run build --workspace @filler/web && npx eslint . && npm run format:check`

Elvárt: a build és az eslint hibátlan. A `format:check` **egyetlen** megengedett kifogása a `compose.yaml` (commitolatlan felhasználói változás, lásd a Global Constraints-et) — bármi más fájlra jelez, azt javítsd `npx prettier --write <fájl>`-lal.

- [ ] **Step 5: Indítsd újra és ellenőrizd a fejléceket**

Run:

```bash
docker compose up --build -d
curl -sI http://localhost:8090/sw.js | grep -i '^cache-control'
curl -sI http://localhost:8090/ | grep -i '^cache-control'
curl -sI http://localhost:8090/events | grep -i -e '^HTTP' -e '^cache-control'
```

Elvárt: az első kettő `cache-control: no-cache`. A harmadik (SPA fallback egy nem létező statikus útvonalra) is tartalmazzon `cache-control: no-cache`-t. Ha a harmadikon **nem** jelenik meg, akkor a `setHeaders` nem fut le a `sendFile`-ra — ebben az esetben, és csak ebben, írd át a `setNotFoundHandler`-t:

```js
app.setNotFoundHandler((_request, reply) => {
  reply.header('Cache-Control', 'no-cache');
  reply.sendFile('index.html');
});
```

majd futtasd újra ezt a lépést.

- [ ] **Step 6: Ellenőrizd, hogy egy hashelt asset NEM kap no-cache-t**

Run:

```bash
ASSET=$(ls apps/web/dist/assets | head -1)
curl -sI "http://localhost:8090/assets/$ASSET" | grep -i -e '^HTTP' -e '^cache-control'
```

Elvárt: `200`, és **nincs** `no-cache` — ezek maradnak hosszan cache-elhetők, ez adja a gyors indulást.

- [ ] **Step 7: Ellenőrizd a service worker viselkedését a böngészőben**

Chrome DevTools a `http://localhost:8090` oldalon:

1. Application → Service Workers: `activated and is running`, egyetlen regisztráció, a forrás `/sw.js`.
2. Application → Cache Storage: **csak** `filler-v1` létezik. Nyisd ki, és ellenőrizd, hogy **nincs benne `/api/` kezdetű bejegyzés** — ez a legfontosabb ellenőrzés ebben a taskban.
3. Töltsd újra az oldalt, majd Network fül: a `/assets/*` kérések a service workerből jönnek (`(ServiceWorker)` a Size oszlopban), az `/api/*` kérések viszont **nem**.
4. Nyisd meg egy esemény kiadáslistáját, és a Network fülön az `EventStream`-nél nézd meg, hogy a `/api/events/<id>/stream` kérés nyitva marad és érkeznek rá üzenetek.
5. Lighthouse fül → „Progressive Web App" / „Installable" ellenőrzés lefuttatása: a telepíthetőségre nem jelez hibát. (A többi Lighthouse-kategória pontszáma itt nem cél.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/public/sw.js apps/web/src/main.js apps/web/server.js
git commit -m "feat: minimális service worker és frissítésbiztos cache fejlécek"
```

---

### Task 4: README és teljes körű ellenőrzés valódi eszközön

**Files:**

- Modify: `README.md` (új szakasz a „Fejlesztői mód" után)
- Test: nincs automatizált teszt — a 2–5. lépés a végső, valódi eszközön végzett ellenőrzés

**Interfaces:**

- Consumes: a Task 1–3 teljes eredménye
- Produces: semmit, amire kód épül

- [ ] **Step 1: Dokumentáld a README-ben**

`README.md` — szúrd be új szakaszként a „Fejlesztői mód (hot reload)" szakasz után:

````markdown
## Telepítés Androidra

Az app telepíthető PWA: Chrome-ban megnyitva a menüből („App telepítése" vagy
„Hozzáadás a főképernyőhöz") kihelyezhető a főképernyőre, és onnan saját
ikonnal, böngészősáv nélkül, teljes képernyőn indul. Nincs telepítőfájl és nem
kell Play Store.

Amit ez nem ad: offline működés nincs — a statikus héj gyorsítótárból
betöltődik, de adatkapcsolat nélkül a lista üres marad.

Az ikonokat a `scripts/generate-icons.js` állítja elő, dependency nélkül. A
generált PNG-k committolva vannak, tehát a build nem futtatja a scriptet; ha az
ikon színén vagy formáján változtatsz, futtasd újra:

```sh
node scripts/generate-icons.js
```

Fontos: az Android a telepítéskori ikont eltárolja, tehát egy ikoncsere csak
újratelepítés után látszik a főképernyőn.
````

- [ ] **Step 2: Deploy-teszt — a frissítés nem ragad be**

Ez a legfontosabb regressziós ellenőrzés. Módosíts valamit jól láthatóan a felületen (például az `App.vue` fejlécében a címet ideiglenesen „Fillér TESZT"-re), majd:

```bash
npm run build --workspace @filler/web
docker compose up --build -d
```

Töltsd újra a `http://localhost:8090`-t (nem hard reloaddal, sima újratöltéssel). Elvárt: a „TESZT" szöveg megjelenik. Ha nem, a service worker beragadt — a `navigationStrategy` network-first ága hibás.

Ezután **állítsd vissza** a módosítást, és építsd újra.

- [ ] **Step 3: Élő frissítés regresszió**

Nyisd meg ugyanannak az eseménynek a kiadáslistáját két böngészőablakban (vagy két eszközön). Vegyél fel egy kiadást az egyikben.

Elvárt: a másikban oldalfrissítés nélkül megjelenik, és a toolbar kapcsolatjelzője aktív marad. Ez bizonyítja, hogy a service worker nem vágta el az SSE streamet.

- [ ] **Step 4: Telepítés és használat telefonon**

A `bill.p1ckle.xyz` címen (HTTPS kell, a `localhost` csak fejlesztéshez jó):

1. Nyisd meg Chrome-ban → megjelenik az „App telepítése" felajánlás, vagy elérhető a menüből.
2. Telepítés után a főképernyőn a zöld „F" ikon látszik, a launcher formájára vágva, „Fillér" névvel.
3. Indítsd el: nincs címsáv és nincs böngésző-eszköztár.
4. A status bar színe megegyezik az app fejlécével — nézd meg világos és sötét rendszertémával, és a beépített témaváltóval kézzel átváltva is.
5. Jelentkezz be, vegyél fel egy kiadást, szerkeszd, töröld. Elvárt: minden változatlanul működik (a session cookie ugyanazon az originon marad).
6. Fordítsd el a telefont fekvőbe: az app nem akad ki, a szélesebb elrendezésre vált.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: androidos telepítés és ikongenerálás a README-ben"
```

---

## Amit ez a terv szándékosan nem tesz

Ha implementálás közben ezek bármelyike csábítónak tűnik, ne tedd — mindegyik tudatos döntés a specből:

- **Nem ad offline írást.** A service worker csak statikus fájlokat cache-el.
- **Nem tesz `skipWaiting`-et a service workerbe.** Az azonnali átvétel kicserélhetné a futó oldal alól a chunkokat.
- **Nem cache-eli az `/api/*` hívásokat**, semmilyen stratégiával.
- **Nem vezet be `vite-plugin-pwa`-t vagy Workboxot**, és semmilyen más dependencyt.
- **Nem épít `beforeinstallprompt`-ra saját „Telepítsd az appot!" sávot.**
- **Nem ad iOS-specifikus metaadatokat** (`apple-touch-icon`, `apple-mobile-web-app-capable`).
- **Nem javítja az SPA fallback 404-es státuszkódját** (ha kiderül, hogy az). Ma is így működik, és a `response.ok` ellenőrzések miatt a service worker helyesen viselkedik mellette.
- **Nem nyúl a `compose.yaml`-hoz, a backendhez és az adatmodellhez.**
