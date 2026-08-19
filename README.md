# Fillér

Közös utazások (vagy más csoportos alkalmak) költségeinek elszámolására
szolgáló, self-hosted webapp. Egyetlen, megosztott jelszóval védett; a
résztvevőket egy globális névjegyzékből választod ki eseményenként, a
kiadásokat tetszőleges pénznemben rögzítheted, az app pedig kiszámolja, ki
kinek mennyit fizet a kiegyenlítéshez.

## Funkciók

- Bejelentkezés egyetlen megosztott jelszóval, perzisztens (365 napos)
  bejelentkezés, IP-alapú rate limit brute force ellen.
- Globális névjegyzék: személyek hozzáadása, átnevezése, törlése (törlés
  blokkolva, ha a személy bármely eseménynek résztvevője, vagy bármely
  kiadás fizetője/osztozója).
- Események: létrehozás, szerkesztés, archiválás, törlés (a kiadásaival
  együtt). Legalább 2 résztvevő szükséges.
- Kiadások: modal alapú felvétel/szerkesztés, tetszőleges pénznemben, élő
  átváltási előnézettel forintra. Az elszámolás mindig forintban történik —
  nincs eseményenkénti alapvaluta-_választás_ a settlementhez (ez korábban
  egy valós bugot okozott: ha egy esemény alapvalutáját a felvett kiadások
  után változtatták meg, a régi kiadások alapösszege rossz pénznemben jelent
  meg). Eseményenként viszont beállítható egy "alapértelmezett pénznem", ami
  csak azt jelöli ki előre, milyen valutával nyíljon meg az új kiadás
  űrlapja — a settlementet nem érinti. HUF-ban rögzített kiadásnál nincs
  API-hívás. Az összeg legfeljebb 999999 lehet (6 számjegy). Fizető szerinti
  szűrés, mobilon kártyás nézet.
- Élő frissítés: ha valaki más eszközön vesz fel, módosít vagy töröl egy
  kiadást, az a nyitva hagyott kiadáslistában oldalfrissítés nélkül megjelenik
  (Server-Sent Events). A toolbar halk jelzője mutatja, áll-e a kapcsolat.
- Árfolyam-lekérés külső API-ból (getgeoapi.com), napi Mongo cache-eléssel és
  hibatűrő fallbackkel a legutóbbi ismert árfolyamra.
- Elszámolás fül: egyenlegtábla és minimalizált "ki fizet kinek mennyit"
  lista.

## Monorepo felépítés

- `apps/api` — Fastify backend
- `apps/web` — Vue 3 frontend. Production módban egy saját, kicsi Fastify
  szerver (`server.js`) szolgálja ki a Vite build kimenetét (`dist/`) és
  proxyzza a `/api`-t a backendre — nincs nginx. Elébe reverse proxy (pl.
  Caddy) állítható a `compose.yaml` `web` service labeljeivel, ami a
  TLS-t és a domain-routingot adja.
- `packages/shared` — közös Zod sémák, pénz- és elszámolási logika (a
  frontend és a backend is ugyanazokat a sémákat importálja)

Sima JavaScript mindenhol, TypeScript nélkül — a fordítási idejű
típusellenőrzés helyett Zod validáció minden határátlépésnél (HTTP be- és
kimenet, külső API válasz), és JSDoc a domain típusokra.

Részletes architektúra-leírás (adatmodell, hitelesítés, pénzkezelés,
elszámolási algoritmus, API végpontok, deploy folyamat): lásd
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Gyors indítás — produkciós mód

```sh
cp .env.example .env
```

Töltsd ki az `.env` fájlt (lásd alább az egyes változókat), majd:

```sh
docker compose up --build
```

Az app a `http://localhost:8090` címen érhető el (a `web` service saját
Fastify szervere 8080-as portját publikálja host 8090-re — állítsd át a
`compose.yaml` `web.ports` bejegyzését, ha más portot szeretnél).

## Fejlesztői mód (hot reload)

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

Ez bind mountokkal indítja a szolgáltatásokat: a backend `node --watch`-csal,
a frontend Vite dev szerverrel (`http://localhost:5173`, proxyzva a `/api`
útvonalat a backend felé).

## Telepítés Androidra

Az app telepíthető PWA: Chrome-ban megnyitva a menüből („App telepítése" vagy
„Hozzáadás a főképernyőhöz") kihelyezhető a főképernyőre, és onnan saját
ikonnal, böngészősáv nélkül, teljes képernyőn indul. Nincs telepítőfájl és nem
kell Play Store.

Ehhez biztonságos kontextus szükséges: TLS-szel (pl. a Caddy elé rakott
`https://bill.p1ckle.xyz`) vagy `localhost`-on elérve működik. Plain HTTP-n,
LAN IP-n (`http://192.168.x.x:8090`) vagy Tailscale IP-n keresztül a
service worker nem regisztrálódik, a Chrome nem ajánlja fel a telepítést, és
a „Hozzáadás a főképernyőhöz" csak egy sima böngészőikont hoz létre, ami
böngészősávval nyílik meg.

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

## Android APK

A PWA (lásd fentebb) mellett natív Android APK is készíthető a
[Capacitor](https://capacitorjs.com/) segítségével (`apps/mobile`). A kettő
egymás mellett létezik, nem egymást helyettesítik: az APK-nak natív share és
Bearer token alapú hitelesítés jár, cserébe nincs benne SSE (lásd lentebb).

### Fejlesztői környezet

A build géphez Android SDK és egy teljes JDK (nem csak JRE) kell:

1. Töltsd le az Android parancssori eszközöket
   (`commandlinetools-linux-*.zip`, https://developer.android.com/studio#command-line-tools-only),
   csomagold ki `~/Android/Sdk/cmdline-tools/latest`-be.
2. Vedd fel a `~/.bashrc`-be:
   ```sh
   export ANDROID_HOME="$HOME/Android/Sdk"
   export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
   ```
3. Fogadd el a licenceket, és telepítsd a szükséges csomagokat:
   ```sh
   yes | sdkmanager --licenses
   sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0"
   ```
4. Gradle-hez valódi JDK kell (`javac`), nem elég a JRE — ellenőrizd
   `which javac`-cal. Ha hiányzik, telepítsd a `java-21-openjdk-devel`
   csomagot, vagy állíts be egy portable JDK-t (pl. Temurin 21) `JAVA_HOME`-nak
   és tedd a `bin`-jét a `PATH` elejére a gradle-parancsok előtt.

### Build és release

```sh
npm run build:mobile    # web build + capacitor sync
npm run release:mobile  # fentiek + aláírt release APK
```

A `build:mobile` a `MOBILE_API_BASE_URL` környezeti változóból veszi a
backend URL-jét (alapértelmezés: `https://bill.p1ckle.xyz/api`), és ezt
`VITE_API_BASE_URL`-ként fordítja bele a webes kódba.

**A szerver címe fordítási időben rögzül, és HTTPS végpontnak kell lennie.**
Az appon belül nincs szerver-cím mező — ez szándékos. A `targetSdkVersion 36`
letiltja a cleartext (plain HTTP) forgalmat, és a projekt szándékosan nem ad
hozzá `usesCleartextTraffic` kivételt vagy hálózatbiztonsági konfigurációt —
egy LAN IP-re vagy más plain HTTP címre mutató build minden kérésnél
elhasalna, jól látható hibaüzenet nélkül. Ha domaint váltasz, új APK-t kell
fordítanod a megfelelő, HTTPS-sel elérhető `MOBILE_API_BASE_URL` értékkel
(pl. a Caddy elé rakott domain); a régi APK-ban a cím utólag nem írható át.

Sikeres `release:mobile` után az aláírt APK itt jön létre:
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.

Minden kiadás előtt kézzel emeld a `versionCode` értékét az
`apps/mobile/android/app/build.gradle`-ben (a `versionName` opcionális, de
érdemes követni) — a Play Store-on kívüli, kézi telepítésnél is ez dönti el,
hogy egy új APK „frissítésnek" számít-e a régi fölött.

### Aláíró kulcs

A release build aláírt APK-t készít; a kulcs helye és jelszava az
`apps/mobile/keystore.properties`-ben van, ami gitignore-olt, tehát géphez
kötött. Új gépen (vagy CI-ban, ha valaha bevezetnétek) másold az
`apps/mobile/keystore.properties.example` fájlt `keystore.properties` néven,
és töltsd ki a valódi `storeFile`/`storePassword`/`keyPassword` értékekkel.

**Fontos:** ha a kulcsfájl elvész, a következő APK-t nem lehet a régi
telepítés fölé installálni — Android eltérő aláírás esetén elutasítja a
frissítést. Az egyetlen kiút az app törlése és újratelepítése, ami az app
minden helyi adatát törli (tárolt Bearer token, offline sorba tett
kiadások). Ezért a kulcsfájlt (és a jelszavát) egy másik eszközön is mentsd.

### Hitelesítés és a token visszavonása

A natív app böngésző-session cookie helyett egy `Authorization: Bearer`
tokent tárol (`@capacitor/preferences`), amit bejelentkezéskor kap. Ennek a
tokennek **nincs szerveroldali lejárata**. Egyetlen módja a visszavonásnak
az `.env` `SESSION_SECRET` értékének cseréje — ez viszont egyszerre
érvényteleníti az összes böngészős sessiont **és** az összes appban tárolt
tokent, tehát mindenkinek újra be kell jelentkeznie, böngészőben és appban
egyaránt.

### Amit a natív app másképp csinál, mint a PWA

- Nincs SSE: a kiadáslista akkor frissül, amikor az app előtérbe kerül,
  vagy amikor a felhasználó lehúzza a listát (pull-to-refresh).
- Natív megosztás (`@capacitor/share`) van bekötve az Elszámolás fülön.
- Az ikonok ugyanabból a forrásból generálódnak, mint a PWA ikonjai
  (`scripts/generate-icons.js`).

### CI

Az APK-build szándékosan **nincs** benne a CI-ban — ehhez az aláíró kulcsot
titokként kellene feltölteni egy megosztott futtatókörnyezetbe, ami egy
önhosztolt, kis léptékű projektnél nagyobb kockázat, mint amennyit megér.
A release APK-t egyelőre kézzel, fejlesztői gépen kell előállítani.

## Bejelentkezési jelszó beállítása

Az app egyetlen, megosztott jelszóval működik, felhasználónév és regisztráció
nélkül. A jelszót ember-olvashatóan írd az `.env` `APP_PASSWORD` változójába —
a backend induláskor memóriában argon2id hash-eli, plaintextként nem tárolja
tovább, és nem is logolja.

**Fontos:** a Docker Compose a `$` karaktert saját változóhelyettesítésként
értelmezi az `.env` fájlban, ezért ha a jelszó `$` karaktert tartalmaz, azt
duplán írd (pl. `jelszo$$ez`), különben a jelszó csonkul, és a bejelentkezés
meghibásodik.

## Környezeti változók

| Változó            | Leírás                                                               |
| ------------------ | -------------------------------------------------------------------- |
| `MONGO_URL`        | Mongo kapcsolati string. Compose-ban `mongodb://mongo:27017/filler`. |
| `APP_PASSWORD`     | A megosztott jelszó, ember-olvashatóan (lásd fentebb).               |
| `SESSION_SECRET`   | Hosszú, random string a session cookie aláírásához.                  |
| `CURRENCY_API_KEY` | getgeoapi.com API kulcs az árfolyam-lekéréshez.                      |
| `CURRENCY_API_URL` | getgeoapi.com convert végpont URL-je.                                |
| `NODE_ENV`         | `development` / `production`.                                        |
| `PORT`             | Backend HTTP port (Docker-en belül, alapértelmezetten 3000).         |
| `BACKUP_UID/GID`   | Milyen uid/gid-del írjon a `backup` service (lásd lentebb).          |

Lásd `.env.example` a kommentekkel ellátott sablonért. Éles titok (jelszó,
session secret, API kulcs) sosem kerül a repóba — csak az `.env` fájlba,
ami `.gitignore`-olt.

**Elérés LAN IP-n vagy Tailscale-en, TLS nélkül:** a session cookie a
tényleges kapcsolat protokollja alapján kapja meg a `Secure` jelzőt (nem a
`NODE_ENV` alapján), így `http://192.168.x.x:8090`-en vagy egy Tailscale IP-n
keresztül, TLS nélkül elérve is működik a bejelentkezés — a böngésző csak
`localhost`-on engedi meg a `Secure` cookie-t plain HTTP felett, egyéb
hoston/IP-n eldobná. Ha reverse proxy (pl. Caddy) mögött, TLS-szel futtatod,
a `Secure` jelző automatikusan bekapcsol (a `web` service saját Fastify
szervere a proxy tényleges `X-Forwarded-Proto`-ját továbbítja a backendnek).

## Adatbázis-mentés

A `backup` service óránként készít egy teljes `mongodump`-ot a `filler`
adatbázisról, és `tar.gz`-ként a `./backups` könyvtárba írja
`kassza-ÉÉÉÉHHNN-ÓÓPPMM.tar.gz` néven. Ugyanazt a `mongo:7` image-et
használja, mint az adatbázis, az ütemezést a `scripts/backup.sh` végzi.

Megőrzés (rétegzett, a compose `KEEP_*` változóival hangolható):

- 24 óránál frissebb → minden mentés megmarad
- 24 óra és 14 nap között → naponta a legfrissebb marad meg
- 14 napnál régebbi → törlődik

A service hibatűrő: egy elbukott `mongodump` bekerül a logba, de nem állítja
meg a sorozatot. Hogy a tartós hiba mégse maradjon észrevétlen, a healthcheck
`unhealthy`-ra vált, ha a legfrissebb mentés 90 percnél régebbi — ezt a
`docker compose ps` mutatja.

A mentések a `BACKUP_UID` / `BACKUP_GID` (alapértelmezetten `1000:1000`)
tulajdonában keletkeznek, hogy a hostról is olvashatók és törölhetők
legyenek. Ha az `id -u` más értéket ad, írd be az `.env`-be.

### Visszaállítás

A `backup` konténerben minden együtt van — látja a `./backups` könyvtárat és
eléri a `mongo` service-t, tehát se kicsomagolni, se másolni nem kell a
hoston:

```sh
docker compose exec backup sh -c '
  rm -rf /tmp/rt && mkdir -p /tmp/rt
  tar -xzf /backups/kassza-20260806-012442.tar.gz -C /tmp/rt
  mongorestore --uri="mongodb://mongo:27017" --drop --nsInclude="filler.*" /tmp/rt/dump
'
```

A `--drop` a visszaállítás előtt eldobja az érintett kollekciókat, tehát a
mentés utáni változások elvesznek. Ha előbb csak meg akarod nézni az
archívum tartalmát, `--drop` helyett irányítsd egy külön adatbázisba:

```sh
  mongorestore --uri="mongodb://mongo:27017" \
    --nsFrom="filler.*" --nsTo="restore_test.*" /tmp/rt/dump
```

## Kódminőség

- ESLint flat config + Prettier, CI-ben ellenőrizve (`npm run lint`,
  `npm run format:check`).
- A pénzkezelésre vonatkozó szabály (`no-restricted-syntax`) tiltja a
  `parseFloat`, `Number.parseFloat` és `.toFixed(` használatát mindenhol,
  a `packages/shared/src/currency/format.js` formázó modul kivételével — ez
  a szabály inline kommenttel sem kerülhető meg.
- Backend rétegzés: routes → services → repositories. Mongoose modell nem
  szivárog ki a route rétegbe.

## Megjegyzés a tesztelésről

A projektben nincs automatizált teszt (unit, integration, E2E). A
minőségbiztosítást a szigorú ESLint szabályok, a Zod validáció minden
határátlépésnél, és a funkciók manuális/Docker-alapú ellenőrzése adja. A CI
(`.github/workflows/ci.yml`) lint, formázás-ellenőrzés és build lépéseket
futtat.

## Commit konvenció

[Conventional Commits](https://www.conventionalcommits.org/) (pl. `feat:`,
`fix:`, `chore:`).
