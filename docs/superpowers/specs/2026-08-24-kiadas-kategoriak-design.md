# Kiadás-kategóriák — design

## Cél

Egy eseményen belül a felhasználók **maguk határozzák meg**, milyen
kategóriákba sorolják a kiadásaikat, és egy kiadásra **több kategória** is
kerülhet. A kategória a kiadás-modalban, a leírással egy sorban álló
lenyílóból választható, és ugyanonnan **új kategória is felvehető**, anélkül
hogy a felhasználónak el kellene hagynia a félig kitöltött űrlapot.

A kategória leíró adat: címkéz és később szűrhetővé/összesíthetővé tesz. Az
elszámolás matematikáját nem érinti.

## Amit ez a projekt nem tartalmaz

- **Szűrés kategóriára** a kiadástáblában. Később jöhet, most nem.
- **Kategóriánkénti összesítés** (mennyi ment el „Étel-ital"-ra). Több
  kategóriás kiadásnál ennek a számolása külön döntést igényel — nem most.
- **Tételenkénti kategória.** A kategória a számla egészére vonatkozik, nem
  az `items` soraira.
- **Globális, eseményeken átívelő kategóriakészlet.** Minden eseménynek saját
  listája van, üresen indul, és nincs másolás másik eseményből.
- **Beépített alapkészlet.** Új esemény nulla kategóriával jön létre.
- **Offline kategória-létrehozás.** A kategória-műveletek hálózatot
  igényelnek; lásd az „Offline" szakaszt.
- **Kézi sorrendezés.** A lista mindig névsorban áll.
- **Meglévő adat átalakítása.** A `categoryIds` nélküli kiadás továbbra is
  érvényes, nincs migráció.

## Jelenlegi állapot

- `packages/shared/src/schemas/expense.js` — `createExpenseBodySchema`
  (`= updateExpenseBodySchema`), `expenseResponseSchema`. A kiadáson ma nincs
  semmilyen címkézés.
- `packages/shared/src/schemas/eventStream.js` — hat üzenettípus
  (`expense.*`, `settlementPayment.*`) diszkriminált unióban.
- `apps/api/src/models/personModel.js` — a legközelebbi minta egy önálló,
  névvel azonosított entitásra: egyedi index a néven, `collation`-nel.
- `apps/api/src/services/personService.js` — a törlés használat-ellenőrzéssel
  és `ConflictError`-ral; a kategória ettől szándékosan eltér (lásd lentebb).
- `apps/api/src/services/expenseService.js` — `assertParticipants`,
  `assertNotArchived`, `publishEventChange`.
- `apps/web/src/components/ExpenseModal.vue` — a Leírás ma teljes szélességű
  `.field`; a Dátum/Kifizette pár már `.modal__row`-ban áll.
- `apps/web/src/offline/cacheKeys.js` — kulcsgyártó függvények egy helyen.
- `apps/web/src/assets/theme.css` — `.participant-chip` (pill, sans),
  `.stamp` (ferde, serif), `.money` (mono).

## Vizuális irány: a rovatjegy

A rendszerben ma három formanyelv van, mindegyiknek van gazdája:

| forma | betűtípus | jelentés |
| --- | --- | --- |
| lekerekített pill (`.participant-chip`) | sans | ember |
| ferde, nagybetűs pecsét (`.stamp`) | serif | állapot, verdikt |
| tabuláris szám (`.money`) | mono | a könyv adata |

A kategória egyik sem: pillként embernek, pecsétként állapotnak olvasnánk.
Ezért kap egy negyedik formát, a **rovatjegyet** — szögletes bal él egy 3 px-es
színes tintacsíkkal, enyhén lekerekített jobb él, mint egy iratrendezőbe
ragasztott indexfül. A felirat mono betűvel, kis méretben, ritkítva: a
pénztárkönyvben a rovat épp olyan gépi adat, mint az összeg. A mono szerepe
ezzel nem hígul, hanem kiteljesedik — serif: nevek és verdiktek, sans: emberek
és vezérlők, mono: a könyv adata (összeg és rovat).

**A szín kizárólag a bal éli csíkban él, sosem kitöltésként.** A rendszerben a
szín ma jelentést hordoz (zöld = a csoportra fordított pénz, vörös = tartozás,
réz = kiegyenlítés); egy színesre töltött címke ezt szétverné. Vékony
tintacsíkként a szín pusztán megkülönböztet.

Hat tintaszín, egyik sem téveszthető össze a három jelentéshordozóval:

| kulcs | világos | sötét |
| --- | --- | --- |
| `indigo` | `#3b4d7a` | `#8fa3d4` |
| `plum` | `#6d3f66` | `#c294bb` |
| `teal` | `#2c6a6b` | `#7bc0c1` |
| `rust` | `#9c5626` | `#d69a6e` |
| `olive` | `#5c6b30` | `#a8bd72` |
| `slate` | `#4c5a64` | `#9fb0bb` |

Az adatbázisba a **kulcs** kerül, nem a hex. Így a sötét mód saját árnyalatot
rendelhet ugyanahhoz a kategóriához, és a paletta később hangolható
adatmigráció nélkül.

Szándékosan kimarad: kivágott/fogazott bal él `clip-path`-szal, ikon a
címkén, hover-animáció. Egy 11 px-es címkén ezek zajok.

## Adatmodell

### Választott megoldás: külön `categories` kollekció

```js
{
  eventId: ObjectId,   // ref: Event, kötelező
  name: String,        // trim, 1..32
  color: String,       // enum: indigo | plum | teal | rust | olive | slate
}
```

- `strict: 'throw'`, `timestamps: true` — mint minden modell a projektben.
- Index: `{ eventId: 1, name: 1 }`, `unique`, `collation: { locale: 'hu',
  strength: 1 }`. A `strength: 1` az ékezetet és a kisbetűt is egybemossa,
  tehát „Étel" és „etel" ütközik. Ez szándékos: két ilyen kategória egymás
  mellett használhatatlan lenne. A `personModel` `strength: 2`-t használ
  (kisbetű igen, ékezet nem) — az eltérés tudatos: két ember tényleg
  hívható Andrásnak és Andrasnak, két rovat nem.
- Index: `{ eventId: 1 }` a listázáshoz, **külön**. A fenti összetett index
  prefixe elvben fedné, de egy collation-nel létrehozott indexet a MongoDB
  csak azonos collation-t megadó lekérdezéshez használ — a sima
  `find({ eventId })` nem ilyen, tehát collation nélküli indexre van
  szüksége.

A kiadás új mezője:

```js
categoryIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Category' }], default: [] }
```

`default: []` (nem `undefined`, ellentétben az `items`-szel): az üres tömb itt
érvényes, jelentéssel bíró állapot — „nincs kategóriája" —, és a válaszséma
sem követel rajta `min(1)`-et.

### Elvetett megoldások

- **Beágyazott altömb az esemény dokumentumában.** Kevesebb kollekció, és a
  lista ingyen érkezne az eseménnyel. Ellene: minden kategória-írás
  újraírja az egész esemény-dokumentumot, és az `updateEventBodySchema`-nak
  külön kellene védekeznie, nehogy egy sima esemény-mentés letörölje a
  kategóriákat.
- **Szabad szöveges címkék entitás nélkül** (`expense.tags: [String]`).
  Átnevezni csak tömeges string-átírással lehetne, szín nem fér el rajta, és
  az „Étel" / „étel" azonnal két kategóriává válna. A feladat kezelt
  készletet kér (létrehozás, szerkesztés, törlés), ez pedig nem az.

## API

```
GET    /api/events/:id/categories     lista, névsorban       → 200
POST   /api/events/:id/categories     { name, color }        → 201
PATCH  /api/categories/:id            { name?, color? }      → 200
DELETE /api/categories/:id                                   → 204
```

A route-ok a védett `/api` prefix alatt élnek, `requireAuth` mögött, mint
minden más. Az esemény alatti al-útvonalak az `events.js`-be kerülnek (ott
laknak ma a `/:id/expenses` és a `/:id/settlement-payments` is); az
azonosított kategória műveletei új `routes/categories.js`-be, az
`expenses.js` mintájára.

### Szabályok

- **Archivált esemény:** mind a három írás elutasított, ugyanazzal az
  `assertNotArchived`-dal, ami a kiadásokat védi ma.
- **Duplikált név:** a `11000`-es hibakód `ConflictError`-rá fordul, magyar
  üzenettel: `Már van "Étel-ital" nevű kategória ezen az eseményen.`
- **Nem létező kategória:** `NotFoundError` (404).
- **A kiadás mentése** ellenőrzi, hogy minden `categoryId` **ehhez az
  eseményhez** tartozik — új `assertCategories` az `expenseService`-ben,
  pontosan úgy elhelyezve és úgy hívva, ahogy az `assertParticipants` ma. Nem
  létező vagy másik eseményhez tartozó id: `ValidationError`.

### Törlés: lekapcsolás, nem tiltás

A kategória törlése két lépés, tranzakció nélkül:

1. `$pull` a kategória id-jére az esemény **összes** kiadásából
   (`expenseRepository.detachCategory(eventId, categoryId)`).
2. A kategória dokumentum törlése.

A sorrend szándékos. Ha a második lépés elbukik, egy árva, senkihez nem kötött
kategória marad, ami újra törölhető — ártalmatlan. Fordított sorrendben a
kiadásokon egy már nem létező kategóriára mutató id maradna, amit semmi nem
takarítana el.

Ez tudatosan **eltér** a személytörléstől, ami `ConflictError`-ral tiltja a
használatban lévő rekord törlését. A különbség oka: a személy törlése
adatvesztéssel járna (kinek mennyi az egyenlege), a kategóriáé csak
címkevesztéssel. A felhasználót a felület tájékoztatja a súlyról a
megerősítéskor.

## Élő frissítés

Az `eventStreamMessageSchema` három új taggal bővül:

```js
{ type: 'category.created', category: categoryResponseSchema }
{ type: 'category.updated', category: categoryResponseSchema }
{ type: 'category.deleted', categoryId: personIdSchema }
```

A törlésnél **nem** megy át kiadásonként egy-egy `expense.updated`. Egyetlen
`category.deleted` üzenet elég: a kliens a saját listájából kapcsolja le az
id-t minden kiadásról, ami pontosan azt az állapotot állítja elő, amit a
szerver `$pull`-ja. Ötven kiadásnál ez egy üzenet ötven helyett.

Következmény, amit vállalunk: a `$pull` megemeli az érintett kiadások
`updatedAt`-jét a szerveren, a kliens másolatán nem. Ez sehol nem
megjelenített és semmilyen döntést nem befolyásoló mező, a következő teljes
betöltés pedig helyrehozza.

## Felület

### Kiadás-modal

A Leírás mező `.modal__row`-ba kerül a kategória-választóval, ahogy a
Dátum/Kifizette pár már ma is:

```
Leírás                              Kategória
┌────────────────────────┐  ┌───────────────────────┐
│ Vacsora a kékesében    │  │ ▎ÉTEL-ITAL ×  ▎EST × ▾│
└────────────────────────┘  └───────────────────────┘
                            ┌───────────────────────┐
                            │ be|                   │
                            ├───────────────────────┤
                            │ ▎BELÉPŐ            ✓  │
                            │ ▎BENZIN               │
                            ├───────────────────────┤
                            │ + Új kategória: „be"  │
                            └───────────────────────┘
```

A jelenlegi `.modal__row .field` szabályon `min-width: 0` van, ami sosem
törne sorba; a két mezőnek `min-width: 12rem` kell, hogy keskeny kijelzőn
egymás alá csússzanak.

Az `+ Új kategória` sor csak akkor jelenik meg, ha a beírt szövegre nincs
pontos (kis/nagybetű- és ékezet-érzéketlen) találat. Rákattintva a kategória
azonnal létrejön a szerveren, és kijelölve visszakerül a mezőbe. **A szín
ilyenkor automatikus**: a paletta első olyan tintája, amit az esemény még nem
használ. Ha mind a hat foglalt, a legkevesebbszer használt nyer, holtversenynél
a palettában előrébb álló. Felvitel közben ne kelljen színt választani;
átszínezni a kezelőmodalban lehet.

Billentyűzet: `↓`/`↑` lépteti a kiemelést, `Enter` kijelöli a kiemeltet (vagy
létrehozza az újat), `Backspace` üres beírómezőnél leveszi az utolsó címkét,
`Escape` bezárja a panelt — a modalt nem (a `keydown` megáll a komponensnél,
ha a panel nyitva van).

### Kategóriák modal

Az eseményoldal fejlécében, a Szerkesztés/Törlés mellé kerül egy „Kategóriák"
gomb (`.btn--ghost .btn--small`), ami nyugta-kártyás modalt nyit. Soronként:
a rovatjegy, egy hatpontos színválasztó, helyben szerkeszthető név, és egy
törlés gomb. Alul egy „+ Új kategória" beviteli sor.

Nincs Mentés gomb: minden művelet azonnal életbe lép, mert külön végpontokon
megy. Ezért nem is fér bele az esemény-szerkesztő űrlapba, ahol a mezők
mentésre várnak.

A törlés megerősítést kér, és megmondja a súlyát:
`A "Belépő" 7 kiadáson szerepel. Törlés után lekerül róluk.` A darabszámot a
kliens számolja a betöltött kiadáslistából — nem kér hozzá külön végpontot.

Archivált eseményen a modal csak olvasható: a gombok tiltottak, a fejlécben a
mai, kiadásokra vonatkozó mintát követő magyarázattal.

### Kiadástábla

A Leírás cella alatt egy sorban a rovatjegyek, kisebb méretben (`.cat-tag
.cat-tag--sm`). Nincs új oszlop: a tábla már hét oszlopos, mobilon pedig
kártya-elrendezésre vált.

## Offline

A kategórialista ugyanúgy gyorsítótárazva jön, mint a kiadások — új
`categoriesCacheKey(eventId)` a `cacheKeys.js`-ben, `fetchWithCache` a
store-ban, és a nézet bejelenti a kulcsot a `setVisibleKeys`-szel, hogy az
`OfflineBanner` róla is tudjon.

Offline **választani lehet** a gyorsítótárazott kategóriákból, **létrehozni
nem**. Az `+ Új kategória` sor helyén ilyenkor magyarázat áll: `Offline nem
hozható létre új kategória.` A Kategóriák modal gombjai szintén tiltottak.

Ennek az oka, hogy a kategória-műveletek nem járnak az outboxon. Az outbox ma
kizárólag kiadás-bejegyzéseket ismer; egy kategória sorbaállítása bevezetné a
bejegyzések közti függőségi sorrendet (a kategória feltöltése előbb kell,
mint az őt hivatkozó kiadásé) és a bukott feltöltés öröklődő hatását (egy
elutasított kategória minden rá hivatkozó kiadást megbuktat). Ez a
komplexitás nem áll arányban a nyereséggel — egy offline felvitt kiadás
utólag, hálózat visszatértekor is felcímkézhető.

A sorbanálló (pending) kiadások címkéi rendben megjelennek: a payload
tartalmazza a `categoryIds`-t, a nevek pedig a gyorsítótárazott listából
jönnek.

## Érintett fájlok

**Megosztott sémák**

- `packages/shared/src/schemas/category.js` — új
- `packages/shared/src/index.js` — export
- `packages/shared/src/schemas/expense.js` — `categoryIds` a kérésben és a
  válaszban
- `packages/shared/src/schemas/eventStream.js` — három új üzenettípus

**Backend**

- `apps/api/src/models/categoryModel.js` — új
- `apps/api/src/models/expenseModel.js` — `categoryIds`
- `apps/api/src/repositories/categoryRepository.js` — új
- `apps/api/src/repositories/expenseRepository.js` — `detachCategory`
- `apps/api/src/services/categoryService.js` — új
- `apps/api/src/services/expenseService.js` — `assertCategories`,
  `buildExpenseData`
- `apps/api/src/routes/events.js` — `GET`/`POST /:id/categories`
- `apps/api/src/routes/categories.js` — új
- `apps/api/src/app.js` — regisztráció

**Frontend**

- `apps/web/src/offline/cacheKeys.js` — `categoriesCacheKey`
- `apps/web/src/stores/categories.js` — új
- `apps/web/src/stores/expenses.js` — három stream-kezelő, lekapcsolás
  törléskor
- `apps/web/src/components/CategoryPicker.vue` — új
- `apps/web/src/components/CategoryManagerModal.vue` — új
- `apps/web/src/components/ExpenseModal.vue` — sor, választó, payload
- `apps/web/src/components/ExpenseTable.vue` — címkék a leírás alatt
- `apps/web/src/views/EventDetailView.vue` — gomb, modal, betöltés
- `apps/web/src/assets/theme.css` — `.cat-tag`, paletta-tokenek

## Korlátok, döntések

- Egy kiadáson legfeljebb **10** kategória. Nem technikai korlát, hanem a
  felület védelme: ennél több címke a sorban olvashatatlan.
- A kategória neve legfeljebb **32** karakter, eseményen belül egyedi.
- A lista mindig **névsorban** áll, magyar összehasonlítással
  (`localeCompare(…, 'hu')` a kliensen, `collation` a szerveren).
- A kategória **nem** befolyásolja az elszámolást.
- A kategória a számla egészén van, **nem** tételenként.
