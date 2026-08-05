<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  convertMinorAmount,
  getCurrencyExponent,
  MAX_EXPENSE_MAJOR_AMOUNT,
  rateResponseSchema,
  SETTLEMENT_CURRENCY,
  SUPPORTED_CURRENCIES,
} from '@filler/shared';
import { apiClient } from '../api/client.js';
import { toDateInputValue } from '../utils/format.js';

const props = defineProps({
  event: { type: Object, required: true },
  people: { type: Array, required: true },
  expense: { type: Object, required: false, default: null },
  saving: { type: Boolean, required: false, default: false },
  errorMessage: { type: String, required: false, default: '' },
});

const emit = defineEmits(['submit', 'cancel']);

const isEditMode = computed(() => props.expense !== null);
const modalRef = ref(null);

function todayLocalDateString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const date = ref(todayLocalDateString());
const description = ref('');
const payerId = ref('');
const amountMajor = ref(null);
const currency = ref(props.event.defaultCurrency);
const exchangeRate = ref('1');
const rateSource = ref('manual');
const rateFetchedAt = ref(null);
const sharedWithIds = ref([...props.event.participantIds]);

const rateLoading = ref(false);
const rateError = ref('');
const fieldErrors = ref({});

let initialSnapshot = '';

function snapshot() {
  return JSON.stringify({
    date: date.value,
    description: description.value,
    payerId: payerId.value,
    amountMajor: amountMajor.value,
    currency: currency.value,
    exchangeRate: exchangeRate.value,
    sharedWithIds: [...sharedWithIds.value].sort(),
  });
}

function resetFromExpense(expense) {
  if (expense) {
    const exponent = getCurrencyExponent(expense.currency);
    date.value = toDateInputValue(expense.date);
    description.value = expense.description;
    payerId.value = expense.payerId;
    amountMajor.value = expense.amountMinor / 10 ** exponent;
    currency.value = expense.currency;
    exchangeRate.value = expense.exchangeRate;
    rateSource.value = expense.rateSource;
    rateFetchedAt.value = expense.rateFetchedAt;
    sharedWithIds.value = [...expense.sharedWithIds];
  } else {
    date.value = todayLocalDateString();
    description.value = '';
    payerId.value = '';
    amountMajor.value = null;
    currency.value = props.event.defaultCurrency;
    exchangeRate.value = '1';
    rateSource.value = 'manual';
    rateFetchedAt.value = null;
    sharedWithIds.value = [...props.event.participantIds];
  }
  nextTick(() => {
    initialSnapshot = snapshot();
  });
}

resetFromExpense(props.expense);

const isDirty = computed(() => snapshot() !== initialSnapshot);

const currencyExponent = computed(() => getCurrencyExponent(currency.value));
const amountStep = computed(() => (currencyExponent.value === 0 ? '1' : '0.01'));

watch(amountMajor, (value) => {
  if (value !== null && !Number.isNaN(value) && value > MAX_EXPENSE_MAJOR_AMOUNT) {
    amountMajor.value = MAX_EXPENSE_MAJOR_AMOUNT;
  }
});

const amountMinor = computed(() => {
  if (amountMajor.value === null || Number.isNaN(amountMajor.value)) {
    return null;
  }
  return Math.round(amountMajor.value * 10 ** currencyExponent.value);
});

const isSettlementCurrency = computed(() => currency.value === SETTLEMENT_CURRENCY);

const baseAmountPreview = computed(() => {
  if (amountMinor.value === null || amountMinor.value <= 0) {
    return null;
  }
  if (isSettlementCurrency.value) {
    return amountMinor.value;
  }
  try {
    return convertMinorAmount({
      amountMinor: amountMinor.value,
      rate: exchangeRate.value,
      sourceCurrency: currency.value,
      targetCurrency: SETTLEMENT_CURRENCY,
    });
  } catch {
    return null;
  }
});

const baseAmountPreviewLabel = computed(() => {
  if (baseAmountPreview.value === null) {
    return '';
  }
  const majorAmount = baseAmountPreview.value / 10 ** getCurrencyExponent(SETTLEMENT_CURRENCY);
  return `${majorAmount.toLocaleString('hu-HU')} ${SETTLEMENT_CURRENCY}`;
});

async function fetchRate() {
  if (isSettlementCurrency.value) {
    exchangeRate.value = '1';
    rateSource.value = 'manual';
    rateFetchedAt.value = new Date();
    return;
  }
  rateLoading.value = true;
  rateError.value = '';
  try {
    const result = await apiClient.get(`/rates?from=${currency.value}&to=${SETTLEMENT_CURRENCY}`, {
      schema: rateResponseSchema,
    });
    exchangeRate.value = result.rate;
    rateFetchedAt.value = result.fetchedAt;
    rateSource.value = 'api';
  } catch {
    rateError.value = 'Nem sikerült lekérni az árfolyamot. Add meg kézzel.';
    rateSource.value = 'manual';
  } finally {
    rateLoading.value = false;
  }
}

watch(currency, () => {
  fetchRate();
});

if (!isEditMode.value) {
  fetchRate();
}

function handleRateInput() {
  rateSource.value = 'manual';
}

function toggleParticipant(personId) {
  const index = sharedWithIds.value.indexOf(personId);
  if (index === -1) {
    sharedWithIds.value.push(personId);
  } else {
    sharedWithIds.value.splice(index, 1);
  }
}

function participantName(id) {
  return props.people.find((person) => person.id === id)?.name ?? 'Ismeretlen';
}

function validate() {
  const errors = {};
  if (!description.value.trim()) {
    errors.description = 'A leírás nem lehet üres.';
  }
  if (!payerId.value) {
    errors.payerId = 'Válassz kifizetőt.';
  }
  if (amountMinor.value === null || amountMinor.value <= 0) {
    errors.amount = 'Az összeg pozitív szám kell legyen.';
  } else if (amountMajor.value > MAX_EXPENSE_MAJOR_AMOUNT) {
    errors.amount = `Az összeg legfeljebb ${MAX_EXPENSE_MAJOR_AMOUNT} lehet.`;
  }
  if (sharedWithIds.value.length === 0) {
    errors.sharedWithIds = 'Legalább egy osztozó szükséges.';
  }
  fieldErrors.value = errors;
  return Object.keys(errors).length === 0;
}

function handleSubmit() {
  if (!validate()) {
    return;
  }
  emit('submit', {
    date: date.value,
    description: description.value.trim(),
    payerId: payerId.value,
    amountMinor: amountMinor.value,
    currency: currency.value,
    exchangeRate: exchangeRate.value,
    rateSource: rateSource.value,
    rateFetchedAt: rateSource.value === 'api' ? rateFetchedAt.value : undefined,
    sharedWithIds: sharedWithIds.value,
  });
}

function attemptClose() {
  if (isDirty.value && !window.confirm('El nem mentett módosítások vannak. Biztosan bezárod?')) {
    return;
  }
  emit('cancel');
}

function focusableElements() {
  if (!modalRef.value) {
    return [];
  }
  return Array.from(
    modalRef.value.querySelectorAll(
      'input, select, button, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.disabled);
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    attemptClose();
    return;
  }
  if (event.key !== 'Tab') {
    return;
  }
  const elements = focusableElements();
  if (elements.length === 0) {
    return;
  }
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
  nextTick(() => {
    focusableElements()[0]?.focus();
  });
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="modal-backdrop" role="presentation" @click.self="attemptClose">
    <div
      ref="modalRef"
      class="modal receipt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-modal-title"
    >
      <span class="eyebrow">Kiadás</span>
      <h2 id="expense-modal-title">{{ isEditMode ? 'Kiadás szerkesztése' : 'Új kiadás' }}</h2>
      <form @submit.prevent="handleSubmit">
        <div class="modal__row">
          <div class="field">
            <label for="expense-date">Dátum</label>
            <input id="expense-date" v-model="date" type="date" required :disabled="saving" />
          </div>
          <div class="field expense-modal__payer">
            <label for="expense-payer">Kifizette</label>
            <select id="expense-payer" v-model="payerId" required :disabled="saving">
              <option value="" disabled>Válassz…</option>
              <option v-for="id in event.participantIds" :key="id" :value="id">
                {{ participantName(id) }}
              </option>
            </select>
          </div>
        </div>
        <p v-if="fieldErrors.payerId" role="alert" class="field-error">{{ fieldErrors.payerId }}</p>

        <fieldset class="modal__fieldset">
          <legend>Ki osztozik rajta</legend>
          <div class="modal__participants">
            <button
              v-for="id in event.participantIds"
              :key="id"
              type="button"
              class="participant-chip"
              :class="{ 'is-selected': sharedWithIds.includes(id) }"
              :aria-pressed="sharedWithIds.includes(id)"
              :disabled="saving"
              @click="toggleParticipant(id)"
            >
              {{ participantName(id) }}
            </button>
          </div>
          <p v-if="fieldErrors.sharedWithIds" role="alert" class="field-error">
            {{ fieldErrors.sharedWithIds }}
          </p>
        </fieldset>

        <div class="field">
          <label for="expense-description">Leírás</label>
          <input
            id="expense-description"
            v-model="description"
            type="text"
            required
            :disabled="saving"
          />
        </div>
        <p v-if="fieldErrors.description" role="alert" class="field-error">
          {{ fieldErrors.description }}
        </p>

        <div class="modal__row">
          <div class="field">
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
          </div>
          <div class="field">
            <label for="expense-currency">Valuta</label>
            <select id="expense-currency" v-model="currency" :disabled="saving">
              <option v-for="code in SUPPORTED_CURRENCIES" :key="code" :value="code">
                {{ code }}
              </option>
            </select>
          </div>
        </div>
        <p v-if="fieldErrors.amount" role="alert" class="field-error">{{ fieldErrors.amount }}</p>

        <template v-if="!isSettlementCurrency">
          <div class="field expense-modal__rate-field">
            <label for="expense-rate"
              >Árfolyam (1 {{ currency }} = ? {{ SETTLEMENT_CURRENCY }})</label
            >
            <div class="expense-modal__rate-row">
              <input
                id="expense-rate"
                v-model="exchangeRate"
                type="text"
                class="money-input"
                :disabled="saving || rateLoading"
                @input="handleRateInput"
              />
              <button
                type="button"
                class="btn btn--ghost btn--small"
                :disabled="saving || rateLoading"
                @click="fetchRate"
              >
                {{ rateLoading ? 'Frissítés…' : 'Frissítés' }}
              </button>
            </div>
          </div>
          <div class="expense-modal__rate-error-slot">
            <p v-if="rateError" role="alert" class="field-error">{{ rateError }}</p>
          </div>
        </template>

        <p v-if="errorMessage" role="alert" class="field-error">{{ errorMessage }}</p>

        <div class="modal-actions">
          <div class="expense-modal__preview-slot">
            <p v-if="baseAmountPreview !== null" class="expense-modal__preview">
              Összeg:
              <span class="money money--credit">{{ baseAmountPreviewLabel }}</span>
            </p>
          </div>
          <div class="expense-modal__action-buttons">
            <button type="button" class="btn btn--ghost" :disabled="saving" @click="attemptClose">
              Mégse
            </button>
            <button type="submit" class="btn btn--primary" :disabled="saving">
              {{ saving ? 'Mentés…' : 'Mentés' }}
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
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

.modal__row {
  display: flex;
  gap: var(--space-3);
}

.modal__row .field {
  flex: 1;
}

.modal__fieldset {
  border: none;
  padding: 0;
  margin: var(--space-4) 0;
}

.modal__fieldset legend {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--ink-soft);
  padding: 0;
  margin-bottom: var(--space-2);
}

.expense-modal__rate-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.expense-modal__rate-row input {
  flex: 1;
}

.expense-modal__rate-field {
  margin-bottom: 0;
}

.expense-modal__preview {
  margin: 0;
  min-width: 0;
  width: 100%;
  background: var(--forint-soft);
  border-radius: 3px;
  padding: var(--space-2) var(--space-3);
  font-size: 0.92rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expense-modal__rate-error-slot {
  min-height: 1.3rem;
}

.expense-modal__preview-slot {
  display: flex;
  align-items: center;
  min-height: 2.4rem;
  min-width: 0;
  flex: 1;
}

.modal__participants {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.participant-chip {
  font-family: var(--font-body);
  font-size: 0.88rem;
  font-weight: 600;
  padding: 0.4em 0.9em;
  border-radius: 999px;
  border: 1.5px solid var(--rule-strong);
  background: var(--paper-raised);
  color: var(--ink-soft);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.participant-chip:hover:not(:disabled) {
  border-color: var(--forint);
  color: var(--forint);
}

.participant-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.participant-chip.is-selected {
  background: var(--forint);
  border-color: var(--forint);
  color: var(--paper-raised);
}

.modal-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.expense-modal__action-buttons {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}

.btn--small {
  font-size: 0.78rem;
  padding: 0.4em 0.7em;
}

@media (max-width: 640px) {
  .modal-actions {
    gap: var(--space-2);
  }

  .expense-modal__preview {
    padding: var(--space-1) var(--space-2);
    font-size: 0.82rem;
  }

  .expense-modal__action-buttons .btn {
    font-size: 0.82rem;
    padding: 0.45em 0.8em;
  }
}
</style>
