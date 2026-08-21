# Tételes számlafelosztás — design

## Cél

Egy számla, amit egy ember fizetett, de amiből a résztvevők **különböző
mértékben** fogyasztottak, **egyetlen kiadásként** legyen felvihető, tételekre
bontva. Ma ehhez több önálló kiadást kell rögzíteni (5 fős vacsoránál
jellemzően négyet), ami elveszíti azt a tényt, hogy ez egy számla volt, és
minden tételhez újra be kell írni a dátumot, a fizetőt, a pénznemet és az
árfolyamot.

Példa, amit a kész funkciónak fednie kell: egy bevásárlás, három résztvevő
(x, y, z). A számlán egy közös tétel (mindhármuk osztozik rajta), három tétel
csak x-nek (szuvenír), kettő csak y-nak, z-nek nincs saját tétele — ő csak a
közösön osztozik.

## Amit ez a projekt nem tartalmaz

- **Százalékos vagy arányos felosztás.** A felosztás tételen belül továbbra is
  egyenlő az adott tétel osztozói között. Aki a duplájából evett, annak két
  tétele van.
- **Tételenkénti pénznem vagy árfolyam.** Egy számla egy pénznem, egy
  árfolyam. Ez nem szűkítés kényelmi okból: a számla _egy_ fizetési esemény,
  az árfolyama egyetlen tény.
- **Tételenkénti fizető.** A számlát egy ember fizette — ez a mai `payerId`,
  számla szinten.
- **Meglévő adat átalakítása.** Az `items` nélküli kiadás jelentése
  változatlan (egyenlően a `sharedWithIds` között), nincs migráció, és a
  korábban külön felvitt „részszámlák" nem lesznek utólag összefűzve.
- **Natív, Android-specifikus munka.** Ugyanaz a webes csomag fut a
  Capacitor-héjban; a felület reszponzív alakja fedi a telefont.

## Jelenlegi állapot

- `packages/shared/src/schemas/expense.js` — `createExpenseBodySchema`
  (`= updateExpenseBodySchema`), `expenseResponseSchema`,
  `expenseStreamMessageSchema`. A kérés nem tartalmaz `baseAmountMinor`-t, a
  válasz igen.
- `packages/shared/src/currency/convert.js` — `convertMinorAmount`,
  `decimal.js`-szel, fél felfelé kerekítéssel.
- `packages/shared/src/currency/split.js` — `splitEqually`, determinisztikus
  maradékosztással.
- `packages/shared/src/settlement/computeSettlement.js` — kiadásonként
  `splitEqually(baseAmountMinor, sharedWithIds)`; a fizető oldalára
  `baseAmountMinor` kerül. Dokumentált invariáns: **az egyenlegek összege
  pontosan 0**.
- `apps/api/src/services/expenseService.js` — `buildExpenseData` számolja a
  `baseAmountMinor`-t és kényszeríti a pénznem/árfolyam szabályokat;
  `assertParticipants` ellenőrzi, hogy a fizető és az osztozók az esemény
  résztvevői.
- `apps/api/src/models/expenseModel.js` — `strict: 'throw'`, ritka egyedi
  index a `clientId`-n (offline idempotencia).
- `apps/web/src/components/ExpenseModal.vue` — egy összeg + osztozó-chipek;
  `snapshot()` adja a „nem mentett módosítás" figyelmeztetést;
  `rateResolvedByForm` külön argumentumként utazik, nem a payloadban.
- `apps/web/src/components/ExpenseTable.vue` — soronként egy kiadás, a teljes
  sor kattintható szerkesztésre.
- `apps/web/src/components/SettlementPanel.vue` — **kliensoldalon** hívja
  ugyanazt a `computeSettlement`-et, a store kiadáslistájából.
- `apps/web/src/stores/expenses.js` — `computePendingBaseAmountMinor`
  reprodukálja a szerver átváltását a sorbanállított sorokra
  (`toPendingExpense`, `toPendingUpdate`).
- `apps/web/src/offline/sync.js` — `withFreshRate` feltöltéskor újra feloldja
  az árfolyamot, de **csak** ha `rateResolvedByForm`.
- `apps/web/src/offline/plain.js` — `toPlain` rekurzív, `Date`-tartó klón az
  IndexedDB-határon.

## Döntés 1: a tételek a kiadás dokumentumában élnek

Az `Expense` kap egy opcionális `items` altömböt. Egy számla = egy rekord =
egy sor a listában. A mai `sharedWithIds` jelentése tételes módban **a számla
résztvevői**, a tételek ezen belül szűkítenek.

Ebből három dolog következik, amiért ez a forma jobb a többinél:

1. **Egy írás.** Egy szerkesztés, egy törlés, az offline sorban egy bejegyzés
   — egy számla nem tud félig feltöltődni.
2. **Nincs migráció.** `items` nélkül a mai viselkedés érvényes.
3. **A védőkorlátok változatlanul helyesek.** Mivel a tételek osztozói mindig
   részhalmazai a `sharedWithIds`-nek, adódik az
   `items ⊆ sharedWithIds ⊆ event.participantIds` lánc. Így a személytörlés és
   a résztvevő-eltávolítás blokkolása (`sharedWithIds`-re kérdez) és a szerver
   `assertParticipants`-a **változtatás nélkül** helyes marad.

**Elvetett alternatíva: csoportosított kiadások (`groupId`).** Minden tétel
önálló `Expense` lenne, közös csoportazonosítóval; az elszámoló motor nem is
változna. Viszont egy számla N dokumentum: a csoport szerkesztése/törlése több
írás, ami félúton megszakadhat — offline N sorbanálló bejegyzés, részleges
feltöltésnél féloldalas számla és átmenetileg hibás egyenlegek. Ráadásul a
dátumnak, fizetőnek, pénznemnek és árfolyamnak N példányban egyeznie kellene
(kikényszerítendő invariáns, ami itt ingyen adódik), a végösszeg csak
összegzéssel állna elő, és az a számla-résztvevő, akinek nincs saját tétele,
nem lenne ábrázolható.

**Elvetett alternatíva: külön `Bill` kollekció.** Új kollekció, új végpontok,
új offline cache-kulcsok és szinkron-út, az elszámolás két forrásból olvasna.
Ehhez az igényhez fölösleges bonyolítás.

## Döntés 2: a végösszeg a tételek összege

Nincs külön, kézzel írt végösszeg tételes módban: az `amountMinor` a tételek
összege. Az űrlap ezt csak olvashatóan mutatja, és **a szerver ellenőrzi az
egyezést** — nem csak a kliens.

Elvetett alternatíva: külön beírt végösszeg, a nem tételezett maradék közös
felosztásával (borravaló, szervizdíj). Kényelmes, de egy néma automatizmus a
pénz útjában: a felhasználó nem látja, mi került a maradékba. A borravaló így
egy külön tétel, ami látszik.

## Döntés 3: minden tétel külön váltódik, a végösszeg a részek összege

Új shared függvény, `convertExpenseAmounts({ amountMinor, items, currency, exchangeRate })`,
ami visszaadja a tételenkénti `baseAmountMinor`-t és a kiadás
`baseAmountMinor`-ját. Devizás számlánál minden tétel külön váltódik a számla
egyetlen árfolyamával, és **a kiadás `baseAmountMinor`-ja a tételek
forint-összegeinek összege** — nem a végösszeg külön átváltása.

Ez nem kozmetika. Az elszámolás a `baseAmountMinor`-t írja a fizető
„kifizette" oldalára, a tételekből számolt részeket pedig a tartozás oldalára.
Ha a kettő két különböző kerekítésből jönne, néhány fillér elszivárogna, és
megsérülne a `computeSettlement` dokumentált invariánsa, hogy az egyenlegek
összege pontosan 0.

A függvény **három hívóé**, és pontosan ezért kerül a shared csomagba: a
backend `buildExpenseData`-ja, a kliens sorbanállított-előnézete
(`computePendingBaseAmountMinor`) és az űrlap forint-előnézete. Ez ugyanaz a
minta, ami miatt a `splitEqually` és a `computeSettlement` is itt van: a
pénzlogika egyetlen helyen létezik.

## Adatmodell

Kérés (`createExpenseBodySchema`, azaz `updateExpenseBodySchema` is) — új,
opcionális mező:

```
items?: [
  {
    description?: string   // trimmelt, max 120 karakter, elhagyható
    amountMinor: int > 0   // a számla pénznemének legkisebb egységében
    sharedWithIds: [personId]  // min 1
  }
]                          // 1..50 elem; „nincs tételezés" = a mező elhagyása
```

Az üres tömb nem érvényes állapot: a tételezés hiányát a mező elhagyása
jelenti, nem egy `items: []`.

A `superRefine` három invariánst kényszerít ki, ha van `items`:

- `sum(items.amountMinor) === amountMinor`;
- minden tétel `sharedWithIds`-e részhalmaza a kiadás `sharedWithIds`-ének;
- a mai `MAX_EXPENSE_MAJOR_AMOUNT` felső korlát változatlanul a **végösszegre**
  él.

A számla résztvevője lehet olyan, akinek nincs egyetlen tétele sem — az nulla
tartozás, nem hiba (szerkesztés közben átmenetileg mindig ez az állapot).

Válasz (`expenseResponseSchema`): ugyanez, tételenként egy szerver által
számolt `baseAmountMinor`-ral. Ez követi a kiadás szintjén már meglévő
mintát: a kérés nem tartalmaz forint-összeget, a válasz igen. Az
`expenseStreamMessageSchema` a válaszsémára épül, tehát a tételek élőben is
átjönnek, külön munka nélkül.

Mongo (`expenseModel.js`): `items` altömb `{ _id: false }`-szal (nincs
szükség tétel-azonosítóra: a tételek mindig a kiadással együtt íródnak),
`strict: 'throw'` alatt. Nincs új index.

## Elszámolás

A `computeSettlement` egyetlen ponton változik: a felosztandó egységek listája

```
expense.items ?? [{ baseAmountMinor, sharedWithIds }]
```

— a tétel nélküli kiadás egy implicit tétel, tehát **nincs két kódág**. A
fizető „kifizette" oldala változatlanul `expense.baseAmountMinor`.

A `computeSettlementInputSchema` kiegészül:

- a tételek osztozóira is ellenőrzi az esemény-résztvevőséget;
- ha van `items`, megköveteli, hogy `sum(items.baseAmountMinor) === baseAmountMinor`.

Ha ez az invariáns sérülne, a séma dob, és a `SettlementPanel` meglévő
hibaútja lép be (üzenet a panelen) — nem pedig csendben rossz egyenlegek. Ez
ugyanaz a döntés, ami az elavult `participantIds` kezelésénél is meg van írva:
egy hibaüzenet jobb, mint rossz egyenleg.

A kerekítési maradékot tételenként a meglévő, determinisztikus `splitEqually`
osztja szét.

## Webes felület

### `ExpenseModal.vue`

Egy „Tételes felosztás" kapcsoló a leírás alatt.

- **Kikapcsolva:** pontosan a mai űrlap.
- **Bekapcsolva:** az `Összeg` beviteli mező helyére tételsorok listája kerül.
  A `Dátum`, `Kifizette`, `Leírás`, `Valuta` és `Árfolyam` a **számla
  szintjén** marad.
- A meglévő „Ki osztozik rajta" chip-blokk címkéje tételes módban **„Kik
  szerepelnek a számlán"**-ra vált — ugyanaz a mező, ugyanaz a chip-stílus,
  megváltozott jelentéssel.

Egy tételsor (a meglévő `participant-chip` és `money-input` elemekből, új
vizuális nyelv nélkül):

```
┌────────────────────────────────────────┐
│ [Vacsora............]  [12 000]    [×] │
│ (Mind) (x) (y) (z)                     │
└────────────────────────────────────────┘
              + Tétel
     Végösszeg  17 700 HUF   ≈ …
```

- A `Mind` gomb egy koppintással a számla összes résztvevőjét kijelöli — ez a
  „közös" tétel.
- A chipek **csak a számla résztvevőit** mutatják; ha valakit kiveszel a
  számla-szintű listából, kiesik minden tételéből is.
- A megnevezés opcionális (a listában „—" jelenik meg helyette); az összeg és
  legalább egy osztozó kötelező, a hibák sorra vetítve.
- A `Végösszeg` csak olvasható; alatta a mai forint-előnézet, ugyanabban a
  formában, de az új `convertExpenseAmounts`-szal számolva — hogy a mutatott
  szám pontosan az legyen, ami tárolódni fog (a tételek külön átváltásának
  összege), ne a végösszeg egyszeri átváltása.
- A kapcsoló **be**: a már beírt összeg átkerül egyetlen tételbe, a számla
  minden résztvevőjével — semmi nem veszik el. A kapcsoló **ki**: a végösszeg
  visszakerül az összeg-mezőbe, a tételbontás elveszik, ezért megerősítést
  kérünk.
- Ha egy számla-résztvevő egyetlen tételen sem szerepel, halk megjegyzés jelzi
  („z egyetlen tételen sem osztozik — nem tartozik semmivel"), nem hiba.
- Az utolsó tételsor nem törölhető ki nyomtalanul: üres sor marad a helyén.
- A `snapshot()` kiegészül a kapcsoló állásával és a tételekkel — enélkül egy
  tétel-átírás után kérdés nélkül záródna a modál.
- Pénznemváltásnál a tételösszegek megmaradnak, csak a tizedes-léptetés vált —
  pontosan úgy, ahogy ma az egyetlen összeg viselkedik.

### `ExpenseTable.vue`

A számla **egy sor** marad, a mai összeggel és a mai szerkeszthetőséggel. Az
„Osztozók" cella a mai névfelsorolást mutatja (a számla résztvevőit), mellette
pedig egy `3 tétel` jelölés, ami lenyit egy tétel-alsort (megnevezés · összeg ·
osztozók). Alapból csukva, hogy
egy tízsoros vacsora ne fújja fel a táblát; a lenyitó `@click.stop`, hogy ne
indítsa el a sorra kattintó szerkesztést. Mobilon (ahol a tábla `data-label`-es
kártyákra bomlik) ez a kártya egy további blokkja.

## Offline réteg

Az outbox bejegyzés payloadja maga a kérés törzse, tehát az `items` magától
utazik — és mivel egy számla egy bejegyzés, nem tud félig feltöltődni. A
`toPlain` rekurzív, így a beágyazott tétel-tömb klónozása is működik, új
védelem nélkül.

Egy dolgot viszont hozzá kell tenni: a `computePendingBaseAmountMinor` ma
egyetlen összeget vált át. Tételes számlánál a sorbanállított sorra
**tételenkénti** forint-értéket is rá kell írni, az új
`convertExpenseAmounts`-szal — mert az elszámolás ebből a listából számol.
Enélkül a függőben lévő számla tételei forint-összeg nélkül érkeznének a
`computeSettlement`-be, ami az új invariáns-ellenőrzésen dobna, és az egész
esemény elszámolása hibaállapotba menne, amíg a számla a sorban áll.

A `withFreshRate` érintetlen: csak az `exchangeRate`-et írja át, a
forint-összegeket a szerver számolja — tehát a feltöltéskori friss árfolyam
automatikusan minden tételre érvényesül. A „csak akkor oldjuk fel újra, ha az
űrlap oldotta fel" szabály (`rateResolvedByForm`) változatlan.

## Hibakezelés

- Szerveroldali séma-hiba (végösszeg nem egyezik, tétel osztozója nincs a
  számla résztvevői között) → a meglévő `ValidationError` út, mezőútvonalas
  hibaüzenettel; az űrlap ugyanott jeleníti meg, ahol ma a többi hibát.
- Kliensoldali űrlap-validáció ugyanezekre a szabályokra, hogy a hiba a
  beküldés előtt látszódjon.
- Az elszámolás invariáns-sérülése → a `SettlementPanel` meglévő hibaútja.
- Az offline sorbanállítás és az idempotencia (`clientId`) útja változatlan.
