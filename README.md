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
