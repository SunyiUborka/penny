<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { formatMoney, SETTLEMENT_CURRENCY } from '@filler/shared';
import { useEventsStore } from '../stores/events.js';
import { usePeopleStore } from '../stores/people.js';
import EventFormModal from '../components/EventFormModal.vue';
import { formatDate } from '../utils/format.js';

const router = useRouter();
const eventsStore = useEventsStore();
const peopleStore = usePeopleStore();

const showCreateModal = ref(false);
const saving = ref(false);
const formError = ref('');

onMounted(async () => {
  await Promise.all([eventsStore.fetchEvents(), peopleStore.fetchPeople()]);
});

function participantNames(event) {
  return event.participantIds.map((id) => peopleStore.nameById(id)).join(', ');
}

function openEvent(event) {
  router.push(`/events/${event.id}`);
}

async function handleCreate(input) {
  saving.value = true;
  formError.value = '';
  try {
    await eventsStore.createEvent(input);
    showCreateModal.value = false;
  } catch (error) {
    formError.value = error.message ?? 'Nem sikerült létrehozni az eseményt.';
  } finally {
    saving.value = false;
  }
}

async function toggleArchived(event) {
  await eventsStore.updateEvent(event.id, { archived: !event.archived });
}
</script>

<template>
  <main class="events">
    <div class="events__header">
      <div>
        <span class="eyebrow">Fillér</span>
        <h1>Események</h1>
      </div>
      <button type="button" class="btn btn--primary" @click="showCreateModal = true">
        + Új esemény
      </button>
    </div>

    <p v-if="eventsStore.loading || peopleStore.loading" class="events__status">Betöltés…</p>
    <p v-else-if="eventsStore.error" role="alert" class="events__status">
      Nem sikerült betölteni az eseményeket.
    </p>
    <p v-else-if="eventsStore.events.length === 0" class="events__status">
      Még nincs esemény. Kattints az „Új esemény” gombra, és rögzítsd az elsőt.
    </p>

    <table v-else class="ledger-table events__table">
      <thead>
        <tr>
          <th>Név</th>
          <th>Résztvevők</th>
          <th class="align-right">Összköltség</th>
          <th>Kezdő dátum</th>
          <th>Állapot</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="event in eventsStore.events"
          :key="event.id"
          class="events__row"
          tabindex="0"
          @click="openEvent(event)"
          @keydown.enter="openEvent(event)"
        >
          <td data-label="Név">
            <span class="events__name">{{ event.name }}</span>
          </td>
          <td data-label="Résztvevők" class="events__participants">
            {{ participantNames(event) }}
          </td>
          <td
            data-label="Összköltség"
            class="align-right money"
            :class="event.totalBaseAmountMinor > 0 ? 'money--credit' : ''"
          >
            {{
              formatMoney({
                amountMinor: event.totalBaseAmountMinor,
                currency: SETTLEMENT_CURRENCY,
              })
            }}
          </td>
          <td data-label="Kezdő dátum" class="money">{{ formatDate(event.startDate) }}</td>
          <td data-label="Állapot">
            <span v-if="event.archived" class="stamp stamp--muted">Archivált</span>
            <span v-else class="events__active">Aktív</span>
          </td>
          <td data-label="" class="align-right">
            <button
              type="button"
              class="btn btn--ghost btn--small"
              @click.stop="toggleArchived(event)"
            >
              {{ event.archived ? 'Visszaállítás' : 'Archiválás' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <EventFormModal
      v-if="showCreateModal"
      :people="peopleStore.people"
      :saving="saving"
      :error-message="formError"
      @submit="handleCreate"
      @cancel="showCreateModal = false"
    />
  </main>
</template>

<style scoped>
.events {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--space-8) var(--space-6);
}

.events__header {
  display: flex;
  justify-content: space-between;
  align-items: end;
  margin-bottom: var(--space-6);
  gap: var(--space-4);
}

.events__status {
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

.events__row {
  cursor: pointer;
}

.events__row:hover {
  background: var(--forint-soft);
}

.events__name {
  font-weight: 600;
  color: var(--ink);
}

.events__participants {
  color: var(--ink-soft);
  font-size: 0.92rem;
}

.events__active {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--forint);
}

.stamp--muted {
  border-color: var(--rule-strong);
  color: var(--ink-soft);
  font-size: 0.7rem;
  padding: 0.15em 0.6em;
}

.btn--small {
  font-size: 0.78rem;
  padding: 0.4em 0.7em;
}

@media (max-width: 640px) {
  .events__table thead {
    display: none;
  }

  .events__table,
  .events__table tbody {
    display: block;
    width: 100%;
  }

  .events__row {
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

  .events__row::before {
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

  .events__table td {
    display: block;
    border-bottom: none;
    padding: 0.2rem 0;
  }

  .events__table td[data-label='Név'],
  .events__table td[data-label='Résztvevők'] {
    grid-column: 1 / -1;
  }

  .events__table td[data-label]::before {
    content: attr(data-label);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
    display: block;
  }

  .events__table .align-right {
    text-align: left;
  }

  .events__table td[data-label=''] {
    align-self: end;
    text-align: right;
  }

  .events__table td[data-label='']::before {
    content: none;
  }
}
</style>
