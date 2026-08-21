/**
 * Ellenőrzi, hogy a natív appba szánt webes build AZZAL a szervercímmel
 * készült-e, amit az APK-hoz szánunk.
 *
 * Miért kell ez. A natív app helyi fájlokról töltődik a WebView-ba, tehát a
 * relatív `/api` útvonal a WebView saját origójára (`https://localhost`)
 * mutat, ahol nincs API: a becsomagolt kiszolgáló ilyenkor az `index.html`-t
 * adja vissza `200`-cal, a kliens a nem JSON törzsből `null`-t csinál, és a
 * válasz-séma azon bukik el. A felhasználó ebből annyit lát, hogy „A szerver
 * váratlan választ adott a bejelentkezésre" — vagyis a tünet nagyon messze
 * esik a hibától, és semmi nem jelzi, hogy a BUILD a rossz.
 *
 * És miért csendes a tévedés. A sima `npm run build` + `cap sync` pontosan
 * ugyanúgy LÁTSZIK sikeresnek, mint a helyes út: a build zöld, a bundle
 * friss, az APK aláírása érvényes. Egyszer már így szállt ki egy kész,
 * használhatatlan APK. Ez az ellenőrzés csak azt a rést zárja be, hogy a
 * tévedés csendes maradhat.
 *
 * Ezért NEM azt vizsgáljuk, hogy „van-e egyáltalán absztolút URL a
 * bundle-ben" — abban a Vue, a decimal.js és az SVG névterek URL-jei is benne
 * vannak, tehát az az ellenőrzés mindig átmenne. A várt szervercím literálját
 * keressük, amit a gyökér `build:mobile` scriptje ad meg.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * Tiszta kilépés: a dobott hiba stack trace-e elnyomná az üzenetet, pedig
 * ennek az egész scriptnek az üzenet AZ értéke.
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`\nAPK-build ellenőrzés — HIBA\n\n${message}\n`);
  process.exit(1);
}

const ASSETS_DIR = fileURLToPath(new URL('../../web/dist/assets/', import.meta.url));

const expectedBase = process.env.MOBILE_API_BASE_URL;
if (!expectedBase) {
  fail(
    'A MOBILE_API_BASE_URL nincs beállítva, tehát ez a sync nem az APK-hoz\n' +
      'szánt build után fut. Ne a `cap sync`-et hívd közvetlenül — a gyökérből:\n' +
      '  npm run build:mobile\n' +
      '(a szervercím a MOBILE_API_BASE_URL környezeti változóval írható át)',
  );
}

let files;
try {
  files = await readdir(ASSETS_DIR);
} catch {
  fail('Nincs webes build (apps/web/dist/assets). Futtasd a gyökérből: npm run build:mobile');
}

const bundles = files.filter((name) => name.startsWith('index-') && name.endsWith('.js'));
if (bundles.length === 0) {
  fail('A webes buildben nincs index-*.js bundle. Futtasd a gyökérből: npm run build:mobile');
}

const contents = await Promise.all(bundles.map((name) => readFile(join(ASSETS_DIR, name), 'utf8')));

// A `baseUrl.js` a normalizált API-bázist fordítási időben literálként süti be,
// és a minifikálás a sztring-literálokat érintetlenül hagyja.
if (!contents.some((source) => source.includes(expectedBase))) {
  fail(
    `A webes build nem a(z) "${expectedBase}" szervercímmel készült, ezért a natív\n` +
      'appban nem érné el az API-t. Valószínűleg egy sima `npm run build` fut le\n' +
      'előtte. A gyökérből:\n' +
      '  npm run build:mobile',
  );
}

console.log(`A webes build a(z) "${expectedBase}" szervercímmel készült — mehet a cap sync.`);
