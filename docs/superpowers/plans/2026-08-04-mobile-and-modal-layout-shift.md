# Modal Layout-Shift Fix + Mobile Responsive View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the expense/event modals from visibly jumping when async content (exchange rate, base-amount preview, errors) pops in, and make every view in the Kassza web app usable on a phone-width screen.

**Architecture:** Pure frontend CSS/template changes across `apps/web/src`. No API, store, or schema changes. The modal fix anchors both modal backdrops to the top of the viewport (instead of vertically centering) and reserves layout space for the two async text blocks in `ExpenseModal.vue` that currently pop in after the initial render. The mobile pass adds a `max-width: 640px` breakpoint (matching the one already used in `ExpenseTable.vue`) to: collapse the top nav's links behind a hamburger button, convert the `EventsListView` and `SettlementPanel` tables to the same stacked-card pattern `ExpenseTable.vue` already uses, and stack the `EventDetailView` header/tabs vertically.

**Tech Stack:** Vue 3 `<script setup>` SFCs, plain scoped CSS (no CSS framework, no preprocessor).

## Global Constraints

- This repository has **no git repository initialized yet** (`git status` fails with "not a git repository") and **no automated test suite** (Vitest/Testcontainers/Playwright were deliberately removed from this project) — every task's "Step: Commit" and "Step: write/run test" from the standard plan template are replaced with a **manual verification** step: run the dev server and check the behavior in a browser. Do not reintroduce a test framework or attempt a git commit.
- Follow the existing design system in `apps/web/src/assets/theme.css` (banknote-green/stamp-red ledger look, `var(--space-*)` spacing scale, `.money`, `.eyebrow`, `.receipt` torn-edge primitives) — don't introduce new colors or a generic look.
- Reuse the existing `640px` mobile breakpoint already established in `apps/web/src/components/ExpenseTable.vue:228`. All new mobile media queries in this plan use the same `@media (max-width: 640px)` value.
- All `<style>` blocks in this codebase are `scoped` — keep new rules inside the existing scoped `<style>` block of the file being edited, matching current class-naming (`.component-name__part`).

**To run the dev server for manual verification:** from `/mnt/WDred/Docker/kassza`, run `npm run dev --workspace=apps/web` (or check `apps/web/package.json` for the exact script name if that fails) and open the printed local URL. Use your browser's device toolbar (or resize the window) to check both a ~375px-wide mobile viewport and the default desktop width for every task below.

---

### Task 1: Anchor both modals to the top of the viewport instead of centering

**Files:**
- Modify: `apps/web/src/components/ExpenseModal.vue:440-455` (`<style scoped>` block, `.modal-backdrop` and `.modal` rules)
- Modify: `apps/web/src/components/EventFormModal.vue:134-149` (`<style scoped>` block, `.modal-backdrop` and `.modal` rules)

**Interfaces:** None — this is a self-contained CSS-only change, no props/emits/JS state involved.

- [ ] **Step 1: Change `ExpenseModal.vue`'s backdrop/modal CSS**

In `apps/web/src/components/ExpenseModal.vue`, replace:

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(30, 42, 34, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  z-index: 10;
}

.modal {
  width: min(480px, 100%);
  max-height: 90vh;
  overflow-y: auto;
}
```

with:

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(30, 42, 34, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-4);
  overflow-y: auto;
  z-index: 10;
}

.modal {
  width: min(480px, 100%);
  max-height: 90vh;
  margin-top: var(--space-6);
  overflow-y: auto;
}
```

- [ ] **Step 2: Change `EventFormModal.vue`'s backdrop/modal CSS**

In `apps/web/src/components/EventFormModal.vue`, replace:

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(30, 42, 34, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  z-index: 10;
}

.modal {
  width: min(440px, 100%);
  max-height: 90vh;
  overflow-y: auto;
}
```

with:

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(30, 42, 34, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-4);
  overflow-y: auto;
  z-index: 10;
}

.modal {
  width: min(440px, 100%);
  max-height: 90vh;
  margin-top: var(--space-6);
  overflow-y: auto;
}
```

- [ ] **Step 3: Manual verification**

Run the dev server. Open an event, click "+ Új kiadás" to open `ExpenseModal`. Confirm the modal now sits near the top of the screen (not vertically centered) with a small gap above it. Switch the currency dropdown away from HUF and back — confirm the modal's title/date/payer fields at the top do not move; only the space below the change grows/shrinks. Repeat by opening "Szerkesztés" on the event (uses `EventFormModal`) — confirm it also sits near the top. On a short/mobile-height viewport, confirm you can still scroll the page (backdrop) to see the whole modal if it's taller than the screen.

---

### Task 2: Reserve layout space for the async rate error and base-amount preview in `ExpenseModal.vue`

**Files:**
- Modify: `apps/web/src/components/ExpenseModal.vue` (template lines ~379-387, `<style scoped>` block)

**Interfaces:** None — wraps existing `rateError` and `baseAmountPreview` reactive values (already defined in this file) in non-conditional container elements; no new props/emits.

- [ ] **Step 1: Wrap the rate error message in a reserved-height slot**

Replace:

```html
          <p v-if="rateError" role="alert" class="field-error">{{ rateError }}</p>
          <span class="eyebrow expense-modal__rate-source">
```

with:

```html
          <div class="expense-modal__rate-error-slot">
            <p v-if="rateError" role="alert" class="field-error">{{ rateError }}</p>
          </div>
          <span class="eyebrow expense-modal__rate-source">
```

- [ ] **Step 2: Wrap the base-amount preview in a reserved-height slot**

Replace:

```html
        <p v-if="baseAmountPreview !== null" class="expense-modal__preview">
          Alapvaluta-összeg: <span class="money money--credit">{{ baseAmountPreviewLabel }}</span>
        </p>
```

with:

```html
        <div class="expense-modal__preview-slot">
          <p v-if="baseAmountPreview !== null" class="expense-modal__preview">
            Alapvaluta-összeg: <span class="money money--credit">{{ baseAmountPreviewLabel }}</span>
          </p>
        </div>
```

- [ ] **Step 3: Add the reserved-height CSS**

In the `<style scoped>` block, right after the existing `.expense-modal__preview` rule, add:

```css
.expense-modal__rate-error-slot {
  min-height: 1.3rem;
}

.expense-modal__preview-slot {
  min-height: 2.5rem;
}
```

- [ ] **Step 4: Manual verification**

Run the dev server, open "+ Új kiadás", set currency to something other than HUF (triggers the async rate fetch). Watch the area around the rate field while the fetch resolves — confirm the space for the error message is already reserved (no shift when it appears/disappears; force an error by disconnecting from the network if you want to see the error text itself). Type a valid amount and confirm the "Alapvaluta-összeg" preview appears without shifting the "Ki osztozik rajta" section below it noticeably (some shift is fine right at the moment the preview's own text renders inside its reserved box, but the box itself must already be present before you type).

---

### Task 3: Collapse the top nav's links behind a hamburger button on mobile

**Files:**
- Modify: `apps/web/src/App.vue` (script block, template, `<style scoped>` block)

**Interfaces:**
- Produces: `mobileMenuOpen` (ref\<boolean\>) — local UI state, not consumed elsewhere.

- [ ] **Step 1: Add mobile menu state and auto-close-on-navigation to the script block**

Replace:

```js
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const showNav = computed(() => route.name !== 'login');
const theme = ref(getTheme());

function handleToggleTheme() {
  theme.value = toggleTheme();
}
```

with:

```js
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const showNav = computed(() => route.name !== 'login');
const theme = ref(getTheme());
const mobileMenuOpen = ref(false);

watch(
  () => route.fullPath,
  () => {
    mobileMenuOpen.value = false;
  },
);

function handleToggleTheme() {
  theme.value = toggleTheme();
}
```

And update the Vue import line from:

```js
import { computed, ref } from 'vue';
```

to:

```js
import { computed, ref, watch } from 'vue';
```

- [ ] **Step 2: Add the hamburger button and make the tabs collapsible in the template**

Replace:

```html
  <header v-if="showNav" class="app-nav">
    <router-link to="/" class="app-nav__mark">Kassza</router-link>
    <nav class="app-nav__tabs">
      <router-link to="/" class="app-nav__tab">Események</router-link>
      <router-link to="/settings" class="app-nav__tab">Beállítások</router-link>
    </nav>
    <button
      type="button"
      class="app-nav__theme-toggle"
      :aria-label="theme === 'dark' ? 'Váltás világos módra' : 'Váltás sötét módra'"
      @click="handleToggleTheme"
    >
      {{ theme === 'dark' ? '☀' : '☾' }}
    </button>
    <button type="button" class="app-nav__logout" @click="handleLogout">Kilépés</button>
  </header>
```

with:

```html
  <header v-if="showNav" class="app-nav">
    <router-link to="/" class="app-nav__mark">Kassza</router-link>
    <button
      type="button"
      class="app-nav__menu-toggle"
      aria-label="Menü megnyitása"
      :aria-expanded="mobileMenuOpen"
      @click="mobileMenuOpen = !mobileMenuOpen"
    >
      {{ mobileMenuOpen ? '✕' : '☰' }}
    </button>
    <nav class="app-nav__tabs" :class="{ 'is-open': mobileMenuOpen }">
      <router-link to="/" class="app-nav__tab">Események</router-link>
      <router-link to="/settings" class="app-nav__tab">Beállítások</router-link>
    </nav>
    <button
      type="button"
      class="app-nav__theme-toggle"
      :aria-label="theme === 'dark' ? 'Váltás világos módra' : 'Váltás sötét módra'"
      @click="handleToggleTheme"
    >
      {{ theme === 'dark' ? '☀' : '☾' }}
    </button>
    <button type="button" class="app-nav__logout" @click="handleLogout">Kilépés</button>
  </header>
```

- [ ] **Step 3: Add the menu-toggle button style and mobile media query**

In the `<style scoped>` block, right after the existing `.app-nav__mark` rule block, add:

```css
.app-nav__menu-toggle {
  display: none;
  font-size: 1.05rem;
  line-height: 1;
  background: none;
  border: 1.5px solid var(--rule-strong);
  color: var(--ink-soft);
  padding: 0.3em 0.6em;
  border-radius: 2px;
  cursor: pointer;
}

.app-nav__menu-toggle:hover {
  border-color: var(--brass);
  color: var(--brass);
}
```

Then, at the very end of the `<style scoped>` block (after the existing `.app-nav__logout:hover` rule), add:

```css
@media (max-width: 640px) {
  .app-nav {
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }

  .app-nav__mark {
    order: 1;
    flex: 1;
  }

  .app-nav__menu-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    order: 2;
  }

  .app-nav__theme-toggle {
    order: 3;
  }

  .app-nav__logout {
    order: 4;
  }

  .app-nav__tabs {
    display: none;
    order: 5;
    flex: 0 0 100%;
    flex-direction: column;
    gap: var(--space-1);
  }

  .app-nav__tabs.is-open {
    display: flex;
  }

  .app-nav__tab {
    padding: 0.5em 0;
    border-bottom: 1px solid var(--rule);
  }
}
```

- [ ] **Step 4: Manual verification**

Run the dev server, resize the browser to ~375px wide. Confirm the header shows: "Kassza" mark, a ☰ button, the theme toggle, and "Kilépés" all on one row without wrapping or overlapping, and the "Események"/"Beállítások" links are hidden. Click ☰ — confirm the links appear as a full-width list below the row and the icon becomes ✕. Click a link — confirm it navigates AND the menu auto-closes. Resize back above 640px — confirm the header returns to its original single-row look with both links visible inline (no hamburger visible).

---

### Task 4: Mobile card view for the events table (`EventsListView.vue`)

**Files:**
- Modify: `apps/web/src/views/EventsListView.vue` (template lines ~62-104, `<style scoped>` block)

**Interfaces:** None — template/CSS-only, reuses the existing `ledger-table` global class and the card-pattern already proven in `apps/web/src/components/ExpenseTable.vue:227-294`.

- [ ] **Step 1: Add a component-scoped table class and per-row class**

Replace the table's opening tag:

```html
    <table v-else class="ledger-table">
```

with:

```html
    <table v-else class="ledger-table events__table">
```

Replace the row's opening tag:

```html
        <tr v-for="event in eventsStore.events" :key="event.id">
```

with:

```html
        <tr v-for="event in eventsStore.events" :key="event.id" class="events__row">
```

- [ ] **Step 2: Add `data-label` attributes to every cell**

Replace the six `<td>` opening tags in the row (keep their existing content and classes exactly as-is) with labeled versions:

```html
          <td data-label="Név">
            <router-link :to="`/events/${event.id}`" class="events__name">{{
              event.name
            }}</router-link>
          </td>
          <td data-label="Résztvevők" class="events__participants">{{ participantNames(event) }}</td>
          <td
            data-label="Összköltség"
            class="align-right money"
            :class="event.totalBaseAmountMinor > 0 ? 'money--credit' : ''"
          >
            {{
              formatMoney({
                amountMinor: event.totalBaseAmountMinor,
                currency: SETTLEMENT_CURRENCY,
              })
            }}
          </td>
          <td data-label="Kezdő dátum" class="money">{{ formatDate(event.startDate) }}</td>
          <td data-label="Állapot">
            <span v-if="event.archived" class="stamp stamp--muted">Archivált</span>
            <span v-else class="events__active">Aktív</span>
          </td>
          <td data-label="" class="align-right">
            <button type="button" class="btn btn--ghost btn--small" @click="toggleArchived(event)">
              {{ event.archived ? 'Visszaállítás' : 'Archiválás' }}
            </button>
          </td>
```

- [ ] **Step 3: Add the mobile card CSS**

At the end of the `<style scoped>` block, add:

```css
@media (max-width: 640px) {
  .events__table thead {
    display: none;
  }

  .events__table,
  .events__table tbody,
  .events__table tr,
  .events__table td {
    display: block;
    width: 100%;
  }

  .events__row {
    position: relative;
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: 2px;
    margin-bottom: var(--space-4);
    padding: var(--space-4) var(--space-3) var(--space-2);
  }

  .events__row::before {
    content: '';
    position: absolute;
    top: -1px;
    left: 0;
    right: 0;
    height: 8px;
    background-image: radial-gradient(circle, var(--paper) 5px, transparent 5.5px);
    background-size: 16px 16px;
    background-position: 8px -8px;
    background-repeat: repeat-x;
  }

  .events__table td {
    border-bottom: none;
    padding: 0.2rem 0;
  }

  .events__table td[data-label]::before {
    content: attr(data-label);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
    display: block;
  }

  .events__table .align-right {
    text-align: left;
  }

  .events__table td[data-label=''] {
    margin-top: var(--space-2);
    text-align: right;
  }

  .events__table td[data-label='']::before {
    content: none;
  }
}
```

- [ ] **Step 4: Manual verification**

Run the dev server, go to the events list with at least one event, resize to ~375px. Confirm each event renders as a torn-receipt card (not a horizontally-scrolling table) with labeled fields (Név, Résztvevők, Összköltség, Kezdő dátum, Állapot) and the archive/restore button right-aligned at the bottom of the card. Resize back above 640px and confirm the original table layout is unchanged.

---

### Task 5: Mobile card view for the settlement table (`SettlementPanel.vue`)

**Files:**
- Modify: `apps/web/src/components/SettlementPanel.vue` (template lines ~63-93, `<style scoped>` block)

**Interfaces:** None — template/CSS-only.

- [ ] **Step 1: Add a per-row class and `data-label` attributes**

Replace:

```html
        <tbody>
          <tr v-for="balance in settlement.balances" :key="balance.personId">
            <td>{{ participantName(balance.personId) }}</td>
            <td class="align-right money">{{ money(balance.paidMinor) }}</td>
            <td class="align-right money">{{ money(balance.owedMinor) }}</td>
            <td class="align-right">
              <span
                class="money"
                :class="{
                  'money--credit': balance.balanceMinor > 0,
                  'money--debit': balance.balanceMinor < 0,
                }"
              >
                {{ money(balance.balanceMinor) }}
              </span>
              <span class="settlement__balance-status">{{
                balanceStatus(balance.balanceMinor)
              }}</span>
            </td>
          </tr>
        </tbody>
```

with:

```html
        <tbody>
          <tr v-for="balance in settlement.balances" :key="balance.personId" class="settlement__row">
            <td data-label="Résztvevő">{{ participantName(balance.personId) }}</td>
            <td data-label="Kifizette" class="align-right money">{{ money(balance.paidMinor) }}</td>
            <td data-label="Rá eső rész" class="align-right money">{{ money(balance.owedMinor) }}</td>
            <td data-label="Egyenleg" class="align-right">
              <span
                class="money"
                :class="{
                  'money--credit': balance.balanceMinor > 0,
                  'money--debit': balance.balanceMinor < 0,
                }"
              >
                {{ money(balance.balanceMinor) }}
              </span>
              <span class="settlement__balance-status">{{
                balanceStatus(balance.balanceMinor)
              }}</span>
            </td>
          </tr>
        </tbody>
```

- [ ] **Step 2: Add the mobile card + coupon-wrap CSS**

At the end of the `<style scoped>` block, add:

```css
@media (max-width: 640px) {
  .settlement__table thead {
    display: none;
  }

  .settlement__table,
  .settlement__table tbody,
  .settlement__table tr,
  .settlement__table td {
    display: block;
    width: 100%;
  }

  .settlement__row {
    position: relative;
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: 2px;
    margin-bottom: var(--space-3);
    padding: var(--space-3) var(--space-3) var(--space-2);
  }

  .settlement__table td {
    border-bottom: none;
    padding: 0.2rem 0;
  }

  .settlement__table td[data-label]::before {
    content: attr(data-label);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
    display: block;
  }

  .settlement__table .align-right {
    text-align: left;
  }

  .settlement__coupon {
    flex-wrap: wrap;
  }

  .settlement__coupon-amount {
    flex: 1 0 100%;
    text-align: right;
  }
}
```

- [ ] **Step 3: Manual verification**

Run the dev server, open an event's "Elszámolás" tab with at least one balance, resize to ~375px. Confirm each participant renders as a card with labeled Résztvevő/Kifizette/Rá eső rész/Egyenleg fields instead of a horizontally-scrolling table. If there are transfers ("Ki fizet kinek"), confirm each coupon wraps the amount onto its own line right-aligned instead of squeezing everything into one cramped row. Resize back above 640px and confirm the original table/coupon layout is unchanged.

---

### Task 6: Stack the event detail header and widen the ledger tabs on mobile (`EventDetailView.vue`)

**Files:**
- Modify: `apps/web/src/views/EventDetailView.vue` (`<style scoped>` block)

**Interfaces:** None — CSS-only, no template changes needed.

- [ ] **Step 1: Add the mobile stacking media query**

At the end of the `<style scoped>` block, add:

```css
@media (max-width: 640px) {
  .event-detail {
    padding: var(--space-6) var(--space-4);
  }

  .event-detail__header {
    flex-direction: column;
    align-items: stretch;
  }

  .event-detail__side {
    align-items: flex-start;
  }

  .event-detail__actions {
    width: 100%;
  }

  .event-detail__actions .btn {
    flex: 1;
  }

  .ledger-tabs__tab {
    flex: 1;
    text-align: center;
    padding: 0.6em 0.5em;
  }
}
```

- [ ] **Step 2: Manual verification**

Run the dev server, open an event's detail page, resize to ~375px. Confirm the header (event name/meta on one side, currency stamp + Szerkesztés/Törlés buttons on the other) now stacks vertically with the two action buttons spanning the full width side-by-side, instead of being squeezed next to the title. Confirm the "Kiadások"/"Elszámolás" tabs each take up half the width instead of being tightly-padded small buttons. Resize back above 640px and confirm the original side-by-side header layout is unchanged.

---

## Self-Review Notes

- **Spec coverage:** Task 1–2 cover the modal layout-shift complaint (anchor-top + reserved space for the rate error/preview). Tasks 3–6 cover the mobile pass agreed in the design: nav (3), the two remaining un-adapted tables (4, 5), and the event detail header/tabs (6). `ExpenseModal.vue`/`EventFormModal.vue` widths and `ExpenseTable.vue`'s existing mobile card view needed no changes, per the design.
- **Placeholder scan:** No TBD/TODO markers; every step has literal before/after code.
- **Type consistency:** No new functions/props/emits are introduced anywhere in this plan (all six tasks are template/CSS + one local `ref`/`watch` in Task 3), so there's nothing to cross-check across tasks.
