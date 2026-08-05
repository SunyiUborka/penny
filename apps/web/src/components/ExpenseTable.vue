<script setup>
import { computed, onMounted, ref } from 'vue';
import { formatMoney, SETTLEMENT_CURRENCY } from '@filler/shared';
import { useExpensesStore } from '../stores/expenses.js';
import ExpenseModal from './ExpenseModal.vue';
import { formatDate } from '../utils/format.js';

const props = defineProps({
  event: { type: Object, required: true },
  people: { type: Array, required: true },
});

const expensesStore = useExpensesStore();

const payerFilter = ref('');
const showModal = ref(false);
const editingExpense = ref(null);
const saving = ref(false);
const formError = ref('');

onMounted(() => {
  expensesStore.fetchExpenses(props.event.id);
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
  editingExpense.value = expense;
  formError.value = '';
  showModal.value = true;
}

async function handleSubmit(input) {
  saving.value = true;
  formError.value = '';
  try {
    if (editingExpense.value) {
      await expensesStore.updateExpense(editingExpense.value.id, input);
    } else {
      await expensesStore.createExpense(props.event.id, input);
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
  await expensesStore.deleteExpense(expense.id);
}
</script>

<template>
  <div class="expense-table">
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
      <button type="button" class="btn btn--primary" @click="openCreateModal">+ Új kiadás</button>
    </div>

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
        <tr
          v-for="expense in filteredExpenses"
          :key="expense.id"
          class="expense-table__row"
          tabindex="0"
          @click="openEditModal(expense)"
          @keydown.enter="openEditModal(expense)"
        >
          <td data-label="Dátum" class="money">{{ formatDate(expense.date) }}</td>
          <td data-label="Leírás" class="expense-table__description">{{ expense.description }}</td>
          <td data-label="Kifizette">{{ participantName(expense.payerId) }}</td>
          <td data-label="Összeg" class="align-right money">
            {{ formatMoney({ amountMinor: expense.amountMinor, currency: expense.currency }) }}
          </td>
          <td data-label="Alapvaluta" class="align-right money money--credit">
            {{
              formatMoney({ amountMinor: expense.baseAmountMinor, currency: SETTLEMENT_CURRENCY })
            }}
          </td>
          <td data-label="Osztozók" class="expense-table__shared">
            {{ expense.sharedWithIds.map(participantName).join(', ') }}
          </td>
          <td data-label="">
            <button
              type="button"
              class="btn btn--danger btn--small"
              @click.stop="handleDelete(expense)"
            >
              Törlés
            </button>
          </td>
        </tr>
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
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.expense-table__filter {
  margin-bottom: 0;
}

.expense-table__toolbar .btn {
  margin-left: auto;
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

.expense-table__description {
  font-weight: 600;
}

.expense-table__shared {
  color: var(--ink-soft);
  font-size: 0.9rem;
}

.expense-table__row {
  cursor: pointer;
}

.expense-table__row:hover {
  background: var(--forint-soft);
}

.btn--small {
  font-size: 0.78rem;
  padding: 0.35em 0.65em;
}

/* Mobilon minden kiadás egy kis letépett nyugtaként jelenik meg. */
@media (max-width: 640px) {
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
    grid-template-columns: 1fr 1fr;
    column-gap: var(--space-3);
    background: var(--paper-raised);
    border: 1px solid var(--rule);
    border-radius: 2px;
    margin-bottom: var(--space-4);
    padding: var(--space-4) var(--space-3) var(--space-2);
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
    padding: 0.2rem 0;
  }

  .expense-table__table td[data-label='Dátum'] {
    order: 1;
  }

  .expense-table__table td[data-label='Kifizette'] {
    order: 2;
  }

  .expense-table__table td[data-label='Leírás'] {
    order: 3;
    grid-column: 1 / -1;
  }

  .expense-table__table td[data-label='Összeg'] {
    order: 4;
  }

  .expense-table__table td[data-label='Alapvaluta'] {
    order: 5;
  }

  .expense-table__table td[data-label='Osztozók'] {
    order: 6;
    grid-column: 1 / -1;
  }

  .expense-table__description {
    font-size: 1.05rem;
  }

  .expense-table__table td[data-label]::before {
    content: attr(data-label);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
    display: block;
  }

  .ledger-table .align-right {
    text-align: left;
  }

  .expense-table__table td[data-label='']::before {
    content: none;
  }

  .expense-table__table td[data-label=''] {
    order: 7;
    grid-column: 1 / -1;
    margin-top: var(--space-2);
    text-align: right;
  }
}
</style>
