<script setup>
import { computed, ref, watch } from 'vue';
import { SETTLEMENT_CURRENCY, SUPPORTED_CURRENCIES } from '@filler/shared';
import { toDateInputValue } from '../utils/format.js';

const props = defineProps({
  event: { type: Object, required: false, default: null },
  people: { type: Array, required: true },
  saving: { type: Boolean, required: false, default: false },
  errorMessage: { type: String, required: false, default: '' },
});

const emit = defineEmits(['submit', 'cancel']);

const isEditMode = computed(() => props.event !== null);

const name = ref('');
const defaultCurrency = ref(SETTLEMENT_CURRENCY);
const participantIds = ref([]);
const startDate = ref('');
const endDate = ref('');

watch(
  () => props.event,
  (event) => {
    name.value = event?.name ?? '';
    defaultCurrency.value = event?.defaultCurrency ?? SETTLEMENT_CURRENCY;
    participantIds.value = event ? [...event.participantIds] : [];
    startDate.value = toDateInputValue(event?.startDate);
    endDate.value = toDateInputValue(event?.endDate);
  },
  { immediate: true },
);

function toggleParticipant(personId) {
  const index = participantIds.value.indexOf(personId);
  if (index === -1) {
    participantIds.value.push(personId);
  } else {
    participantIds.value.splice(index, 1);
  }
}

function handleSubmit() {
  emit('submit', {
    name: name.value,
    defaultCurrency: defaultCurrency.value,
    participantIds: participantIds.value,
    startDate: startDate.value || null,
    endDate: endDate.value || null,
  });
}
</script>

<template>
  <div class="modal-backdrop" role="presentation" @click.self="emit('cancel')">
    <div
      class="modal receipt"
      role="dialog"
      aria-modal="true"
      :aria-label="isEditMode ? 'Esemény szerkesztése' : 'Új esemény'"
    >
      <span class="eyebrow">{{ isEditMode ? 'Szerkesztés' : 'Új bejegyzés' }}</span>
      <h2>{{ isEditMode ? 'Esemény szerkesztése' : 'Új esemény' }}</h2>
      <form @submit.prevent="handleSubmit">
        <div class="field">
          <label for="event-name">Esemény neve</label>
          <input id="event-name" v-model="name" type="text" required :disabled="saving" />
        </div>

        <div class="field">
          <label for="event-default-currency">Kiadások alapértelmezett pénzneme</label>
          <select id="event-default-currency" v-model="defaultCurrency" :disabled="saving">
            <option v-for="code in SUPPORTED_CURRENCIES" :key="code" :value="code">
              {{ code }}
            </option>
          </select>
          <p class="field-hint">
            Csak azt jelöli ki előre, milyen pénznemben adj fel egy új kiadást — az elszámolás
            mindig forintban történik.
          </p>
        </div>

        <div v-if="isEditMode" class="modal__row">
          <div class="field">
            <label for="event-start">Kezdő dátum</label>
            <input id="event-start" v-model="startDate" type="date" :disabled="saving" />
          </div>
          <div class="field">
            <label for="event-end">Befejező dátum</label>
            <input id="event-end" v-model="endDate" type="date" :disabled="saving" />
          </div>
        </div>

        <fieldset class="modal__fieldset">
          <legend>Résztvevők (legalább 2)</legend>
          <p v-if="people.length === 0" class="modal__empty-hint">
            Még nincs senki a névjegyzékben.
            <router-link to="/settings" @click="emit('cancel')">Adj hozzá résztvevőket</router-link>
            a Beállításokban, mielőtt eseményt hozol létre.
          </p>
          <div class="modal__participants">
            <button
              v-for="person in people"
              :key="person.id"
              type="button"
              class="participant-chip"
              :class="{ 'is-selected': participantIds.includes(person.id) }"
              :aria-pressed="participantIds.includes(person.id)"
              :disabled="saving"
              @click="toggleParticipant(person.id)"
            >
              {{ person.name }}
            </button>
          </div>
        </fieldset>

        <p v-if="errorMessage" role="alert" class="field-error">{{ errorMessage }}</p>

        <div class="modal-actions">
          <button type="button" class="btn btn--ghost" :disabled="saving" @click="emit('cancel')">
            Mégse
          </button>
          <button
            type="submit"
            class="btn btn--primary"
            :disabled="saving || participantIds.length < 2"
          >
            {{ saving ? 'Mentés…' : 'Mentés' }}
          </button>
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
  width: min(440px, 100%);
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

.modal__empty-hint {
  font-size: 0.88rem;
  color: var(--ink-soft);
  background: var(--stamp-soft);
  border-radius: 3px;
  padding: var(--space-2) var(--space-3);
  margin: 0 0 var(--space-2);
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
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-4);
}
</style>
