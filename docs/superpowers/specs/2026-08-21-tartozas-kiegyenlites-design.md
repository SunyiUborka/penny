# Tartozás-kiegyenlítés — terv

Elfogadott látványterv: `kiegyenlites-latvanyterv.html` (Artifact,
2026-08-21). Ez a dokumentum a látványtervben jóváhagyott viselkedést írja le
implementálható pontossággal.

## 1. Mi ez

Ha valaki tényleg átadja a pénzt a másiknak, azt rögzíteni kell. Ez **nem
kiadás**: nem növeli az esemény összköltségét, nem jelenik meg a Kiadások
fülön, és nem szerepel a „Kifizette” oszlopban. Csak a tartozás mozdul.

## 2. A központi döntés: a jegyzék állandó

A „ki fizet kinek” lista (**fizetési jegyzék**) **kizárólag a kiadásokból**
számol, a kiegyenlítésekből nem. Ez a mai `computeSettlement` viselkedésétől
szándékos eltérés, és ez a funkció lényege:

- Egy fizetés **csak a saját sorát** rendezi. A többi páros összege nem
  mozdul.
- **Részfizetésnél** a soron marad a hátralék, ugyanannak a párosnak.
- **Túlfizetésnél** a sor rendezve, a fölösleg **kerekítés**: a szelvényen
  dokumentált, de egyetlen egyenleghez sem ér hozzá.

Miért nem a korábbi (derivált) modell: ott egy 8 000 Ft-os fizetés egy 7 800
Ft-os sorra átrendezte a másik két sort is (és ugyanígy tett minden
részfizetés). A jóváhagyott viselkedés: „amit kiírt, az legyen rendezve,
semmi más ne változzon”.

### Következmény: beszámítás (credited) származtatott érték

A szelvény azt tárolja, ami **történt** (összeg, pénznem, árfolyam,
forint-érték). Hogy ebből mennyi **számít be** egy jegyzéksorba, az
számított: a sor összegéig, a szelvények dátum (majd `createdAt`) szerinti
sorrendjében. Így egy utólagos kiadás-módosítás nem hagy maga után hamis,
eltárolt beszámítást.

### Következmény: az egyenleg a beszámított összeggel számol

Az egyenlegtábla a **beszámított** (nem a teljes átadott) forintot mozgatja.
Ez nem részletkérdés: ha a teljes átadott összeg mozdítaná, akkor egy 7 800
helyett átadott 8 000 Ft után a jegyzék minden sora rendezett lenne, mégis
maradna ±200 Ft egyenleg — kifizetett jegyzék mellett látszó tartozás. Így
viszont igaz az alaptétel: **rendezett jegyzék = mindenki nullán**.

A kerekítés nem tűnik el, csak nem az elszámolásban van: a szelvény kiírja
(„8 000 Ft átadva · 7 800 Ft beszámítva · 200 Ft kerekítés”).

Ugyanez fedi le azt is, ha a kiadások utólag módosulnak: a jegyzék
újraszámol, és egy korábbi szelvény párosa eltűnhet belőle. Ilyenkor a
szelvény beszámított összege 0, a teljes összeg „kerekítésként” jelenik meg,
és a felület kiírja, hogy ez a bejegyzés a mostani jegyzékbe nem számít be —
nem hallgatja el.

## 3. Adatmodell

Új kollekció: `settlementpayments`.

| mező              | típus               | megjegyzés                               |
| ----------------- | ------------------- | ---------------------------------------- |
| `eventId`         | ObjectId → Event    | kötelező, indexelt                       |
| `date`            | Date                | dátum-only, a kiadásokkal azonos kezelés |
| `fromId`          | ObjectId → Person   | aki fizetett; az esemény résztvevője     |
| `toId`            | ObjectId → Person   | aki kapta; résztvevő, és `!== fromId`    |
| `amountMinor`     | Number ≥ 1          | a pénznem legkisebb egységében           |
| `currency`        | String              | `SUPPORTED_CURRENCIES`                   |
| `exchangeRate`    | String              | a felvitelkori árfolyam, ráfagyva        |
| `rateSource`      | `'api' \| 'manual'` | kézi árfolyam megjelölhető               |
| `rateFetchedAt`   | Date                | mint a kiadásoknál                       |
| `baseAmountMinor` | Number ≥ 0          | forint-érték, szerver számolja           |
| `note`            | String?             | legfeljebb 120 karakter                  |
| `clientId`        | String?             | sparse-unique, jövőbeli offline sorhoz   |

A szelvény **szerkeszthető** (`PATCH`) és **visszavonható** (törlés). A
beszámítás származtatott érték, tehát egy utólagos összeg- vagy
dátumjavítás után a jegyzék és az egyenlegek maguktól újraszámolnak.

Felső korlát az összegre: `MAX_EXPENSE_MAJOR_AMOUNT` (999 999), a
kiadásokkal azonosan.

## 4. Számítás (`packages/shared`)

`computeSettlement({ participantIds, expenses, payments })` visszatérése:

```
{
  balances: [{ personId, paidMinor, owedMinor, settledMinor, balanceMinor }],
  transfers: [{ fromId, toId, amountMinor, creditedMinor, remainingMinor }],
  paymentCredits: [{ creditedMinor, roundingMinor }],   // payments sorrendjében
  unmatchedCreditMinor: number,
}
```

- `paidMinor` / `owedMinor`: **csak a kiadásokból** (változatlan).
- `settledMinor`: a személy kiegyenlítéseinek előjeles, **beszámított**
  forint-összege (fizetőnek `+`, kedvezményezettnek `−`).
- `balanceMinor` = `paidMinor − owedMinor + settledMinor`.
- `transfers`: a mohó párosítás a **kiadás-egyenlegekre** (`paidMinor −
owedMinor`), tehát a kiegyenlítésektől független — ez a jegyzék. A
  párosítás algoritmusa változatlan (legnagyobb adós ↔ legnagyobb hitelező,
  azonos összegnél `personId` szerint).
- `creditedMinor` soronként: a páros szelvényeinek forint-értéke, a sor
  összegéig levágva.
- `paymentCredits`: szelvényenként, mennyi számított be és mennyi a
  kerekítés (`baseAmountMinor − creditedMinor`).
- `unmatchedCreditMinor`: ami egyetlen sorba sem tudott beszámítani.

Ha minden sor rendezett, minden `balanceMinor` 0 — ez a modell alaptétele.

## 5. API

| metódus  | út                                    | leírás                        |
| -------- | ------------------------------------- | ----------------------------- |
| `GET`    | `/api/events/:id/settlement-payments` | lista, dátum szerint csökkenő |
| `POST`   | `/api/events/:id/settlement-payments` | felvétel, 201                 |
| `PATCH`  | `/api/settlement-payments/:id`        | szerkesztés                   |
| `DELETE` | `/api/settlement-payments/:id`        | visszavonás, 204              |

A `GET /api/events/:id/settlement` válasza a 4. pont szerinti bővebb
alakot adja.

Validáció a szerveren: `fromId`/`toId` az esemény résztvevője,
`fromId !== toId`, a forint-érték a shared `convertMinorAmount`-tal számol,
`currency === 'HUF'` esetén az árfolyam kényszerítve `'1'` (a kiadások
`buildExpenseData`-jának mintájára).

## 6. Élő frissítés (SSE)

A stream mostantól kiadás- **és** kiegyenlítés-üzenetet is szállít, ezért:

- `expenseStreamMessageSchema` → `eventStreamMessageSchema`, új tagokkal:
  `settlementPayment.created`, `settlementPayment.updated`,
  `settlementPayment.deleted`.
- `eventBus`: `publishExpenseChange` → `publishEventChange`,
  `subscribeToExpenseChanges` → `subscribeToEventChanges`.

Ez névbővítés, nem átépítés: a stream eddig is eseményenkénti csatorna volt.

## 7. Integritási védőkorlátok

A meglévő korlátok csak a kiadásokat kérdezik; ki kell terjeszteni:

- **személy törlése** (`personService.deletePerson`): tiltott, ha bármely
  kiegyenlítés fizetője vagy kedvezményezettje;
- **résztvevő eltávolítása** (`eventService.updateEvent`): tiltott, ha az
  eltávolítandó résztvevő szerepel az esemény kiegyenlítésein;
- **esemény törlése**: a kiegyenlítések is törlődnek a kiadásokkal együtt.

## 8. Felület

Az Elszámolás fülön, három blokkban:

1. **Egyenlegek** — új, rézszínnel kiemelt „Kiegyenlítve” oszlop, előjelesen.
   A „Kifizette” marad tisztán a közös költés.
2. **Ki fizet kinek** — a jegyzék. Nyitott soron „Rendezve” gomb; részben
   fizetett soron a hátralék, alatta „10 000 Ft rendezve a 22 100-ból” és
   rézszín folyamatsáv; kifizetett soron rézszín „Rendezve” pecsét (a sor
   ott marad, nem tűnik el). Ha minden sor rendezett, a meglévő zöld
   „Egyenleg rendezve” pecsét jelenik meg.
3. **Kiegyenlítések** — a napló, perforált bal élű szelvényekkel: átadott
   összeg a saját pénznemében, alatta dátum, megjegyzés, devizánál a
   forint-érték és az árfolyam (kézi árfolyamnál „kézi árfolyam” jelölés),
   túlfizetésnél a beszámított összeg és a többlet. Soronként „Szerkesztés" és
   „Visszavonás”. Üres állapot kimondja a szabályt.

**Modal** (`SettlementPaymentModal.vue`): melyik tartozás (a nyitott
jegyzéksorok közül) · átadott összeg · pénznem · dátum · megjegyzés, és
devizánál árfolyam-mező „Frissítés” gombbal, a kiadás-űrlappal azonos
viselkedéssel (beleírás → kézi árfolyam; pénznemváltás → visszaáll a lekért
árfolyamra). Élő segédszöveg mondja meg, mennyi számít be és mennyi a
kerekítés.

**Szín**: a `--brass` kap jelentést — zöld = a csoportra fordított pénz,
vörös = tartozás, réz = kézen-közön mozgó pénz. Új szín nincs; a
`--settle` / `--settle-soft` token a `theme.css`-be kerül.

## 9. Offline

Ebben a körben **olvasás**: a lista bekerül a cache-be
(`settlement-payments:<eseményId>` kulcs), tehát offline is látszik, és a
kulcs bejelentkezik az `OfflineBanner` frissesség-jelzésébe.

**Írás (outbox sorbanállítás) nem tartozik ide.** A szinkron-motor ma
kiadás-specifikus (árfolyam újra-feloldás, `applyUploadResult`, dedup
`clientId`-vel), és egy második entitástípus bevezetése ott önálló,
kockázatos munka. A `clientId` mező és a sparse-unique index viszont már
most bekerül, hogy a későbbi sorbanállítás ne igényeljen migrációt.

## 10. Ellenőrzés

A projektben nincs automatizált teszt, ezért: `npm run lint`,
`npm run build`, majd kézi végigjátszás a futó appban (felvétel forintban és
devizában, kézi árfolyam, részfizetés, túlfizetés, visszavonás, két
eszközön az élő frissítés).
