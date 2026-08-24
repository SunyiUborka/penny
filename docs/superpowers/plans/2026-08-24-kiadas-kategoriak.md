# Kiadás-kategóriák — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eseményenként a felhasználók által kezelt kategóriakészlet, amiből egy kiadásra több kategória is tehető, és amibe a kiadás-modalból is lehet újat felvenni.

**Architecture:** Új `Category` kollekció (`eventId`, `name`, `color`), saját CRUD végpontokkal a személyek mintájára. A kiadás egy `categoryIds: [ObjectId]` mezőt kap, `default: []`. A kategória törlése két lépés: előbb `$pull` az esemény összes kiadásából, utána a dokumentum törlése — ebben a sorrendben, mert a fordítottja árva id-ket hagyna a kiadásokon. A változások az esemény meglévő SSE-csatornáján mennek át három új üzenettípussal; a törlésnél egyetlen `category.deleted` üzenet megy, nem kiadásonként egy `expense.updated`. A felületen a kategória új vizuális formát kap (rovatjegy: szögletes bal él színes tintacsíkkal, mono felirat), mert a meglévő három forma (pill = ember, pecsét = állapot, mono szám = a könyv adata) mind foglalt.

**Tech Stack:** Node 22 (ESM, nincs TypeScript), Fastify 5 + `fastify-type-provider-zod`, Mongoose 8, Zod 3, Vue 3 (`<script setup>`) + Pinia + Vite 6, `idb` (IndexedDB), Docker Compose.

**Spec:** [`docs/superpowers/specs/2026-08-24-kiadas-kategoriak-design.md`](../specs/2026-08-24-kiadas-kategoriak-design.md)

## Global Constraints

- **Nincs tesztkeret ebben a projektben, és ne is vezess be egyet** (a Vitest/Testcontainers/Playwright szándékosan el van távolítva). Az ellenőrzés eszközei: egyszer használatos `node` scriptek, `npm run lint`, `npm run format:check`, `npm run build`, és kézi ellenőrzés a dev stackben.
- **Az egyszer használatos ellenőrző scriptek a munkamenet scratchpad könyvtárába kerülnek, nem a repóba**, és `.js` kiterjesztéssel (az ESLint config csak `**/*.js`-re ad node globálisokat). A lenti parancsokban `$SCRATCH` ezt a könyvtárat jelenti — állítsd be a task elején: `SCRATCH=<a munkamenet scratchpad könyvtára>`. Ezek a scriptek relatív helyett **absolute repó-útvonalról** importálnak (`/mnt/WDred/Docker/kassza/packages/shared/...`), így a Node a repó `node_modules`-át találja meg.
- **Ellenőrző parancsot SOHA ne csövezz `tail`-be, `head`-be vagy `grep`-be** — a pipe elnyeli a kilépési kódot, és egy bukott ellenőrzés zöldnek látszik.
- **Új kódba ne kerüljön komment.** A meglévő kommenteket ne töröld; ahol meglévő kommentelt blokkot módosítasz, a komment maradjon érvényes.
- **Commit üzenet egysoros**, magyarul, `feat(...)` / `fix(...)` / `docs(...)` prefixszel. **Ne kerüljön bele `Co-Authored-By` sor.**
- **Séma- és felületi üzenetek magyarul.**
- **Kategória-paletta (kulcsok, kötelező sorrend):** `indigo`, `plum`, `teal`, `rust`, `olive`, `slate`. Világos hexek: `#3b4d7a`, `#6d3f66`, `#2c6a6b`, `#9c5626`, `#5c6b30`, `#4c5a64`. Sötét hexek: `#8fa3d4`, `#c294bb`, `#7bc0c1`, `#d69a6e`, `#a8bd72`, `#9fb0bb`.
- **Korlátok:** kategórianév 1..32 karakter, eseményen belül egyedi (`collation: { locale: 'hu', strength: 1 }`); egy kiadáson legfeljebb 10 kategória, duplikátum nélkül.
- **A kategória nem befolyásolja az elszámolást**, és a számla egészén van, nem tételenként.
- **Dev stack:** `npm run dev` a repó gyökerében (web: `http://localhost:5173`, az `/api` proxyzva). Ha compose-fájlt váltasz, `--build` kell; dev módban a friss `node_modules` volume-ba `npm ci` szükséges.
- **Mongo:** újraépítéskor a `mongod` beragadhat, és egy beragadt docker CLI fogja a konténer-lockot — PID szerint kell kilőni, nem a démont újraindítani.

---

## Fájlszerkezet

| Fájl                                               | Felelősség                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/schemas/category.js`          | **Új:** a kategória sémái, a paletta kulcsai és a korlátok — egyetlen igazság a szerver és a kliens számára. |
| `packages/shared/src/index.js`                     | **Módosul:** az új séma-modul exportja.                                                                      |
| `packages/shared/src/schemas/expense.js`           | **Módosul:** `categoryIds` a kérésben és a válaszban.                                                        |
| `packages/shared/src/schemas/eventStream.js`       | **Módosul:** három új üzenettípus.                                                                           |
| `apps/api/src/models/categoryModel.js`             | **Új:** Mongoose séma, egyedi index collationnel.                                                            |
| `apps/api/src/models/expenseModel.js`              | **Módosul:** `categoryIds` mező.                                                                             |
| `apps/api/src/repositories/categoryRepository.js`  | **Új:** adatelérés, szerializálás.                                                                           |
| `apps/api/src/repositories/expenseRepository.js`   | **Módosul:** `categoryIds` szerializálása, `detachCategory`.                                                 |
| `apps/api/src/services/categoryService.js`         | **Új:** archiválás- és duplikátum-szabályok, törlés-lekapcsolás, SSE-publikálás.                             |
| `apps/api/src/services/expenseService.js`          | **Módosul:** `assertCategories`, `categoryIds` a mentendő adatban.                                           |
| `apps/api/src/services/eventService.js`            | **Módosul:** az esemény törlése a kategóriáit is elviszi.                                                    |
| `apps/api/src/routes/events.js`                    | **Módosul:** `GET`/`POST /:id/categories`.                                                                   |
| `apps/api/src/routes/categories.js`                | **Új:** `PATCH`/`DELETE /:id`.                                                                               |
| `apps/api/src/app.js`                              | **Módosul:** az új route-csoport regisztrációja.                                                             |
| `apps/web/src/assets/theme.css`                    | **Módosul:** paletta-tokenek és a `.cat-tag` rovatjegy.                                                      |
| `apps/web/src/offline/cacheKeys.js`                | **Módosul:** `categoriesCacheKey`.                                                                           |
| `apps/web/src/stores/categories.js`                | **Új:** kategórialista, CRUD, stream-alkalmazás.                                                             |
| `apps/web/src/stores/expenses.js`                  | **Módosul:** a `category.*` üzenetek útvonala és a törlés lekapcsolása.                                      |
| `apps/web/src/components/CategoryTag.vue`          | **Új:** a rovatjegy megjelenítése, egy helyen (tábla, választó, kezelő).                                     |
| `apps/web/src/components/CategoryPicker.vue`       | **Új:** többértékű, kereshető választó inline felvitellel.                                                   |
| `apps/web/src/components/CategoryManagerModal.vue` | **Új:** átnevezés, átszínezés, törlés.                                                                       |
| `apps/web/src/components/ExpenseModal.vue`         | **Módosul:** a Leírás sor kettéosztva, `categoryIds` a payloadban.                                           |
| `apps/web/src/components/ExpenseTable.vue`         | **Módosul:** címkék a leírás alatt.                                                                          |
| `apps/web/src/views/EventDetailView.vue`           | **Módosul:** „Kategóriák" gomb, modal, betöltés, cache-kulcs.                                                |
| `docs/ARCHITECTURE.md`                             | **Módosul:** adatmodell és API fejezetek.                                                                    |

---

### Task 1: Megosztott sémák

A kategória sémája a shared csomagba kerül, mert **három** fogyasztója van: a Fastify route-ok (kérés- és válaszvalidálás), a kliens `apiClient`-je (válaszvalidálás), és az IndexedDB cache (visszaolvasáskor újravalidál). A paletta kulcsai és a korlátok ugyanitt laknak, hogy a szerver enumja és a kliens színválasztója ne tudjon széttartani.

**Files:**

- Create: `packages/shared/src/schemas/category.js`
- Modify: `packages/shared/src/index.js`
- Modify: `packages/shared/src/schemas/expense.js`
- Modify: `packages/shared/src/schemas/eventStream.js`

**Interfaces:**

- Consumes: `personIdSchema` (`./money.js`) — a projekt generikus ObjectId-string sémája.
- Produces:
  - `CATEGORY_COLORS: string[]` — `['indigo', 'plum', 'teal', 'rust', 'olive', 'slate']`, ebben a sorrendben (az automatikus színválasztás erre a sorrendre támaszkodik).
  - `MAX_CATEGORY_NAME_LENGTH: number` (32), `MAX_EXPENSE_CATEGORIES: number` (10)
  - `categoryColorSchema`, `createCategoryBodySchema`, `updateCategoryBodySchema`, `categoryResponseSchema`, `categoryListResponseSchema`
  - `expenseResponseSchema` mostantól tartalmaz `categoryIds: string[]`-et; `createExpenseBodySchema` (`= updateExpenseBodySchema`) elfogad `categoryIds`-t, elhagyva `[]`-re alapértelmezve.
  - `eventStreamMessageSchema` három új taggal: `category.created`, `category.updated`, `category.deleted`.

- [ ] **Step 1: Hozd létre a kategória-sémát**

`packages/shared/src/schemas/category.js`:

```js
import { z } from 'zod';
import { personIdSchema } from './money.js';

export const CATEGORY_COLORS = ['indigo', 'plum', 'teal', 'rust', 'olive', 'slate'];

export const MAX_CATEGORY_NAME_LENGTH = 32;

export const MAX_EXPENSE_CATEGORIES = 10;

export const categoryColorSchema = z.enum(CATEGORY_COLORS);

const categoryNameSchema = z
  .string()
  .trim()
  .min(1, 'A kategória neve nem lehet üres.')
  .max(
    MAX_CATEGORY_NAME_LENGTH,
    `A kategória neve legfeljebb ${MAX_CATEGORY_NAME_LENGTH} karakter lehet.`,
  );

export const createCategoryBodySchema = z.object({
  name: categoryNameSchema,
  color: categoryColorSchema,
});

export const updateCategoryBodySchema = z
  .object({
    name: categoryNameSchema.optional(),
    color: categoryColorSchema.optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.color !== undefined,
    'Legalább egy módosítandó mező szükséges.',
  );

export const categoryResponseSchema = z.object({
  id: personIdSchema,
  eventId: personIdSchema,
  name: z.string(),
  color: categoryColorSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const categoryListResponseSchema = z.array(categoryResponseSchema);

export const expenseCategoryIdsSchema = z
  .array(personIdSchema)
  .max(
    MAX_EXPENSE_CATEGORIES,
    `Egy kiadásra legfeljebb ${MAX_EXPENSE_CATEGORIES} kategória tehető.`,
  )
  .refine(
    (ids) => new Set(ids).size === ids.length,
    'A kategóriák nem szerepelhetnek duplikáltan.',
  );
```

- [ ] **Step 2: Exportáld a shared csomag gyökeréből**

`packages/shared/src/index.js` — a `./schemas/expense.js` sora **elé** vedd fel:

```js
export * from './schemas/category.js';
```

- [ ] **Step 3: Vedd fel a `categoryIds`-t a kiadás sémájába**

`packages/shared/src/schemas/expense.js` — az importok közé:

```js
import { expenseCategoryIdsSchema } from './category.js';
```

A `createExpenseBodySchema` objektumában, az `items` mező **elé**:

```js
    categoryIds: expenseCategoryIdsSchema.default([]),
```

Az `expenseResponseSchema` objektumában, az `items` mező **elé**:

```js
  categoryIds: z.array(personIdSchema),
```

- [ ] **Step 4: Vedd fel a három stream-üzenetet**

`packages/shared/src/schemas/eventStream.js` — az importok közé:

```js
import { categoryResponseSchema } from './category.js';
```

A diszkriminált unió tömbjének végére, a `settlementPayment.deleted` után:

```js
  z.object({ type: z.literal('category.created'), category: categoryResponseSchema }),
  z.object({ type: z.literal('category.updated'), category: categoryResponseSchema }),
  z.object({ type: z.literal('category.deleted'), categoryId: personIdSchema }),
```

- [ ] **Step 5: Írd meg az ellenőrző scriptet**

`$SCRATCH/verify-category-schema.js`:

```js
import assert from 'node:assert/strict';
import {
  CATEGORY_COLORS,
  categoryListResponseSchema,
  createCategoryBodySchema,
  createExpenseBodySchema,
  eventStreamMessageSchema,
  expenseResponseSchema,
  updateCategoryBodySchema,
} from '/mnt/WDred/Docker/kassza/packages/shared/src/index.js';

const OID = '507f1f77bcf86cd799439011';
const OID2 = '507f1f77bcf86cd799439012';

assert.deepEqual(CATEGORY_COLORS, ['indigo', 'plum', 'teal', 'rust', 'olive', 'slate']);

{
  const parsed = createCategoryBodySchema.parse({ name: '  Étel-ital  ', color: 'teal' });
  assert.equal(parsed.name, 'Étel-ital');
}

assert.throws(() => createCategoryBodySchema.parse({ name: '', color: 'teal' }));
assert.throws(() => createCategoryBodySchema.parse({ name: 'x'.repeat(33), color: 'teal' }));
assert.throws(() => createCategoryBodySchema.parse({ name: 'Ok', color: 'neonpink' }));

assert.deepEqual(updateCategoryBodySchema.parse({ name: 'Új' }), { name: 'Új' });
assert.throws(() => updateCategoryBodySchema.parse({}));

const baseExpense = {
  date: '2026-08-24',
  description: 'Vacsora',
  payerId: OID,
  amountMinor: 1000,
  currency: 'HUF',
  exchangeRate: '1',
  rateSource: 'manual',
  sharedWithIds: [OID],
};

assert.deepEqual(createExpenseBodySchema.parse(baseExpense).categoryIds, []);
assert.deepEqual(
  createExpenseBodySchema.parse({ ...baseExpense, categoryIds: [OID, OID2] }).categoryIds,
  [OID, OID2],
);
assert.throws(() => createExpenseBodySchema.parse({ ...baseExpense, categoryIds: [OID, OID] }));
assert.throws(() =>
  createExpenseBodySchema.parse({ ...baseExpense, categoryIds: Array(11).fill(OID) }),
);

assert.throws(() =>
  expenseResponseSchema.parse({
    id: OID,
    eventId: OID,
    date: '2026-08-24',
    description: 'Vacsora',
    payerId: OID,
    amountMinor: 1000,
    currency: 'HUF',
    exchangeRate: '1',
    rateSource: 'manual',
    rateFetchedAt: '2026-08-24T10:00:00.000Z',
    baseAmountMinor: 1000,
    sharedWithIds: [OID],
    createdAt: '2026-08-24T10:00:00.000Z',
    updatedAt: '2026-08-24T10:00:00.000Z',
  }),
);

{
  const category = {
    id: OID,
    eventId: OID2,
    name: 'Étel-ital',
    color: 'teal',
    createdAt: '2026-08-24T10:00:00.000Z',
    updatedAt: '2026-08-24T10:00:00.000Z',
  };
  assert.equal(categoryListResponseSchema.parse([category]).length, 1);
  assert.equal(
    eventStreamMessageSchema.parse({ type: 'category.created', category }).category.name,
    'Étel-ital',
  );
  assert.equal(
    eventStreamMessageSchema.parse({ type: 'category.deleted', categoryId: OID }).categoryId,
    OID,
  );
}

console.log('OK');
```

- [ ] **Step 6: Futtasd**

Run: `node $SCRATCH/verify-category-schema.js`
Expected: `OK`, kilépési kód 0. A `categoryIds` nélküli válasz-objektum ellenőrzése azt bizonyítja, hogy a mező a válaszban **kötelező** — a repository-nak mindig ki kell írnia.

- [ ] **Step 7: Lint és formázás**

Run: `npm run lint`
Run: `npm run format:check`
Expected: mindkettő hibátlan, kilépési kód 0.

- [ ] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): kategória-sémák és categoryIds a kiadáson"
```

---

### Task 2: Mongoose modell és repository

**Files:**

- Create: `apps/api/src/models/categoryModel.js`
- Create: `apps/api/src/repositories/categoryRepository.js`
- Modify: `apps/api/src/models/expenseModel.js`
- Modify: `apps/api/src/repositories/expenseRepository.js`

**Interfaces:**

- Consumes: `CATEGORY_COLORS`, `MAX_CATEGORY_NAME_LENGTH` (`@filler/shared`, Task 1).
- Produces (`categoryRepository`): `listForEvent(eventId) → Promise<object[]>`, `findCategoryById(id) → Promise<object | null>`, `createCategory(input) → Promise<object>`, `updateCategory(id, input) → Promise<object | null>`, `deleteCategoryById(id) → Promise<object | null>`, `deleteAllForEvent(eventId) → Promise<object>`, `countExistingByEventAndIds(eventId, ids) → Promise<number>`. A visszaadott objektumok alakja: `{ id, eventId, name, color, createdAt, updatedAt }`.
- Produces (`expenseRepository`): `detachCategory(eventId, categoryId) → Promise<object>`.

- [ ] **Step 1: Hozd létre a modellt**

`apps/api/src/models/categoryModel.js`:

```js
import mongoose from 'mongoose';
import { CATEGORY_COLORS, MAX_CATEGORY_NAME_LENGTH } from '@filler/shared';

const { Schema } = mongoose;

const categorySchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true, trim: true, maxlength: MAX_CATEGORY_NAME_LENGTH },
    color: { type: String, required: true, enum: CATEGORY_COLORS },
  },
  { strict: 'throw', timestamps: true },
);

// A `strength: 1` a kisbetűt ÉS az ékezetet is egybemossa: „Étel" és „etel"
// ütközik. Ez szándékosan szigorúbb, mint a személyek `strength: 2`-je — két
// ember tényleg hívható Andrásnak és Andrasnak, két rovat nem.
categorySchema.index(
  { eventId: 1, name: 1 },
  { unique: true, collation: { locale: 'hu', strength: 1 } },
);

// Külön, collation nélküli index: a listázás megadja a collationt, tehát a
// fenti indexet használja, de a collation nélküli lekérdezések (az esemény
// törlésekor futó deleteMany) nem tudják — a MongoDB egy collationnel
// létrehozott indexet csak azonos collationt megadó művelethez használ.
categorySchema.index({ eventId: 1 });

export const CategoryModel = mongoose.model('Category', categorySchema);
```

- [ ] **Step 2: Hozd létre a repository-t**

`apps/api/src/repositories/categoryRepository.js`:

```js
import { CategoryModel } from '../models/categoryModel.js';

const NAME_COLLATION = { locale: 'hu', strength: 1 };

/**
 * @param {import('mongoose').Document} doc
 */
function serialize(doc) {
  const { _id, __v, eventId, ...rest } = doc.toObject();
  return { id: _id.toString(), eventId: eventId.toString(), ...rest };
}

/**
 * @param {string} eventId
 */
export async function listForEvent(eventId) {
  const docs = await CategoryModel.find({ eventId }).sort({ name: 1 }).collation(NAME_COLLATION);
  return docs.map(serialize);
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function findCategoryById(id) {
  const doc = await CategoryModel.findById(id);
  return doc ? serialize(doc) : null;
}

/**
 * @param {{ eventId: string, name: string, color: string }} input
 */
export async function createCategory(input) {
  const doc = await CategoryModel.create(input);
  return serialize(doc);
}

/**
 * @param {string} id
 * @param {{ name?: string, color?: string }} input
 * @returns {Promise<object | null>}
 */
export async function updateCategory(id, input) {
  const doc = await CategoryModel.findByIdAndUpdate(id, input, {
    new: true,
    runValidators: true,
  });
  return doc ? serialize(doc) : null;
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function deleteCategoryById(id) {
  const doc = await CategoryModel.findByIdAndDelete(id);
  return doc ? serialize(doc) : null;
}

/**
 * @param {string} eventId
 */
export function deleteAllForEvent(eventId) {
  return CategoryModel.deleteMany({ eventId });
}

/**
 * @param {string} eventId
 * @param {string[]} ids
 * @returns {Promise<number>} hány megadott azonosító tartozik EHHEZ az eseményhez
 */
export function countExistingByEventAndIds(eventId, ids) {
  return CategoryModel.countDocuments({ eventId, _id: { $in: ids } });
}
```

- [ ] **Step 3: Vedd fel a `categoryIds`-t a kiadás-modellbe**

`apps/api/src/models/expenseModel.js` — az `expenseSchema` mezői közé, a `sharedWithIds` **után**, az `items` **elé**:

```js
    categoryIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
      required: true,
      default: [],
    },
```

`default: []` — az `items`-szel ellentétben itt az üres tömb érvényes, jelentéssel bíró állapot („nincs kategóriája"), és a válaszséma sem követel rajta `min(1)`-et.

- [ ] **Step 4: Szerializáld és tudj lekapcsolni**

`apps/api/src/repositories/expenseRepository.js` — a `serialize` függvényben a destrukturálásba vedd fel a `categoryIds`-t, és írd ki stringgé alakítva:

```js
function serialize(doc) {
  const { _id, __v, eventId, payerId, sharedWithIds, categoryIds, items, ...rest } = doc.toObject();
  return {
    id: _id.toString(),
    eventId: eventId.toString(),
    payerId: payerId.toString(),
    sharedWithIds: sharedWithIds.map(String),
    categoryIds: (categoryIds ?? []).map(String),
    // Üres/hiányzó tétellistánál a mezőt KI SEM írjuk: a válaszséma az
    // `items`-et opcionálisnak, de nem üresnek fogadja el — a tételezés
    // hiányát a mező elhagyása jelenti.
    ...(items?.length ? { items: items.map(serializeItem) } : {}),
    ...rest,
  };
}
```

A `categoryIds ?? []` nem fölösleges óvatosság: a funkció ELŐTT létrehozott kiadás-dokumentumokban a mező fizikailag nincs benne, és a Mongoose a `default`-ot csak íráskor alkalmazza — enélkül a régi kiadások `GET`-je a `.map` hívásán hasalna el.

Ugyanebbe a fájlba, a `deleteAllForEvent` alá:

```js
/**
 * @param {string} eventId
 * @param {string} categoryId
 */
export function detachCategory(eventId, categoryId) {
  return ExpenseModel.updateMany({ eventId }, { $pull: { categoryIds: categoryId } });
}
```

- [ ] **Step 5: Lint és formázás**

Run: `npm run lint`
Run: `npm run format:check`
Expected: hibátlan.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/models apps/api/src/repositories
git commit -m "feat(api): kategória-modell és repository, categoryIds a kiadáson"
```

---

### Task 3: Kategória-service és végpontok

**Files:**

- Create: `apps/api/src/services/categoryService.js`
- Create: `apps/api/src/routes/categories.js`
- Modify: `apps/api/src/routes/events.js`
- Modify: `apps/api/src/services/eventService.js`
- Modify: `apps/api/src/app.js`

**Interfaces:**

- Consumes: `categoryRepository.*` és `expenseRepository.detachCategory` (Task 2), `eventRepository.findEventById`, `publishEventChange`, `ConflictError`/`NotFoundError` (`../errors.js`), `createCategoryBodySchema`/`updateCategoryBodySchema`/`categoryResponseSchema`/`categoryListResponseSchema` (Task 1).
- Produces: `listCategoriesForEvent(eventId)`, `createCategory(eventId, input)`, `updateCategory(id, input)`, `deleteCategory(id)`. Végpontok: `GET`/`POST /api/events/:id/categories`, `PATCH`/`DELETE /api/categories/:id`.

- [ ] **Step 1: Írd meg a service-t**

`apps/api/src/services/categoryService.js`:

```js
import * as categoryRepository from '../repositories/categoryRepository.js';
import * as eventRepository from '../repositories/eventRepository.js';
import * as expenseRepository from '../repositories/expenseRepository.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { publishEventChange } from './eventBus.js';

/**
 * @param {string} eventId
 */
export async function listCategoriesForEvent(eventId) {
  await getEventOrThrow(eventId);
  return categoryRepository.listForEvent(eventId);
}

/**
 * @param {string} eventId
 * @param {{ name: string, color: string }} input
 */
export async function createCategory(eventId, input) {
  const event = await getEventOrThrow(eventId);
  assertNotArchived(event);

  let created;
  try {
    created = await categoryRepository.createCategory({ ...input, eventId });
  } catch (error) {
    throw toConflictOnDuplicateName(error, input.name);
  }

  publishEventChange(eventId, { type: 'category.created', category: created });
  return created;
}

/**
 * @param {string} id
 * @param {{ name?: string, color?: string }} input
 */
export async function updateCategory(id, input) {
  const existing = await getCategoryOrThrow(id);
  const event = await getEventOrThrow(existing.eventId);
  assertNotArchived(event);

  let updated;
  try {
    updated = await categoryRepository.updateCategory(id, input);
  } catch (error) {
    throw toConflictOnDuplicateName(error, input.name ?? existing.name);
  }
  if (!updated) {
    throw new NotFoundError('Nincs ilyen kategória.');
  }

  publishEventChange(updated.eventId, { type: 'category.updated', category: updated });
  return updated;
}

/**
 * A törlés két lépés, tranzakció nélkül, és a SORREND számít: előbb kerül le a
 * kategória a kiadásokról, csak utána tűnik el maga a kategória. Ha a második
 * lépés elbukik, egy árva, senkihez nem kötött kategória marad — az újra
 * törölhető. Fordítva a kiadásokon egy már nem létező kategóriára mutató id
 * maradna, amit semmi nem takarítana el.
 * @param {string} id
 */
export async function deleteCategory(id) {
  const existing = await getCategoryOrThrow(id);
  const event = await getEventOrThrow(existing.eventId);
  assertNotArchived(event);

  await expenseRepository.detachCategory(existing.eventId, id);

  const deleted = await categoryRepository.deleteCategoryById(id);
  if (!deleted) {
    throw new NotFoundError('Nincs ilyen kategória.');
  }

  publishEventChange(deleted.eventId, { type: 'category.deleted', categoryId: deleted.id });
}

/**
 * @param {string} eventId
 */
async function getEventOrThrow(eventId) {
  const event = await eventRepository.findEventById(eventId);
  if (!event) {
    throw new NotFoundError('Nincs ilyen esemény.');
  }
  return event;
}

/**
 * @param {string} id
 */
async function getCategoryOrThrow(id) {
  const category = await categoryRepository.findCategoryById(id);
  if (!category) {
    throw new NotFoundError('Nincs ilyen kategória.');
  }
  return category;
}

/**
 * @param {{ archived?: boolean }} event
 */
function assertNotArchived(event) {
  if (event.archived) {
    throw new ConflictError(
      'Az esemény archivált: a kategóriái nem hozhatók létre, nem szerkeszthetők és nem törölhetők.',
    );
  }
}

/**
 * @param {unknown} error
 * @param {string} name
 */
function toConflictOnDuplicateName(error, name) {
  if (error?.code === 11000) {
    return new ConflictError(`Már van "${name}" nevű kategória ezen az eseményen.`);
  }
  return error;
}
```

- [ ] **Step 2: Írd meg az azonosított kategória route-jait**

`apps/api/src/routes/categories.js`:

```js
import { categoryResponseSchema, updateCategoryBodySchema } from '@filler/shared';
import * as categoryService from '../services/categoryService.js';
import { idParamsSchema } from '../schemas/params.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default function categoriesRoutes(fastify) {
  fastify.patch(
    '/:id',
    {
      schema: {
        params: idParamsSchema,
        body: updateCategoryBodySchema,
        response: { 200: categoryResponseSchema },
      },
    },
    (request) => {
      return categoryService.updateCategory(request.params.id, request.body);
    },
  );

  fastify.delete('/:id', { schema: { params: idParamsSchema } }, async (request, reply) => {
    await categoryService.deleteCategory(request.params.id);
    return reply.status(204).send();
  });
}
```

- [ ] **Step 3: Vedd fel az esemény alatti végpontokat**

`apps/api/src/routes/events.js` — az importok közé:

```js
import * as categoryService from '../services/categoryService.js';
```

Az `@filler/shared` import-blokkjába (ábécésorrendben, a `createEventBodySchema` elé):

```js
  categoryListResponseSchema,
  categoryResponseSchema,
  createCategoryBodySchema,
```

A `GET /:id/expenses` **elé**:

```js
fastify.get(
  '/:id/categories',
  { schema: { params: idParamsSchema, response: { 200: categoryListResponseSchema } } },
  (request) => {
    return categoryService.listCategoriesForEvent(request.params.id);
  },
);

fastify.post(
  '/:id/categories',
  {
    schema: {
      params: idParamsSchema,
      body: createCategoryBodySchema,
      response: { 201: categoryResponseSchema },
    },
  },
  async (request, reply) => {
    const category = await categoryService.createCategory(request.params.id, request.body);
    return reply.status(201).send(category);
  },
);
```

- [ ] **Step 4: Az esemény törlése vigye a kategóriákat is**

`apps/api/src/services/eventService.js` — az importok közé:

```js
import * as categoryRepository from '../repositories/categoryRepository.js';
```

A `deleteEvent` végén, a `settlementPaymentRepository.deleteAllForEvent(id)` **után**:

```js
await categoryRepository.deleteAllForEvent(id);
```

- [ ] **Step 5: Regisztráld a route-csoportot**

`apps/api/src/app.js` — az importok közé, az `expensesRoutes` **után**:

```js
import categoriesRoutes from './routes/categories.js';
```

A védett `/api` csoportban, az `expensesRoutes` sora **után**:

```js
await protectedApi.register(categoriesRoutes, { prefix: '/categories' });
```

- [ ] **Step 6: Indítsd el a dev stacket**

Run: `npm run dev`
Expected: az `api` konténer hiba nélkül elindul, a log nem tartalmaz `FST_ERR_*` bejegyzést.

- [ ] **Step 7: Járd végig a CRUD-ot kézzel**

Bejelentkezés után, a böngésző konzoljából (a session cookie így megy át), ahol `EV` egy létező, **nem archivált** esemény azonosítója:

```js
const EV = '<esemény id>';
const j = (r) => r.json();
const post = (u, b) =>
  fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
    credentials: 'include',
  });

const a = await post(`/api/events/${EV}/categories`, { name: 'Étel-ital', color: 'teal' }).then(j);
console.log('létrehozva', a);

const dup = await post(`/api/events/${EV}/categories`, { name: 'etel-ital', color: 'rust' });
console.log('duplikátum státusz', dup.status, await dup.json());

const renamed = await fetch(`/api/categories/${a.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Kaja' }),
  credentials: 'include',
}).then(j);
console.log('átnevezve', renamed);

console.log(
  'lista',
  await fetch(`/api/events/${EV}/categories`, { credentials: 'include' }).then(j),
);

const del = await fetch(`/api/categories/${a.id}`, { method: 'DELETE', credentials: 'include' });
console.log('törlés státusz', del.status);
```

Expected:

- a létrehozás `id`/`eventId`/`name`/`color` mezőkkel tér vissza,
- a duplikátum **409**, üzenet: `Már van "etel-ital" nevű kategória ezen az eseményen.` (az ékezet- és kisbetű-érzéketlen ütközés a lényeg),
- az átnevezés `name: 'Kaja'`-t ad vissza,
- a törlés **204**.

- [ ] **Step 8: Ellenőrizd az archivált esemény tiltását**

Archiválj egy eseményt a felületen, majd próbálj rá kategóriát létrehozni a fenti `post` hívással.
Expected: **409**, üzenet: `Az esemény archivált: a kategóriái nem hozhatók létre, nem szerkeszthetők és nem törölhetők.`

- [ ] **Step 9: Lint, formázás, commit**

Run: `npm run lint`
Run: `npm run format:check`

```bash
git add apps/api/src
git commit -m "feat(api): kategória-végpontok eseményenként"
```

---

### Task 4: A kiadás kategóriáinak ellenőrzése

Ez külön task, mert külön is elutasítható: a CRUD önmagában működik, ez a lépés köti a kategóriát a kiadáshoz. Az ellenőrzés ugyanoda kerül és ugyanúgy néz ki, mint az `assertParticipants` — egy kiadás nem hivatkozhat másik esemény kategóriájára.

**Files:**

- Modify: `apps/api/src/services/expenseService.js`

**Interfaces:**

- Consumes: `categoryRepository.countExistingByEventAndIds` (Task 2).
- Produces: a `createExpense`/`updateExpense` mostantól `ValidationError`-t dob idegen `categoryId`-ra, és a mentett dokumentumba beírja a `categoryIds`-t.

- [ ] **Step 1: Vedd fel az importot**

`apps/api/src/services/expenseService.js` — az importok közé:

```js
import * as categoryRepository from '../repositories/categoryRepository.js';
```

- [ ] **Step 2: Írd meg az ellenőrzést**

Ugyanebbe a fájlba, az `assertParticipants` **alá**:

```js
/**
 * @param {string} eventId
 * @param {{ categoryIds?: string[] }} input
 */
async function assertCategories(eventId, input) {
  const categoryIds = input.categoryIds ?? [];
  if (categoryIds.length === 0) {
    return;
  }
  const existing = await categoryRepository.countExistingByEventAndIds(eventId, categoryIds);
  if (existing !== categoryIds.length) {
    throw new ValidationError('A kategóriák az esemény kategóriái közül kell legyenek.', {
      categoryIds,
    });
  }
}
```

- [ ] **Step 3: Hívd meg mindkét íróúton**

`createExpense`-ben, az `assertParticipants(event, input);` sor **után**:

```js
await assertCategories(eventId, input);
```

`updateExpense`-ben, az `assertParticipants(event, input);` sor **után**:

```js
await assertCategories(existing.eventId, input);
```

- [ ] **Step 4: Írd bele a mentendő adatba**

`buildExpenseData` visszatérési objektumában, a `sharedWithIds` **után**:

```js
    categoryIds: input.categoryIds ?? [],
```

- [ ] **Step 5: Ellenőrizd kézzel**

A dev stackben, a böngésző konzoljából. Hozz létre két eseményt (`EV_A`, `EV_B`), mindkettőn egy-egy kategóriát, majd próbálj `EV_A`-ba olyan kiadást felvinni, ami `EV_B` kategóriájára hivatkozik:

```js
const res = await fetch(`/api/events/${EV_A}/expenses`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    date: '2026-08-24',
    description: 'Idegen kategória',
    payerId: '<EV_A egy résztvevője>',
    amountMinor: 1000,
    currency: 'HUF',
    exchangeRate: '1',
    rateSource: 'manual',
    sharedWithIds: ['<EV_A egy résztvevője>'],
    categoryIds: ['<EV_B kategóriájának id-je>'],
  }),
});
console.log(res.status, await res.json());
```

Expected: **400**, üzenet: `A kategóriák az esemény kategóriái közül kell legyenek.` Ugyanez a hívás `EV_A` saját kategóriájával **201**, és a válasz `categoryIds`-e tartalmazza az id-t.

- [ ] **Step 6: Ellenőrizd a régi kiadásokat**

Ugyanabból a böngészőkonzolból (a session cookie így megy át), egy olyan eseményen, aminek **a funkció előtt** felvitt kiadásai vannak:

```js
const r = await fetch(`/api/events/${EV_A}/expenses`, { credentials: 'include' });
const list = await r.json();
console.log(
  r.status,
  list.length,
  list.map((e) => e.categoryIds),
);
```

Expected: státusz `200`, és minden régi kiadás `categoryIds`-e `[]`. Ez azt bizonyítja, hogy a funkció előtt létrehozott, a mezőt fizikailag nem tartalmazó dokumentumok is átmennek a válaszsémán (a repository `?? []`-je miatt) — a Mongoose a `default`-ot csak íráskor alkalmazza.

- [ ] **Step 7: Lint, formázás, commit**

Run: `npm run lint`
Run: `npm run format:check`

```bash
git add apps/api/src/services/expenseService.js
git commit -m "feat(api): a kiadás kategóriái az esemény kategóriái közül kell legyenek"
```

---

### Task 5: A rovatjegy — vizuális alap

A címke három helyen jelenik meg (kiadástábla, választó, kezelőmodal), ezért egy komponens és egy CSS-szabály felel érte. A szín kizárólag a bal éli tintacsíkban él, sosem kitöltésként: a rendszerben a szín ma jelentést hordoz (zöld = a csoportra fordított pénz, vörös = tartozás, réz = kiegyenlítés), és egy színesre töltött címke ezt szétverné.

**Files:**

- Modify: `apps/web/src/assets/theme.css`
- Create: `apps/web/src/components/CategoryTag.vue`

**Interfaces:**

- Produces: `--cat-indigo`, `--cat-plum`, `--cat-teal`, `--cat-rust`, `--cat-olive`, `--cat-slate` CSS-változók mind a négy témablokkban; `.cat-tag` és `.cat-tag--sm` osztályok; `CategoryTag` komponens `props: { name: String, color: String, small: Boolean }`.

- [ ] **Step 1: Vedd fel a paletta-tokeneket**

`apps/web/src/assets/theme.css` — **mind a négy** témablokkba (`:root`, `@media (prefers-color-scheme: dark) :root`, `:root[data-theme='light']`, `:root[data-theme='dark']`), a `--rule-strong` sor **után**.

Világos blokkokba (`:root` és `:root[data-theme='light']`):

```css
--cat-indigo: #3b4d7a;
--cat-plum: #6d3f66;
--cat-teal: #2c6a6b;
--cat-rust: #9c5626;
--cat-olive: #5c6b30;
--cat-slate: #4c5a64;
```

Sötét blokkokba (`@media (prefers-color-scheme: dark) :root` és `:root[data-theme='dark']`):

```css
--cat-indigo: #8fa3d4;
--cat-plum: #c294bb;
--cat-teal: #7bc0c1;
--cat-rust: #d69a6e;
--cat-olive: #a8bd72;
--cat-slate: #9fb0bb;
```

- [ ] **Step 2: Írd meg a rovatjegy szabályát**

`apps/web/src/assets/theme.css` — a `.stamp--small` szabály **után**:

```css
/* Rovatjegy: a kategória formája. Se pill (az az ember), se pecsét (az az
   állapot) — szögletes bal él egy színes tintacsíkkal, mint egy
   iratrendezőbe ragasztott indexfül. Mono felirat, mert a pénztárkönyvben a
   rovat épp olyan gépi adat, mint az összeg. A szín KIZÁRÓLAG a csíkban él:
   kitöltésként összeütközne a rendszer jelentéshordozó színeivel (zöld =
   kiadás, vörös = tartozás, réz = kiegyenlítés). */
.cat-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  max-width: 12rem;
  padding: 0.2em 0.55em;
  border: 1px solid var(--rule);
  border-left: 3px solid var(--cat-color, var(--rule-strong));
  border-radius: 0 3px 3px 0;
  background: var(--paper-raised);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-soft);
  white-space: nowrap;
}

.cat-tag__name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.cat-tag--sm {
  font-size: 0.64rem;
  padding: 0.1em 0.45em;
  max-width: 9rem;
}
```

- [ ] **Step 3: Írd meg a komponenst**

`apps/web/src/components/CategoryTag.vue`:

```vue
<script setup>
import { computed } from 'vue';

const props = defineProps({
  name: { type: String, required: true },
  color: { type: String, required: true },
  small: { type: Boolean, required: false, default: false },
});

const style = computed(() => ({ '--cat-color': `var(--cat-${props.color})` }));
</script>

<template>
  <span class="cat-tag" :class="{ 'cat-tag--sm': small }" :style="style">
    <span class="cat-tag__name">{{ name }}</span>
    <slot />
  </span>
</template>
```

A `<slot />` az `×` gombnak van fenntartva a választóban; máshol üresen marad.

- [ ] **Step 4: Nézd meg mind a hat színt, mindkét témában**

Ideiglenesen tedd az `EventDetailView.vue` sablonjának `<header>` blokkja alá (a `</header>` után), az importot a script tetejére (`import CategoryTag from '../components/CategoryTag.vue';`):

```vue
<p>
        <CategoryTag name="Indigo" color="indigo" />
        <CategoryTag name="Plum" color="plum" />
        <CategoryTag name="Teal" color="teal" />
        <CategoryTag name="Rust" color="rust" />
        <CategoryTag name="Olive" color="olive" />
        <CategoryTag name="Slate" color="slate" />
      </p>
```

Nyisd meg egy esemény oldalát `http://localhost:5173`-on.
Expected: hat címke, mindegyik saját színű bal csíkkal, a felirat monóval, nagybetűsen. Válts sötét témára a Beállítások képernyőn — a csíkok láthatóan világosabbak, és a szöveg olvasható marad.

- [ ] **Step 5: Vedd ki az ideiglenes blokkot**

Töröld a Step 4-ben beszúrt `<p>` blokkot és az importot az `EventDetailView.vue`-ból.

- [ ] **Step 6: Lint, formázás, commit**

Run: `npm run lint`
Run: `npm run format:check`

```bash
git add apps/web/src/assets/theme.css apps/web/src/components/CategoryTag.vue
git commit -m "feat(web): rovatjegy-címke és kategória-paletta"
```

---

### Task 6: Kategória-store, cache és élő frissítés

**Files:**

- Modify: `apps/web/src/offline/cacheKeys.js`
- Create: `apps/web/src/stores/categories.js`
- Modify: `apps/web/src/stores/expenses.js`

**Interfaces:**

- Consumes: `fetchWithCache`/`refreshIntoCache` (`../offline/cache.js`), `apiClient` (`../api/client.js`), `categoryListResponseSchema`/`categoryResponseSchema` (Task 1).
- Produces:
  - `categoriesCacheKey(eventId) → string` (`categories:<eventId>`)
  - `useCategoriesStore()` — state: `categories: object[]`, `loading: boolean`, `error: unknown`; getter: `byId(id) → object | undefined`; actions: `fetchCategories(eventId)`, `refreshQuietly(eventId)`, `createCategory(eventId, { name, color })`, `updateCategory(id, input)`, `deleteCategory(id)`, `applyStreamMessage(message)`, `reset()`, és a getter `nextColor` (a paletta első még nem használt tintája).
  - `useExpensesStore().detachCategory(categoryId)` — a kategória lekapcsolása minden betöltött kiadásról.

- [ ] **Step 1: Vedd fel a cache-kulcsot**

`apps/web/src/offline/cacheKeys.js` — a fájl végére:

```js
/**
 * Egy esemény kategórialistájának kulcsa. Külön kulcs a kiadásokétól: két
 * külön kérés, és offline egyikük megléte nem jelenti a másikét.
 * @param {string} eventId
 * @returns {string}
 */
export function categoriesCacheKey(eventId) {
  return `categories:${eventId}`;
}
```

- [ ] **Step 2: Írd meg a store-t**

`apps/web/src/stores/categories.js`:

```js
import { defineStore } from 'pinia';
import {
  CATEGORY_COLORS,
  categoryListResponseSchema,
  categoryResponseSchema,
} from '@filler/shared';
import { apiClient } from '../api/client.js';
import { fetchWithCache, refreshIntoCache } from '../offline/cache.js';
import { categoriesCacheKey } from '../offline/cacheKeys.js';

function sortByName(categories) {
  return [...categories].sort((a, b) => a.name.localeCompare(b.name, 'hu'));
}

export const useCategoriesStore = defineStore('categories', {
  state: () => ({
    categories: [],
    loading: false,
    error: null,
  }),
  getters: {
    /**
     * @returns {(id: string) => object | undefined}
     */
    byId: (state) => (id) => {
      return state.categories.find((category) => category.id === id);
    },
    /**
     * A paletta első olyan tintája, amit az esemény még nem használ. Ha mind
     * a hat foglalt, a legkevesebbszer használt nyer, holtversenynél a
     * palettában előrébb álló — így a felvitel közben sosem kell színt
     * választani.
     * @returns {string}
     */
    nextColor: (state) => {
      const counts = new Map(CATEGORY_COLORS.map((color) => [color, 0]));
      state.categories.forEach((category) => {
        counts.set(category.color, (counts.get(category.color) ?? 0) + 1);
      });
      let best = CATEGORY_COLORS[0];
      CATEGORY_COLORS.forEach((color) => {
        if (counts.get(color) < counts.get(best)) {
          best = color;
        }
      });
      return best;
    },
  },
  actions: {
    async fetchCategories(eventId) {
      this.loading = true;
      this.error = null;
      try {
        const result = await fetchWithCache({
          key: categoriesCacheKey(eventId),
          schema: categoryListResponseSchema,
          request: () =>
            apiClient.get(`/events/${eventId}/categories`, {
              schema: categoryListResponseSchema,
            }),
        });
        this.categories = sortByName(result.value);
      } catch (error) {
        this.error = error;
      } finally {
        this.loading = false;
      }
    },

    async refreshQuietly(eventId) {
      try {
        const categories = await refreshIntoCache({
          key: categoriesCacheKey(eventId),
          request: () =>
            apiClient.get(`/events/${eventId}/categories`, {
              schema: categoryListResponseSchema,
            }),
        });
        this.categories = sortByName(categories);
        this.error = null;
      } catch {
        // Csendben bukik is: a látható (elavult) lista többet ér egy
        // hibaüzenetnél, és a következő frissítés helyrehozza.
      }
    },

    async createCategory(eventId, input) {
      const category = await apiClient.post(`/events/${eventId}/categories`, input, {
        schema: categoryResponseSchema,
      });
      this.upsert(category);
      return category;
    },

    async updateCategory(id, input) {
      const updated = await apiClient.patch(`/categories/${id}`, input, {
        schema: categoryResponseSchema,
      });
      this.upsert(updated);
      return updated;
    },

    async deleteCategory(id) {
      await apiClient.delete(`/categories/${id}`);
      this.remove(id);
    },

    upsert(category) {
      const index = this.categories.findIndex((item) => item.id === category.id);
      if (index === -1) {
        this.categories.push(category);
      } else {
        this.categories[index] = category;
      }
      this.categories = sortByName(this.categories);
    },

    remove(id) {
      this.categories = this.categories.filter((category) => category.id !== id);
    },

    applyStreamMessage(message) {
      if (message.type === 'category.deleted') {
        this.remove(message.categoryId);
        return;
      }
      this.upsert(message.category);
    },

    reset() {
      this.categories = [];
      this.loading = false;
      this.error = null;
    },
  },
});
```

- [ ] **Step 3: Irányítsd a `category.*` üzeneteket, és kapcsold le a törölt kategóriát**

`apps/web/src/stores/expenses.js` — az importok közé, a `settlementPayments.js` sora **elé**:

```js
import { useCategoriesStore } from './categories.js';
```

Az `applyStreamMessage`-ben, a `settlementPayment.` ág **után**:

```js
if (message.type.startsWith('category.')) {
  useCategoriesStore().applyStreamMessage(message);
  if (message.type === 'category.deleted') {
    this.detachCategory(message.categoryId);
  }
  return;
}
```

A store `actions` blokkjába (a `removeExpense` mellé):

```js
    /**
     * A törölt kategória lekapcsolása minden betöltött kiadásról. Ez a
     * kliensoldali párja a szerver `$pull`-jának: a törlés EGY üzenetben jön
     * (`category.deleted`), nem kiadásonként egy `expense.updated`-ben — ötven
     * kiadásnál az ötven üzenet lenne.
     * @param {string} categoryId
     */
    detachCategory(categoryId) {
      this.expenses = this.expenses.map((expense) =>
        expense.categoryIds?.includes(categoryId)
          ? { ...expense, categoryIds: expense.categoryIds.filter((id) => id !== categoryId) }
          : expense,
      );
    },
```

- [ ] **Step 4: Ellenőrizd a mezőnevet**

Run: `grep -n 'expenses: \[\]' apps/web/src/stores/expenses.js`
Expected: egy találat a `state` blokkban (`apps/web/src/stores/expenses.js:148`). Ez az a tömb, amit a Step 3 `detachCategory`-ja átír.

- [ ] **Step 5: Lint, formázás, build**

Run: `npm run lint`
Run: `npm run format:check`
Run: `npm run build`
Expected: mind hibátlan.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/offline/cacheKeys.js apps/web/src/stores
git commit -m "feat(web): kategória-store, cache-kulcs és élő frissítés"
```

---

### Task 7: A kategória-választó komponens

Ez a terv legnagyobb egyedi darabja. Többértékű, kereshető választó: a kijelölt kategóriák chipként ülnek magában a mezőben, a gépelés szűri a listát, és ha nincs pontos találat, az utolsó sor felveszi az újat.

**Files:**

- Create: `apps/web/src/components/CategoryPicker.vue`

**Interfaces:**

- Consumes: `CategoryTag` (Task 5), `useCategoriesStore` (Task 6), `useOfflineStore` (`../stores/offline.js`).
- Produces: `CategoryPicker` komponens.
  - Props: `modelValue: string[]` (a kijelölt kategória-azonosítók), `eventId: String`, `disabled: Boolean`.
  - Emit: `update:modelValue` a kijelölés minden változásakor.
  - A komponens **maga** hívja a store `createCategory`-ját az inline felvitelnél, és a friss id-t azonnal beteszi a kijelölésbe.

**Az offline jelzés `offlineStore.stale`, nem `navigator.onLine`.** Az appban ma nincs „online" logikai mező; a `stale` azt mondja meg, hogy a képernyőn látszó cache-kulcsok közül valamelyik gyorsítótárból jött, mert a hálózat nem válaszolt — pontosan ez hajtja az `OfflineBanner`-t is. Ugyanaz az egy jelzés, két helyen; egy második, saját online-érzékelés csak széttarthatna tőle. A `stale` mellett a **bukott kérés** is beszél: ha a felvitel mégis elindul és elhasal, a hibaüzenet a mező alatt jelenik meg (`createError`).

- [ ] **Step 1: Írd meg a komponenst**

`apps/web/src/components/CategoryPicker.vue`:

```vue
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import CategoryTag from './CategoryTag.vue';
import { useCategoriesStore } from '../stores/categories.js';
import { useOfflineStore } from '../stores/offline.js';

const props = defineProps({
  modelValue: { type: Array, required: true },
  eventId: { type: String, required: true },
  disabled: { type: Boolean, required: false, default: false },
});

const emit = defineEmits(['update:modelValue']);

const categoriesStore = useCategoriesStore();
const offlineStore = useOfflineStore();

const rootRef = ref(null);
const inputRef = ref(null);
const open = ref(false);
const query = ref('');
const highlighted = ref(0);
const creating = ref(false);
const createError = ref('');

watch(query, () => {
  highlighted.value = 0;
});

const selected = computed(() =>
  props.modelValue.map((id) => categoriesStore.byId(id)).filter(Boolean),
);

function normalize(value) {
  return value
    .trim()
    .toLocaleLowerCase('hu')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

const matches = computed(() => {
  const needle = normalize(query.value);
  if (!needle) {
    return categoriesStore.categories;
  }
  return categoriesStore.categories.filter((category) => normalize(category.name).includes(needle));
});

const hasExactMatch = computed(() =>
  categoriesStore.categories.some(
    (category) => normalize(category.name) === normalize(query.value),
  ),
);

const canCreate = computed(
  () => query.value.trim().length > 0 && !hasExactMatch.value && !offlineStore.stale,
);

const optionCount = computed(() => matches.value.length + (canCreate.value ? 1 : 0));

function openPanel() {
  if (props.disabled) {
    return;
  }
  open.value = true;
  highlighted.value = 0;
  nextTick(() => inputRef.value?.focus());
}

function closePanel() {
  open.value = false;
  query.value = '';
  createError.value = '';
}

function toggle(id) {
  const next = props.modelValue.includes(id)
    ? props.modelValue.filter((item) => item !== id)
    : [...props.modelValue, id];
  emit('update:modelValue', next);
}

function remove(id) {
  emit(
    'update:modelValue',
    props.modelValue.filter((item) => item !== id),
  );
}

async function createFromQuery() {
  const name = query.value.trim();
  if (!name || creating.value) {
    return;
  }
  creating.value = true;
  createError.value = '';
  try {
    const category = await categoriesStore.createCategory(props.eventId, {
      name,
      color: categoriesStore.nextColor,
    });
    emit('update:modelValue', [...props.modelValue, category.id]);
    query.value = '';
    highlighted.value = 0;
  } catch (error) {
    createError.value = error?.message ?? 'Offline nem hozható létre új kategória.';
  } finally {
    creating.value = false;
  }
}

function activate(index) {
  if (index < matches.value.length) {
    toggle(matches.value[index].id);
    return;
  }
  if (index === matches.value.length && canCreate.value) {
    createFromQuery();
  }
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    if (open.value) {
      event.stopPropagation();
      closePanel();
    }
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!open.value) {
      openPanel();
      return;
    }
    highlighted.value = optionCount.value === 0 ? 0 : (highlighted.value + 1) % optionCount.value;
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    highlighted.value =
      optionCount.value === 0 ? 0 : (highlighted.value - 1 + optionCount.value) % optionCount.value;
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    activate(highlighted.value);
    return;
  }
  if (event.key === 'Backspace' && query.value === '' && props.modelValue.length > 0) {
    remove(props.modelValue[props.modelValue.length - 1]);
  }
}

function onDocumentPointerDown(event) {
  if (open.value && rootRef.value && !rootRef.value.contains(event.target)) {
    closePanel();
  }
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown));
</script>

<template>
  <div ref="rootRef" class="cat-picker" @keydown="onKeydown">
    <div
      class="cat-picker__control"
      :class="{ 'is-open': open, 'is-disabled': disabled }"
      role="combobox"
      aria-label="Kategória"
      :aria-expanded="open"
      aria-haspopup="listbox"
      aria-controls="cat-picker-list"
      tabindex="0"
      @click="openPanel"
      @focus="openPanel"
    >
      <CategoryTag
        v-for="category in selected"
        :key="category.id"
        :name="category.name"
        :color="category.color"
        small
      >
        <button
          type="button"
          class="cat-picker__remove"
          :aria-label="`${category.name} levétele`"
          :disabled="disabled"
          @click.stop="remove(category.id)"
        >
          ×
        </button>
      </CategoryTag>
      <input
        v-if="open"
        ref="inputRef"
        v-model="query"
        type="text"
        class="cat-picker__input"
        aria-label="Kategória keresése"
        :disabled="disabled"
        @click.stop
      />
      <span v-else-if="selected.length === 0" class="cat-picker__placeholder">Nincs kategória</span>
      <span class="cat-picker__caret" aria-hidden="true">▾</span>
    </div>

    <ul
      v-if="open"
      id="cat-picker-list"
      class="cat-picker__list"
      role="listbox"
      aria-multiselectable="true"
    >
      <li
        v-for="(category, index) in matches"
        :key="category.id"
        role="option"
        :aria-selected="modelValue.includes(category.id)"
        class="cat-picker__option"
        :class="{ 'is-highlighted': highlighted === index }"
        @mouseenter="highlighted = index"
        @click="toggle(category.id)"
      >
        <CategoryTag :name="category.name" :color="category.color" />
        <span v-if="modelValue.includes(category.id)" class="cat-picker__check" aria-hidden="true">
          ✓
        </span>
      </li>
      <li
        v-if="canCreate"
        role="option"
        :aria-selected="false"
        class="cat-picker__option cat-picker__create"
        :class="{ 'is-highlighted': highlighted === matches.length }"
        @mouseenter="highlighted = matches.length"
        @click="createFromQuery"
      >
        {{ creating ? 'Létrehozás…' : `+ Új kategória: „${query.trim()}”` }}
      </li>
      <li v-if="offlineStore.stale && query.trim() && !hasExactMatch" class="cat-picker__hint">
        Offline nem hozható létre új kategória.
      </li>
      <li v-else-if="matches.length === 0 && !canCreate" class="cat-picker__hint">
        Nincs még kategória. Írd be az elsőt.
      </li>
    </ul>

    <p v-if="createError" role="alert" class="field-error">{{ createError }}</p>
  </div>
</template>

<style scoped>
.cat-picker {
  position: relative;
}

.cat-picker__control {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1);
  min-height: 2.6rem;
  padding: 0.35em 0.6em;
  border-bottom: 2px solid var(--rule);
  cursor: text;
}

.cat-picker__control.is-open,
.cat-picker__control:focus {
  border-bottom-color: var(--forint);
  outline: none;
}

.cat-picker__control.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cat-picker__input {
  flex: 1;
  min-width: 4rem;
  border: none;
  background: transparent;
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 1rem;
  outline: none;
}

.cat-picker__placeholder {
  flex: 1;
  color: var(--ink-soft);
  font-size: 0.9rem;
}

.cat-picker__caret {
  color: var(--ink-soft);
  font-size: 0.8rem;
}

.cat-picker__remove {
  border: none;
  background: none;
  padding: 0;
  color: inherit;
  font-size: 1em;
  line-height: 1;
  cursor: pointer;
}

.cat-picker__list {
  position: absolute;
  z-index: 20;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  max-height: 14rem;
  overflow-y: auto;
  margin: 0;
  padding: var(--space-1);
  list-style: none;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 3px;
  box-shadow: 0 6px 18px rgb(0 0 0 / 12%);
}

.cat-picker__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: 2px;
  cursor: pointer;
}

.cat-picker__option.is-highlighted {
  background: var(--forint-soft);
}

.cat-picker__check {
  color: var(--forint);
}

.cat-picker__create {
  font-size: 0.85rem;
  color: var(--forint);
}

.cat-picker__hint {
  padding: var(--space-1) var(--space-2);
  font-size: 0.8rem;
  color: var(--ink-soft);
}
</style>
```

- [ ] **Step 2: Lint, formázás, build**

Run: `npm run lint`
Run: `npm run format:check`
Run: `npm run build`
Expected: hibátlan. (A komponens kézi ellenőrzése a következő taskban történik, ahol a kiadás-modalba kerül — önmagában nincs hova kattintani rajta.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/CategoryPicker.vue
git commit -m "feat(web): kategória-választó inline felvitellel"
```

---

### Task 8: A választó a kiadás-modalban

**Files:**

- Modify: `apps/web/src/components/ExpenseModal.vue`

**Interfaces:**

- Consumes: `CategoryPicker` (Task 7).
- Produces: a modal `submit` eseményének payloadja mostantól tartalmaz `categoryIds: string[]`-et.

A kategórialista **betöltése** még nem ebben a taskban történik (az `EventDetailView` Task 10-ben hívja a `fetchCategories`-t), tehát itt a lenyíló üresen nyílik, és csak az „+ Új kategória" sor működik. Ez a helyes köztes állapot — a létrehozott kategória a store-ba kerül, tehát a lenti ellenőrzés végigmegy.

- [ ] **Step 1: Vedd fel az importot és az állapotot**

`apps/web/src/components/ExpenseModal.vue` — az importok közé:

```js
import CategoryPicker from './CategoryPicker.vue';
```

A `sharedWithIds` ref **után**:

```js
const categoryIds = ref([]);
```

- [ ] **Step 2: Vedd bele a lenyomatba**

A `snapshot()` visszaadott objektumába, a `sharedWithIds` sor **után**:

```js
    categoryIds: [...categoryIds.value].sort(),
```

Enélkül a kategória hozzáadása után a modal nem tudná, hogy van nem mentett módosítás, és a bezárás nem kérdezne rá.

- [ ] **Step 3: Töltsd fel szerkesztéskor**

A `resetFromExpense` függvényben. A `if (expense)` ágban, a `sharedWithIds.value = [...expense.sharedWithIds];` **után**:

```js
categoryIds.value = [...(expense.categoryIds ?? [])];
```

Az `else` ágban, a `sharedWithIds.value = [...props.event.participantIds];` **után**:

```js
categoryIds.value = [];
```

- [ ] **Step 4: Tedd bele a payloadba**

Run: `grep -n 'sharedWithIds:' apps/web/src/components/ExpenseModal.vue`

Keresd meg a `handleSubmit`-ben összeállított payload objektumot (az, amelyik `date`, `description`, `payerId`, `amountMinor`, `currency`, `exchangeRate`, `rateSource`, `sharedWithIds` kulcsokat tartalmaz), és a `sharedWithIds` **után** vedd fel:

```js
    categoryIds: [...categoryIds.value],
```

- [ ] **Step 5: Oszd ketté a Leírás sort**

A sablonban cseréld le a Leírás `.field` blokkját (`<div class="field">` … `<label for="expense-description">` … `</div>`) erre:

```vue
        <div class="modal__row">
          <div class="field expense-modal__description">
            <label for="expense-description">Leírás</label>
            <input
              id="expense-description"
              v-model="description"
              type="text"
              required
              :disabled="saving"
            />
          </div>
          <div class="field expense-modal__categories">
            <label>Kategória</label>
            <CategoryPicker v-model="categoryIds" :event-id="event.id" :disabled="saving" />
          </div>
        </div>
```

A `<label>` itt pusztán vizuális (nincs `for`-ja, mert a választó nem egyetlen `<input>`), a hozzáférhető nevet a `CategoryPicker` saját `aria-label="Kategória"`-ja adja a `role="combobox"` elemen. **Ne** `aria-labelledby`-t adj a komponensnek: a Vue az ismeretlen attribútumot a gyökér `<div class="cat-picker">`-re örökíti, nem a comboboxra, tehát a vezérlő névtelen maradna.

- [ ] **Step 6: Add meg a törési pontot**

A komponens `<style scoped>` blokkjába:

```css
.modal__row .expense-modal__description,
.modal__row .expense-modal__categories {
  min-width: 12rem;
}
```

A `.modal__row .field` szabályon `min-width: 0` van, ami sosem törne sorba — enélkül a két mező telefonon összepréselődne egymás mellett.

- [ ] **Step 7: Ellenőrizd kézzel**

Run: `npm run dev`

A dev stackben, egy nem archivált esemény Kiadások fülén:

1. Nyisd meg az „+ Új kiadás"-t. Expected: a Leírás és a Kategória mező egy sorban van, a Kategória „Nincs kategória" felirattal.
2. Kattints a Kategória mezőre, írd be: `Étel-ital`. Expected: megjelenik a `+ Új kategória: „Étel-ital"` sor.
3. Nyomj `Enter`-t. Expected: a kategória létrejön, rovatjegyként megjelenik a mezőben, a beírómező kiürül.
4. Írd be: `Belépő`, `Enter`. Expected: két címke a mezőben.
5. Nyomj `Backspace`-t üres beírómezőnél. Expected: a `Belépő` lekerül.
6. Nyomj `Escape`-et. Expected: a panel bezárul, **a modal nyitva marad**.
7. Töltsd ki a kiadást és mentsd. Expected: a mentés sikeres.
8. Nyisd meg a most mentett kiadást szerkesztésre. Expected: a kategória-mező a mentett címkével jön be.
9. Szűkítsd a böngészőablakot 480 px alá. Expected: a Leírás és a Kategória egymás alá kerül.

- [ ] **Step 8: Lint, formázás, build, commit**

Run: `npm run lint`
Run: `npm run format:check`
Run: `npm run build`

```bash
git add apps/web/src/components/ExpenseModal.vue
git commit -m "feat(web): kategória-választó a kiadás-modalban"
```

---

### Task 9: Címkék a kiadástáblán

**Files:**

- Modify: `apps/web/src/components/ExpenseTable.vue`

**Interfaces:**

- Consumes: `CategoryTag` (Task 5), `useCategoriesStore` (Task 6).

- [ ] **Step 1: Vedd fel az importokat és a store-példányt**

`apps/web/src/components/ExpenseTable.vue` — az importok közé:

```js
import CategoryTag from './CategoryTag.vue';
import { useCategoriesStore } from '../stores/categories.js';
```

és a többi store-példány mellé:

```js
const categoriesStore = useCategoriesStore();
```

- [ ] **Step 2: Írd meg a feloldó segédfüggvényt**

A `<script setup>` blokkba, a store-példányok alá:

```js
function categoriesOf(expense) {
  return (expense.categoryIds ?? []).map((id) => categoriesStore.byId(id)).filter(Boolean);
}
```

A `.filter(Boolean)` nem fölösleges: egy másik eszközön épp most törölt kategória id-je még bent lehet a listában, amíg a `category.deleted` üzenet meg nem érkezik — enélkül a sablon `undefined.name`-en hasalna el.

- [ ] **Step 3: Írd ki a címkéket a leírás alá**

A Leírás cellában, a `függőben` jelvény **után**, a `</td>` **elé**:

```vue
<span v-if="categoriesOf(expense).length" class="expense-table__categories">
                <CategoryTag
                  v-for="category in categoriesOf(expense)"
                  :key="category.id"
                  :name="category.name"
                  :color="category.color"
                  small
                />
              </span>
```

- [ ] **Step 4: Stílus**

A `<style scoped>` blokkba:

```css
.expense-table__categories {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-1);
}
```

- [ ] **Step 5: Ellenőrizd kézzel**

A dev stackben, egy eseményen, aminek van kategóriázott kiadása:

1. Expected: a Leírás alatt megjelennek a rovatjegyek, kisebb méretben.
2. Szűkítsd az ablakot a kártya-elrendezésig. Expected: a címkék a kártyán maradnak, nem törik el az elrendezést.
3. Kattints a sorra. Expected: a szerkesztő modal nyílik meg — a címkék nem fogják el a kattintást.

- [ ] **Step 6: Lint, formázás, build, commit**

Run: `npm run lint`
Run: `npm run format:check`
Run: `npm run build`

```bash
git add apps/web/src/components/ExpenseTable.vue
git commit -m "feat(web): kategória-címkék a kiadástáblán"
```

---

### Task 10: Kezelőmodal és az eseményoldal bekötése

**Files:**

- Create: `apps/web/src/components/CategoryManagerModal.vue`
- Modify: `apps/web/src/views/EventDetailView.vue`

**Interfaces:**

- Consumes: `CategoryTag` (Task 5), `useCategoriesStore` (Task 6), `useExpensesStore` (a használat-darabszámhoz), `categoriesCacheKey` (Task 6), `CATEGORY_COLORS` (Task 1).
- Produces: `CategoryManagerModal` — props: `eventId: String`, `readOnly: Boolean`; emit: `close`.

- [ ] **Step 1: Írd meg a kezelőmodalt**

`apps/web/src/components/CategoryManagerModal.vue`:

```vue
<script setup>
import { ref } from 'vue';
import { CATEGORY_COLORS } from '@filler/shared';
import CategoryTag from './CategoryTag.vue';
import { useCategoriesStore } from '../stores/categories.js';
import { useExpensesStore } from '../stores/expenses.js';

const props = defineProps({
  eventId: { type: String, required: true },
  readOnly: { type: Boolean, required: false, default: false },
});

const emit = defineEmits(['close']);

const categoriesStore = useCategoriesStore();
const expensesStore = useExpensesStore();

const busyId = ref('');
const actionError = ref('');
const newName = ref('');
const creating = ref(false);

function usageCount(categoryId) {
  return expensesStore.expenses.filter((expense) => expense.categoryIds?.includes(categoryId))
    .length;
}

async function run(id, action) {
  busyId.value = id;
  actionError.value = '';
  try {
    await action();
  } catch (error) {
    actionError.value = error?.message ?? 'A művelet nem sikerült.';
  } finally {
    busyId.value = '';
  }
}

function rename(category, name) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === category.name) {
    return;
  }
  run(category.id, () => categoriesStore.updateCategory(category.id, { name: trimmed }));
}

function recolor(category, color) {
  if (color === category.color) {
    return;
  }
  run(category.id, () => categoriesStore.updateCategory(category.id, { color }));
}

function remove(category) {
  const used = usageCount(category.id);
  const suffix =
    used === 0
      ? ''
      : ` A(z) „${category.name}” ${used} kiadáson szerepel — törlés után lekerül róluk.`;
  if (!window.confirm(`Biztosan törlöd a(z) „${category.name}” kategóriát?${suffix}`)) {
    return;
  }
  run(category.id, () => categoriesStore.deleteCategory(category.id));
}

async function create() {
  const name = newName.value.trim();
  if (!name || creating.value) {
    return;
  }
  creating.value = true;
  actionError.value = '';
  try {
    await categoriesStore.createCategory(props.eventId, {
      name,
      color: categoriesStore.nextColor,
    });
    newName.value = '';
  } catch (error) {
    actionError.value = error?.message ?? 'A kategória létrehozása nem sikerült.';
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" role="presentation" @click.self="emit('close')">
    <div
      class="modal receipt category-manager"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-manager-title"
    >
      <button type="button" class="modal-close" aria-label="Bezárás" @click="emit('close')">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            d="M4 4l8 8M12 4l-8 8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <span class="eyebrow">Esemény</span>
      <h2 id="category-manager-title">Kategóriák</h2>
      <p v-if="readOnly" class="field-hint">Az esemény archivált: a kategóriái csak olvashatók.</p>

      <p v-if="actionError" role="alert" class="field-error">{{ actionError }}</p>

      <p v-if="categoriesStore.categories.length === 0" class="field-hint">
        Még nincs kategória. Vedd fel az elsőt alul.
      </p>

      <ul class="category-manager__list">
        <li v-for="category in categoriesStore.categories" :key="category.id">
          <CategoryTag :name="category.name" :color="category.color" />
          <input
            :value="category.name"
            type="text"
            class="input-line category-manager__name"
            maxlength="32"
            :aria-label="`${category.name} neve`"
            :disabled="readOnly || busyId === category.id"
            @change="rename(category, $event.target.value)"
          />
          <span class="category-manager__colors">
            <button
              v-for="color in CATEGORY_COLORS"
              :key="color"
              type="button"
              class="category-manager__swatch"
              :class="{ 'is-active': color === category.color }"
              :style="{ '--cat-color': `var(--cat-${color})` }"
              :aria-label="`${category.name} színe: ${color}`"
              :aria-pressed="color === category.color"
              :disabled="readOnly || busyId === category.id"
              @click="recolor(category, color)"
            />
          </span>
          <button
            type="button"
            class="btn btn--danger btn--small"
            :disabled="readOnly || busyId === category.id"
            @click="remove(category)"
          >
            Törlés
          </button>
        </li>
      </ul>

      <form v-if="!readOnly" class="category-manager__create" @submit.prevent="create">
        <input
          v-model="newName"
          type="text"
          class="input-line"
          placeholder="Új kategória neve"
          maxlength="32"
          aria-label="Új kategória neve"
          :disabled="creating"
        />
        <button type="submit" class="btn btn--primary btn--small" :disabled="creating">
          {{ creating ? 'Felvétel…' : '+ Felvétel' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.category-manager__list {
  list-style: none;
  margin: 0 0 var(--space-4);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.category-manager__list li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.category-manager__name {
  flex: 1;
  min-width: 8rem;
}

.category-manager__colors {
  display: flex;
  gap: var(--space-1);
}

.category-manager__swatch {
  width: 1.1rem;
  height: 1.1rem;
  padding: 0;
  border: 1px solid var(--rule);
  border-radius: 2px;
  background: var(--cat-color);
  cursor: pointer;
}

.category-manager__swatch.is-active {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}

.category-manager__create {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
</style>
```

- [ ] **Step 2: Kösd be az eseményoldalt**

`apps/web/src/views/EventDetailView.vue` — az importok közé:

```js
import { useCategoriesStore } from '../stores/categories.js';
import CategoryManagerModal from '../components/CategoryManagerModal.vue';
```

A `cacheKeys` import-blokkjába vedd fel a `categoriesCacheKey`-t (ábécésorrendben az első):

```js
  categoriesCacheKey,
```

A store-példányok közé:

```js
const categoriesStore = useCategoriesStore();
```

A `showEditModal` ref mellé:

```js
const showCategoryModal = ref(false);
```

- [ ] **Step 3: Jelentsd be a cache-kulcsot és töltsd be a listát**

Az `onMounted`-ben a `setVisibleKeys` tömbjébe, az `expensesCacheKey` sora **után**:

```js
    categoriesCacheKey(route.params.id),
```

Ugyanitt, a `paymentsStore.fetchPayments(route.params.id);` sor **után**:

```js
categoriesStore.fetchCategories(route.params.id);
```

Az `onUnmounted`-ben, a `paymentsStore.reset();` **után**:

```js
categoriesStore.reset();
```

- [ ] **Step 4: Vedd fel a csendes frissítésbe**

A `refreshScreenQuietly` (`apps/web/src/views/EventDetailView.vue:152`) `Promise.all` tömbjében, a `paymentsStore.refreshQuietly(route.params.id),` sor **után**:

```js
    categoriesStore.refreshQuietly(route.params.id),
```

Ez az a függvény, amit a lehúzásos frissítés, az előtérbe kerülés és a stream-újrakapcsolódás is hív — enélkül egy másik eszközön felvett kategória csak oldalfrissítésre jönne meg.

- [ ] **Step 5: Vedd fel a gombot és a modalt**

A fejléc `.event-detail__actions` blokkjában, a „Szerkesztés" gomb **elé**:

```vue
<button type="button" class="btn btn--ghost btn--small" @click="showCategoryModal = true">
              Kategóriák
            </button>
```

Az `EventFormModal` **után**:

```vue
<CategoryManagerModal
  v-if="showCategoryModal"
  :event-id="event.id"
  :read-only="event.archived"
  @close="showCategoryModal = false"
/>
```

- [ ] **Step 6: Ellenőrizd kézzel**

Run: `npm run dev`

1. Nyiss meg egy nem archivált eseményt. Expected: a fejlécben ott a „Kategóriák" gomb.
2. Nyisd meg. Expected: a Task 8-ban felvitt kategóriák listája, mindegyik rovatjeggyel, névmezővel, hat színponttal és Törlés gombbal.
3. Írd át egy nevét és lépj ki a mezőből (`Tab`). Expected: a név azonnal frissül a listában **és** a kiadástábla címkéjén is.
4. Kattints egy másik színpontra. Expected: a rovatjegy csíkja azonnal átszíneződik.
5. Vegyél fel egy újat alul. Expected: megjelenik a listában, a paletta következő, még nem használt színével.
6. Törölj egy olyat, ami rajta van egy kiadáson. Expected: a megerősítő kérdés megmondja, hány kiadáson szerepel; az OK után a kategória eltűnik, és a kiadástáblán is lekerül a címke — **oldalfrissítés nélkül**.
7. Archiválj egy eseményt, és nyisd meg rajta a Kategóriák modalt. Expected: „Az esemény archivált: a kategóriái csak olvashatók.", minden gomb és mező tiltott, a felvevő űrlap nem látszik.

- [ ] **Step 7: Ellenőrizd az élő frissítést két lapon**

Nyisd meg ugyanazt az eseményt két böngészőfülön.

1. Az egyiken vegyél fel egy kategóriát a Kategóriák modalból. Expected: a másik fülön a kiadás-modal lenyílójában is ott van, frissítés nélkül.
2. Az egyiken törölj egy használatban lévő kategóriát. Expected: a másik fülön a címke azonnal lekerül a kiadássorról.

- [ ] **Step 8: Ellenőrizd offline**

A böngésző DevTools Network fülén állítsd „Offline"-ra, majd tölts újra.

Expected: a kategóriák a gyorsítótárból jönnek, a kiadás-modal lenyílójában választhatók, és a lenyíló alján ott áll: `Offline nem hozható létre új kategória.`

- [ ] **Step 9: Lint, formázás, build, commit**

Run: `npm run lint`
Run: `npm run format:check`
Run: `npm run build`

```bash
git add apps/web/src/components/CategoryManagerModal.vue apps/web/src/views/EventDetailView.vue
git commit -m "feat(web): kategória-kezelő modal az eseményoldalon"
```

---

### Task 11: Dokumentáció

**Files:**

- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Nézd meg a célfejezeteket**

Run: `grep -n '^#' docs/ARCHITECTURE.md`

Expected: `## 4. Adatmodell`, `## 9. Backend rétegzés és API végpontok` (benne `### API végpontok` és `### 9.1 Élő frissítés (SSE)`), `### 10.1 Olvasás: hálózat-először, cache tartalékként`.

- [ ] **Step 2: Írd le a kollekciót**

Az adatmodell fejezetbe, a `Expense` leírása **után**, a meglévő fejezet formátumát követve:

```markdown
### Category

Egy esemény kiadás-kategóriája. `eventId`, `name` (max 32 karakter), `color`
(a hat kulcs egyike: `indigo`, `plum`, `teal`, `rust`, `olive`, `slate`).

A név eseményen belül egyedi, `collation: { locale: 'hu', strength: 1 }`
mellett — ez a kisbetűt és az ékezetet is egybemossa, tehát „Étel" és „etel"
ütközik. Szándékosan szigorúbb, mint a `Person` `strength: 2`-je.

A kategória törlése előbb `$pull`-lal leszedi magát az esemény összes
kiadásáról, és csak utána törli a dokumentumot — fordítva a kiadásokon egy
már nem létező kategóriára mutató id maradna. Az esemény törlése a
kategóriáit is elviszi.

A kiadás `categoryIds` mezője ezekre hivatkozik (`default: []`, legfeljebb 10,
duplikátum nélkül), és **nem** befolyásolja az elszámolást.
```

- [ ] **Step 3: Írd le a végpontokat**

A `### API végpontok` táblázatába, a `DELETE /api/expenses/:id` sor **után** (a táblázat háromoszlopos: metódus, útvonal, hitelesítés-jelölés, leírás — a `✓` a védett végpontokat jelöli):

```markdown
| `GET` | `/api/events/:id/categories` | ✓ | Esemény kategóriái, névsorban |
| `POST` | `/api/events/:id/categories` | ✓ | Új kategória (`name`, `color`) |
| `PATCH` | `/api/categories/:id` | ✓ | Átnevezés vagy átszínezés |
| `DELETE` | `/api/categories/:id` | ✓ | Törlés, a kiadásokról lekapcsolva |
```

Futtasd utána a `npm run format:check`-et: a Prettier a markdown-táblázatok oszlopszélességét is igazítja, tehát ha a beszúrt sorok nem passzolnak, ott bukik el.

- [ ] **Step 4: Egészítsd ki az élő frissítés leírását**

A `### 9.1 Élő frissítés (SSE)` fejezetben, ahol az `eventStreamMessageSchema` üzenettípusai fel vannak sorolva, vedd fel a `category.created`, `category.updated`, `category.deleted` típusokat, és jegyezd meg: a törlés **egyetlen** üzenet, nem kiadásonként egy `expense.updated` — a kliens maga kapcsolja le az id-t a betöltött kiadásokról.

- [ ] **Step 4b: Vedd fel az új cache-kulcsot**

A `### 10.1 Olvasás: hálózat-először, cache tartalékként` fejezetben, ahol a cache-kulcsok fel vannak sorolva, vedd fel a `categories:<eseményId>` kulcsot, és jegyezd meg, hogy a kategória-**írás** nem jár az outboxon: offline a lista csak olvasható.

- [ ] **Step 5: Formázás és commit**

Run: `npm run format:check`

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: kategóriák az architektúra-leírásban"
```

---

## Végső ellenőrzés

- [ ] Run: `npm run lint` — hibátlan
- [ ] Run: `npm run format:check` — hibátlan
- [ ] Run: `npm run build` — hibátlan
- [ ] A dev stackben: kategória felvitele a kiadás-modalból, átnevezés és átszínezés a kezelőmodalból, használatban lévő kategória törlése (a címke lekerül a kiadássorról), archivált eseményen minden kategória-művelet tiltott, offline a lenyíló választható de nem felvehető.
