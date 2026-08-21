<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  convertMinorAmount,
  getCurrencyExponent,
  MAX_EXPENSE_MAJOR_AMOUNT,
  SETTLEMENT_CURRENCY,
  SUPPORTED_CURRENCIES,
} from '@filler/shared';
import { fetchRateWithCache } from '../offline/rates.js';
import { roundRate, toDateInputValue } from '../utils/format.js';

const props = defineProps({
  /**
   * A választható jegyzéksorok: `{ fromId, toId, amountMinor, creditedMinor,
   * remainingMinor }`. A kiegyenlítés mindig egy KONKRÉT tartozást zár, ezért
   * itt nincs szabad fizető/kedvezményezett választás.
   */
  rows: { type: Array, required: true },
  /** Az előre kijelölt sor (a „Rendezés" gomb sora), vagy null. */
  row: { type: Object, required: false, default: null },
  /** Szerkesztendő szelvény; `null` esetén új felvétel. */
  payment: { type: Object, required: false, default: null },
  people: { type: Array, required: true },
  saving: { type: Boolean, required: false, default: false },
  errorMessage: { type: String, required: false, default: '' },
});

const emit = defineEmits(['submit', 'cancel']);

const modalRef = ref(null);

function todayLocalDateString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** A sor azonosítója a `select`-ben: a páros maga. */
function rowKey(row) {
  return `${row.fromId}>${row.toId}`;
}

const isEditMode = computed(() => props.payment !== null);

const selectedKey = ref(rowKey(props.payment ?? props.row ?? props.rows[0]));
const selectedRow = computed(
  () => props.rows.find((row) => rowKey(row) === selectedKey.value) ?? props.rows[0],
);

const date = ref(props.payment ? toDateInputValue(props.payment.date) : todayLocalDateString());
const currency = ref(props.payment?.currency ?? SETTLEMENT_CURRENCY);
const amountMajor = ref(
  props.payment
    ? props.payment.amountMinor / 10 ** getCurrencyExponent(props.payment.currency)
    : null,
);
const note = ref(props.payment?.note ?? '');
const exchangeRate = ref(props.payment?.exchangeRate ?? '1');
const rateSource = ref(props.payment?.rateSource ?? 'manual');
const rateFetchedAt = ref(props.payment?.rateFetchedAt ?? null);
const rateLoading = ref(false);
const rateError = ref('');
const rateEstimated = ref(false);
const fieldError = ref('');

const isSettlementCurrency = computed(() => currency.value === SETTLEMENT_CURRENCY);
const amountStep = computed(() => (getCurrencyExponent(currency.value) === 0 ? '1' : '0.01'));

function participantName(id) {
  return props.people.find((person) => person.id === id)?.name ?? 'Ismeretlen';
}

/** A beírt (major egységű) összeg a pénznem legkisebb egységében. */
const amountMinor = computed(() => {
  if (!amountMajor.value || amountMajor.value <= 0) {
    return 0;
  }
  return Math.round(amountMajor.value * 10 ** getCurrencyExponent(currency.value));
});

/**
 * Az átadott összeg forint-értéke a mezőben álló árfolyammal — ugyanaz a
 * képlet, amit a szerver is futtat (`convertMinorAmount`). Érvénytelen
 * árfolyamnál `null`, hogy az előnézet inkább hallgasson, mint hazudjon.
 */
const baseAmountMinor = computed(() => {
  if (amountMinor.value <= 0) {
    return null;
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

/**
 * A felkínált összeg: ami a kiválasztott sort pont lezárja. Devizánál a
 * hátralékot (forint) váltjuk vissza a választott pénznemre — a számítás a
 * pénznem legkisebb egységében, EGÉSZ számokkal megy, és csak az űrlapmező
 * kedvéért osztunk vissza nagyobb egységre.
 */
function suggestAmount() {
  const remainingMinor = remainingForRow.value;
  const exponent = getCurrencyExponent(currency.value);
  if (isSettlementCurrency.value) {
    amountMajor.value = remainingMinor / 10 ** exponent;
    return;
  }
  const rate = Number(exchangeRate.value);
  if (!Number.isFinite(rate) || rate <= 0) {
    return;
  }
  const suggestedMinor = Math.round((remainingMinor / rate) * 10 ** exponent);
  amountMajor.value = suggestedMinor / 10 ** exponent;
}

async function fetchRate() {
  if (isSettlementCurrency.value) {
    exchangeRate.value = '1';
    rateSource.value = 'manual';
    rateFetchedAt.value = new Date();
    rateEstimated.value = false;
    rateError.value = '';
    return;
  }
  rateLoading.value = true;
  rateError.value = '';
  rateEstimated.value = false;
  try {
    const result = await fetchRateWithCache(currency.value, SETTLEMENT_CURRENCY);
    exchangeRate.value = roundRate(result.rate);
    rateFetchedAt.value = result.fetchedAt;
    rateSource.value = 'api';
    rateEstimated.value = result.estimated;
  } catch {
    rateError.value = 'Nem sikerült lekérni az árfolyamot. Add meg kézzel.';
    rateSource.value = 'manual';
  } finally {
    rateLoading.value = false;
  }
}

watch(currency, async () => {
  // Pénznemváltásnál a lekért árfolyam jön vissza: a korábbi kézi érték egy
  // MÁS pénznemhez tartozott, azt átvinni hiba lenne.
  await fetchRate();
  suggestAmount();
});

watch(selectedKey, () => {
  suggestAmount();
});

/**
 * Ha a felhasználó beleír az árfolyamba, az az ő száma: a mentés nem
 * cserélheti le egy frissen lekértre, és a szelvényen is „kézi árfolyam"-ként
 * marad meg. Ugyanaz a szabály, mint a kiadás-űrlapon.
 */
function handleRateInput() {
  rateSource.value = 'manual';
  rateEstimated.value = false;
}

const remainingForRow = computed(() => {
  const row = selectedRow.value;
  if (!row) {
    return 0;
  }
  if (!isEditMode.value || rowKey(row) !== rowKey(props.payment)) {
    return row.remainingMinor;
  }
  return row.remainingMinor + Math.min(props.payment.baseAmountMinor, row.creditedMinor);
});

function validate() {
  if (!selectedRow.value) {
    return 'Nincs rendezendő tartozás.';
  }
  if (!amountMinor.value || amountMinor.value < 1) {
    return 'Az összeg pozitív szám legyen.';
  }
  if (amountMajor.value > MAX_EXPENSE_MAJOR_AMOUNT) {
    return `Az összeg legfeljebb ${MAX_EXPENSE_MAJOR_AMOUNT} lehet.`;
  }
  if (baseAmountMinor.value === null) {
    return 'Az árfolyam pozitív szám legyen, pl. 395.2.';
  }
  return '';
}

function handleSubmit() {
  fieldError.value = validate();
  if (fieldError.value) {
    return;
  }

  emit('submit', {
    date: date.value,
    fromId: selectedRow.value.fromId,
    toId: selectedRow.value.toId,
    amountMinor: amountMinor.value,
    currency: currency.value,
    exchangeRate: exchangeRate.value,
    rateSource: rateSource.value,
    ...(rateFetchedAt.value ? { rateFetchedAt: rateFetchedAt.value } : {}),
    ...(note.value.trim() ? { note: note.value.trim() } : {}),
  });
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
    emit('cancel');
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
  if (!isEditMode.value) {
    suggestAmount();
  }
  nextTick(() => {
    focusableElements()[0]?.focus();
  });
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="modal-backdrop" role="presentation" @click.self="emit('cancel')">
    <div
      ref="modalRef"
      class="modal receipt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settlement-payment-title"
    >
      <div class="payment-modal__head">
        <div>
          <span class="eyebrow">Kiegyenlítés</span>
          <h2 id="settlement-payment-title">
            {{ isEditMode ? 'Kiegyenlítés szerkesztése' : 'Pénzátadás rögzítése' }}
          </h2>
        </div>
        <span class="stamp stamp--settle" title="Nem növeli az esemény kiadásait">Nem kiadás</span>
      </div>

      <form @submit.prevent="handleSubmit">
        <div class="modal__row">
          <!-- A tartozás-választó szélesebb: két név van benne, a dátumnak
               viszont fix, rövid helye van. A hátralék szándékosan NEM
               szerepel a feliratban: a dátum melletti szűkebb helyen még rövid
               neveknél is levágódott, és az összeget amúgy is az alatta lévő
               (előre kitöltött) mező és az előnézet mondja meg. -->
          <div class="field payment-modal__row-field">
            <label for="payment-row">Melyik tartozás</label>
            <select id="payment-row" v-model="selectedKey" :disabled="saving">
              <option v-for="option in rows" :key="rowKey(option)" :value="rowKey(option)">
                {{ participantName(option.fromId) }} → {{ participantName(option.toId) }}
              </option>
            </select>
          </div>
          <div class="field payment-modal__date-field">
            <label for="payment-date">Dátum</label>
            <input id="payment-date" v-model="date" type="date" required :disabled="saving" />
          </div>
        </div>

        <div class="modal__row">
          <div class="field">
            <label for="payment-amount">Átadott összeg</label>
            <input
              id="payment-amount"
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
          <div v-if="!isSettlementCurrency" class="field payment-modal__rate-field">
            <label for="payment-rate">Árfolyam</label>
            <div class="payment-modal__rate-row">
              <input
                id="payment-rate"
                v-model="exchangeRate"
                type="text"
                class="money-input"
                inputmode="decimal"
                :disabled="saving || rateLoading"
                @input="handleRateInput"
              />
              <button
                type="button"
                class="btn btn--ghost payment-modal__rate-refresh"
                :disabled="saving || rateLoading"
                title="Árfolyam frissítése"
                aria-label="Árfolyam frissítése"
                @click="fetchRate"
              >
                {{ rateLoading ? '…' : '↻' }}
              </button>
            </div>
          </div>
          <div class="field payment-modal__currency-field">
            <label for="payment-currency">Valuta</label>
            <select id="payment-currency" v-model="currency" :disabled="saving">
              <option v-for="code in SUPPORTED_CURRENCIES" :key="code" :value="code">
                {{ code }}
              </option>
            </select>
          </div>
        </div>

        <template v-if="!isSettlementCurrency">
          <p v-if="rateEstimated" class="field-hint">
            ≈ Becsült árfolyam a legutóbb letöltött adatból.
          </p>
          <p v-if="rateError" role="alert" class="field-error">{{ rateError }}</p>
        </template>

        <div class="field">
          <label for="payment-note">Megjegyzés</label>
          <input
            id="payment-note"
            v-model="note"
            type="text"
            maxlength="120"
            placeholder="Készpénz, utalás, …"
            :disabled="saving"
          />
        </div>

        <p v-if="fieldError" role="alert" class="field-error">{{ fieldError }}</p>
        <p v-if="errorMessage" role="alert" class="field-error">{{ errorMessage }}</p>

        <div class="modal-actions">
          <div class="payment-modal__buttons">
            <button type="button" class="btn btn--ghost" :disabled="saving" @click="emit('cancel')">
              Mégse
            </button>
            <button type="submit" class="btn btn--settle" :disabled="saving">
              {{ saving ? 'Mentés…' : isEditMode ? 'Mentés' : 'Rögzítés' }}
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
  width: min(520px, 100%);
  max-height: 90vh;
  margin-top: var(--space-6);
  overflow-y: auto;
}

.modal__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.modal__row .field {
  flex: 1;
  min-width: 0;
}

.modal__row .field input,
.modal__row .field select {
  min-width: 0;
  width: 100%;
}

.modal__row .payment-modal__row-field {
  flex: 2 1 9rem;
}

.modal__row .payment-modal__row-field select {
  text-overflow: ellipsis;
}

.modal__row .payment-modal__date-field {
  flex: 0 0 8.5rem;
}

.modal__row .payment-modal__currency-field {
  flex: 0 0 5rem;
}

.modal__row .payment-modal__rate-field {
  flex: 0 1 8.5rem;
}

.payment-modal__rate-refresh {
  flex: none;
  padding: 0.45em 0.6em;
  font-size: 1rem;
  line-height: 1;
}

@media (max-width: 520px) {
  .modal {
    padding: var(--space-4);
  }

  .modal__row {
    gap: var(--space-2);
  }

  .modal__row .payment-modal__date-field {
    flex: 0 0 8.5rem;
  }

  .modal__row .payment-modal__currency-field {
    flex: 0 0 4.5rem;
  }

  .modal__row .payment-modal__currency-field select {
    padding-left: 0.2em;
    padding-right: 0;
  }

  .modal__row .payment-modal__rate-field {
    flex: 0 1 7.75rem;
  }

  .modal__row .payment-modal__rate-row input {
    padding-left: 0.3em;
    padding-right: 0.3em;
  }
}

.payment-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.payment-modal__rate-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.payment-modal__rate-row input {
  flex: 1;
  min-width: 0;
}

.modal-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.payment-modal__buttons {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}
</style>
