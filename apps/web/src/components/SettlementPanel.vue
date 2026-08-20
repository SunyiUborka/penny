<script setup>
import { computed } from 'vue';
import { Share } from '@capacitor/share';
import { computeSettlement, formatMoney, SETTLEMENT_CURRENCY } from '@filler/shared';
import { useExpensesStore } from '../stores/expenses.js';
import { isNativeApp } from '../utils/platform.js';

const props = defineProps({
  event: { type: Object, required: true },
  people: { type: Array, required: true },
});

const expensesStore = useExpensesStore();

/**
 * Az elszámolás a betöltött kiadáslistából számolva. Ugyanaz a
 * `computeSettlement` fut, amit a backend `/settlement` végpontja használ —
 * ezért nem kell külön kérés, és a stream minden új kiadását azonnal követi.
 *
 * `props.event` egyszer, a nézet mountjakor töltődik be, és nem frissül olyan
 * gyakran, mint a kiadáslista (ami a streamen élőben jön). Ha időközben más
 * eszközön új résztvevő került az eseményhez, és tőle érkezik kiadás a
 * streamen, ez a `participantIds` lista már elavult, és a
 * `computeSettlement` bemenet-validációja (a payerId/sharedWithIds ellenőrzi
 * a résztvevőséget) eldobja. Ez várható, átmeneti állapot — az
 * `EventDetailView` újratölti az eseményt újrakapcsolódáskor és
 * előtér-váltáskor —, és egy hibaüzenet jobb, mint rossz egyenlegeket
 * mutatni, ezért itt elkapjuk és `null`-t adunk vissza.
 */
const settlement = computed(() => {
  try {
    return computeSettlement({
      participantIds: props.event.participantIds,
      expenses: expensesStore.expenses.map((expense) => ({
        payerId: expense.payerId,
        baseAmountMinor: expense.baseAmountMinor,
        sharedWithIds: expense.sharedWithIds,
      })),
    });
  } catch {
    return null;
  }
});

// A betöltés állapota a kiadáslistáé: az elszámolásnak nincs saját kérése.
// Hiba esetén (akár a kiadáslista betöltése bukott, akár a résztvevőlista
// elavulása miatt a settlement fentebb null-t adott) nem üres táblát
// mutatunk, hanem hibaüzenetet — ez teszi valódivá a lenti
// `hasNothingToSettle` `settlement !== null` feltételét is.
const loading = computed(() => expensesStore.loading);
const loadError = computed(() => expensesStore.error !== null || settlement.value === null);
const shareSupported = Boolean(globalThis.navigator?.share) || isNativeApp();

function participantName(id) {
  return props.people.find((person) => person.id === id)?.name ?? 'Ismeretlen';
}

function money(amountMinor) {
  return formatMoney({ amountMinor: Math.abs(amountMinor), currency: SETTLEMENT_CURRENCY });
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

const hasNothingToSettle = computed(() => {
  return settlement.value !== null && settlement.value.transfers.length === 0;
});

/**
 * Igaz, ha a listában van olyan kiadás, ami még nincs feltöltve — ilyenkor az
 * elszámolás is ezt tartalmazza, és a devizás összegek csak a felvitelkori
 * (esetleg becsült) árfolyammal számoltak.
 */
const hasPendingExpense = computed(() => {
  return expensesStore.expenses.some((expense) => expense.pending === true);
});

/**
 * A megosztható összefoglaló: ki kinek mennyit fizet. Egyszerű szöveg, hogy
 * bármelyik célalkalmazásban olvasható maradjon.
 * @returns {string}
 */
function buildShareText() {
  const lines = settlement.value.transfers.map((transfer) => {
    return `${participantName(transfer.fromId)} → ${participantName(transfer.toId)}: ${money(transfer.amountMinor)}`;
  });
  return [`${props.event.name} — elszámolás`, '', ...lines].join('\n');
}

async function handleShare() {
  try {
    await Share.share({
      title: `${props.event.name} — elszámolás`,
      text: buildShareText(),
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

      <div v-if="hasNothingToSettle" class="settlement__settled">
        <span class="stamp settlement__settled-stamp">Egyenleg rendezve</span>
        <p>Mindenki nullán van, nincs teendő.</p>
      </div>

      <template v-else>
        <p v-if="hasPendingExpense" class="settlement__status">
          Az elszámolás még fel nem töltött kiadást is tartalmaz. A devizás összegek a felvitelkori
          árfolyammal becsültek — a végleges érték a feltöltéskor dől el.
        </p>
        <span class="eyebrow settlement__transfers-label">Ki fizet kinek</span>
        <ul class="settlement__transfers">
          <li
            v-for="(transfer, index) in settlement.transfers"
            :key="index"
            class="settlement__coupon"
          >
            <span class="settlement__coupon-parties">
              <strong>{{ participantName(transfer.fromId) }}</strong>
              <span class="settlement__coupon-arrow" aria-hidden="true">→</span>
              <strong>{{ participantName(transfer.toId) }}</strong>
            </span>
            <span class="money money--debit settlement__coupon-amount">
              {{ money(transfer.amountMinor) }}
            </span>
          </li>
        </ul>
        <button
          v-if="shareSupported"
          type="button"
          class="btn settlement__share"
          @click="handleShare"
        >
          Megosztás
        </button>
      </template>
    </template>
  </div>
</template>

<style scoped>
.settlement__status {
  color: var(--ink-soft);
}

.ledger-table {
  width: 100%;
  border-collapse: collapse;
  margin: var(--space-2) 0 var(--space-8);
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

.settlement__coupon-parties {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.settlement__coupon-arrow {
  color: var(--brass);
}

.settlement__coupon-amount {
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
</style>
