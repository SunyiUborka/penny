<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEventsStore } from '../stores/events.js';
import { usePeopleStore } from '../stores/people.js';
import { useExpensesStore } from '../stores/expenses.js';
import EventFormModal from '../components/EventFormModal.vue';
import ExpenseTable from '../components/ExpenseTable.vue';
import SettlementPanel from '../components/SettlementPanel.vue';
import { formatDate } from '../utils/format.js';

const route = useRoute();
const router = useRouter();
const eventsStore = useEventsStore();
const peopleStore = usePeopleStore();
const expensesStore = useExpensesStore();

const event = ref(null);
const loading = ref(true);
const loadError = ref(false);
const activeTab = ref('expenses');
const showEditModal = ref(false);
const saving = ref(false);
const formError = ref('');

const participantNames = computed(() => {
  if (!event.value) {
    return '';
  }
  return event.value.participantIds.map((id) => peopleStore.nameById(id)).join(', ');
});

const dateRangeLabel = computed(() => {
  if (!event.value?.startDate) {
    return '';
  }
  const start = formatDate(event.value.startDate);
  if (!event.value.endDate) {
    return `· ${start}`;
  }
  return `· ${start} – ${formatDate(event.value.endDate)}`;
});

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    await peopleStore.fetchPeople();
    event.value = await eventsStore.fetchEvent(route.params.id);
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  // A feliratkozás és a kiadás-betöltés itt van, nem a kiadás-fül
  // komponensében: a két fül `v-if`-fel váltakozik, tehát az ott nyitott
  // stream az Elszámolás fülre váltva lezárulna — pedig az elszámolás épp
  // ebből a listából számol.
  //
  // Feliratkozás ELŐBB, mint a lista betöltése: így a két művelet közben
  // felvitt kiadás sem maradhat le.
  expensesStore.subscribe(route.params.id);
  expensesStore.fetchExpenses(route.params.id);

  load();
});

onUnmounted(() => {
  expensesStore.unsubscribe(route.params.id);
});

async function handleEdit(input) {
  saving.value = true;
  formError.value = '';
  try {
    event.value = await eventsStore.updateEvent(event.value.id, input);
    showEditModal.value = false;
  } catch (error) {
    formError.value = error.message ?? 'Nem sikerült menteni.';
  } finally {
    saving.value = false;
  }
}

async function handleDelete() {
  const confirmed = window.confirm('Biztosan törlöd az eseményt és minden kiadását?');
  if (!confirmed) {
    return;
  }
  await eventsStore.deleteEvent(event.value.id);
  router.push('/');
}
</script>

<template>
  <main class="event-detail">
    <p v-if="loading" class="event-detail__status">Betöltés…</p>
    <p v-else-if="loadError" role="alert" class="event-detail__status">
      Nem sikerült betölteni az eseményt.
    </p>

    <template v-else>
      <header class="receipt event-detail__header">
        <div>
          <span class="eyebrow">Esemény</span>
          <h1>{{ event.name }}</h1>
          <p class="event-detail__meta">{{ participantNames }} {{ dateRangeLabel }}</p>
        </div>
        <div class="event-detail__side">
          <span class="stamp" title="Új kiadás felvételekor előre kijelölt pénznem">
            {{ event.defaultCurrency }}
          </span>
          <div class="event-detail__actions">
            <button type="button" class="btn btn--ghost btn--small" @click="showEditModal = true">
              Szerkesztés
            </button>
            <button type="button" class="btn btn--danger btn--small" @click="handleDelete">
              Törlés
            </button>
          </div>
        </div>
      </header>

      <nav class="ledger-tabs" role="tablist" aria-label="Esemény nézetek">
        <button
          id="tab-expenses"
          type="button"
          role="tab"
          aria-controls="panel-event"
          :aria-selected="activeTab === 'expenses'"
          class="ledger-tabs__tab"
          :class="{ 'is-active': activeTab === 'expenses' }"
          @click="activeTab = 'expenses'"
        >
          Kiadások
        </button>
        <button
          id="tab-settlement"
          type="button"
          role="tab"
          aria-controls="panel-event"
          :aria-selected="activeTab === 'settlement'"
          class="ledger-tabs__tab"
          :class="{ 'is-active': activeTab === 'settlement' }"
          @click="activeTab = 'settlement'"
        >
          Elszámolás
        </button>
      </nav>

      <section
        id="panel-event"
        class="event-detail__panel"
        role="tabpanel"
        :aria-labelledby="activeTab === 'expenses' ? 'tab-expenses' : 'tab-settlement'"
      >
        <ExpenseTable v-if="activeTab === 'expenses'" :event="event" :people="peopleStore.people" />
        <SettlementPanel v-else :event="event" :people="peopleStore.people" />
      </section>

      <EventFormModal
        v-if="showEditModal"
        :event="event"
        :people="peopleStore.people"
        :saving="saving"
        :error-message="formError"
        @submit="handleEdit"
        @cancel="showEditModal = false"
      />
    </template>
  </main>
</template>

<style scoped>
.event-detail {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--space-8) var(--space-6);
}

.event-detail__status {
  color: var(--ink-soft);
}

.event-detail__header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: var(--space-6);
  margin-bottom: var(--space-2);
}

.event-detail__meta {
  color: var(--ink-soft);
  margin: 0.35em 0 0;
}

.event-detail__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-3);
}

.event-detail__actions {
  display: flex;
  gap: var(--space-2);
}

.btn--small {
  font-size: 0.78rem;
  padding: 0.4em 0.7em;
}

.ledger-tabs {
  display: flex;
  align-items: flex-end;
  gap: 0.25rem;
  padding-left: 0.25rem;
  border-bottom: 2px solid var(--ink);
  margin-top: var(--space-6);
}

/* Inaktív fül: hátrasüllyedt dossziéfül — a lapnál sötétebb, tompa, lejjebb. */
.ledger-tabs__tab {
  position: relative;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.55em 1.2em;
  border: 1.5px solid var(--rule-strong);
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  background: color-mix(in srgb, var(--paper) 87%, #000);
  color: var(--ink-soft);
  cursor: pointer;
  box-shadow: inset 0 -7px 8px -7px rgb(0 0 0 / 25%);
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}

/* Hover csak igazi kurzorral: érintésnél beragadna a fülön a kiemelés. */
@media (hover: hover) and (pointer: fine) {
  .ledger-tabs__tab:hover:not(.is-active) {
    background: color-mix(in srgb, var(--paper) 96%, #000);
    color: var(--ink);
  }
}

/* Aktív fül: teljes magasságban előre jön, és egy testet alkot a panellel. */
.ledger-tabs__tab.is-active {
  background: var(--paper-raised);
  border-color: var(--ink);
  color: var(--ink);
  font-weight: 700;
  padding: 0.75em 1.4em 0.65em;
  box-shadow: none;
  z-index: 1;
}

/*
 * Papírszínű illesztés minden fül alján. Az inaktív fülnél a záróvonal fölé
 * esik (a vonal előtte fut → hátul van), az aktívnál átvágja a vonalat.
 */
.ledger-tabs__tab::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  background: var(--paper-raised);
}

.ledger-tabs__tab.is-active::after {
  bottom: -2px;
}

.event-detail__panel {
  background: var(--paper-raised);
  border: 1.5px solid var(--ink);
  border-top: none;
  padding: var(--space-6);
}

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
    padding: 0.55em 0.5em;
  }

  .ledger-tabs__tab.is-active {
    padding: 0.75em 0.5em 0.65em;
  }
}
</style>
