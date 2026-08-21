<script setup>
import { computed, ref } from 'vue';
import { Share } from '@capacitor/share';
import { computeSettlement, formatMoney, SETTLEMENT_CURRENCY } from '@filler/shared';
import { useExpensesStore } from '../stores/expenses.js';
import { useSettlementPaymentsStore } from '../stores/settlementPayments.js';
import { isNativeApp } from '../utils/platform.js';
import { formatDate } from '../utils/format.js';
import SettlementPaymentModal from './SettlementPaymentModal.vue';

const props = defineProps({
  event: { type: Object, required: true },
  people: { type: Array, required: true },
});

const expensesStore = useExpensesStore();
const paymentsStore = useSettlementPaymentsStore();

const showPaymentModal = ref(false);
/** A „Rendezés" gombbal előre kijelölt jegyzéksor, vagy null (szabad választás). */
const modalRow = ref(null);
/** A szerkesztett szelvény, vagy null (új felvétel). */
const editedPayment = ref(null);
const saving = ref(false);
const modalError = ref('');
const actionError = ref('');

/**
 * Az elszámolás a betöltött kiadás- és kiegyenlítés-listából számolva.
 * Ugyanaz a `computeSettlement` fut, amit a backend `/settlement` végpontja
 * használ — ezért nem kell külön kérés, és a stream minden változását azonnal
 * követi.
 *
 * `props.event` egyszer, a nézet mountjakor töltődik be, és nem frissül olyan
 * gyakran, mint a listák (amik a streamen élőben jönnek). Ha időközben más
 * eszközön új résztvevő került az eseményhez, és tőle érkezik kiadás vagy
 * kiegyenlítés, ez a `participantIds` lista már elavult, és a
 * `computeSettlement` bemenet-validációja (a résztvevőséget ellenőrzi)
 * eldobja. Ez várható, átmeneti állapot — az `EventDetailView` újratölti az
 * eseményt újrakapcsolódáskor és előtér-váltáskor —, és egy hibaüzenet jobb,
 * mint rossz egyenlegeket mutatni, ezért itt elkapjuk és `null`-t adunk
 * vissza.
 */
const settlement = computed(() => {
  try {
    return computeSettlement({
      participantIds: props.event.participantIds,
      expenses: expensesStore.expenses.map((expense) => ({
        payerId: expense.payerId,
        baseAmountMinor: expense.baseAmountMinor,
        sharedWithIds: expense.sharedWithIds,
        ...(expense.items ? { items: expense.items } : {}),
      })),
      payments: paymentsStore.payments.map((payment) => ({
        fromId: payment.fromId,
        toId: payment.toId,
        baseAmountMinor: payment.baseAmountMinor,
        date: payment.date,
        createdAt: payment.createdAt,
      })),
    });
  } catch {
    return null;
  }
});

// A betöltés állapota a két listáé: az elszámolásnak nincs saját kérése.
const loading = computed(() => expensesStore.loading || paymentsStore.loading);
const loadError = computed(
  () => expensesStore.error !== null || paymentsStore.error !== null || settlement.value === null,
);
const shareSupported = Boolean(globalThis.navigator?.share) || isNativeApp();

/** A jegyzék sorai; a nyitottak (hátralékkal) a modal választéka. */
const planRows = computed(() => settlement.value?.transfers ?? []);
const openRows = computed(() => planRows.value.filter((row) => row.remainingMinor > 0));
const allSettled = computed(() => planRows.value.length > 0 && openRows.value.length === 0);
const hasNothingToSettle = computed(() => settlement.value !== null && planRows.value.length === 0);

/**
 * Szelvényenkénti beszámítás, a lista sorrendjében — a `computeSettlement`
 * ugyanebben a sorrendben adja vissza a `paymentCredits`-et.
 */
const paymentRows = computed(() => {
  return paymentsStore.payments.map((payment, index) => {
    const credit = settlement.value?.paymentCredits[index] ?? {
      creditedMinor: payment.baseAmountMinor,
      roundingMinor: 0,
    };
    return { payment, ...credit };
  });
});

function participantName(id) {
  return props.people.find((person) => person.id === id)?.name ?? 'Ismeretlen';
}

function money(amountMinor, currency = SETTLEMENT_CURRENCY) {
  return formatMoney({ amountMinor: Math.abs(amountMinor), currency });
}

/** Előjeles forint-összeg a „Kiegyenlítve" oszlopba. */
function signedMoney(amountMinor) {
  if (amountMinor === 0) {
    return '—';
  }
  return `${amountMinor > 0 ? '+' : '−'} ${money(amountMinor)}`;
}

function balanceStatus(balanceMinor) {
  if (balanceMinor > 0) {
    return 'jár neki';
  }
  if (balanceMinor < 0) {
    return 'fizetnie kell';
  }
  return 'egyenben';
}

/** Százalék a részben rendezett sor folyamatsávjához. */
function progressPercent(row) {
  return Math.round((row.creditedMinor / row.amountMinor) * 100);
}

/**
 * Igaz, ha a listában van olyan kiadás, ami még nincs feltöltve — ilyenkor az
 * elszámolás is ezt tartalmazza, és a devizás összegek csak a felvitelkori
 * (esetleg becsült) árfolyammal számoltak.
 */
const hasPendingExpense = computed(() => {
  return expensesStore.expenses.some((expense) => expense.pending === true);
});

/**
 * A modal választható jegyzéksorai. Felvételnél csak a nyitottak, mert lezárt
 * tartozásra nincs mit fizetni. Szerkesztésnél a teljes jegyzék, plusz — ha a
 * szelvény párosa közben kiesett belőle — a saját párosa, hogy a mező sose
 * legyen üres.
 */
const modalRows = computed(() => {
  if (!editedPayment.value) {
    return openRows.value;
  }
  const payment = editedPayment.value;
  const key = `${payment.fromId}>${payment.toId}`;
  const own = planRows.value.find((row) => `${row.fromId}>${row.toId}` === key);
  return own
    ? planRows.value
    : [
        {
          fromId: payment.fromId,
          toId: payment.toId,
          amountMinor: 0,
          creditedMinor: 0,
          remainingMinor: 0,
        },
        ...planRows.value,
      ];
});

function openPaymentModal(row) {
  actionError.value = '';
  modalError.value = '';
  modalRow.value = row ?? null;
  editedPayment.value = null;
  showPaymentModal.value = true;
}

function openEditModal(payment) {
  actionError.value = '';
  modalError.value = '';
  modalRow.value = null;
  editedPayment.value = payment;
  showPaymentModal.value = true;
}

async function handlePaymentSubmit(input) {
  saving.value = true;
  modalError.value = '';
  try {
    if (editedPayment.value) {
      await paymentsStore.updatePayment(editedPayment.value.id, input);
    } else {
      await paymentsStore.createPayment(props.event.id, input);
    }
    showPaymentModal.value = false;
  } catch (error) {
    modalError.value = error.message ?? 'Nem sikerült menteni a kiegyenlítést.';
  } finally {
    saving.value = false;
  }
}

async function handleUndo(payment) {
  const confirmed = window.confirm(
    `Biztosan visszavonod? ${participantName(payment.fromId)} → ${participantName(payment.toId)}, ${money(payment.amountMinor, payment.currency)}`,
  );
  if (!confirmed) {
    return;
  }
  actionError.value = '';
  try {
    await paymentsStore.deletePayment(payment.id);
  } catch (error) {
    actionError.value = error.message ?? 'Nem sikerült visszavonni a kiegyenlítést.';
  }
}

/**
 * A megosztható összefoglaló: ki fizet kinek mennyit. A már rendezett sorok
 * nem tartoznak bele — a címzettnek az a hasznos, mi van még hátra.
 * @returns {string}
 */
function buildShareText() {
  const lines = openRows.value.map((row) => {
    return `${participantName(row.fromId)} → ${participantName(row.toId)}: ${money(row.remainingMinor)}`;
  });
  return [`${props.event.name} — elszámolás`, '', ...lines].join('\n');
}

async function handleShare() {
  try {
    await Share.share({
      title: `${props.event.name} — elszámolás`,
      text: buildShareText(),
      url: globalThis.location?.href,
      dialogTitle: 'Elszámolás megosztása',
    });
  } catch {
    // Androidon a megosztó lap bezárása is hibaként jön vissza, és a plugin
    // nem ad megbízható hibakódot, amivel ezt egy valódi küldési hibától meg
    // lehetne különböztetni — ezért itt szándékosan nem jelzünk semmit: egy
    // hibaüzenet minden egyszerű bezáráskor téves riasztás lenne.
  }
}
</script>

<template>
  <div class="settlement">
    <p v-if="loading" class="settlement__status">Betöltés…</p>
    <p v-else-if="loadError" role="alert" class="settlement__status">
      Nem sikerült betölteni az elszámolást.
    </p>

    <template v-else>
      <span class="eyebrow">Egyenlegek</span>
      <table class="ledger-table settlement__table">
        <thead>
          <tr>
            <th>Résztvevő</th>
            <th class="align-right">Kifizette</th>
            <th class="align-right">Rá eső rész</th>
            <th class="align-right settlement__settled-col">Kiegyenlítve</th>
            <th class="align-right">Egyenleg</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="balance in settlement.balances"
            :key="balance.personId"
            class="settlement__row"
          >
            <td data-label="Résztvevő">{{ participantName(balance.personId) }}</td>
            <td data-label="Kifizette" class="align-right money">{{ money(balance.paidMinor) }}</td>
            <td data-label="Rá eső rész" class="align-right money">
              {{ money(balance.owedMinor) }}
            </td>
            <td
              data-label="Kiegyenlítve"
              class="align-right money money--settle settlement__settled-col"
            >
              {{ signedMoney(balance.settledMinor) }}
            </td>
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
      </table>

      <p v-if="hasPendingExpense" class="settlement__status">
        Az elszámolás még fel nem töltött kiadást is tartalmaz. A devizás összegek a felvitelkori
        árfolyammal becsültek — a végleges érték a feltöltéskor dől el.
      </p>

      <div v-if="hasNothingToSettle" class="settlement__settled">
        <span class="stamp settlement__settled-stamp">Egyenleg rendezve</span>
        <p>Mindenki nullán van, nincs teendő.</p>
      </div>

      <template v-else>
        <span class="eyebrow settlement__transfers-label">Ki fizet kinek</span>
        <ul class="settlement__transfers">
          <li
            v-for="row in planRows"
            :key="`${row.fromId}>${row.toId}`"
            class="settlement__coupon"
            :class="{ 'is-done': row.remainingMinor === 0 }"
          >
            <span class="settlement__coupon-main">
              <span class="settlement__coupon-parties">
                <strong>{{ participantName(row.fromId) }}</strong>
                <span class="settlement__coupon-arrow" aria-hidden="true">→</span>
                <strong>{{ participantName(row.toId) }}</strong>
              </span>
              <template v-if="row.creditedMinor > 0 && row.remainingMinor > 0">
                <span class="settlement__coupon-meta">
                  {{ money(row.creditedMinor) }} rendezve a {{ money(row.amountMinor) }}-ból
                </span>
                <span
                  class="settlement__progress"
                  role="img"
                  :aria-label="`${progressPercent(row)} százalék rendezve`"
                >
                  <i :style="{ width: `${progressPercent(row)}%` }" />
                </span>
              </template>
            </span>
            <span class="settlement__coupon-right">
              <span
                class="money settlement__coupon-amount"
                :class="{ 'money--debit': row.remainingMinor > 0 }"
              >
                {{ money(row.remainingMinor > 0 ? row.remainingMinor : row.amountMinor) }}
              </span>
              <span v-if="row.remainingMinor === 0" class="stamp stamp--settle settlement__done">
                Rendezve
              </span>
              <button
                v-else
                type="button"
                class="btn btn--settle btn--small"
                @click="openPaymentModal(row)"
              >
                Rendezés
              </button>
            </span>
          </li>
        </ul>

        <div v-if="allSettled" class="settlement__settled">
          <span class="stamp settlement__settled-stamp">Egyenleg rendezve</span>
          <p>A jegyzék minden sora kifizetve.</p>
        </div>

        <button
          v-if="shareSupported && openRows.length > 0"
          type="button"
          class="btn settlement__share"
          @click="handleShare"
        >
          Megosztás
        </button>
      </template>

      <div class="settlement__payments-head">
        <span class="eyebrow">Kiegyenlítések</span>
        <button
          type="button"
          class="btn btn--settle btn--small"
          :disabled="openRows.length === 0"
          :title="
            openRows.length === 0 ? 'Nincs olyan tartozás, amit rendezni lehetne.' : undefined
          "
          @click="openPaymentModal(null)"
        >
          + Kiegyenlítés
        </button>
      </div>

      <p v-if="actionError" role="alert" class="field-error">{{ actionError }}</p>

      <p v-if="paymentRows.length === 0" class="settlement__empty">
        Még nincs kiegyenlítés. Ha valaki átadta a pénzt, vedd fel itt — az összeg nem növeli az
        esemény kiadásait.
      </p>

      <ul v-else class="settlement__stubs">
        <li v-for="entry in paymentRows" :key="entry.payment.id" class="settlement__stub">
          <span class="settlement__stub-main">
            <span class="settlement__coupon-parties">
              <strong>{{ participantName(entry.payment.fromId) }}</strong>
              <span class="settlement__coupon-arrow" aria-hidden="true">→</span>
              <strong>{{ participantName(entry.payment.toId) }}</strong>
            </span>
            <span class="settlement__stub-note">
              {{ formatDate(entry.payment.date) }}
              <template v-if="entry.payment.note"> · {{ entry.payment.note }}</template>
              <template v-if="entry.payment.currency !== SETTLEMENT_CURRENCY">
                · {{ money(entry.payment.baseAmountMinor) }} · 1 {{ entry.payment.currency }} =
                {{ entry.payment.exchangeRate }} {{ SETTLEMENT_CURRENCY }}
                <span v-if="entry.payment.rateSource === 'manual'" class="settlement__stub-manual">
                  kézi árfolyam
                </span>
              </template>
              <template v-if="entry.roundingMinor > 0">
                ·
                <span class="settlement__surplus">
                  {{ money(entry.creditedMinor) }} beszámítva ·
                  {{ money(entry.roundingMinor) }}
                  {{ entry.creditedMinor === 0 ? 'nem számít be' : 'többlet' }}
                </span>
              </template>
            </span>
          </span>
          <span class="settlement__stub-right">
            <span class="money money--settle settlement__stub-amount">
              {{ money(entry.payment.amountMinor, entry.payment.currency) }}
            </span>
            <button
              type="button"
              class="btn btn--ghost btn--small"
              @click="openEditModal(entry.payment)"
            >
              Szerkesztés
            </button>
            <button
              type="button"
              class="btn btn--danger btn--small"
              @click="handleUndo(entry.payment)"
            >
              Visszavonás
            </button>
          </span>
        </li>
      </ul>
    </template>

    <SettlementPaymentModal
      v-if="showPaymentModal"
      :rows="modalRows"
      :row="modalRow"
      :payment="editedPayment"
      :people="people"
      :saving="saving"
      :error-message="modalError"
      @submit="handlePaymentSubmit"
      @cancel="showPaymentModal = false"
    />
  </div>
</template>

<style scoped>
.settlement__status {
  color: var(--ink-soft);
}

.ledger-table {
  width: 100%;
  border-collapse: collapse;
  margin: var(--space-2) 0 var(--space-6);
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
}

.ledger-table .align-right {
  text-align: right;
}

/* A kiegyenlítés oszlopa halk réz alapot kap: első pillantásra látszik, hogy
   az az összeg nem a közös költéshez tartozik. */
.settlement__table th.settlement__settled-col,
.settlement__table td.settlement__settled-col {
  background: var(--settle-soft);
}

.settlement__balance-status {
  display: block;
  font-size: 0.7rem;
  color: var(--ink-soft);
  letter-spacing: 0.02em;
}

.settlement__transfers-label {
  margin-bottom: var(--space-3);
}

.settlement__transfers {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.settlement__share {
  margin-top: var(--space-4);
}

.settlement__coupon {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--paper-raised);
  border: 1px dashed var(--rule-strong);
  border-radius: 3px;
}

/* A kifizetett sor NEM tűnik el a jegyzékből: ott marad, kipipálva. */
.settlement__coupon.is-done {
  border-style: solid;
  border-color: var(--rule);
  background: transparent;
}

.settlement__coupon.is-done .settlement__coupon-parties,
.settlement__coupon.is-done .settlement__coupon-amount {
  opacity: 0.45;
  text-decoration: line-through;
}

.settlement__coupon-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.settlement__coupon-parties {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.settlement__coupon-arrow {
  color: var(--brass);
}

.settlement__coupon-right {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.settlement__coupon-amount {
  font-size: 1.05rem;
}

.settlement__coupon-meta {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--ink-soft);
}

.settlement__progress {
  display: block;
  height: 3px;
  max-width: 14rem;
  background: var(--rule);
  border-radius: 2px;
  overflow: hidden;
}

.settlement__progress i {
  display: block;
  height: 100%;
  background: var(--settle);
}

.settlement__done {
  font-size: 0.76rem;
  padding: 0.2em 0.6em;
  animation: stamp-in 0.28s ease-out;
}

.settlement__payments-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin: var(--space-8) 0 var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--rule);
}

.settlement__empty {
  border: 1px dashed var(--rule-strong);
  border-radius: 3px;
  padding: var(--space-6);
  text-align: center;
  color: var(--ink-soft);
  font-size: 0.9rem;
}

.settlement__stubs {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* Perforált BAL él: átvételi elismervény, nem a főkönyv sora. */
.settlement__stub {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-left: none;
  border-radius: 0 3px 3px 0;
  padding: var(--space-3) var(--space-4) var(--space-3) var(--space-6);
}

.settlement__stub::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 8px;
  background-image: radial-gradient(circle, var(--paper) 5px, transparent 5.5px);
  background-size: 16px 16px;
  background-position: -8px 8px;
  background-repeat: repeat-y;
  border-right: 1px dashed var(--settle);
}

.settlement__stub-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.settlement__stub-note {
  font-size: 0.78rem;
  color: var(--ink-soft);
}

.settlement__stub-manual {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-soft);
  border: 1px solid var(--rule-strong);
  border-radius: 2px;
  padding: 0.1em 0.4em;
}

.settlement__surplus {
  color: var(--settle);
}

.settlement__stub-right {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-shrink: 0;
}

.settlement__stub-amount {
  font-size: 1.05rem;
}

.settlement__settled {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) 0;
  animation: stamp-in 0.28s ease-out;
}

.settlement__settled p {
  color: var(--ink-soft);
  margin: 0;
}

.settlement__settled-stamp {
  font-size: 1rem;
  padding: 0.35em 0.9em;
}

@keyframes stamp-in {
  from {
    opacity: 0;
    transform: scale(1.15) rotate(-3deg);
  }
  to {
    opacity: 1;
    transform: scale(1) rotate(-3deg);
  }
}

@media (max-width: 640px) {
  .settlement__table thead {
    display: none;
  }

  .settlement__table,
  .settlement__table tbody {
    display: block;
    width: 100%;
  }

  .settlement__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: var(--space-3);
    row-gap: var(--space-2);
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: 2px;
    margin-bottom: var(--space-3);
    padding: var(--space-3);
  }

  .settlement__table td {
    display: block;
    border-bottom: none;
    padding: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .settlement__table td[data-label='Résztvevő'] {
    grid-column: 1 / -1;
    font-weight: 600;
    font-size: 1.02rem;
    margin-bottom: var(--space-1);
  }

  .settlement__table td[data-label='Kifizette']::before,
  .settlement__table td[data-label='Rá eső rész']::before,
  .settlement__table td[data-label='Kiegyenlítve']::before,
  .settlement__table td[data-label='Egyenleg']::before {
    content: attr(data-label);
    display: block;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .settlement__table .align-right {
    text-align: left;
  }

  .settlement__balance-status {
    display: none;
  }

  .settlement__table td.settlement__settled-col {
    background: transparent;
    color: var(--settle);
  }

  .settlement__coupon,
  .settlement__stub {
    flex-wrap: wrap;
  }

  .settlement__coupon-right,
  .settlement__stub-right {
    flex: 1 0 100%;
    justify-content: space-between;
  }

  .settlement__stub-right {
    gap: var(--space-2);
  }
}
</style>
