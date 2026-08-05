<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEventsStore } from '../stores/events.js';
import { usePeopleStore } from '../stores/people.js';
import EventFormModal from '../components/EventFormModal.vue';
import ExpenseTable from '../components/ExpenseTable.vue';
import SettlementPanel from '../components/SettlementPanel.vue';
import { formatDate } from '../utils/format.js';

const route = useRoute();
const router = useRouter();
const eventsStore = useEventsStore();
const peopleStore = usePeopleStore();

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

onMounted(load);

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

      <nav class="ledger-tabs">
        <button
          type="button"
          class="ledger-tabs__tab"
          :class="{ 'is-active': activeTab === 'expenses' }"
          @click="activeTab = 'expenses'"
        >
          Kiadások
        </button>
        <button
          type="button"
          class="ledger-tabs__tab"
          :class="{ 'is-active': activeTab === 'settlement' }"
          @click="activeTab = 'settlement'"
        >
          Elszámolás
        </button>
      </nav>

      <section class="event-detail__panel">
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
  gap: 0.25rem;
  border-bottom: 2px solid var(--ink);
  margin-top: var(--space-6);
}

.ledger-tabs__tab {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.6em 1.2em;
  border: 1.5px solid var(--rule-strong);
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  background: var(--paper);
  color: var(--ink-soft);
  cursor: pointer;
  transform: translateY(2px);
}

.ledger-tabs__tab.is-active {
  background: var(--paper-raised);
  border-color: var(--ink);
  color: var(--ink);
  font-weight: 700;
  transform: translateY(0);
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
    padding: 0.6em 0.5em;
  }
}
</style>
