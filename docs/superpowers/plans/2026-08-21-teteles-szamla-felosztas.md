# Tételes számlafelosztás — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Egy fizetett számla egyetlen kiadásként legyen felvihető, tételekre bontva, tételenként külön osztozókkal.

**Architecture:** Az `Expense` dokumentum kap egy opcionális `items` altömböt (`description?`, `amountMinor`, `baseAmountMinor`, `sharedWithIds`). A kiadás `sharedWithIds`-e tételes módban a **számla résztvevőit** jelenti, a tételek ezen belül szűkítenek — ebből adódik az `items ⊆ sharedWithIds ⊆ event.participantIds` lánc, ami miatt a meglévő integritási védőkorlátok változtatás nélkül helyesek maradnak. Az átváltás tételenként történik, és a kiadás `baseAmountMinor`-ja a tételek forint-összegeinek **összege**, hogy az elszámolás „egyenlegek összege = 0" invariánsa ne sérüljön. Az `items` nélküli kiadás jelentése változatlan: nincs migráció.

**Tech Stack:** Node 22 (ESM, nincs TypeScript), Fastify 5 + `fastify-type-provider-zod`, Mongoose 8, Zod 3, `decimal.js`, Vue 3 (`<script setup>`) + Pinia + Vite 6, `idb` (IndexedDB), Docker Compose.

**Spec:** [`docs/superpowers/specs/2026-08-21-teteles-szamla-felosztas-design.md`](../specs/2026-08-21-teteles-szamla-felosztas-design.md)

## Global Constraints

- **Nincs tesztkeret ebben a projektben, és ne is vezess be egyet** (a Vitest/Testcontainers/Playwright szándékosan el van távolítva). Az ellenőrzés eszközei: egyszer használatos `node` scriptek, `npm run lint`, `npm run format:check`, `npm run build`, és kézi ellenőrzés a dev stackben.
- **Az egyszer használatos ellenőrző scriptek a munkamenet scratchpad könyvtárába kerülnek, nem a repóba**, és `.js` kiterjesztéssel (az ESLint config csak `**/*.js`-re ad node globálisokat). A lenti parancsokban `$SCRATCH` ezt a könyvtárat jelenti — állítsd be a task elején: `SCRATCH=<a munkamenet scratchpad könyvtára>`. Ezek a scriptek relatív helyett **absolute repó-útvonalról** importálnak (`/mnt/WDred/Docker/kassza/packages/shared/...`), így a Node a repó `node_modules`-át találja meg.
- **Ellenőrző parancsot SOHA ne csövezz `tail`-be, `head`-be vagy `grep`-be** — a pipe elnyeli a kilépési kódot, és egy bukott ellenőrzés zöldnek látszik.
- **Pénz:** minden összeg egész szám a pénznem legkisebb egységében (`amountMinor`). A `parseFloat`, `Number.parseFloat` és `.toFixed(` ESLint-tilos az egész kódbázisban, egyetlen kivétellel: `packages/shared/src/currency/format.js`.
- **Elszámolási pénznem mindig `SETTLEMENT_CURRENCY` (HUF)**, eseményenkénti választás nélkül.
- **Séma- és felületi üzenetek magyarul.**
- **Commit üzenetek magyarul**, `feat(...)` / `fix(...)` / `docs(...)` prefixszel. **Ne kerüljön bele `Co-Authored-By` sor.**
- **Tétel-korlátok:** `items` 1..50 elem; a tételezés hiányát a mező **elhagyása** jelenti, nem `items: []`. A tétel megnevezése opcionális, max 120 karakter. Egy tétel `amountMinor`-ja pozitív. A `MAX_EXPENSE_MAJOR_AMOUNT` (999999) felső korlát a **végösszegre** él.
- **Dev stack:** `npm run dev` a repó gyökerében (web: `http://localhost:5173`, az `/api` proxyzva). Ha compose-fájlt váltasz, `--build` kell; dev módban a friss `node_modules` volume-ba `npm ci` szükséges.

---

## Fájlszerkezet

Új fájl nem kell — a funkció a meglévő felelősségi körökbe illeszkedik.

| Fájl | Felelősség ebben a projektben |
| --- | --- |
| `packages/shared/src/currency/convert.js` | **Módosul:** új `convertExpenseAmounts` — a kiadás (és tételei) forint-értékének egyetlen igazsága. |
| `packages/shared/src/schemas/expense.js` | **Módosul:** tétel-sémák, `items` a kérésben/válaszban, invariánsok. |
| `packages/shared/src/schemas/settlement.js` | **Módosul:** `items` az elszámolás bemenetén + invariáns-ellenőrzés. |
| `packages/shared/src/settlement/computeSettlement.js` | **Módosul:** tételenkénti felosztás (a tétel nélküli kiadás egy implicit tétel). |
| `apps/api/src/models/expenseModel.js` | **Módosul:** `items` altömb. |
| `apps/api/src/repositories/expenseRepository.js` | **Módosul:** tétel-szerializálás (ObjectId → string) és a tételek `$unset`-je. |
| `apps/api/src/services/expenseService.js` | **Módosul:** `buildExpenseData` a `convertExpenseAmounts`-ra épül. |
| `apps/api/src/services/settlementService.js` | **Módosul:** az `items` átadása a `computeSettlement`-nek. |
| `apps/web/src/stores/expenses.js` | **Módosul:** a sorbanállított sorok tételenkénti forint-értéke. |
| `apps/web/src/components/SettlementPanel.vue` | **Módosul:** az `items` átadása a kliensoldali `computeSettlement`-nek. |
| `apps/web/src/components/ExpenseModal.vue` | **Módosul:** „Tételes felosztás" mód. |
| `apps/web/src/components/ExpenseTable.vue` | **Módosul:** lenyitható tétel-alsor. |
| `docs/ARCHITECTURE.md` | **Módosul:** adatmodell, pénzkezelés, elszámolás fejezetek. |

---

### Task 1: `convertExpenseAmounts` a shared csomagban

Ez a funkció pénzügyi alapköve: minden tétel külön váltódik a számla egyetlen árfolyamával, és a kiadás forint-összege a részek összege. Ha ez a szám a végösszeg **egyszeri** átváltásából jönne, a fizető „kifizette" oldala és a tételekből számolt tartozás-oldal két különböző kerekítésből származna, és néhány fillér elszivárogna — vagyis megsérülne a `computeSettlement` dokumentált invariánsa, hogy az egyenlegek összege pontosan 0.

**Files:**
- Modify: `packages/shared/src/currency/convert.js` (a fájl végére, a `convertMinorAmount` alá)

**Interfaces:**
- Consumes: `convertMinorAmount`, `SETTLEMENT_CURRENCY` (`./exponents.js`), `amountMinorSchema`, `currencyCodeSchema`, `exchangeRateStringSchema`
- Produces: `convertExpenseAmounts({ amountMinor, items?, currency, exchangeRate }) → { baseAmountMinor: number, items: object[] | undefined }`. A visszaadott tételek az eredeti tétel-objektumok, mindegyik egy plusz `baseAmountMinor` mezővel. Ismeretlen kulcsokat (pl. `description`, `sharedWithIds`) megtart. Az input-objektum további kulcsait (pl. `date`, `payerId`) figyelmen kívül hagyja — ezért hívható közvetlenül egy teljes kiadás-payloaddal.

- [ ] **Step 1: Írd meg az ellenőrző scriptet** (`$SCRATCH/verify-convert.js`)

```js
import assert from 'node:assert/strict';
import { convertExpenseAmounts } from '/mnt/WDred/Docker/kassza/packages/shared/src/currency/convert.js';

// 1. Forintos számla: nincs átváltás, a végösszeg a tételek összege.
{
  const result = convertExpenseAmounts({
    amountMinor: 17700,
    items: [
      { description: 'Közös', amountMinor: 12000, sharedWithIds: ['x', 'y', 'z'] },
      { amountMinor: 3500, sharedWithIds: ['x'] },
      { amountMinor: 2200, sharedWithIds: ['y'] },
    ],
    currency: 'HUF',
    exchangeRate: '1',
  });
  assert.equal(result.baseAmountMinor, 17700);
  assert.deepEqual(
    result.items.map((item) => item.baseAmountMinor),
    [12000, 3500, 2200],
  );
  // A kísérő mezők nem eshetnek ki.
  assert.equal(result.items[0].description, 'Közös');
  assert.deepEqual(result.items[1].sharedWithIds, ['x']);
}

// 2. Devizás számla: MINDEN tétel külön váltódik, és a kiadás
//    baseAmountMinor-ja a részek összege — nem a végösszeg átváltása.
//    333 * 3 = 999 cent, 1 cent = 4.005 Ft:
//      részenként round(333 * 4.005 / 100 ... ) -> lásd lent,
//      a végösszeg egyszeri átváltása MÁS számot adna.
{
  const items = [{ amountMinor: 333 }, { amountMinor: 333 }, { amountMinor: 333 }];
  const result = convertExpenseAmounts({
    amountMinor: 999,
    items,
    currency: 'EUR',
    exchangeRate: '4.005',
  });
  const perItem = result.items.map((item) => item.baseAmountMinor);
  assert.equal(
    result.baseAmountMinor,
    perItem.reduce((sum, value) => sum + value, 0),
    'a végösszeg a tételek forint-összegeinek összege kell legyen',
  );
}

// 3. Tétel nélküli kiadás: a mai viselkedés, items nélkül. Az árfolyam
//    jelentése „1 EUR = 400.5 HUF", tehát 1000 cent (10 EUR) -> 4005 Ft.
//    Ez SZÓ SZERINT az, amit a mai `convertMinorAmount` ad ugyanezekkel az
//    argumentumokkal — ezt a számítást a tételes felosztás NEM változtatja
//    meg, csak tételenként végzi el.
{
  const result = convertExpenseAmounts({
    amountMinor: 1000,
    currency: 'EUR',
    exchangeRate: '400.5',
  });
  assert.equal(result.baseAmountMinor, 4005);
  assert.equal(result.items, undefined);
}

// 4. Teljes payloaddal is hívható: az idegen kulcsok nem zavarják meg.
{
  const result = convertExpenseAmounts({
    date: '2026-08-21',
    description: 'Étterem',
    payerId: 'p1',
    amountMinor: 500,
    currency: 'HUF',
    exchangeRate: '1',
    rateSource: 'manual',
    sharedWithIds: ['x'],
  });
  assert.equal(result.baseAmountMinor, 500);
}

// 5. Érvénytelen bemenet dob (nulla összegű tétel).
assert.throws(() =>
  convertExpenseAmounts({
    amountMinor: 0,
    items: [{ amountMinor: 0, sharedWithIds: ['x'] }],
    currency: 'HUF',
    exchangeRate: '1',
  }),
);

console.log('convertExpenseAmounts: OK');
```

- [ ] **Step 2: Futtasd, és ellenőrizd, hogy elhasal**

Run: `node "$SCRATCH/verify-convert.js"`
Expected: FAIL — `SyntaxError: ... does not provide an export named 'convertExpenseAmounts'`

- [ ] **Step 3: Írd meg a függvényt**

`packages/shared/src/currency/convert.js` — az import-blokkot egészítsd ki (`getCurrencyExponent` mellé `SETTLEMENT_CURRENCY`):

```js
import { getCurrencyExponent, SETTLEMENT_CURRENCY } from './exponents.js';
```

A fájl végére:

```js
const convertExpenseAmountsInputSchema = z
  .object({
    amountMinor: amountMinorSchema.positive(),
    items: z
      .array(z.object({ amountMinor: amountMinorSchema.positive() }).passthrough())
      .min(1)
      .optional(),
    currency: currencyCodeSchema,
    exchangeRate: exchangeRateStringSchema,
  })
  // A hívók teljes kiadás-payloadot adnak át (dátum, fizető, osztozók is
  // benne van) — a séma alapból eldobja az ismeretlen kulcsokat, tehát nem
  // kell szűrni a hívási helyeken.
  .passthrough();

/**
 * Egy kiadás (és tételei) forint-összegének kiszámítása. Ez a **pénzlogika
 * egyetlen helye** erre a számításra: a backend `buildExpenseData`-ja, a
 * kliens sorbanállított-előnézete és az űrlap forint-előnézete is ezt hívja.
 *
 * Devizás kiadásnál minden tétel KÜLÖN váltódik a kiadás egyetlen
 * árfolyamával, és a kiadás `baseAmountMinor`-ja a tételek forint-összegeinek
 * ÖSSZEGE — nem a végösszeg egyszeri átváltása. Ez nem stílus kérdése: az
 * elszámolás a `baseAmountMinor`-t írja a fizető „kifizette" oldalára, a
 * tételekből számolt részeket pedig a tartozás oldalára. Két különböző
 * kerekítésből néhány fillér elszivárogna, és megsérülne a
 * `computeSettlement` invariánsa, hogy az egyenlegek összege pontosan 0.
 *
 * @param {{ amountMinor: number, items?: object[], currency: string, exchangeRate: string }} input
 * @returns {{ baseAmountMinor: number, items: object[] | undefined }}
 */
export function convertExpenseAmounts(input) {
  const { amountMinor, items, currency, exchangeRate } =
    convertExpenseAmountsInputSchema.parse(input);

  const toBaseAmountMinor = (minorAmount) =>
    currency === SETTLEMENT_CURRENCY
      ? minorAmount
      : convertMinorAmount({
          amountMinor: minorAmount,
          rate: exchangeRate,
          sourceCurrency: currency,
          targetCurrency: SETTLEMENT_CURRENCY,
        });

  if (!items) {
    return { baseAmountMinor: toBaseAmountMinor(amountMinor), items: undefined };
  }

  const convertedItems = items.map((item) => ({
    ...item,
    baseAmountMinor: toBaseAmountMinor(item.amountMinor),
  }));

  return {
    baseAmountMinor: convertedItems.reduce((sum, item) => sum + item.baseAmountMinor, 0),
    items: convertedItems,
  };
}
```

- [ ] **Step 4: Futtasd újra**

Run: `node "$SCRATCH/verify-convert.js"`
Expected: `convertExpenseAmounts: OK`

- [ ] **Step 5: Lint és formázás**

Run: `npm run lint && npm run format:check`
Expected: mindkettő hibátlanul lefut (0 exit kód)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/currency/convert.js
git commit -m "feat(shared): a kiadás forint-összege tételenkénti átváltásból áll össze"
```

---

### Task 2: Tétel-sémák a kiadás kérésében és válaszában

**Files:**
- Modify: `packages/shared/src/schemas/expense.js`

**Interfaces:**
- Consumes: `amountMinorSchema`, `personIdSchema` (`./money.js`)
- Produces: `expenseItemInputSchema`, `expenseItemResponseSchema`; a `createExpenseBodySchema` (`= updateExpenseBodySchema`) opcionális `items` mezője és három új invariánsa; az `expenseResponseSchema` opcionális `items` mezője (tételenként `baseAmountMinor`-ral). Az `expenseStreamMessageSchema` a válaszsémára épül, tehát külön munka nélkül átveszi a tételeket.

- [ ] **Step 1: Írd meg az ellenőrző scriptet** (`$SCRATCH/verify-expense-schema.js`)

```js
import assert from 'node:assert/strict';
import {
  createExpenseBodySchema,
  expenseResponseSchema,
} from '/mnt/WDred/Docker/kassza/packages/shared/src/schemas/expense.js';

const base = {
  date: '2026-08-21',
  description: 'Étterem',
  payerId: 'p-anna',
  currency: 'HUF',
  exchangeRate: '1',
  rateSource: 'manual',
  sharedWithIds: ['p-x', 'p-y', 'p-z'],
};

// 1. Érvényes tételes számla.
{
  const parsed = createExpenseBodySchema.parse({
    ...base,
    amountMinor: 17700,
    items: [
      { description: 'Közös', amountMinor: 12000, sharedWithIds: ['p-x', 'p-y', 'p-z'] },
      { amountMinor: 3500, sharedWithIds: ['p-x'] },
      { amountMinor: 2200, sharedWithIds: ['p-y'] },
    ],
  });
  assert.equal(parsed.items.length, 3);
  // A megnevezés opcionális.
  assert.equal(parsed.items[1].description, undefined);
}

// 2. Tétel nélküli (mai) kiadás továbbra is érvényes.
assert.ok(createExpenseBodySchema.parse({ ...base, amountMinor: 5000 }));

// 3. A tételek összege nem egyezik a végösszeggel -> hiba.
{
  const result = createExpenseBodySchema.safeParse({
    ...base,
    amountMinor: 17700,
    items: [{ amountMinor: 12000, sharedWithIds: ['p-x'] }],
  });
  assert.equal(result.success, false);
  assert.ok(
    result.error.issues.some((issue) => issue.path.join('.') === 'items'),
    'a hibának az items útvonalon kell megjelennie',
  );
}

// 4. A tétel osztozója nincs a számla résztvevői között -> hiba, a
//    pontos útvonalon (hogy az űrlap a megfelelő sorra tudja vetíteni).
{
  const result = createExpenseBodySchema.safeParse({
    ...base,
    amountMinor: 1000,
    items: [{ amountMinor: 1000, sharedWithIds: ['p-idegen'] }],
  });
  assert.equal(result.success, false);
  assert.ok(
    result.error.issues.some((issue) => issue.path.join('.') === 'items.0.sharedWithIds.0'),
  );
}

// 5. Üres tömb nem érvényes állapot: a tételezés hiányát a mező elhagyása
//    jelenti.
assert.equal(
  createExpenseBodySchema.safeParse({ ...base, amountMinor: 1000, items: [] }).success,
  false,
);

// 6. Tétel osztozó nélkül, és nem pozitív tételösszeg -> hiba.
assert.equal(
  createExpenseBodySchema.safeParse({
    ...base,
    amountMinor: 1000,
    items: [{ amountMinor: 1000, sharedWithIds: [] }],
  }).success,
  false,
);
assert.equal(
  createExpenseBodySchema.safeParse({
    ...base,
    amountMinor: 0,
    items: [{ amountMinor: 0, sharedWithIds: ['p-x'] }],
  }).success,
  false,
);

// 7. A felső korlát a VÉGÖSSZEGRE él.
assert.equal(
  createExpenseBodySchema.safeParse({
    ...base,
    amountMinor: 1000000,
    items: [
      { amountMinor: 999999, sharedWithIds: ['p-x'] },
      { amountMinor: 1, sharedWithIds: ['p-y'] },
    ],
  }).success,
  false,
);

// 8. A válaszsémában tételenként ott van a forint-összeg.
{
  const parsed = expenseResponseSchema.parse({
    id: 'e1',
    eventId: 'ev1',
    date: '2026-08-21T00:00:00.000Z',
    description: 'Étterem',
    payerId: 'p-anna',
    amountMinor: 1000,
    currency: 'HUF',
    exchangeRate: '1',
    rateSource: 'manual',
    rateFetchedAt: '2026-08-21T10:00:00.000Z',
    baseAmountMinor: 1000,
    sharedWithIds: ['p-x', 'p-y'],
    items: [{ amountMinor: 1000, baseAmountMinor: 1000, sharedWithIds: ['p-x'] }],
    createdAt: '2026-08-21T10:00:00.000Z',
    updatedAt: '2026-08-21T10:00:00.000Z',
  });
  assert.equal(parsed.items[0].baseAmountMinor, 1000);
}

console.log('expense séma: OK');
```

- [ ] **Step 2: Futtasd, és ellenőrizd, hogy elhasal**

Run: `node "$SCRATCH/verify-expense-schema.js"`
Expected: FAIL az 1. blokkban — `AssertionError` (a `parse` a mai sémával eldobja az `items` kulcsot, így `parsed.items` `undefined`, és a `.length` olvasása `TypeError`-t ad)

- [ ] **Step 3: Írd meg a sémákat**

`packages/shared/src/schemas/expense.js` — a `rateSourceEnumSchema` alá:

```js
/**
 * Egy számla egy tétele. A megnevezés elhagyható (a felület „—"-t mutat
 * helyette); az összeg a SZÁMLA pénznemének legkisebb egységében értendő,
 * mert egy számla egy pénznem és egy árfolyam.
 */
export const expenseItemInputSchema = z.object({
  description: z
    .string()
    .trim()
    .max(120, 'A tétel megnevezése legfeljebb 120 karakter lehet.')
    .optional(),
  amountMinor: amountMinorSchema.positive('A tétel összege pozitív kell legyen.'),
  sharedWithIds: z.array(personIdSchema).min(1, 'A tételen legalább egy osztozó szükséges.'),
});

/**
 * Ugyanaz, kimenetkor: a forint-összeget a szerver számolja (a kérés nem
 * tartalmazza), pontosan úgy, ahogy a kiadás szintjén sem.
 */
export const expenseItemResponseSchema = expenseItemInputSchema.extend({
  baseAmountMinor: amountMinorSchema,
});

const MAX_EXPENSE_ITEMS = 50;
```

A `createExpenseBodySchema` objektumába, a `sharedWithIds` alá:

```js
    /**
     * Tételes felosztás. A mező ELHAGYÁSA jelenti azt, hogy a kiadás nem
     * tételezett (a mai, egyenlő felosztás a `sharedWithIds` között) — egy
     * üres tömb nem érvényes állapot. Tételes módban a `sharedWithIds` a
     * SZÁMLA résztvevőit jelenti, a tételek ezen belül szűkítenek.
     */
    items: z
      .array(expenseItemInputSchema)
      .min(1, 'Legalább egy tétel szükséges.')
      .max(MAX_EXPENSE_ITEMS, `Legfeljebb ${MAX_EXPENSE_ITEMS} tétel adható meg.`)
      .optional(),
```

A meglévő `.superRefine((data, ctx) => { ... })` blokk **végére** (a felső korlát ellenőrzése után), a záró `})` előtt:

```js
    if (!data.items) {
      return;
    }

    const itemsTotalMinor = data.items.reduce((sum, item) => sum + item.amountMinor, 0);
    if (itemsTotalMinor !== data.amountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A tételek összege nem egyezik a végösszeggel.',
        path: ['items'],
      });
    }

    // A tételek osztozói a SZÁMLA résztvevői közül kell legyenek. Ez adja az
    // `items ⊆ sharedWithIds ⊆ event.participantIds` láncot, amire a szerver
    // `assertParticipants`-a és a személytörlés/résztvevő-eltávolítás
    // védőkorlátjai (mind `sharedWithIds`-re kérdeznek) változtatás nélkül
    // támaszkodhatnak.
    const billParticipants = new Set(data.sharedWithIds);
    data.items.forEach((item, index) => {
      item.sharedWithIds.forEach((personId, sharerIndex) => {
        if (!billParticipants.has(personId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'A tétel osztozója nem szerepel a számla résztvevői között.',
            path: ['items', index, 'sharedWithIds', sharerIndex],
          });
        }
      });
    });
```

Az `expenseResponseSchema` objektumába, a `sharedWithIds` alá:

```js
  items: z.array(expenseItemResponseSchema).min(1).optional(),
```

- [ ] **Step 4: Futtasd újra**

Run: `node "$SCRATCH/verify-expense-schema.js"`
Expected: `expense séma: OK`

- [ ] **Step 5: Lint és formázás**

Run: `npm run lint && npm run format:check`
Expected: hibátlan

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas/expense.js
git commit -m "feat(shared): a kiadás felvihető tételekre bontva"
```

---

### Task 3: Tételenkénti felosztás az elszámolásban

**Files:**
- Modify: `packages/shared/src/schemas/settlement.js`
- Modify: `packages/shared/src/settlement/computeSettlement.js`

**Interfaces:**
- Consumes: `splitEqually`, `amountMinorSchema`, `personIdSchema`
- Produces: a `computeSettlement` bemenetének kiadás-objektuma opcionális `items: [{ baseAmountMinor, sharedWithIds }]` mezőt fogad. A visszatérési érték alakja (`{ balances, transfers }`) nem változik.

- [ ] **Step 1: Írd meg az ellenőrző scriptet** (`$SCRATCH/verify-settlement.js`)

```js
import assert from 'node:assert/strict';
import { computeSettlement } from '/mnt/WDred/Docker/kassza/packages/shared/src/settlement/computeSettlement.js';

const participantIds = ['p-anna', 'p-x', 'p-y', 'p-z'];

// 1. A példa a specből: Anna fizet 17 700-at. Közös 12 000 (x, y, z),
//    szuvenír 3500 (x), koktél 2200 (y). Anna maga nem osztozik.
{
  const { balances, transfers } = computeSettlement({
    participantIds,
    expenses: [
      {
        payerId: 'p-anna',
        baseAmountMinor: 17700,
        sharedWithIds: ['p-x', 'p-y', 'p-z'],
        items: [
          { baseAmountMinor: 12000, sharedWithIds: ['p-x', 'p-y', 'p-z'] },
          { baseAmountMinor: 3500, sharedWithIds: ['p-x'] },
          { baseAmountMinor: 2200, sharedWithIds: ['p-y'] },
        ],
      },
    ],
  });

  const owed = new Map(balances.map((balance) => [balance.personId, balance.owedMinor]));
  assert.equal(owed.get('p-x'), 4000 + 3500);
  assert.equal(owed.get('p-y'), 4000 + 2200);
  assert.equal(owed.get('p-z'), 4000);
  assert.equal(owed.get('p-anna'), 0);

  // Az invariáns: az egyenlegek összege pontosan 0.
  assert.equal(
    balances.reduce((sum, balance) => sum + balance.balanceMinor, 0),
    0,
  );

  const toAnna = transfers.filter((transfer) => transfer.toId === 'p-anna');
  assert.equal(
    toAnna.reduce((sum, transfer) => sum + transfer.amountMinor, 0),
    17700,
  );
}

// 2. Tétel nélküli kiadás: a mai viselkedés változatlan (egyenlő felosztás,
//    determinisztikus maradékkal).
{
  const { balances } = computeSettlement({
    participantIds: ['p-a', 'p-b', 'p-c'],
    expenses: [{ payerId: 'p-a', baseAmountMinor: 100, sharedWithIds: ['p-a', 'p-b', 'p-c'] }],
  });
  assert.deepEqual(
    balances.map((balance) => balance.owedMinor),
    [34, 33, 33],
  );
}

// 3. Ha a tételek forint-összege nem adja ki a kiadás baseAmountMinor-ját,
//    a séma DOB — inkább hibaüzenet, mint csendben rossz egyenleg.
assert.throws(() =>
  computeSettlement({
    participantIds,
    expenses: [
      {
        payerId: 'p-anna',
        baseAmountMinor: 17700,
        sharedWithIds: ['p-x'],
        items: [{ baseAmountMinor: 12000, sharedWithIds: ['p-x'] }],
      },
    ],
  }),
);

// 4. Tétel-osztozó, aki nem résztvevője az eseménynek -> dob.
assert.throws(() =>
  computeSettlement({
    participantIds,
    expenses: [
      {
        payerId: 'p-anna',
        baseAmountMinor: 1000,
        sharedWithIds: ['p-x'],
        items: [{ baseAmountMinor: 1000, sharedWithIds: ['p-idegen'] }],
      },
    ],
  }),
);

console.log('computeSettlement: OK');
```

- [ ] **Step 2: Futtasd, és ellenőrizd, hogy elhasal**

Run: `node "$SCRATCH/verify-settlement.js"`
Expected: FAIL az 1. blokkban — a mai kód a teljes 17 700-at osztja el háromfelé, tehát `owed.get('p-x')` 5900 lesz 7500 helyett

- [ ] **Step 3: Egészítsd ki a bemeneti sémát**

`packages/shared/src/schemas/settlement.js` — a `settlementExpenseSchema` felett:

```js
const settlementExpenseItemSchema = z.object({
  baseAmountMinor: amountMinorSchema,
  sharedWithIds: z.array(personIdSchema).min(1),
});
```

A `settlementExpenseSchema` objektumába, a `sharedWithIds` alá:

```js
  items: z.array(settlementExpenseItemSchema).min(1).optional(),
```

A `computeSettlementInputSchema` `superRefine`-jában, a meglévő `expense.sharedWithIds.forEach(...)` blokk **után**, még az `input.expenses.forEach` callbackjén belül:

```js
      if (!expense.items) {
        return;
      }

      // A fizető „kifizette" oldalára a kiadás baseAmountMinor-ja kerül, a
      // tartozás oldalára a tételekből számolt részek. Ha a kettő nem ugyanaz
      // az összeg, az egyenlegek nem adnának ki nullát — ilyenkor inkább
      // dobjunk, mint hogy csendben rossz egyenleget mutassunk (a
      // SettlementPanel ezt a hibát üzenetként jeleníti meg).
      const itemsBaseTotalMinor = expense.items.reduce(
        (sum, item) => sum + item.baseAmountMinor,
        0,
      );
      if (itemsBaseTotalMinor !== expense.baseAmountMinor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `A ${index}. kiadás tételeinek alapösszege (${itemsBaseTotalMinor}) nem egyezik a kiadás alapösszegével (${expense.baseAmountMinor}).`,
          path: ['expenses', index, 'items'],
        });
      }

      expense.items.forEach((item, itemIndex) => {
        item.sharedWithIds.forEach((sharerId, sharerIndex) => {
          if (!participantSet.has(sharerId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `A ${index}. kiadás ${itemIndex}. tételének egy osztozója (${sharerId}) nem résztvevője az eseménynek.`,
              path: ['expenses', index, 'items', itemIndex, 'sharedWithIds', sharerIndex],
            });
          }
        });
      });
```

- [ ] **Step 4: Írd át a felosztás ciklusát**

`packages/shared/src/settlement/computeSettlement.js` — a JSDoc typedef sorát egészítsd ki:

```js
/**
 * @typedef {{ baseAmountMinor: number, sharedWithIds: string[] }} SettlementPart
 * @typedef {{ payerId: string, baseAmountMinor: number, sharedWithIds: string[], items?: SettlementPart[] }} SettlementExpense
```

A `for (const expense of expenses)` ciklus törzsében a `splitEqually`-t hívó rész helyére:

```js
    // A tétel nélküli kiadás EGY implicit tétel — így nincs két kódág, és a
    // mai (egyenlő felosztású) viselkedés szó szerint ugyanez a számítás.
    const parts = expense.items ?? [
      { baseAmountMinor: expense.baseAmountMinor, sharedWithIds: expense.sharedWithIds },
    ];

    for (const part of parts) {
      const shares = splitEqually({
        amountMinor: part.baseAmountMinor,
        participantIds: part.sharedWithIds,
      });
      for (const share of shares) {
        owedMinor.set(share.personId, owedMinor.get(share.personId) + share.shareMinor);
      }
    }
```

A függvény JSDoc-jába, a felosztás leírása után:

```
 * Tételes számlánál a felosztás tételenként történik: minden tétel a saját
 * osztozói között oszlik egyenlően. A fizető „kifizette" oldala változatlanul
 * a kiadás `baseAmountMinor`-ja — a bemeneti séma követeli meg, hogy ez a
 * tételek alapösszegeinek összege legyen.
```

- [ ] **Step 5: Futtasd újra**

Run: `node "$SCRATCH/verify-settlement.js"`
Expected: `computeSettlement: OK`

- [ ] **Step 6: Lint és formázás**

Run: `npm run lint && npm run format:check`
Expected: hibátlan

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schemas/settlement.js packages/shared/src/settlement/computeSettlement.js
git commit -m "feat(shared): az elszámolás tételenként osztja fel a számlát"
```

---

### Task 4: Backend — tárolás, szerializálás, elszámolás-végpont

Ebben a taskban három olyan csapda van, amit könnyű átnézni, és mindhárom **csendben** rossz adatot eredményez:

1. A Mongoose a tömb-mezőt alapból `[]`-ként adja vissza, a válaszséma viszont `min(1)`-et követel → az `items` nélküli kiadás GET-je hibára futna. Ezért `default: undefined` **és** a szerializálóban üres tömb esetén ki sem írjuk a mezőt.
2. A `doc.toObject()` a tétel `sharedWithIds`-ét `ObjectId` példányokként adja; a `personIdSchema` `z.string()` — a válaszséma elhasalna. A szerializálónak tételenként stringgé kell alakítania.
3. A `findByIdAndUpdate` az `undefined` mezőket **kihagyja** a `$set`-ből. Egy tételes → egyszerű szerkesztésnél emiatt a régi `items` bent maradna a dokumentumban: a lista a helyes végösszeget mutatná, az elszámolás viszont a megmaradt tételekből számolna. Ezért a tételek hiánya kifejezett `$unset`.

**Files:**
- Modify: `apps/api/src/models/expenseModel.js`
- Modify: `apps/api/src/repositories/expenseRepository.js:5-16` (`serialize`), `:52-56` (`updateExpense`)
- Modify: `apps/api/src/services/expenseService.js` (`buildExpenseData`, `assertParticipants` kommentje)
- Modify: `apps/api/src/services/settlementService.js:20-26`

**Interfaces:**
- Consumes: `convertExpenseAmounts` (Task 1), a `createExpenseBodySchema` `items` mezője (Task 2), a `computeSettlement` `items` bemenete (Task 3)
- Produces: a `POST /api/events/:id/expenses` és `PATCH /api/expenses/:id` elfogad és visszaad `items`-et (tételenként `baseAmountMinor`-ral); a `GET /api/events/:id/settlement` tételesen számol

- [ ] **Step 1: Vedd fel a tétel-altömböt a modellbe**

`apps/api/src/models/expenseModel.js` — a `const { Schema } = mongoose;` alá:

```js
/**
 * Egy számla egy tétele. Nincs saját `_id`-je (`_id: false`): a tételek
 * mindig a kiadással együtt íródnak, önállóan nem hivatkozzuk őket.
 */
const expenseItemSchema = new Schema(
  {
    description: { type: String, required: false, trim: true },
    amountMinor: { type: Number, required: true, min: 1 },
    baseAmountMinor: { type: Number, required: true, min: 0 },
    sharedWithIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Person' }],
      required: true,
      validate: [
        {
          validator: (ids) => ids.length >= 1,
          message: 'A tételen legalább egy osztozó szükséges.',
        },
      ],
    },
  },
  { _id: false },
);
```

Az `expenseSchema` objektumába, a `sharedWithIds` **után**:

```js
    /**
     * `default: undefined` — enélkül a Mongoose üres tömböt írna a tétel
     * nélküli kiadásokba, a válaszséma pedig `min(1)`-et követel: a mai,
     * egyszerű kiadások GET-je hasalna el a saját sémáján.
     */
    items: { type: [expenseItemSchema], required: false, default: undefined },
```

- [ ] **Step 2: Javítsd a szerializálást**

`apps/api/src/repositories/expenseRepository.js` — a `serialize` fölé:

```js
/**
 * A tétel osztozói a Mongo-ból `ObjectId` példányként jönnek, a válaszséma
 * `personIdSchema`-ja viszont stringet vár — enélkül a séma-validáció a
 * kimenetnél hasal el.
 * @param {object} item
 */
function serializeItem(item) {
  return { ...item, sharedWithIds: item.sharedWithIds.map(String) };
}
```

A `serialize` törzsét cseréld erre:

```js
function serialize(doc) {
  const { _id, __v, eventId, payerId, sharedWithIds, items, ...rest } = doc.toObject();
  return {
    id: _id.toString(),
    eventId: eventId.toString(),
    payerId: payerId.toString(),
    sharedWithIds: sharedWithIds.map(String),
    // Üres/hiányzó tétellistánál a mezőt KI SEM írjuk: a válaszséma az
    // `items`-et opcionálisnak, de nem üresnek fogadja el — a tételezés
    // hiányát a mező elhagyása jelenti.
    ...(items?.length ? { items: items.map(serializeItem) } : {}),
    ...rest,
  };
}
```

- [ ] **Step 3: Írd át az update-et kifejezett `$unset`-re**

`apps/api/src/repositories/expenseRepository.js` — az `updateExpense` törzsét cseréld erre:

```js
export async function updateExpense(id, input) {
  const { items, ...withoutItems } = input;
  // A `findByIdAndUpdate` az undefined mezőket kihagyja a `$set`-ből (erre
  // támaszkodik a `clientId` megőrzése is, lásd `expenseService`), tehát egy
  // tételes → egyszerű szerkesztésnél a régi `items` bent maradna: a lista a
  // helyes végösszeget mutatná, az elszámolás viszont a megmaradt tételekből
  // számolna. Ezért a tételek hiánya kifejezett `$unset`.
  const update = items ? { $set: input } : { $set: withoutItems, $unset: { items: 1 } };
  const doc = await ExpenseModel.findByIdAndUpdate(id, update, {
    new: true,
    runValidators: true,
  });
  return doc ? serialize(doc) : null;
}
```

- [ ] **Step 4: Kapcsold be a tételes átváltást a service-ben**

`apps/api/src/services/expenseService.js` — az import sorát cseréld:

```js
import { convertExpenseAmounts, SETTLEMENT_CURRENCY } from '@filler/shared';
```

A `buildExpenseData`-ban a `baseAmountMinor` számítását cseréld erre (a `rateFetchedAt` alatt):

```js
  // Egy helyen, a shared csomagban: minden tétel külön váltódik a kiadás
  // egyetlen (itt már kikényszerített) árfolyamával, és a kiadás
  // `baseAmountMinor`-ja a tételek forint-összegeinek összege.
  const { baseAmountMinor, items } = convertExpenseAmounts({
    amountMinor: input.amountMinor,
    items: input.items,
    currency: input.currency,
    exchangeRate,
  });
```

A `return` objektumban a `baseAmountMinor` sor után:

```js
    items,
```

Az `assertParticipants` JSDoc-ja alá vedd fel, miért nem kell itt új ellenőrzés:

```js
/**
 * A tételekre nincs külön ellenőrzés, és ez nem kihagyás: a kérés sémája
 * megköveteli, hogy minden tétel osztozója a kiadás `sharedWithIds`-ében
 * legyen, ez a függvény pedig a `sharedWithIds`-et az esemény résztvevőihez
 * méri. Az `items ⊆ sharedWithIds ⊆ event.participantIds` láncból következik,
 * hogy egy tétel-osztozó sem lehet kívülálló.
 */
```

- [ ] **Step 5: Adj tételeket az elszámolás-végpontnak**

`apps/api/src/services/settlementService.js` — a `computeSettlement` hívásában a `map` callbackjét cseréld erre:

```js
    expenses: expenses.map((expense) => ({
      payerId: expense.payerId,
      baseAmountMinor: expense.baseAmountMinor,
      sharedWithIds: expense.sharedWithIds,
      // Csak akkor adjuk át, ha van: az `items: undefined` a sémán átmegy, de
      // az explicit feltétel dokumentálja, hogy a tétel nélküli kiadás
      // szándékosan a régi úton (egyenlő felosztással) számol.
      ...(expense.items ? { items: expense.items } : {}),
    })),
```

- [ ] **Step 6: Indítsd a dev stacket**

Run: `npm run dev`
Expected: `api` és `web` elindul; a web `http://localhost:5173`-on válaszol. (Ha a `mongod` beragad egy újraépítés után, a beragadt docker CLI-t PID szerint kell kilőni — ne a démont indítsd újra.)

- [ ] **Step 7: Ellenőrizd végponton, kézzel**

Egy második terminálban (a jelszó a `.env` `APP_PASSWORD`-je):

```bash
# pipefail: az id-kinyerő csövek hibája ne maradjon néma
set -euo pipefail
BASE=http://localhost:5173/api
JAR=$(mktemp)
PW=$(grep '^APP_PASSWORD=' .env | cut -d= -f2-)

curl -sf -c "$JAR" -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"password\":\"$PW\"}" >/dev/null

# Három személy és egy esemény
X=$(curl -sf -b "$JAR" -X POST "$BASE/people" -H 'content-type: application/json' -d '{"name":"Teszt X"}' | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).id))')
Y=$(curl -sf -b "$JAR" -X POST "$BASE/people" -H 'content-type: application/json' -d '{"name":"Teszt Y"}' | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).id))')
Z=$(curl -sf -b "$JAR" -X POST "$BASE/people" -H 'content-type: application/json' -d '{"name":"Teszt Z"}' | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).id))')
EV=$(curl -sf -b "$JAR" -X POST "$BASE/events" -H 'content-type: application/json' \
  -d "{\"name\":\"Tétel-teszt\",\"defaultCurrency\":\"HUF\",\"participantIds\":[\"$X\",\"$Y\",\"$Z\"],\"startDate\":\"2026-08-21\",\"endDate\":\"2026-08-21\"}" \
  | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).id))')

# Tételes számla: X fizet, közös 12000 + szuvenír 3500 (X) + koktél 2200 (Y)
EXP=$(curl -sf -b "$JAR" -X POST "$BASE/events/$EV/expenses" -H 'content-type: application/json' -d "{
  \"date\":\"2026-08-21\",\"description\":\"Étterem\",\"payerId\":\"$X\",
  \"amountMinor\":17700,\"currency\":\"HUF\",\"exchangeRate\":\"1\",\"rateSource\":\"manual\",
  \"sharedWithIds\":[\"$X\",\"$Y\",\"$Z\"],
  \"items\":[
    {\"description\":\"Közös\",\"amountMinor\":12000,\"sharedWithIds\":[\"$X\",\"$Y\",\"$Z\"]},
    {\"description\":\"Szuvenír\",\"amountMinor\":3500,\"sharedWithIds\":[\"$X\"]},
    {\"description\":\"Koktél\",\"amountMinor\":2200,\"sharedWithIds\":[\"$Y\"]}
  ]}")
echo "$EXP"
```

Expected: a válaszban `"items"` három elemmel, mindegyiken `baseAmountMinor` (12000 / 3500 / 2200), a `sharedWithIds` **stringekkel**, és `"baseAmountMinor":17700`.

```bash
curl -sf -b "$JAR" "$BASE/events/$EV/settlement"
```

Expected: `Y` tartozása 4000+2200 = 6200, `Z`-é 4000, és a `transfers` összesen 10200-at utal `X`-nek.

```bash
# Rossz végösszeg -> 400-as validációs hiba, nem néma mentés
curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR" -X POST "$BASE/events/$EV/expenses" \
  -H 'content-type: application/json' -d "{
  \"date\":\"2026-08-21\",\"description\":\"Rossz\",\"payerId\":\"$X\",
  \"amountMinor\":9999,\"currency\":\"HUF\",\"exchangeRate\":\"1\",\"rateSource\":\"manual\",
  \"sharedWithIds\":[\"$X\"],\"items\":[{\"amountMinor\":1,\"sharedWithIds\":[\"$X\"]}]}"
```

Expected: `400`

```bash
# A 3. csapda: tételesből egyszerűbe szerkesztés törli a tételeket
ID=$(echo "$EXP" | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).id))')
curl -sf -b "$JAR" -X PATCH "$BASE/expenses/$ID" -H 'content-type: application/json' -d "{
  \"date\":\"2026-08-21\",\"description\":\"Étterem\",\"payerId\":\"$X\",
  \"amountMinor\":17700,\"currency\":\"HUF\",\"exchangeRate\":\"1\",\"rateSource\":\"manual\",
  \"sharedWithIds\":[\"$X\",\"$Y\",\"$Z\"]}"
```

Expected: a válaszban **nincs** `items` kulcs, és a `GET /events/$EV/settlement` innentől egyenlően oszt (mindenki 5900).

- [ ] **Step 8: Lint, formázás, build**

Run: `npm run lint && npm run format:check && npm run build`
Expected: mindhárom hibátlan

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/models/expenseModel.js apps/api/src/repositories/expenseRepository.js apps/api/src/services/expenseService.js apps/api/src/services/settlementService.js
git commit -m "feat(api): a tételes számla tárolása és tételenkénti elszámolása"
```

---

### Task 5: Kliensoldali elszámolás tételesen (sorbanállított sorokkal együtt)

A `SettlementPanel` **a kliensen** számol, a store kiadáslistájából — a szerver `/settlement` végpontja csak a másik fogyasztó. Ezért a tételeknek el kell jutniuk a `computeSettlement`-ig, és a sorbanállított (még fel nem töltött) számla tételeire **a kliensnek magának kell** kiszámolnia a forint-értéket: enélkül a függőben lévő számla tételei `baseAmountMinor` nélkül érkeznének a sémába, ami dobna — és az egész esemény elszámolása hibaállapotba menne, amíg a számla a sorban áll.

**Files:**
- Modify: `apps/web/src/stores/expenses.js:70-135` (`computePendingBaseAmountMinor`, `toPendingExpense`, `toPendingUpdate`)
- Modify: `apps/web/src/components/SettlementPanel.vue:30-45`

**Interfaces:**
- Consumes: `convertExpenseAmounts` (Task 1), a `computeSettlement` `items` bemenete (Task 3)
- Produces: a store `expenses` listájának elemein tételes kiadás esetén `items` van, tételenként `baseAmountMinor`-ral — a szervertől kapott és a sorbanállított sorokon egyaránt

- [ ] **Step 1: Cseréld le a pending forint-számítást**

`apps/web/src/stores/expenses.js` — az importban a `convertMinorAmount` helyére (ha máshol nem használja a fájl, cseréld; ha igen, vedd fel mellé):

```js
import { convertExpenseAmounts, SETTLEMENT_CURRENCY } from '@filler/shared';
```

A `computePendingBaseAmountMinor` függvényt töröld, és a helyére:

```js
/**
 * Ugyanaz a számítás, amit a szerver `buildExpenseData`-ja végez — csak
 * (deviza esetén) a felvitelkor/szerkesztéskor ismert, esetleg cache-elt
 * árfolyammal. NE a nyers `amountMinor` kerüljön a listába: az elszámolás
 * ebből a listából számol, tehát egy 10 EUR-os kiadás 10 forintként rontaná
 * el az egyenlegeket. A végleges érték a feltöltéskor, friss árfolyammal dől
 * el.
 *
 * Tételes számlánál a tételekre is rá kell írni a forint-értéket, mert az
 * elszámolás bemeneti sémája tételenként megköveteli — enélkül egy függőben
 * lévő számla az EGÉSZ esemény elszámolását hibaállapotba vinné, amíg a
 * sorban áll.
 *
 * Ezt hívja mind a létrehozás (`toPendingExpense`), mind a szerkesztés
 * (`toPendingUpdate`) sorbaállított alakja — egy helyen, hogy a két út ne
 * csúszhasson szét.
 * @param {object} payload a szervernek szánt kiadás-payload
 * @returns {{ baseAmountMinor: number, items: object[] | undefined }}
 */
function computePendingAmounts(payload) {
  return convertExpenseAmounts(payload);
}
```

- [ ] **Step 2: Írd át a két pending-alakot**

`toPendingExpense`:

```js
function toPendingExpense(entry) {
  const { baseAmountMinor, items } = computePendingAmounts(entry.payload);
  return {
    ...entry.payload,
    id: `pending:${entry.id}`,
    eventId: entry.eventId,
    date: new Date(entry.payload.date),
    baseAmountMinor,
    ...(items ? { items } : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    pending: true,
  };
}
```

`toPendingUpdate`:

```js
function toPendingUpdate(existing, payload) {
  const { baseAmountMinor, items } = computePendingAmounts(payload);
  // A tételek NEM örökölhetők a régi sorból: egy tételesből egyszerűvé
  // szerkesztésnél a `...existing` bent hagyná őket, és a lista a helyes
  // végösszeget mutatná, miközben az elszámolás a megmaradt tételekből
  // számolna (ugyanaz a csapda, amit a szerveren a `$unset` zár ki).
  const { items: _previousItems, ...existingWithoutItems } = existing;
  return {
    ...existingWithoutItems,
    ...payload,
    // A `date` az űrlapról (és az outbox payload-ból) ÉÉÉÉ-HH-NN string, a
    // listában viszont Date — a rendezés (compareExpenses) getTime()-ot hív
    // rá.
    date: new Date(payload.date),
    baseAmountMinor,
    ...(items ? { items } : {}),
    pending: true,
  };
}
```

Ha a `SETTLEMENT_CURRENCY` importja emiatt használatlanná vált a fájlban, vedd ki az importból (a lint jelezni fogja).

- [ ] **Step 3: Add át a tételeket a panelnek**

`apps/web/src/components/SettlementPanel.vue` — a `computeSettlement` hívásában a `map` callbackjét:

```js
      expenses: expensesStore.expenses.map((expense) => ({
        payerId: expense.payerId,
        baseAmountMinor: expense.baseAmountMinor,
        sharedWithIds: expense.sharedWithIds,
        ...(expense.items ? { items: expense.items } : {}),
      })),
```

- [ ] **Step 4: Ellenőrizd a böngészőben**

A dev stack (`npm run dev`) mellett, `http://localhost:5173`:

1. Nyisd meg a Task 4-ben létrehozott „Tétel-teszt" eseményt (vagy vigyél fel egy tételes számlát a végponton keresztül).
2. Expected: az „Elszámolás" fül `Y`-nál 6200, `Z`-nél 4000 tartozást mutat, és nincs hibaüzenet a panelen.
3. Kapcsold ki a hálózatot a DevTools Network fülén („Offline"), vigyél fel egy tételes számlát az űrlapon (Task 6 után) vagy — ha az űrlap még nincs kész — hagyd ki ezt a pontot, és Task 6 végén térj vissza ide.
4. Expected: a függőben lévő sor mellett az elszámolás továbbra is számol (nem „Nem sikerült…" üzenet), és a figyelmeztetés a nem véglegesített árfolyamról megjelenik.

- [ ] **Step 5: Lint, formázás, build**

Run: `npm run lint && npm run format:check && npm run build`
Expected: mindhárom hibátlan

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/expenses.js apps/web/src/components/SettlementPanel.vue
git commit -m "feat(web): a kliensoldali elszámolás a tételekből számol"
```

---

### Task 6: „Tételes felosztás" mód a kiadás-űrlapon

A meglévő űrlap érintetlen marad kikapcsolt állapotban. Bekapcsolva a „Ki osztozik rajta" blokk jelentése **a számla résztvevői**, és az `Összeg` mező helyére tételsorok kerülnek — a chipek tételenként **csak a számla résztvevőit** kínálják.

**Files:**
- Modify: `apps/web/src/components/ExpenseModal.vue`

**Interfaces:**
- Consumes: `convertExpenseAmounts`, `formatMoney` (`@filler/shared`)
- Produces: a `submit` esemény payloadja tételes módban `items: [{ description?, amountMinor, sharedWithIds }]`-t tartalmaz, és az `amountMinor` a tételek összege. A második argumentum (`{ rateResolvedByForm }`) változatlan — a kliensoldali kísérő tény továbbra sem kerülhet a payloadba.

- [ ] **Step 1: Vedd fel az állapotot és a számított értékeket**

`apps/web/src/components/ExpenseModal.vue` — az import-blokkot egészítsd ki (`convertExpenseAmounts`, `formatMoney`):

```js
import {
  convertExpenseAmounts,
  formatMoney,
  getCurrencyExponent,
  MAX_EXPENSE_MAJOR_AMOUNT,
  SETTLEMENT_CURRENCY,
  SUPPORTED_CURRENCIES,
} from '@filler/shared';
```

(A `convertMinorAmount` importja kivehető: a forint-előnézet innentől a `convertExpenseAmounts`-ot hívja.)

A `sharedWithIds` ref alá:

```js
const itemized = ref(false);
/**
 * Tételsorok az űrlap alakjában: az összeg itt MAJOR egységben van (mint a
 * kiadás `amountMajor`-ja), a `key` pedig csak a Vue listakulcsa — a
 * payloadba nem kerül bele.
 * @type {import('vue').Ref<Array<{ key: number, description: string, amountMajor: number | null, sharedWithIds: string[] }>>}
 */
const items = ref([]);
let nextItemKey = 0;

function createItem(overrides = {}) {
  nextItemKey += 1;
  return {
    key: nextItemKey,
    description: '',
    amountMajor: null,
    sharedWithIds: [...sharedWithIds.value],
    ...overrides,
  };
}
```

- [ ] **Step 2: Egészítsd ki a betöltést és a „nem mentett módosítás" ellenőrzést**

A `snapshot()` visszatérési objektumába, a `sharedWithIds` sor után:

```js
    itemized: itemized.value,
    items: items.value.map((item) => ({
      description: item.description,
      amountMajor: item.amountMajor,
      sharedWithIds: [...item.sharedWithIds].sort(),
    })),
```

A `resetFromExpense` **`if (expense)`** ágába, a `sharedWithIds.value = [...expense.sharedWithIds];` után:

```js
    itemized.value = Array.isArray(expense.items) && expense.items.length > 0;
    items.value = (expense.items ?? []).map((item) =>
      createItem({
        description: item.description ?? '',
        amountMajor: item.amountMinor / 10 ** exponent,
        sharedWithIds: [...item.sharedWithIds],
      }),
    );
```

Az `else` ágba, a `sharedWithIds.value = [...props.event.participantIds];` után:

```js
    itemized.value = false;
    items.value = [];
```

- [ ] **Step 3: Írd meg a tétel-műveleteket és a végösszeget**

A `currencyExponent` / `amountStep` computed-ek alá:

```js
/**
 * Egy tételsor összege a pénznem legkisebb egységében. Üres/érvénytelen
 * bevitelnél 0 — a validáció ezt hibaként jelzi, de a végösszeg addig is
 * számolható marad.
 * @param {{ amountMajor: number | null }} item
 */
function itemAmountMinor(item) {
  if (item.amountMajor === null || Number.isNaN(item.amountMajor)) {
    return 0;
  }
  return Math.round(item.amountMajor * 10 ** currencyExponent.value);
}

const itemsTotalMinor = computed(() =>
  items.value.reduce((sum, item) => sum + itemAmountMinor(item), 0),
);

/** A mentendő végösszeg: tételes módban a tételek összege. */
const effectiveAmountMinor = computed(() =>
  itemized.value ? itemsTotalMinor.value : amountMinor.value,
);

const itemsTotalLabel = computed(() =>
  formatMoney({ amountMinor: itemsTotalMinor.value, currency: currency.value }),
);

function toggleItemized() {
  if (itemized.value) {
    if (
      items.value.length > 0 &&
      !window.confirm('A tételbontás elveszik, a végösszeg egyetlen összegként marad. Folytatod?')
    ) {
      return;
    }
    amountMajor.value =
      itemsTotalMinor.value > 0 ? itemsTotalMinor.value / 10 ** currencyExponent.value : null;
    items.value = [];
    itemized.value = false;
    return;
  }
  // Bekapcsolásnál a már beírt összeg egyetlen tételbe kerül, a számla
  // minden résztvevőjével — a „közös" tétel. Így semmi nem veszik el.
  items.value = [createItem({ amountMajor: amountMajor.value })];
  itemized.value = true;
}

function addItem() {
  items.value.push(createItem());
}

function removeItem(index) {
  items.value.splice(index, 1);
  // Tételes módban mindig legyen legalább egy sor: egy üres lista se a
  // felületen, se a payloadban nem érvényes állapot.
  if (items.value.length === 0) {
    addItem();
  }
}

function toggleItemParticipant(item, personId) {
  const index = item.sharedWithIds.indexOf(personId);
  if (index === -1) {
    item.sharedWithIds.push(personId);
  } else {
    item.sharedWithIds.splice(index, 1);
  }
}

function selectAllForItem(item) {
  item.sharedWithIds = [...sharedWithIds.value];
}

/**
 * A számla azon résztvevői, akik egyetlen tételen sem osztoznak. Nem hiba
 * (szerkesztés közben átmenetileg mindig van ilyen), csak halk jelzés — ők
 * nem tartoznak semmivel.
 */
const participantsWithoutItemLabel = computed(() => {
  if (!itemized.value) {
    return '';
  }
  const covered = new Set(items.value.flatMap((item) => item.sharedWithIds));
  const names = sharedWithIds.value
    .filter((id) => !covered.has(id))
    .map((id) => participantName(id));
  if (names.length === 0) {
    return '';
  }
  return `${names.join(', ')} egyetlen tételen sem osztozik — nem tartozik semmivel.`;
});
```

- [ ] **Step 4: Kösd a forint-előnézetet a tételekhez**

A `baseAmountPreview` computed-et cseréld erre:

```js
const baseAmountPreview = computed(() => {
  const amount = effectiveAmountMinor.value;
  if (amount === null || amount <= 0) {
    return null;
  }
  try {
    // Ugyanaz a függvény, ami a szerveren is számol — így a mutatott szám
    // pontosan az, ami tárolódni fog (a tételek külön átváltásának összege),
    // nem a végösszeg egyszeri átváltása.
    return convertExpenseAmounts({
      amountMinor: amount,
      items: itemized.value
        ? items.value.map((item) => ({ amountMinor: itemAmountMinor(item) }))
        : undefined,
      currency: currency.value,
      exchangeRate: exchangeRate.value,
    }).baseAmountMinor;
  } catch {
    return null;
  }
});
```

- [ ] **Step 5: Terjeszd ki a számla-résztvevő eltávolítását a tételekre**

A `toggleParticipant` törzsét cseréld erre:

```js
function toggleParticipant(personId) {
  const index = sharedWithIds.value.indexOf(personId);
  if (index === -1) {
    sharedWithIds.value.push(personId);
    return;
  }
  sharedWithIds.value.splice(index, 1);
  // Aki nem szerepel a számlán, nem szerepelhet a tételein sem — enélkül a
  // szerver a részhalmaz-invariánson utasítaná el a mentést, egy olyan
  // chipre hivatkozva, ami a felületen már nem is látszik.
  for (const item of items.value) {
    const itemIndex = item.sharedWithIds.indexOf(personId);
    if (itemIndex !== -1) {
      item.sharedWithIds.splice(itemIndex, 1);
    }
  }
}
```

- [ ] **Step 6: Egészítsd ki a validációt és a beküldést**

A `validate()`-ben az összeg-ellenőrzés blokkját cseréld erre:

```js
  const maxAmountMinor = MAX_EXPENSE_MAJOR_AMOUNT * 10 ** currencyExponent.value;
  if (itemized.value) {
    const itemErrors = items.value.map((item) => {
      if (itemAmountMinor(item) <= 0) {
        return 'A tétel összege pozitív szám kell legyen.';
      }
      if (item.sharedWithIds.length === 0) {
        return 'Válassz legalább egy osztozót a tételhez.';
      }
      return '';
    });
    if (itemErrors.some(Boolean)) {
      errors.itemRows = itemErrors;
    }
    if (itemsTotalMinor.value > maxAmountMinor) {
      errors.amount = `A végösszeg legfeljebb ${MAX_EXPENSE_MAJOR_AMOUNT} lehet.`;
    }
  } else if (amountMinor.value === null || amountMinor.value <= 0) {
    errors.amount = 'Az összeg pozitív szám kell legyen.';
  } else if (amountMinor.value > maxAmountMinor) {
    errors.amount = `Az összeg legfeljebb ${MAX_EXPENSE_MAJOR_AMOUNT} lehet.`;
  }
```

A `handleSubmit` payloadjában az `amountMinor` sort és az `sharedWithIds` sor utáni részt:

```js
      amountMinor: effectiveAmountMinor.value,
```

```js
      sharedWithIds: sharedWithIds.value,
      // Nem tételes módban a mező ELHAGYVA megy (undefined): a JSON-ból
      // kimarad, és a szerver ebből tudja, hogy nincs tételezés.
      items: itemized.value
        ? items.value.map((item) => ({
            ...(item.description.trim() ? { description: item.description.trim() } : {}),
            amountMinor: itemAmountMinor(item),
            sharedWithIds: [...item.sharedWithIds],
          }))
        : undefined,
```

- [ ] **Step 7: Írd meg a sablont**

A „Ki osztozik rajta" `<legend>` sorát cseréld:

```html
        <legend>{{ itemized ? 'Kik szerepelnek a számlán' : 'Ki osztozik rajta' }}</legend>
```

A leírás-mező (`expense-description`) hibaüzenete **után**, az összeg/valuta `modal__row` **előtt** vedd fel a kapcsolót és a tétellistát:

```html
        <div class="expense-modal__itemized">
          <label class="expense-modal__itemized-label">
            <input
              type="checkbox"
              :checked="itemized"
              :disabled="saving"
              @change="toggleItemized"
            />
            Tételes felosztás
          </label>
          <p class="expense-modal__itemized-hint">
            Egy számla, több tétel — tételenként más osztozókkal.
          </p>
        </div>

        <fieldset v-if="itemized" class="modal__fieldset">
          <legend>Tételek</legend>
          <div v-for="(item, index) in items" :key="item.key" class="expense-item">
            <div class="expense-item__row">
              <input
                v-model="item.description"
                type="text"
                class="expense-item__description"
                placeholder="Megnevezés (nem kötelező)"
                :aria-label="`${index + 1}. tétel megnevezése`"
                :disabled="saving"
              />
              <input
                v-model.number="item.amountMajor"
                type="number"
                class="money-input expense-item__amount"
                :step="amountStep"
                min="0"
                :aria-label="`${index + 1}. tétel összege`"
                :disabled="saving"
              />
              <button
                type="button"
                class="btn btn--ghost btn--small expense-item__remove"
                :aria-label="`${index + 1}. tétel törlése`"
                :disabled="saving"
                @click="removeItem(index)"
              >
                ×
              </button>
            </div>
            <div class="modal__participants">
              <button
                type="button"
                class="participant-chip expense-item__all"
                :disabled="saving"
                @click="selectAllForItem(item)"
              >
                Mind
              </button>
              <button
                v-for="id in sharedWithIds"
                :key="id"
                type="button"
                class="participant-chip"
                :class="{ 'is-selected': item.sharedWithIds.includes(id) }"
                :aria-pressed="item.sharedWithIds.includes(id)"
                :disabled="saving"
                @click="toggleItemParticipant(item, id)"
              >
                {{ participantName(id) }}
              </button>
            </div>
            <p v-if="fieldErrors.itemRows?.[index]" role="alert" class="field-error">
              {{ fieldErrors.itemRows[index] }}
            </p>
          </div>
          <button
            type="button"
            class="btn btn--ghost btn--small"
            :disabled="saving"
            @click="addItem"
          >
            + Tétel
          </button>
          <p v-if="participantsWithoutItemLabel" class="expense-modal__no-item-note">
            {{ participantsWithoutItemLabel }}
          </p>
        </fieldset>
```

Az összeg/valuta `modal__row`-ban az összeg-mezőt cseréld erre (a valuta `<select>` blokkja változatlan):

```html
          <div class="field">
            <template v-if="!itemized">
              <label for="expense-amount">Összeg</label>
              <input
                id="expense-amount"
                v-model.number="amountMajor"
                type="number"
                class="money-input"
                :step="amountStep"
                min="0"
                :max="MAX_EXPENSE_MAJOR_AMOUNT"
                required
                :disabled="saving"
              />
            </template>
            <template v-else>
              <span class="expense-modal__pseudo-label">Végösszeg</span>
              <output class="money expense-modal__total">{{ itemsTotalLabel }}</output>
            </template>
          </div>
```

- [ ] **Step 8: Vedd fel a stílusokat**

A `<style scoped>` blokk végére:

```css
.expense-modal__itemized {
  margin: var(--space-3) 0 var(--space-4);
}

.expense-modal__itemized-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
}

.expense-modal__itemized-hint,
.expense-modal__no-item-note {
  margin: var(--space-1) 0 0;
  font-size: 0.8rem;
  color: var(--ink-soft);
}

/* Tételsor: letépett nyugta-csík a nyugta-lapon belül. */
.expense-item {
  padding: var(--space-2) 0;
  border-bottom: 1px dashed var(--rule);
}

.expense-item__row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin-bottom: var(--space-2);
}

.expense-item__description {
  flex: 1;
  min-width: 0;
}

.expense-item__amount {
  width: 8rem;
  flex-shrink: 0;
}

.expense-item__remove {
  flex-shrink: 0;
  line-height: 1;
}

.expense-item__all {
  border-style: dashed;
}

.expense-modal__pseudo-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--ink-soft);
  margin-bottom: var(--space-2);
}

.expense-modal__total {
  display: block;
  font-family: var(--font-mono);
  font-weight: 600;
  padding: 0.55em 0;
}

@media (max-width: 640px) {
  .expense-item__amount {
    width: 6rem;
  }
}
```

- [ ] **Step 9: Ellenőrizd a böngészőben**

A dev stack mellett, `http://localhost:5173`, egy legalább 3 résztvevős eseményen:

1. „+ Új kiadás" → az űrlap a mai alakjában nyílik, tételek nélkül.
2. Kapcsold be a „Tételes felosztás"-t → egy tétel jelenik meg minden résztvevővel; írj be 12000-et, majd „+ Tétel" kétszer (3500 csak X-nek, 2200 csak Y-nak). Expected: a `Végösszeg` 17 700-at mutat, alatta a forint-előnézet.
3. Vedd ki Z-t a „Kik szerepelnek a számlán" blokkból. Expected: Z chipje eltűnik a tételsorokból is.
4. Tedd vissza Z-t, majd mentsd. Expected: a lista egy sort kap 17 700-tal; az Elszámolás fülön Y tartozása 6200, Z-é 4000.
5. Nyisd meg szerkesztésre. Expected: a kapcsoló bekapcsolva, a három tétel a helyén, a megnevezésekkel.
6. Írj át egy tételösszeget, majd Escape. Expected: „El nem mentett módosítások vannak…" megerősítés jelenik meg.
7. Kapcsold ki a „Tételes felosztás"-t. Expected: megerősítést kér, és utána a végösszeg egyetlen összegként áll az `Összeg` mezőben.
8. Válts EUR-ra tételes módban, és mentsd. Expected: mentés után az „Alapvaluta" oszlop forintban mutatja a számlát, és az elszámolás nem hibázik.
9. DevTools → Network → „Offline", vigyél fel egy tételes számlát. Expected: a sor „függőben" jelöléssel megjelenik, ÉS az Elszámolás fül továbbra is számol (nem hibaüzenet) — ez a Task 5 4. pontjának kihagyott ellenőrzése.

- [ ] **Step 10: Lint, formázás, build**

Run: `npm run lint && npm run format:check && npm run build`
Expected: mindhárom hibátlan

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/components/ExpenseModal.vue
git commit -m "feat(web): egy számla tételekre bontva vihető fel az űrlapon"
```

---

### Task 7: Lenyitható tétel-alsor a kiadáslistában

**Files:**
- Modify: `apps/web/src/components/ExpenseTable.vue`

**Interfaces:**
- Consumes: a store kiadásain lévő `items` (Task 4 és 5)
- Produces: nincs új interfész — csak megjelenítés

- [ ] **Step 1: Vedd fel a lenyitás állapotát**

`apps/web/src/components/ExpenseTable.vue` — a `pullRatio` ref alá:

```js
/**
 * Mely számlák tétellistája van lenyitva. Új `Set` referenciával váltunk,
 * mert a `Set` belső mutációja nem indítana újrarenderelést.
 * @type {import('vue').Ref<Set<string>>}
 */
const expandedIds = ref(new Set());

function toggleItems(expenseId) {
  const next = new Set(expandedIds.value);
  if (next.has(expenseId)) {
    next.delete(expenseId);
  } else {
    next.add(expenseId);
  }
  expandedIds.value = next;
}
```

- [ ] **Step 2: Alakítsd a sor-ciklust két soros sablonná**

A `<tbody>`-ban a `<tr v-for="expense in filteredExpenses" :key="expense.id" ...>` sort bontsd ketté: kerüljön körbe egy `<template>` a ciklussal, a `<tr>`-ről pedig kerüljön le a `v-for` és a `:key`.

```html
      <tbody>
        <template v-for="expense in filteredExpenses" :key="expense.id">
          <tr
            class="expense-table__row"
            :class="{
              'is-fresh': expensesStore.freshIds.has(expense.id),
              'is-pending': expense.pending,
            }"
            :tabindex="expense.pending ? -1 : 0"
            :title="
              expense.pending
                ? 'Egy még fel nem töltött kiadás nem szerkeszthető, amíg fel nem töltődik — a Szinkronizálás képernyőn eldobható.'
                : undefined
            "
            @click="openEditModal(expense)"
            @keydown.enter="openEditModal(expense)"
          >
```

A sor `<td>`-i változatlanok, kivéve az „Osztozók" cellát:

```html
          <td data-label="Osztozók" class="expense-table__shared">
            {{ expense.sharedWithIds.map(participantName).join(', ') }}
            <button
              v-if="expense.items"
              type="button"
              class="expense-table__items-toggle"
              :aria-expanded="expandedIds.has(expense.id)"
              @click.stop="toggleItems(expense.id)"
            >
              {{ expense.items.length }} tétel
            </button>
          </td>
```

A záró `</tr>` után, még a `</template>` előtt:

```html
          <tr
            v-if="expense.items && expandedIds.has(expense.id)"
            class="expense-table__items-row"
          >
            <td colspan="7">
              <ul class="expense-table__items">
                <li v-for="(item, index) in expense.items" :key="index">
                  <span class="expense-table__item-name">{{ item.description || '—' }}</span>
                  <span class="money expense-table__item-amount">
                    {{ formatMoney({ amountMinor: item.amountMinor, currency: expense.currency }) }}
                  </span>
                  <span class="expense-table__item-shared">
                    {{ item.sharedWithIds.map(participantName).join(', ') }}
                  </span>
                </li>
              </ul>
            </td>
          </tr>
        </template>
      </tbody>
```

- [ ] **Step 3: Vedd fel a stílusokat**

A `<style scoped>`-ban, a `.expense-table__shared` szabály után:

```css
.expense-table__items-toggle {
  display: inline-block;
  margin-left: var(--space-2);
  padding: 0.1rem 0.45rem;
  border: 1px dashed var(--rule-strong);
  border-radius: 999px;
  background: none;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  cursor: pointer;
}

.expense-table__items-toggle[aria-expanded='true'] {
  border-style: solid;
  color: var(--forint);
}

.expense-table__items {
  list-style: none;
  margin: 0;
  padding: 0;
}

.expense-table__items li {
  display: grid;
  grid-template-columns: 1fr auto 1.4fr;
  gap: var(--space-3);
  padding: 0.2rem 0;
  font-size: 0.88rem;
  border-bottom: 1px dashed var(--rule);
}

.expense-table__items li:last-child {
  border-bottom: none;
}

.expense-table__item-name {
  font-weight: 600;
}

.expense-table__item-shared {
  color: var(--ink-soft);
}
```

A `@media (max-width: 640px)` blokk **végére** (hogy a mobil kártyás nézetben a tétellista a fölötte lévő kártya folytatásának látsszon, ne önálló kártyának):

```css
  /* A tétel-alsor a kártyás nézetben a saját kiadás-kártyájának
     folytatása: felül nincs szegély, és a fölötte lévő kártya alsó
     margóját visszahúzzuk, hogy összeérjenek. */
  .expense-table__items-row {
    display: block;
    margin-top: calc(-1 * var(--space-4));
    margin-bottom: var(--space-4);
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-top: none;
    padding: 0 var(--space-3) var(--space-3);
  }

  .expense-table__table .expense-table__items-row td {
    display: block;
    padding: 0;
  }

  .expense-table__items li {
    grid-template-columns: 1fr auto;
  }

  .expense-table__item-shared {
    grid-column: 1 / -1;
  }
```

- [ ] **Step 4: Ellenőrizd a böngészőben**

1. Asztali szélességen: a tételes számla sorában az osztozók mellett `3 tétel` jelölés. Kattints rá. Expected: lenyílik a három tétel (megnevezés · összeg · osztozók), és **nem** nyílik meg a szerkesztő modál.
2. Kattints a sor bármely más pontjára. Expected: a szerkesztő modál nyílik meg.
3. Kattints újra a `3 tétel`-re. Expected: becsukódik.
4. Egy megnevezés nélküli tétel `—`-t mutat.
5. Szűkítsd az ablakot 400 px alá. Expected: a tétellista a kiadás-kártyájához tapadva jelenik meg, nem önálló kártyaként.
6. Egy tétel nélküli (egyszerű) kiadás sorában **nincs** `n tétel` jelölés.

- [ ] **Step 5: Lint, formázás, build**

Run: `npm run lint && npm run format:check && npm run build`
Expected: mindhárom hibátlan

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ExpenseTable.vue
git commit -m "feat(web): a tételes számla bontása lenyitható a kiadáslistában"
```

---

### Task 8: Architektúra-dokumentáció és záró ellenőrzés

**Files:**
- Modify: `docs/ARCHITECTURE.md` (4. Adatmodell, 6. Pénzkezelés, 8. Elszámolási algoritmus)

**Interfaces:**
- Consumes: minden korábbi task
- Produces: nincs kód — a dokumentum a kódbázis leírása, ezt kell szinkronban tartani

- [ ] **Step 1: Írd le az adatmodellt**

`docs/ARCHITECTURE.md` 4. fejezet, az `Expense` mermaid-blokkjában a `sharedWithIds` sor után:

```
        object[] items "opcionális tételek: description?, amountMinor, baseAmountMinor, sharedWithIds"
```

A „Fontos üzleti szabályok" felsorolásába egy új pont:

```markdown
- **Tételes számla:** ha a kiadásnak van `items` tömbje, akkor a
  `sharedWithIds` a **számla résztvevőit** jelenti, a tételek pedig ezen belül
  szűkítenek (`items ⊆ sharedWithIds ⊆ event.participantIds`, a
  `createExpenseBodySchema` kényszeríti ki). Az `amountMinor` a tételek
  összege, a `baseAmountMinor` a tételek forint-összegeinek összege. A
  tételezés hiányát a mező **elhagyása** jelenti (`items: []` nem érvényes),
  és az `items` nélküli kiadás jelentése változatlan: egyenlő felosztás a
  `sharedWithIds` között. A tételek hiánya szerkesztéskor kifejezett
  `$unset` — a `findByIdAndUpdate` az `undefined` mezőket kihagyná a
  `$set`-ből, és a régi tételek bent maradnának.
```

- [ ] **Step 2: Írd le a pénzkezelési szabályt**

6. fejezet felsorolásába, a „Árfolyam-átváltás" pont után:

```markdown
- **Tételes számla átváltása** (`convertExpenseAmounts`,
  `packages/shared/src/currency/convert.js`): minden tétel **külön** váltódik a
  számla egyetlen árfolyamával, és a kiadás `baseAmountMinor`-ja a tételek
  forint-összegeinek **összege** — nem a végösszeg egyszeri átváltása. Az
  elszámolás a `baseAmountMinor`-t írja a fizető „kifizette" oldalára, a
  tételekből számolt részeket a tartozás oldalára; két különböző kerekítésből
  néhány fillér elszivárogna, és megsérülne az az invariáns, hogy az
  egyenlegek összege pontosan 0. Ezért ez a függvény a backend
  (`buildExpenseData`), a kliens sorbanállított-előnézete és az űrlap
  forint-előnézete **közös** forrása.
```

- [ ] **Step 3: Írd le az elszámolást**

8. fejezetben, a felosztás leírásánál vedd fel:

```markdown
Tételes számlánál a felosztás tételenként történik: minden tétel a saját
osztozói között oszlik egyenlően, a tétel nélküli kiadás pedig egyetlen
implicit tétel — így a két eset ugyanazon a kódágon fut. A bemeneti séma
megköveteli, hogy a tételek alapösszegeinek összege megegyezzen a kiadás
`baseAmountMinor`-jával; ha nem, dob, és a `SettlementPanel` hibaüzenetet
mutat helyette — egy hibaüzenet jobb, mint rossz egyenleg.
```

- [ ] **Step 4: Záró, teljes ellenőrzés**

Run: `npm run lint && npm run format:check && npm run build`
Expected: mindhárom hibátlan

Kézzel, a dev stackben, egy tiszta eseményen végig:
1. Tételes számla felvitele, mentés → az elszámolás a várt tartozásokat mutatja.
2. Ugyanaz devizában (EUR) → az „Alapvaluta" oszlop forintot mutat, és a tételek alapösszegének összege pontosan az, ami az oszlopban látszik.
3. Egy másik böngészőfülön nyitva ugyanaz az esemény → az élő (SSE) frissítés a tételes számlát is behozza, tételekkel.
4. Résztvevő eltávolítása az eseményből, aki egy tételen szerepel → az esemény-űrlap **elutasítja**, a kiadásra hivatkozva.
5. Személy törlése a névjegyzékből, aki egy tételen szerepel → **elutasítva**.

- [ ] **Step 5: Töröld az egyszer használatos ellenőrző scripteket**

```bash
rm -f "$SCRATCH"/verify-convert.js "$SCRATCH"/verify-expense-schema.js "$SCRATCH"/verify-settlement.js
```

- [ ] **Step 6: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: a tételes számlafelosztás az architektúra-leírásban"
```
