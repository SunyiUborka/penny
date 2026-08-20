# Élő frissítés minden képernyőn — design

## Cél

A más eszközön történt változás manuális újratöltés nélkül jelenjen meg:

- **Kiadások:** azonnal, élő streamen — a natív Android appban is, nem csak
  böngészőben.
- **Elszámolás:** amint egy kiadás megjelenik vagy megváltozik, kövesse magát.
- **Események listája:** lehúzásos frissítéssel legyen frissíthető (eddig
  semmilyen frissítés nem volt rajta, sem böngészőben, sem appban).

## Amit ez a projekt nem tartalmaz

- **Push értesítés.** Külön alrendszer (FCM-projekt, `google-services.json`,
  eszköz-tokenek tárolása, backend küldő réteg), saját tervezési döntésekkel
  (kinek szóljon, mit írjon ki, hogyan kapcsolható ki). Önálló körben készül.
- **Háttérben futó lekérdezés.** Nem technikai lustaság, hanem lehetetlen:
  háttérbe kerülve az Android a WebView JavaScript-időzítőit előbb megfojtja,
  majd leállítja; a `WorkManager` legrövidebb ismétlődő ütemezése ~15 perc;
  másodperces háttérmunkához állandó értesítést mutató foreground service
  kellene. Adatfrissesség szempontjából nem is hiányzik: előtérbe visszatéréskor
  a stream újrakapcsolódik, és a meglévő csendes újratöltés behozza a kimaradt
  változásokat. A háttérben történt változásról értesíteni a push feladata.
- Az árfolyam-, névjegyzék- és beállítás-képernyők frissítése.

## Jelenlegi állapot

- `GET /api/events/:id/stream` — eseményenkénti SSE a kiadás-változásokról, a
  védett `/api` prefix alatt, tehát a `requireAuth` hookon keresztül. A hook a
  session cookie **és** az `Authorization: Bearer` fejléc mellett is átengedi a
  kérést.
- `apps/web/src/stores/expenses.js` — a böngészőben `EventSource`-szal
  streamel; a natív appban ez ki van kapcsolva (`liveUpdatesSupported()`), és
  helyette előtérbe kerüléskor, illetve lehúzásra frissít.
- `apps/web/src/components/ExpenseTable.vue` — ő nyitja és zárja a
  feliratkozást, és fülváltáskor `v-if` miatt lebomlik.
- `apps/web/src/components/SettlementPanel.vue` — a `GET
/api/events/:id/settlement` végpontot kéri le, csak `onMounted`-kor.
- `apps/web/src/views/EventsListView.vue` — `fetchEvents()` csak `onMounted`-kor.
- `apps/api/src/app.js` — `cors` regisztrálva `{ origin: false, credentials: true }`,
  azaz a CORS gyakorlatilag kikapcsolva.

## Döntés 1: az SSE a natív appban a nem patchelt `fetch`-en megy

A `CapacitorHttp` engedélyezése a `window.fetch`-et a natív HTTP-rétegre
irányítja, ami nem streamel. A Capacitor viszont megtartja az eredeti
implementációt (`window.CapacitorWebFetch`), és azon a kérés a WebView-ból megy,
tehát streamelhető — és **fejlécet is tud küldeni**, szemben az
`EventSource`-szal.

Ezért a natív stream a meglévő `Authorization: Bearer` tokent használja. Nem
kell új hitelesítési mechanizmus, és a token nem kerül URL-be, tehát a szerver
kéréslogjába sem.

Elvetett alternatíva: **rövid életű stream-jegy az URL-ben**, `EventSource`-szal.
Ugyanannyi kliensmunkát igényel (a lejárt jeggyel az `EventSource` vakon
újrapróbálkozna, tehát a újrakapcsolódást így is magunknak kell kezelni),
viszont ehhez jön egy szerveroldali jegy-kiadó végpont, jegy-tárolás és
lejáratkezelés, plusz egy URL-ben utazó hitelesítő adat, aminek a naplózását
külön kellene megakadályozni.

**Ár, amit elfogadunk:** az `EventSource` beépített újrakapcsolódását és
`retry`-kezelését magunknak kell megírni.

## Döntés 2: az elszámolás nem kér le semmit, hanem számol

A `GET /api/events/:id/settlement` végpont a szerveren pontosan annyit tesz,
hogy meghívja a `computeSettlement`-et az esemény résztvevőire és a kiadások
`payerId` / `baseAmountMinor` / `sharedWithIds` hármasaira. Ugyanez a függvény a
`packages/shared`-ből a kliensen is fut.

Ezért az elszámolás panel a már betöltött kiadáslistából számol. Következmény:
amint egy kiadás megjelenik a streamen, az elszámolás magától követi — nulla
extra kérés, nulla külön időzítő.

A szerveroldali végpont **megmarad** (az API felülete maradjon teljes), csak a
frontend nem hívja többé.

## Döntés 3: az események listája csak lehúzásra frissül

Nem kerül rá gomb és nem kap időzített frissítést. A meglévő
`apps/web/src/utils/pullToRefresh.js` gesztus-modul kötődik rá, ugyanúgy, ahogy
ma a kiadáslistán működik. Az események store kap egy csendes újratöltést, ami
nem villantja fel a „Betöltés…" állapotot, és hiba esetén a látható listát
hagyja a helyén.

## Architektúra

### Új: SSE-transzport modul

`apps/web/src/api/eventStream.js` — egyetlen felelősség: egy SSE-kapcsolat
életciklusa.

- Böngészőben `EventSource`-ot használ (marad a mai, bevált út).
- Natív appban a nem patchelt `fetch`-fel nyit streamet, `Authorization: Bearer`
  fejléccel, és sorokra bontva értelmezi a választ.
- Mindkét esetben ugyanazt a felületet adja: megnyitás, üzenet-visszahívás,
  megnyitás-visszahívás (ebből tudja a hívó, hogy újrakapcsolódás után pótolnia
  kell a kimaradt üzeneteket), hiba-visszahívás, és egy lezáró függvény.
- Az újrakapcsolódás a modulon belül van, növekvő várakozással, hogy egy leállt
  szerver ne kapjon másodpercenkénti kéréseket.

Miért marad két implementáció, miért nem egy? Böngészőben a hitelesítést a
httpOnly session cookie adja, és a kérés same-origin — ott az `EventSource` a
legrövidebb helyes út, és ma is működik. A fetch-es olvasót azért nem húzzuk rá
a böngészőre is, mert az a platform, aminek a viselkedése nem romolhat: egy
bevált útvonalat cserélnénk egy saját írásúra, kockázatért cserébe, amit semmi
nem indokol.

Így a `expenses` store nem tud arról, hogy melyik platformon melyik transzport
megy — csak üzeneteket kap.

### A feliratkozás feljebb kerül

A kiadás-feliratkozást az `EventDetailView.vue` nyitja és zárja, nem az
`ExpenseTable.vue`. Ok: a két fül `v-if`-fel váltakozik, tehát a kiadás-fül
lebomlik, amikor az elszámolást nézed — a streamnek viszont mindkét fülön élnie
kell, különben az elszámolás nem tud magától frissülni.

Az `ExpenseTable` marad a lista és a lehúzásos gesztus felelőse, a
kapcsolatjelzőt pedig továbbra is a store állapotából olvassa.

### Az elszámolás adatforrása

A `SettlementPanel.vue` a `expenses` store listájából és a kapott `event`
résztvevőiből számol. A „Betöltés…" állapot a kiadások betöltéséhez kötődik,
nem egy saját kéréshez. Ha a kiadások betöltése elbukott, az elszámolás is
hibát jelez — nem üres táblát mutat.

### Backend

Egyetlen változás: az `apps/api/src/app.js` CORS-beállítása engedje a WebView
origóját, hogy a natív `fetch`-es stream átmenjen. Cookie-t nem kell hozzá
engedni, mert a hitelesítés fejléces tokennel történik. A stream-végpont
hitelesítése változatlan.

## Ami ezzel eltűnik

- a `expenses` store natív ága (`subscribeNative`, az előtérbe-figyelő és a
  hozzá tartozó generációszámláló-kezelés),
- a `liveUpdatesSupported()` szétválasztás — ha mindkét platformon van stream, a
  kapcsolatjelző mindkettőn értelmes,
- a `SettlementPanel` saját HTTP-kérése.

A lehúzásos gesztus marad, és `isNativeApp()`-ra van kötve (nem a stream
támogatottságára) — érintéses affordancia, nem az SSE hiányának pótléka.

## Kockázatok

- **`CapacitorWebFetch` elérhetősége.** A terv erre épül. Ha a Capacitor
  jelenlegi verziója más néven tartja meg az eredeti `fetch`-et, vagy egyáltalán
  nem tartja meg, a tartalék a jegy-alapú változat. **Ezt kell először
  igazolni eszközön**, mielőtt bármi ráépül.
- **A WebView origója.** A CORS-engedély ehhez az origóhoz szól; a feltevés
  `https://localhost` (a Capacitor alapértelmezett `androidScheme`-je `https`,
  és a projekt nem írja felül). Eszközön ellenőrizendő a tényleges
  `window.location.origin`.
- **Saját újrakapcsolódás.** Az `EventSource` ingyen adta; itt hibázni lehet
  benne (végtelen szoros ciklus leállt szerver esetén, vagy örökre halott
  kapcsolat). A növekvő várakozás és a megnyitás-visszahívásra futó csendes
  újratöltés együtt fedi le.
- **Hosszan nyitott kapcsolat mobilon.** Ez tudatos csere: a felhasználó
  azonnali frissítést kért, amíg az app nyitva van. Háttérben a kapcsolat
  elhal, és visszatéréskor újranyílik.
- **CORS-felület nyitása.** Egy fix, ismert origó engedélyezése — a Capacitor
  appoknál ez a szokásos megoldás, de mégis egy korábban zárt felület nyílik
  meg. A token továbbra is fejlécben megy, cookie nem engedélyezett.
