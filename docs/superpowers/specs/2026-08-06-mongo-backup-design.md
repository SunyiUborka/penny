# Óránkénti MongoDB mentés — design

**Dátum:** 2026-08-06
**Állapot:** elfogadott, implementációra vár

## 1. A probléma

A `filler` adatbázis egyetlen helyen létezik: a `./mongo-data` bind mountban.
Nincs róla másolat. Egy elrontott törlés, egy sérült adatfájl vagy egy
félresikerült `docker compose down -v` visszafordíthatatlan — az események,
résztvevők és kiadások teljes története elvész.

A host lemez (`/mnt/WDred`) 99%-on áll, 36 GB szabad hellyel. Egy korábbi
incidensben pont a helyhiány vitte crash-loopba a `mongod`-ot (lásd a
`compose.yaml` FTDC-megjegyzését), tehát a mentés helyfoglalása nem
elhanyagolható szempont — még akkor sem, ha a jelenlegi adatkönyvtár 1.4 MB.

## 2. Hatókör

**Benne van:**

- Óránkénti, teljes `mongodump` a `filler` adatbázisról, `tar.gz`-be tömörítve.
- Külön Docker service, ami a többi service-től függetlenül fut és újraindul.
- Rétegzett megőrzés, hogy a fájlszám és a helyfoglalás ne nőjön korlátlanul.
- Rövid visszaállítási recept a README-ben.

**Nincs benne (tudatos kihagyás):**

- Távoli (offsite) másolat, S3/rsync szinkron. Ez külön döntés, külön
  hitelesítéssel; a mentés puszta létezése az első lépés.
- Titkosítás. Az adat a saját hoston marad, ugyanolyan olvashatóan, mint a
  `mongo-data` könyvtár mellette — a `.tar.gz` titkosítása itt nem védene új
  fenyegetés ellen.
- Automatikus visszaállítás vagy visszaállítás-teszt. A helyreállítás kézi,
  dokumentált művelet.
- Point-in-time recovery (oplog). Egyfelhasználós replicaset nélküli mongod-on
  nincs is oplog, és óránkénti felbontásnál ez túlzás.

## 3. Miért külön service, sleep-loop ütemezéssel

A `mongo:7` image már tartalmazza a `mongodump`, `tar` és `gzip` binárisokat,
cront viszont nem. Ezért három út adódott:

**A `mongo:7` image + shell sleep-loop (ez lett kiválasztva).** Nulla új
függőség, nulla build lépés, a már letöltött image-ből indul. A ciklus mindig
a következő egész óráig alszik, tehát nem sodródik el, ahogy egy naiv
`sleep 3600` tenné.

**B `mongo:7` + saját Dockerfile, `apt install cron`.** Igazi crontab-szintaxis,
cserébe build lépés, apt-telepítés build időben, és a cront foreground módban
kell futtatni, a logjait pedig külön stdout-ra vezetni. Több mozgó alkatrész
ugyanazért az eredményért.

**C Ofelia vagy hasonló docker-scheduler.** A Docker socket bemountolását
igényli, ami gyakorlatilag root jogot ad a konténernek a hoston. Egy óránkénti
`mongodump`-ért aránytalan kockázat.

## 4. Architektúra

Egyetlen új service és egyetlen új script:

```
compose.yaml            backup service (mongo:7, entrypoint: backup.sh)
scripts/backup.sh       az egész logika: ütemezés + dump + takarítás
./backups/              a kimenet, bind mount, gitignore-olva
```

A service az `internal` hálózatra csatlakozik, és hálózaton keresztül dumpol
(`mongodb://mongo:27017/filler`). A `mongo-data` könyvtárhoz nem fér hozzá —
ez szándékos: az élő adatfájlok nyers másolása futó `mongod` mellett
inkonzisztens mentést adna, a `mongodump` viszont a szerveren keresztül olvas.

`depends_on: mongo (service_healthy)`, `restart: unless-stopped`.

A script bind mountként érkezik, nem az image-be sütve, így szerkesztés után
elég egy `docker compose restart backup` — nincs újraépítés.

### Konfiguráció (environment)

| Változó             | Alapérték                      | Szerepe                          |
| ------------------- | ------------------------------ | -------------------------------- |
| `MONGO_URL`         | `mongodb://mongo:27017/filler` | a dumpolandó adatbázis           |
| `BACKUP_DIR`        | `/backups`                     | a kimeneti könyvtár              |
| `TZ`                | `Europe/Budapest`              | a fájlnevek időbélyegének zónája |
| `KEEP_HOURLY_HOURS` | `24`                           | eddig marad meg minden mentés    |
| `KEEP_DAILY_DAYS`   | `14`                           | eddig marad meg napi egy         |

### Ütemezés

A script induláskor **azonnal** készít egy mentést, mielőtt a ciklusba lépne.
Így a konténer indítása egyben a konfiguráció ellenőrzése is: ha a `MONGO_URL`
rossz vagy a `/backups` nem írható, az percek alatt kiderül, nem a következő
egész órakor.

Utána végtelen ciklus: kiszámolja a következő egész óráig hátralévő
másodperceket, annyit alszik, mentést készít, takarít, ismétel. A fal-óra
igazítás miatt a mentések mindig `HH:00` körül keletkeznek, és nem sodródnak
el, ahogy egy fix `sleep 3600` tenné a dump futásidejével.

## 5. Egy mentés menete

1. `work=$(mktemp -d)`, majd `mongodump --uri="$MONGO_URL" --out="$work/dump"`.
2. `tar -czf "$BACKUP_DIR/.kassza-<ts>.tar.gz.part" -C "$work" dump`.
3. Atomi `mv` a végleges `"$BACKUP_DIR/kassza-<ts>.tar.gz"` névre.
4. A munkakönyvtár törlése.

Az időbélyeg formátuma `YYYYMMDD-HHMMSS`, helyi idő szerint.

A rejtett `.part` kiterjesztés és az atomi átnevezés együtt garantálja, hogy
félkész archívum soha ne látszódjon érvényes mentésnek — sem a takarító
logikának, sem az embernek, aki visszaállítana belőle. Induláskor a script
letörli a korábbi futásból ottfelejtett `.part` fájlokat.

### Hibakezelés

Ha a `mongodump` nem nulla kilépési kóddal tér vissza, a script az stderr-re
logol, eldobja a munkakönyvtárat, és **nem áll le** — a következő órában újra
próbálkozik. Egy elbukott óra nem szakítja meg a mentési sorozatot. A `set -e`
ezért nem terjed ki a dump hívására.

## 6. Rétegzett megőrzés

Minden sikeres mentés után lefut a takarítás. Az időbélyeget a fájlnévből
olvassa ki, nem az mtime-ból — így egy `cp` vagy `rsync` nem hazudik friss
mentést. A fájlokat a legújabbtól haladva végigjárva:

- **24 óránál frissebb** → megmarad, mindegyik (óránkénti felbontás).
- **24 óra és 14 nap között** → naptári naponként a legfrissebb marad meg, a
  nap többi fájlja törlődik.
- **14 napnál régebbi** → törlődik.

A "legújabbtól haladva" bejárás miatt a napi megtartott példány mindig az adott
nap utolsó mentése. Steady state: kb. 24 óránkénti plusz 14 napi fájl. A mai
adatmérettel ez néhány MB összesen, tehát a majdnem tele lemezen sem jelent
kockázatot.

Ismert, elfogadott pontatlanság: az a naptári nap, amelyik részben a 24 órás
ablakon belül van, egy extra fájlt tarthat meg (a napi példányát az órási
példányok mellett). Ez legfeljebb egyetlen fájl, nem éri meg bonyolítani érte
a logikát.

## 7. Healthcheck

A `backup` service healthcheckje azt nézi, hogy a legfrissebb `kassza-*.tar.gz`
90 percnél frissebb-e. Ha nem, a konténer `unhealthy` lesz, és a hiba láthatóvá
válik a `docker compose ps`-ben. E nélkül egy tartósan bukó `mongodump` némán
maradna észrevétlen — a service ugyanis a hibatűrés miatt futva marad.

A 90 perces küszöb az óránkénti ciklushoz ad fél óra ráhagyást. `start_period`
kell hozzá, hogy az első mentés elkészültéig ne jelezzen hibát.

## 8. Visszaállítás

A README kap egy rövid szakaszt:

```sh
tar -xzf backups/kassza-20260806-140000.tar.gz -C /tmp
docker compose exec -T mongo mongorestore --uri="mongodb://localhost:27017" --drop --nsInclude='filler.*' /dump
```

A pontos parancs az implementáció során, tényleges kipróbálás után kerül a
README-be — nem találgatásból.

## 9. Egyéb változások

- `.gitignore` kiegészítése a `backups/` sorral.
- A `backup` service a `compose.dev.yaml`-lel indított dev módban is fut. Ez
  szándékos: a dev adatbázis ugyanaz a `mongo-data`, tehát ugyanúgy védendő.
