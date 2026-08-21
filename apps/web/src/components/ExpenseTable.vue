<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { formatMoney, SETTLEMENT_CURRENCY } from '@filler/shared';
import { useExpensesStore } from '../stores/expenses.js';
import ExpenseModal from './ExpenseModal.vue';
import RowMenu from './RowMenu.vue';
import { formatDate } from '../utils/format.js';
import { isNativeApp } from '../utils/platform.js';
import { attachPullToRefresh } from '../utils/pullToRefresh.js';

const props = defineProps({
  event: { type: Object, required: true },
  people: { type: Array, required: true },
});

/**
 * A lehúzásos gesztus a KÉPERNYŐ frissítését jelenti, nem csak a
 * kiadástábláét — a fejléc eseményadatai és a nevek viszont a szülő
 * (`EventDetailView`) sajátjai. Ezért itt csak jelezzük a gesztust, a
 * kiadáslistán túli frissítést a szülő végzi: ha ez a komponens írná a
 * cache-t azokra a kulcsokra, a kulcs frissnek jelölődne, miközben a
 * képernyőn még a régi fejléc látszik — vagyis az offline sáv eltűnne egy
 * még nem frissült adat felett.
 */
const emit = defineEmits(['refresh']);

const expensesStore = useExpensesStore();

const payerFilter = ref('');
const showModal = ref(false);
const editingExpense = ref(null);
const saving = ref(false);
const formError = ref('');
const actionError = ref('');
const pullRatio = ref(0);
let detachPullToRefresh = null;

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

onMounted(() => {
  // A lehúzásos gesztus natív affordance, nem az SSE hiányának a
  // helyettesítője — böngészőben ne kapjon touch-gesztust.
  if (isNativeApp()) {
    detachPullToRefresh = attachPullToRefresh({
      onRefresh: () => {
        emit('refresh');
        return expensesStore.refreshQuietly(props.event.id);
      },
      onProgress: (ratio) => {
        pullRatio.value = ratio;
      },
    });
  }
});

onUnmounted(() => {
  if (detachPullToRefresh) {
    detachPullToRefresh();
    detachPullToRefresh = null;
  }
});

const filteredExpenses = computed(() => {
  if (!payerFilter.value) {
    return expensesStore.expenses;
  }
  return expensesStore.expenses.filter((expense) => expense.payerId === payerFilter.value);
});

function participantName(id) {
  return props.people.find((person) => person.id === id)?.name ?? 'Ismeretlen';
}

function openCreateModal() {
  editingExpense.value = null;
  formError.value = '';
  showModal.value = true;
}

function openEditModal(expense) {
  if (expense.pending) {
    // Egy még fel nem töltött sor nem szerkeszthető: a szerkesztés a
    // szervertől kapott, valódi kiadás azonosítójára támaszkodik, ami egy
    // pending sornak nincs. A módosítás a szinkron képernyőn kerül majd sorra
    // (visszavonás + újrafelvitel) — a sor emiatt eleve nem is kínálja fel
    // ezt a lehetőséget (lásd a `<tr>` `tabindex`/`title` kötését lent).
    return;
  }
  editingExpense.value = expense;
  formError.value = '';
  showModal.value = true;
}

/**
 * @param {object} input a szervernek szánt kiadás-payload
 * @param {{ rateResolvedByForm: boolean }} rateMeta kliensoldali kísérő tény
 * az árfolyam eredetéről (lásd `ExpenseModal.vue`) — a payloadtól
 * szándékosan elválasztva, mert a szervernek nem küldhető
 */
async function handleSubmit(input, rateMeta) {
  saving.value = true;
  formError.value = '';
  try {
    if (editingExpense.value) {
      await expensesStore.updateExpense(editingExpense.value.id, input, rateMeta);
    } else {
      await expensesStore.createExpense(props.event.id, input, rateMeta);
    }
    showModal.value = false;
  } catch (error) {
    formError.value = error.message ?? 'Nem sikerült menteni a kiadást.';
  } finally {
    saving.value = false;
  }
}

async function handleDelete(expense) {
  const confirmed = window.confirm(`Biztosan törlöd ezt a kiadást: "${expense.description}"?`);
  if (!confirmed) {
    return;
  }
  actionError.value = '';
  try {
    await expensesStore.deleteExpense(expense.id);
  } catch (error) {
    // A `deleteExpense` egy szerver által ténylegesen elutasított törlést
    // (pl. már törölt kiadás) idedob, nem sorolja be — enélkül ez egy
    // néma, kezeletlen elutasítás lenne, a felhasználó semmit nem látna.
    actionError.value = error.message ?? 'Nem sikerült törölni a kiadást.';
  }
}
</script>

<template>
  <div class="expense-table">
    <p v-if="pullRatio > 0" class="expense-table__pull" :style="{ opacity: pullRatio }">
      {{ pullRatio >= 1 ? 'Frissítés…' : 'Húzd lejjebb a frissítéshez' }}
    </p>
    <div class="expense-table__toolbar">
      <div class="field expense-table__filter">
        <label for="payer-filter">Szűrés fizetőre</label>
        <select id="payer-filter" v-model="payerFilter">
          <option value="">Mind</option>
          <option v-for="id in event.participantIds" :key="id" :value="id">
            {{ participantName(id) }}
          </option>
        </select>
      </div>
      <p
        class="expense-table__live"
        :class="{ 'is-offline': !expensesStore.connected }"
        :title="
          expensesStore.connected
            ? 'A más eszközökön felvitt kiadások azonnal megjelennek'
            : 'Nincs élő kapcsolat — a lista elavult lehet, újrakapcsolódás folyamatban'
        "
      >
        <span class="expense-table__live-dot" aria-hidden="true" />
        {{ expensesStore.connected ? 'élő' : 'nincs kapcsolat' }}
      </p>
      <button type="button" class="btn btn--primary" @click="openCreateModal">+ Új kiadás</button>
    </div>

    <p v-if="actionError" role="alert" class="expense-table__status">{{ actionError }}</p>
    <p v-if="expensesStore.loading" class="expense-table__status">Betöltés…</p>
    <p v-else-if="expensesStore.error" role="alert" class="expense-table__status">
      Nem sikerült betölteni a kiadásokat.
    </p>
    <p v-else-if="filteredExpenses.length === 0" class="expense-table__status">
      Még nincs kiadás. Rögzítsd az elsőt a „Új kiadás” gombbal.
    </p>

    <table v-else class="ledger-table expense-table__table">
      <thead>
        <tr>
          <th>Dátum</th>
          <th>Leírás</th>
          <th>Kifizette</th>
          <th class="align-right">Összeg</th>
          <th class="align-right">Alapvaluta</th>
          <th>Osztozók</th>
          <th></th>
        </tr>
      </thead>
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
            <td data-label="Dátum" class="money">{{ formatDate(expense.date) }}</td>
            <td data-label="Leírás" class="expense-table__description">
              {{ expense.description }}
              <span v-if="expense.pending" class="expense-table__pending-badge">függőben</span>
            </td>
            <td data-label="Kifizette">{{ participantName(expense.payerId) }}</td>
            <td data-label="Összeg" class="align-right money">
              {{ formatMoney({ amountMinor: expense.amountMinor, currency: expense.currency }) }}
            </td>
            <!--
              A `≈` („becsült") csak akkor jár, ha ténylegesen történt
              árfolyam-átváltás: egy forintban rögzített pending sornál az összeg
              pontos, ott a jelölés azt állította volna, hogy egy pontos szám
              becsült.
            -->
            <td data-label="Alapvaluta" class="align-right money money--credit">
              {{ expense.pending && expense.currency !== SETTLEMENT_CURRENCY ? '≈ ' : ''
              }}{{
                formatMoney({
                  amountMinor: expense.baseAmountMinor,
                  currency: SETTLEMENT_CURRENCY,
                })
              }}
            </td>
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
            <td v-if="!expense.pending" data-label="" class="expense-table__actions">
              <RowMenu label="Kiadás műveletei">
                <button
                  type="button"
                  class="btn btn--ghost btn--small"
                  @click="openEditModal(expense)"
                >
                  Szerkesztés
                </button>
                <button
                  type="button"
                  class="btn btn--danger btn--small"
                  @click="handleDelete(expense)"
                >
                  Törlés
                </button>
              </RowMenu>
            </td>
          </tr>
          <tr v-if="expense.items && expandedIds.has(expense.id)" class="expense-table__items-row">
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
    </table>

    <ExpenseModal
      v-if="showModal"
      :event="event"
      :people="people"
      :expense="editingExpense"
      :saving="saving"
      :error-message="formError"
      @submit="handleSubmit"
      @cancel="showModal = false"
    />
  </div>
</template>

<style scoped>
.expense-table__toolbar {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.expense-table__filter {
  margin-bottom: 0;
}

/* Halk kapcsolatjelző: enélkül egy halott stream néma hiba lenne — a lista
   élőnek tűnik, pedig elavult. */
.expense-table__live {
  display: flex;
  align-items: center;
  gap: 0.4em;
  margin: 0 0 0.55em auto;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-soft);
  white-space: nowrap;
}

.expense-table__live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--forint);
}

.expense-table__live.is-offline {
  color: var(--stamp);
}

.expense-table__live.is-offline .expense-table__live-dot {
  background: none;
  border: 1.5px solid currentColor;
}

.expense-table__status {
  color: var(--ink-soft);
}

.ledger-table {
  width: 100%;
  border-collapse: collapse;
}

.ledger-table th {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-soft);
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border-bottom: 2px solid var(--ink);
}

.ledger-table td {
  padding: var(--space-3);
  border-bottom: 1px solid var(--rule);
  vertical-align: middle;
}

.ledger-table .align-right {
  text-align: right;
}

.expense-table__table td[data-label='Dátum'] {
  white-space: nowrap;
}

.expense-table__actions {
  text-align: right;
  width: 1%;
}

.expense-table__description {
  font-weight: 600;
}

.expense-table__pending-badge {
  margin-left: var(--space-1);
  padding: 0.05rem 0.35rem;
  border-radius: 0.2rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--brass);
  color: var(--paper);
}

.expense-table__shared {
  color: var(--ink-soft);
  font-size: 0.9rem;
}

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

.expense-table__row {
  cursor: pointer;
}

/* Egy még fel nem töltött sor nem szerkeszthető (lásd `openEditModal`
   őrfeltétele) — a kurzor és a hover-kiemelés ezt ne ígérje meg. */
.expense-table__row.is-pending {
  cursor: default;
}

/* Hover csak igazi kurzorral, és csak nem-pending soron: érintésnél
   beragadna a kiemelés, pending soron pedig egy nem elérhető műveletet
   ígérne. */
@media (hover: hover) and (pointer: fine) {
  .expense-table__row:not(.is-pending):hover {
    background: var(--forint-soft);
  }
}

/* Más eszközön felvitt/szerkesztett kiadás: rövid bankjegy-zöld felvillanás,
   mintha most ütötték volna bele a bélyegzőt a főkönyvbe. */
@keyframes expense-arrive {
  from {
    background-color: var(--forint-soft);
  }
  to {
    background-color: transparent;
  }
}

/* Mobil kártyás nézetben a sor alapháttere nem átlátszó, ezért oda külön
   keyframe kell — különben a felvillanás végén eltűnne a kártya háttere. */
@keyframes expense-arrive-card {
  from {
    background-color: var(--forint-soft);
  }
  to {
    background-color: var(--paper-raised);
  }
}

.expense-table__row.is-fresh {
  animation: expense-arrive 1.6s ease-out;
}

.btn--small {
  font-size: 0.78rem;
  padding: 0.35em 0.65em;
}

/* Mobilon minden kiadás egy kis letépett nyugtaként jelenik meg. */
@media (max-width: 640px) {
  .expense-table__toolbar {
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .expense-table__filter {
    flex: 1;
  }

  .expense-table__filter label {
    font-size: 0.7rem;
  }

  .expense-table__live {
    margin: 0 0 0.7em;
  }

  .expense-table__table thead {
    display: none;
  }

  .expense-table__table,
  .expense-table__table tbody {
    display: block;
    width: 100%;
  }

  .expense-table__row {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
    column-gap: var(--space-3);
    row-gap: 2px;
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: 2px;
    margin-bottom: var(--space-3);
    padding: var(--space-4) var(--space-3) var(--space-3);
  }

  .expense-table__row::before {
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

  .expense-table__table td {
    display: block;
    border-bottom: none;
    padding: 0;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .expense-table__table td[data-label='Leírás'] {
    order: 1;
    font-size: 1rem;
    font-weight: 600;
  }

  .expense-table__table td[data-label='Dátum'] {
    order: 2;
    text-align: right;
    font-size: 0.78rem;
    color: var(--ink-soft);
  }

  .expense-table__table td[data-label='Kifizette'] {
    order: 3;
    font-size: 0.85rem;
  }

  .expense-table__table td[data-label='Osztozók'] {
    order: 4;
    text-align: right;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }

  .expense-table__table td[data-label='Alapvaluta'] {
    display: none;
  }

  .expense-table__table td[data-label='Összeg'] {
    order: 5;
    text-align: left;
    font-size: 1.05rem;
    color: var(--forint);
  }

  .expense-table__table td[data-label=''] {
    order: 6;
    text-align: right;
    overflow: visible;
  }

  .expense-table__table td[data-label='Osztozók']::before {
    content: '→ ';
    color: var(--brass);
  }

  .ledger-table .align-right {
    text-align: right;
  }

  .expense-table__row.is-fresh {
    animation-name: expense-arrive-card;
  }

  .expense-table__items-row {
    display: block;
    margin-top: calc(-1 * var(--space-3));
    margin-bottom: var(--space-3);
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-top: none;
    padding: 0 var(--space-3) var(--space-3);
  }

  .expense-table__table .expense-table__items-row td {
    display: block;
    padding: 0;
    white-space: normal;
  }

  .expense-table__items li {
    grid-template-columns: 1fr auto;
  }

  .expense-table__item-shared {
    grid-column: 1 / -1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .expense-table__row.is-fresh {
    animation: none;
    background-color: var(--forint-soft);
  }
}

.expense-table__pull {
  margin: 0 0 var(--space-2);
  text-align: center;
  font-size: 0.85rem;
  color: var(--ink-soft);
}
</style>
