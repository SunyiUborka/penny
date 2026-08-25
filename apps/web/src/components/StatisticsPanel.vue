<script setup>
import { computed } from 'vue';
import { formatMoney, SETTLEMENT_CURRENCY } from '@filler/shared';
import { useExpensesStore } from '../stores/expenses.js';
import { useCategoriesStore } from '../stores/categories.js';
import { useSettlementPaymentsStore } from '../stores/settlementPayments.js';
import { computeEventStatistics } from '../utils/statistics.js';
import { categoryColorStyle } from '../utils/categoryColor.js';
import CategoryTag from './CategoryTag.vue';

const props = defineProps({
  event: { type: Object, required: true },
  people: { type: Array, required: true },
});

const expensesStore = useExpensesStore();
const categoriesStore = useCategoriesStore();
const paymentsStore = useSettlementPaymentsStore();

const stats = computed(() =>
  computeEventStatistics({
    event: props.event,
    expenses: expensesStore.expenses,
    categories: categoriesStore.categories,
    payments: paymentsStore.payments,
  }),
);

const isEmpty = computed(() => stats.value.expenseCount === 0);

function personName(id) {
  return props.people.find((person) => person.id === id)?.name ?? 'Ismeretlen';
}

function huf(amountMinor) {
  return formatMoney({ amountMinor, currency: SETTLEMENT_CURRENCY });
}

function original(row) {
  return formatMoney({ amountMinor: row.amountMinor, currency: row.currency });
}

function sharePercent(share) {
  return `${(share * 100).toLocaleString('hu-HU', { maximumFractionDigits: 1 })}%`;
}

const maxCategoryMinor = computed(() =>
  Math.max(1, ...stats.value.categories.map((row) => row.baseAmountMinor)),
);

const maxDayMinor = computed(() =>
  Math.max(1, ...stats.value.days.map((row) => row.baseAmountMinor)),
);

const maxPaidMinor = computed(() =>
  Math.max(1, ...stats.value.people.flatMap((row) => [row.paidMinor, row.owedMinor])),
);

const busiestDay = computed(() => {
  const days = stats.value.days;
  if (days.length === 0) {
    return null;
  }
  return days.reduce((best, day) => (day.baseAmountMinor > best.baseAmountMinor ? day : best));
});

function widthOf(amountMinor, maxMinor) {
  return `${Math.max(0, (amountMinor / maxMinor) * 100)}%`;
}

function dayLabel(date) {
  return `${date.slice(8, 10)}.`;
}

function dayTitle(row) {
  return `${date2hu(row.date)} — ${huf(row.baseAmountMinor)}`;
}

function date2hu(date) {
  return `${date.slice(5, 7)}. ${date.slice(8, 10)}.`;
}
</script>

<template>
  <div class="stats">
    <p v-if="isEmpty" class="stats__empty">
      Ehhez az eseményhez még nincs kiadás — a statisztika az első felvitt tétel után jelenik meg.
    </p>

    <template v-else>
      <p v-if="stats.hasPending" class="stats__pending">
        A számok tartalmaznak még fel nem töltött kiadásokat is, becsült árfolyammal.
      </p>

      <section class="receipt stats__block">
        <span class="eyebrow">Összesen</span>
        <div class="stats__tiles">
          <div class="stats__tile stats__tile--hero">
            <span class="stats__tile-label">Végösszeg</span>
            <span class="stats__tile-value stats__tile-value--hero money">
              {{ huf(stats.totalBaseMinor) }}
            </span>
            <span class="stats__tile-note">{{ stats.dayCount }} nap alatt</span>
          </div>
          <div class="stats__tile">
            <span class="stats__tile-label">Kiadás</span>
            <span class="stats__tile-value money">{{ stats.expenseCount }}</span>
            <span class="stats__tile-note">tétel</span>
          </div>
          <div class="stats__tile">
            <span class="stats__tile-label">Átlag</span>
            <span class="stats__tile-value money">{{ huf(stats.averageBaseMinor) }}</span>
            <span class="stats__tile-note">tételenként</span>
          </div>
          <div v-if="stats.largest" class="stats__tile">
            <span class="stats__tile-label">Legnagyobb</span>
            <span class="stats__tile-value money">{{ huf(stats.largest.baseAmountMinor) }}</span>
            <span class="stats__tile-note stats__tile-note--clip">
              {{ stats.largest.description }}
            </span>
          </div>
          <div class="stats__tile">
            <span class="stats__tile-label">Napi átlag</span>
            <span class="stats__tile-value money">{{ huf(stats.dailyAverageBaseMinor) }}</span>
            <span class="stats__tile-note">naponta</span>
          </div>
        </div>
      </section>

      <section class="receipt stats__block">
        <span class="eyebrow">Rovatonként</span>
        <h2>Mire ment el</h2>
        <div class="stats__bars">
          <div
            v-for="row in stats.categories"
            :key="row.id ?? 'none'"
            class="stats__bar-row"
            :title="`${row.name} — ${huf(row.baseAmountMinor)}, ${row.expenseCount} tétel`"
          >
            <span class="stats__bar-name">
              <CategoryTag v-if="row.id" :name="row.name" :color="row.color" small />
              <span v-else class="stats__bar-none">{{ row.name }}</span>
            </span>
            <span class="stats__bar-track">
              <span
                class="stats__bar-fill"
                :style="[
                  categoryColorStyle(row.color),
                  { width: widthOf(row.baseAmountMinor, maxCategoryMinor) },
                ]"
              />
            </span>
            <span class="stats__bar-amount money">{{ huf(row.baseAmountMinor) }}</span>
            <span class="stats__bar-share money">{{ sharePercent(row.share) }}</span>
          </div>
        </div>
      </section>

      <section class="receipt stats__block">
        <span class="eyebrow">Naponta</span>
        <h2>Melyik nap vitte el</h2>
        <div class="stats__cols">
          <div v-for="row in stats.days" :key="row.date" class="stats__col" :title="dayTitle(row)">
            <span
              v-if="busiestDay && row.date === busiestDay.date"
              class="stats__col-cap money"
              :style="{ bottom: `calc(${widthOf(row.baseAmountMinor, maxDayMinor)} + 4px)` }"
            >
              {{ huf(row.baseAmountMinor) }}
            </span>
            <span
              class="stats__col-fill"
              :style="{ height: widthOf(row.baseAmountMinor, maxDayMinor) }"
            />
          </div>
        </div>
        <div class="stats__col-axis">
          <span v-for="row in stats.days" :key="row.date">{{ dayLabel(row.date) }}</span>
        </div>
      </section>

      <div class="stats__split">
        <section class="receipt stats__block">
          <span class="eyebrow">Személyenként</span>
          <h2>Ki mennyit tett bele</h2>
          <table class="ledger-table stats__table">
            <thead>
              <tr>
                <th>Név</th>
                <th class="align-right">Kifizette</th>
                <th class="align-right">Ráesik</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in stats.people" :key="row.personId">
                <td>
                  {{ personName(row.personId) }}
                  <span class="stats__mini">
                    <span
                      class="stats__mini-fill"
                      :style="{ width: widthOf(row.paidMinor, maxPaidMinor) }"
                    />
                  </span>
                  <span class="stats__mini">
                    <span
                      class="stats__mini-fill stats__mini-fill--owed"
                      :style="{ width: widthOf(row.owedMinor, maxPaidMinor) }"
                    />
                  </span>
                </td>
                <td class="align-right money money--credit">{{ huf(row.paidMinor) }}</td>
                <td class="align-right money">{{ huf(row.owedMinor) }}</td>
              </tr>
            </tbody>
          </table>
          <p class="stats__legend">
            Zöld: amit a saját zsebéből kifizetett. Szürke: ami az osztozásból rá esik. A kettő
            különbségét az Elszámolás fül rendezi.
          </p>
        </section>

        <section class="receipt stats__block">
          <span class="eyebrow">Pénznemenként</span>
          <h2>Miben ment el</h2>
          <table class="ledger-table stats__table">
            <thead>
              <tr>
                <th>Pénznem</th>
                <th class="align-right">Eredetiben</th>
                <th class="align-right">Forintban</th>
                <th class="align-right">Tétel</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in stats.currencies" :key="row.currency">
                <td>{{ row.currency }}</td>
                <td class="align-right money">{{ original(row) }}</td>
                <td class="align-right money">{{ huf(row.baseAmountMinor) }}</td>
                <td class="align-right money">{{ row.expenseCount }}</td>
              </tr>
            </tbody>
          </table>
          <p class="stats__legend">
            A forintérték a kiadás saját, korabeli árfolyamán — ugyanaz a szám, amiből az elszámolás
            számol.
          </p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stats {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.stats__empty,
.stats__legend {
  margin: 0;
  color: var(--ink-soft);
}

.stats__legend {
  margin-top: var(--space-3);
  font-size: 0.82rem;
}

.stats__pending {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--stamp-soft);
  border-left: 3px solid var(--stamp);
  font-size: 0.85rem;
}

.stats__block h2 {
  margin: 0 0 var(--space-4);
  font-size: 1.15rem;
}

.stats__tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.stats__tile--hero {
  grid-column: span 2;
}

.stats__tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.stats__tile-label {
  font-family: var(--font-mono);
  font-size: 0.64rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

.stats__tile-value {
  font-size: 1.4rem;
  font-weight: 600;
  line-height: 1.15;
}

.stats__tile-value--hero {
  font-size: 1.6rem;
  color: var(--forint);
}

.stats__tile-note {
  font-size: 0.75rem;
  color: var(--ink-soft);
}

.stats__tile-note--clip {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stats__bars {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.stats__bar-row {
  display: grid;
  grid-template-columns: 9.5rem minmax(0, 1fr) 7rem 3.4rem;
  align-items: center;
  gap: var(--space-3);
}

.stats__bar-name {
  min-width: 0;
  display: flex;
}

.stats__bar-none {
  font-family: var(--font-mono);
  font-size: 0.64rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

.stats__bar-track {
  display: flex;
  height: 14px;
}

.stats__bar-fill {
  height: 14px;
  min-width: 2px;
  border-radius: 0 4px 4px 0;
  background: var(--cat-color, var(--rule-strong));
}

.stats__bar-amount {
  text-align: right;
  font-size: 0.9rem;
}

.stats__bar-share {
  text-align: right;
  font-size: 0.8rem;
  color: var(--ink-soft);
}

.stats__cols {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 150px;
  border-bottom: 1px solid var(--rule);
}

.stats__col {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: flex-end;
}

.stats__col-fill {
  width: 100%;
  max-width: 24px;
  margin: 0 auto;
  border-radius: 4px 4px 0 0;
  background: var(--forint);
}

.stats__col-cap {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.62rem;
  white-space: nowrap;
}

.stats__col-axis {
  display: flex;
  gap: 4px;
  margin-top: var(--space-2);
}

.stats__col-axis span {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  color: var(--ink-soft);
}

.stats__mini {
  display: block;
  width: 100%;
  min-width: 5rem;
  height: 8px;
  margin-top: 3px;
  background: var(--forint-soft);
  border-radius: 0 4px 4px 0;
}

.stats__mini-fill {
  display: block;
  height: 8px;
  border-radius: 0 4px 4px 0;
  background: var(--forint);
}

.stats__mini-fill--owed {
  background: var(--rule-strong);
}

.stats__table th:first-child,
.stats__table td:first-child {
  width: 45%;
}

.stats__split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
  gap: var(--space-6);
}

@media (max-width: 640px) {
  .stats__bar-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'name amount'
      'track track';
    gap: var(--space-1) var(--space-2);
  }

  .stats__bar-name {
    grid-area: name;
  }

  .stats__bar-track {
    grid-area: track;
  }

  .stats__bar-amount {
    grid-area: amount;
  }

  .stats__bar-share {
    display: none;
  }

  .stats__col-axis span:nth-child(even) {
    visibility: hidden;
  }
}
</style>
