# Androidos appszerű megjelenés (PWA alapok) — design

**Dátum:** 2026-08-10
**Állapot:** elfogadott, implementációra vár

## 1. A cél

A Fillért telefonon böngészőben kell megnyitni: cím beírása vagy könyvjelző,
majd a tartalom fölött ott marad a böngésző címsávja és eszköztára. Egy közös
utazás közben, ahol naponta több kiadás kerül fel, ez érzékelhető súrlódás — és
a képernyő tetején-alján elvesző hely pont a kiadáslistából vesz el.

A cél: a főképernyőn saját ikonnal induló, böngészőelemek nélkül,
teljes képernyőn megjelenő alkalmazás. A frontend már ma mobilra
optimalizált (kártyás kiadásnézet, modal alapú felvétel), tehát nem a
felület átalakításáról van szó, hanem arról, hogy a meglévő felület
alkalmazásként legyen becsomagolva.

## 2. Hatókör

**Benne van:**

- Web app manifest, hogy az Android telepíthető alkalmazásként ismerje fel az
  appot, és `standalone` módban — böngészősáv nélkül — indítsa.
- Ikonkészlet (192, 512, és egy 512-es _maskable_ változat az Android adaptív,
  körbevágott ikonjához), és egy hozzá tartozó, dependency nélküli generátor
  script, hogy az ikon később átszínezhető és reprodukálható legyen.
- Minimális service worker: a telepíthetőség biztosításához, illetve az
  induláshoz szükséges statikus fájlok gyorsítótárazásához.
- A status bar színének illesztése az app fejlécéhez, világos és sötét témában
  is.
- `Cache-Control` beállítása a `web` service Fastify szerverén azokra a
  fájlokra, amelyek nem hashelt nevűek, hogy egy deploy után a frissítés le
  tudjon jönni.

**Nincs benne (tudatos kihagyás):**

- **Telepítőfájl (`.apk`/`.aab`), Play Store.** Külön projekt: aláírókulcs,
  Digital Asset Links a domainen, wrapper-projekt, terjesztés. A telepíthető
  PWA ennek amúgy is az előfeltétele, tehát ez a spec az első lépése annak is,
  ha később kell.
- **Offline működés.** A service worker itt kizárólag statikus fájlokat
  gyorsítótáraz. Kiadást offline rögzíteni továbbra sem lehet: ahhoz írási
  outbox, szinkronizálás és konfliktuskezelés kell, ami önmagában nagyobb
  munka, mint ez az egész spec, és semmi köze az Androidhoz.
- **Natív funkciók** (kamera a bizonylathoz, push értesítés, biometrikus
  belépés). A bizonylatfotó ráadásul nem csomagolási kérdés: backend
  fájltárolást és mellékletmodellt igényel, tehát termékfeature.
- **iOS támogatás.** Az `apple-touch-icon` és a hozzá tartozó metaadatok
  kimaradnak; a cél Android. Később kis kiegészítéssel pótolható.
- **Telepítést reklámozó saját UI** („Telepítsd az appot!" sáv,
  `beforeinstallprompt` kezelés). A Chrome saját felajánlása elég egy
  néhányfős, zárt körnek.

## 3. Miért PWA, és miért nem natív csomagolás

Négy út volt:

**A Csak PWA manifest + service worker (ez lett kiválasztva).** A cél —
főképernyő-ikon és böngészőelemek nélküli indulás — pontosan ez, semmi több.
Nincs új dependency, nincs második build-lánc, nincs terjesztendő fájl, és
minden `docker compose up --build` után mindenki azonnal az új verziót látja.

**B TWA (Trusted Web Activity, Bubblewrap).** Igazi telepíthető `.apk`-t ad,
ugyanezen az originon futva, tehát a session cookie is érintetlen maradna.
Csak épp a kért célhoz nem szükséges, viszont aláírókulcs-kezelést,
`assetlinks.json` kiszolgálást és egy generált Android projekt fenntartását
hozza magával. Ha később mégis kell, ez a spec az előfeltétele.

**C Capacitor.** Natív WebView shell bundlelt assetekkel. Két érdemi költsége
van. Egy: a WebView originja `https://localhost` lenne, így az `/api` hívások
cross-origin-ná válnak — a mostani same-origin session cookie
(`credentials: 'include'`, `SameSite`) átépítést kívánna CORS-ra és
`SameSite=None`-ra vagy bearer tokenre, ami rontja a jelenlegi CSRF-pozíciót.
Kettő: minden frontend-változás után új telepítőt kell építeni és mindenkinél
újratelepíteni. Egy ikonért ez aránytalan.

**D Natív vagy Flutter kliens a meglévő API-ra.** A legnagyobb munka, és a
teljes felületet duplikálná — miközben a meglévő Vue felület mobilon már jó.

## 4. Architektúra

Minden változás az `apps/web` alatt van, egyetlen kivétellel (az ikongenerátor
script a `scripts/` alatt). **A backend és az adatmodell érintetlen.**

| Fájl                                          | Állapot       | Mi történik                                               |
| --------------------------------------------- | ------------- | --------------------------------------------------------- |
| `apps/web/public/manifest.webmanifest`        | új            | app metaadatok és ikonhivatkozások                        |
| `apps/web/public/icons/icon-192.png`          | új (generált) | launcher ikon                                             |
| `apps/web/public/icons/icon-512.png`          | új (generált) | nagy felbontású ikon, splash                              |
| `apps/web/public/icons/icon-maskable-512.png` | új (generált) | Android adaptív ikon                                      |
| `apps/web/public/sw.js`                       | új            | service worker                                            |
| `scripts/generate-icons.js`                   | új            | az ikonokat előállító script                              |
| `apps/web/index.html`                         | módosul       | manifest link, favicon, `theme-color` meta                |
| `apps/web/src/main.js`                        | módosul       | service worker regisztráció                               |
| `apps/web/src/utils/theme.js`                 | módosul       | a `theme-color` meta követi a témát                       |
| `apps/web/server.js`                          | módosul       | `Cache-Control` a nem hashelt fájlokra                    |
| `README.md`                                   | módosul       | rövid szakasz a telepítésről és az ikon újragenerálásáról |

A `public/` könyvtár tartalmát a Vite build változatlanul bemásolja a
`dist/`-be, amit a `server.js` `@fastify/static`-kal már ma kiszolgál — tehát
sem új build lépés, sem új Docker-réteg nem kell. Fejlesztői módban a Vite dev
szerver ugyanezeket a fájlokat szolgálja ki a gyökérből.

## 5. A manifest

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
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    {
      "src": "/icons/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

Néhány érték magyarázata:

- **`display: standalone`** — ez adja a böngészősáv nélküli indulást. Nem
  `fullscreen`: a status bar (óra, akkumulátor) maradjon látható, egy
  költségnyilvántartónál nincs okunk elrejteni.
- **`theme_color: #f7f7f2`** — ez a `--paper-raised` világos értéke, vagyis az
  `App.vue` `.app-nav` fejlécének háttere. Így a status bar és a fejléc
  összeolvad, ami az „ez egy app" érzés nagy részét adja. Szándékosan **nem** a
  bankjegyzöld: a zöld az ikon identitása, a fejléc viszont papírszínű, és egy
  zöld status bar elvágná a fejlécet.
- **`background_color: #edeee6`** — a `--paper`; ezt használja az Android az
  indítási splash hátteréhez, amin a zöld ikon jól elválik. A manifest
  `background_color` nem lehet témafüggő, tehát sötét módban ez egy rövid
  világos felvillanás az indulásnál. Elfogadjuk; az alternatíva (zöld splash)
  viszont a zöld hátterű ikont olvasztaná bele a háttérbe.
- **`start_url: /`** — az eseménylista. Lejárt session esetén a router a
  megszokott módon a login képernyőre irányít, ez nem igényel külön kezelést.
- **`orientation` nincs beállítva** — a felület reszponzív, fekvő tájolásban a
  szélesebb elrendezésre vált, ami működik. Egy portré-zár elvenne egy ma
  meglévő képességet, cserébe semmit nem adna.

## 6. Ikonok

**Motívum:** bankjegyzöld (`#2f6b4f`) alap, rajta papírszínű (`#edeee6`) „F",
alatta rézszínű (`#a9832e`) vonal — a pénztárkönyv-vizualitás sűrített
változata, a `theme.css`-ben már meglévő színekből. Kis méretben is olvasható,
mert egyetlen betű és egy vonal.

**Geometria** (a méret százalékában, tehát minden felbontásban azonos):

| Elem                                            | x     | y     | szín      |
| ----------------------------------------------- | ----- | ----- | --------- |
| háttér (lekerekített négyzet, 22% sarokrádiusz) | 0–100 | 0–100 | `#2f6b4f` |
| „F" szára                                       | 36–46 | 20–68 | `#edeee6` |
| „F" felső szára                                 | 36–68 | 20–29 | `#edeee6` |
| „F" középső szára                               | 36–61 | 39–48 | `#edeee6` |
| rézvonal                                        | 32–68 | 74–79 | `#a9832e` |

A lekerekített sarkokon kívüli terület átlátszó, tehát a `purpose: "any"` ikon
a saját formáját hozza magával — ahol a launcher nem alkalmaz maszkot, ott is
lekerekített négyzetként jelenik meg, nem éles sarkú kockaként.

A **maskable** változat ugyanez, két eltéréssel: a háttér teljes kitöltésű
négyzet lekerekítés nélkül (a launcher vágja a saját formájára), a grafika
pedig a középpont körül 0,75× méretre húzva, hogy a biztonságos zónán (a
képméret 80%-át kitevő középső kör) belül maradjon. A fenti geometriával
skálázva a grafika legtávolabbi pontja a középponttól ~26%-ra van, a
megengedett 40%-hoz képest — tehát bármely launcher-forma esetén sértetlen.

**Generálás:** `scripts/generate-icons.js`, futtatása `node
scripts/generate-icons.js`. Nincs se új npm dependency, se rendszereszköz
(a hoston nincs sem ImageMagick, sem librsvg, sem PIL): a script kézzel írja
ki a PNG-t a Node beépített `node:zlib` moduljával (IHDR/IDAT/IEND chunkok
CRC32-vel), és 4× felülminta-vételezéssel simítja az éleket. Az előállított
PNG-ket committeljük, tehát a szokásos build nem futtatja a scriptet — az
csak akkor kell, ha az ikon színén vagy formáján változtatunk.

## 7. Service worker

Ez a spec egyetlen érdemi kockázata: egy rosszul megírt service worker
**deploy után is a régi frontendet szolgálja ki**, és ezt a felhasználó nem
tudja megkerülni egy sima újratöltéssel. Ezért a stratégia szándékosan szűk.

**Miért kell egyáltalán?** A Chrome telepíthetőségi feltételei között
hagyományosan szerepel egy `fetch` eseményt kezelő service worker. Nem biztos,
hogy a jelenlegi Chrome-verzió még megköveteli, de mivel egy minimális SW
olcsó, ezzel a telepíthetőség a Chrome-változatoktól függetlenül biztos —
és mellékesen az indítás is gyorsul.

**Kezelési szabályok**, ebben a sorrendben:

| Kérés                             | Kezelés                            | Miért                                                                   |
| --------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| nem `GET`                         | érintetlenül átmegy                | írásoknak semmi keresnivalója cache-ben                                 |
| más origin                        | érintetlenül átmegy                | az árfolyam-API a backendről hívódik, de a szabály védelemként megmarad |
| `/api/*`                          | **érintetlenül átmegy**            | ez a legfontosabb szabály (lásd alább)                                  |
| navigáció (`mode === 'navigate'`) | network-first, cache csak fallback | egy deploy azonnal látszik                                              |
| `/assets/*`                       | cache-first                        | a Vite hasht tesz a fájlnévbe, tehát a tartalom nem avulhat             |
| minden más (manifest, ikonok)     | érintetlenül átmegy                | a HTTP cache elég, nem érdemes SW-logikát rátenni                       |

Az `/api/*` kihagyása azért kiemelten fontos, mert az élő frissítés egy
órákig nyitva tartott SSE streamen működik (`/api/events/:id/stream`, 20
másodperces heartbeatekkel). Egy cache-elési kísérlet — vagy akár csak a
válasz átvezetése egy `Response`-klónon — elvágná a streamet, és az élő
frissítés némán elhalna. Ugyanez a szabály védi a bejelentkezést is: a session
cookie-val hitelesített válaszok nem kerülhetnek osztott cache-be.

**Verziókezelés:**

- Egyetlen, verziózott cache-név (`filler-v1`); az `activate` esemény minden
  más nevű cache-t töröl.
- **Nincs `skipWaiting` és nincs `clients.claim`.** Egy új service worker a
  következő indításnál veszi át a szerepet. Ha azonnal átvenné, kicserélhetné
  a futó oldal alól a chunkokat, és a lusta betöltésű route-ok elhasalnának.
- **Nincs precache-lista.** Csak a `/` kerül be telepítéskor (a navigációs
  fallbackhez), minden más futásidőben, kérés alapján. Így nem kell a build
  hashelt fájlneveit a service workerbe injektálni, tehát nem kell sem
  `vite-plugin-pwa`, sem Workbox — az egész kb. 40 sor sima JavaScript, a
  projekt „minimál dependency" elvének megfelelően.

**Regisztráció** (`src/main.js`): csak `import.meta.env.PROD` esetén, a `load`
esemény után. Fejlesztői módban a service worker összeakadna a Vite HMR-jével,
ezért ott nem regisztrálódik.

## 8. Cache-Control a web szerveren

A hashelt nevű fájlok (`/assets/*`) hosszan cache-elhetők, a nem hasheltek
viszont nem — különben a böngésző HTTP cache-e ugyanazt a beragadást okozná,
amit a service workernél elkerültünk. A `server.js` `@fastify/static`
regisztrációja `setHeaders`-t kap, ami `Cache-Control: no-cache`-t tesz az
`index.html`-re és az `sw.js`-re, és ugyanez a fejléc kerül az SPA fallback
(`setNotFoundHandler`) válaszára is.

A `no-cache` nem azt jelenti, hogy „ne tárold", hanem hogy „használat előtt
ellenőrizd" — tehát a válasz továbbra is lehet 304, csak nem szolgálható ki
ellenőrzés nélkül.

## 9. Status bar és téma

Az `index.html` egyetlen `<meta name="theme-color">` elemet kap, a világos
érték (`#f7f7f2`) statikus tartalommal — ez fedi a JS betöltése előtti rövid
pillanatot. Onnantól a `utils/theme.js` tartja szinkronban:

- `initTheme()` — ami a saját dokumentációja szerint már ma is renderelés előtt
  fut, hogy ne legyen témavillanás — a `getTheme()` eredménye alapján beállítja
  a meta tartalmát (`#f7f7f2` világosban, `#222f28` sötétben, azaz a
  `--paper-raised` két értéke).
- `toggleTheme()` — a kézi váltásnál ugyanezt frissíti, hogy a status bar
  azonnal kövesse a fejlécet.

A rendszertéma menet közbeni váltására nem reagálunk élőben (a következő
indításnál érvényesül). Ez megegyezik az app mostani viselkedésével, ami szintén
nem figyel `matchMedia` változást — nem vezetünk be új mintát egyetlen
metaadatért.

## 10. Ellenőrzés

A projektben nincs automatizált teszt, tehát az ellenőrzés kézi, de konkrét
lépésekből áll:

**Build és kiszolgálás:**

1. `npm run build --workspace @filler/web` — hiba nélkül lefut.
2. `npm run lint` és `npm run format:check` — zöld.
3. `docker compose up --build`, majd:
   - `curl -sI http://localhost:8090/manifest.webmanifest` → 200, a
     `content-type` `application/manifest+json`.
   - `curl -sI http://localhost:8090/icons/icon-512.png` → 200, `image/png`.
   - `curl -sI http://localhost:8090/sw.js` → 200, `cache-control: no-cache`.
   - `curl -sI http://localhost:8090/` → `cache-control: no-cache`.
   - `curl -sI http://localhost:8090/assets/<hashelt fájl>` → **nincs**
     `no-cache` (ezek maradnak hosszan cache-elhetők).

**Böngészőben (Chrome DevTools, Application fül):**

4. Manifest: nincs hibajelzés, mindhárom ikon betöltődik, a maskable előnézet
   nem vágja le a grafikát.
5. Service Workers: `activated and is running`, egyetlen regisztráció.
6. Cache Storage: csak `filler-v1` létezik, és nincs benne `/api/` alatti
   bejegyzés.
7. Lighthouse: az „Installable" ellenőrzés hibátlan.

**Telefonon (a valódi próba):**

8. `bill.p1ckle.xyz` megnyitása Chrome-ban → megjelenik az „App telepítése"
   felajánlás (vagy elérhető a menüből).
9. Telepítés után a főképernyőn a zöld „F" ikon látszik, a launcher formájára
   vágva, a név „Fillér".
10. Indításnál nincs címsáv és nincs böngésző-eszköztár; a status bar színe
    megegyezik a fejléccel — világos és sötét témában is, beleértve a kézi
    témaváltást.

**Regressziók, amiket kifejezetten meg kell nézni:**

11. **Élő frissítés:** két eszközön nyitva ugyanaz a kiadáslista, az egyiken
    felvitt kiadás a másikon oldalfrissítés nélkül megjelenik, és a toolbar
    kapcsolatjelzője aktív marad. Ez bizonyítja, hogy a service worker nem
    vágta el az SSE streamet.
12. **Deploy nem ragad be:** egy jól látható frontend-változás után
    `docker compose up --build`, majd a telepített app bezárása és
    újraindítása a telefonon → az új verzió jön le.
13. Bejelentkezés, kiadás felvétele, szerkesztése és törlése változatlanul
    működik a telepített appból (a session cookie ugyanazon az originon
    marad, tehát ez inkább megerősítés, mint valós kockázat).

## 11. Ismert korlátok

- **Ikoncsere után újratelepítés kell.** Az Android a telepítéskori ikont
  eltárolja; a manifest későbbi módosítása nem cseréli le megbízhatóan a már
  kihelyezett launcher-ikont.
- **Az ikon nem témafüggő.** Sötét módban a `--forint` világosabb zöldre
  vált, az ikon viszont mindig a világos téma zöldjét (`#2f6b4f`) használja.
  Tudatos: a launcher-ikonnak a rendszer témájától függetlenül
  felismerhetőnek kell lennie.
- **Nincs garancia az automatikus telepítési felajánlásra.** A Chrome maga
  döntheti el, mikor mutatja; ha nem jelenik meg, a menüből kézzel
  hozzáadható, és a manifest miatt ugyanúgy `standalone` módban indul.
- **Offline nyitva hagyott app üres listát mutat.** A statikus héj betöltődik
  a cache-ből, de az `/api` hívások elhasalnak, tehát a szokásos hibaállapot
  látszik. Ez nem regresszió — ma sincs offline működés —, csak most
  könnyebben előjön, mert az app hálózat nélkül is elindul.
