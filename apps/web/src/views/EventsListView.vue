<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { formatMoney, SETTLEMENT_CURRENCY } from '@filler/shared';
import { useEventsStore } from '../stores/events.js';
import { usePeopleStore } from '../stores/people.js';
import { useOfflineStore } from '../stores/offline.js';
import { EVENTS_CACHE_KEY, PEOPLE_CACHE_KEY } from '../offline/cacheKeys.js';
import EventFormModal from '../components/EventFormModal.vue';
import RowMenu from '../components/RowMenu.vue';
import { formatDate } from '../utils/format.js';
import { eventStatusBadge, eventStatusStampClass } from '../utils/eventStatus.js';
import { isNativeApp } from '../utils/platform.js';
import { attachPullToRefresh } from '../utils/pullToRefresh.js';

const router = useRouter();
const eventsStore = useEventsStore();
const peopleStore = usePeopleStore();
const offlineStore = useOfflineStore();

const showFormModal = ref(false);
const editingEvent = ref(null);
const saving = ref(false);
const formError = ref('');

const pullRatio = ref(0);
let detachPullToRefresh = null;

onMounted(async () => {
  // Ez a képernyő két cache-kulcsból mutat adatot: az eseménylistából és a
  // névjegyzékből (a „Résztvevők" oszlop nevei). Az offline sáv pontosan
  // ezekre néz — lásd `stores/offline.js` `setVisibleKeys`.
  offlineStore.setVisibleKeys([EVENTS_CACHE_KEY, PEOPLE_CACHE_KEY]);

  // A lehúzásos gesztus natív affordance: böngészőben nincs rá szükség, ott
  // az oldal újratöltése a megszokott mozdulat.
  if (isNativeApp()) {
    detachPullToRefresh = attachPullToRefresh({
      // MINDKÉT látható kulcs frissül, nem csak az eseménylista: a
      // résztvevő-nevek a névjegyzékből jönnek, tehát egy csak-eseménylista
      // frissítés után a képernyő egyik fele még mindig elavult adatot
      // mutatna — és az offline sáv (helyesen) fent is maradna, hiába
      // frissült a lista a felhasználó szeme előtt (végső re-review U1).
      onRefresh: () => Promise.all([eventsStore.refreshQuietly(), peopleStore.refreshQuietly()]),
      onProgress: (ratio) => {
        pullRatio.value = ratio;
      },
    });
  }

  await Promise.all([eventsStore.fetchEvents(), peopleStore.fetchPeople()]);
});

onUnmounted(() => {
  if (detachPullToRefresh) {
    detachPullToRefresh();
    detachPullToRefresh = null;
  }
});

const eventRows = computed(() => {
  return eventsStore.events.map((event) => ({ event, status: eventStatusBadge(event) }));
});

function participantNames(event) {
  return event.participantIds.map((id) => peopleStore.nameById(id)).join(', ');
}

function openEvent(event) {
  router.push(`/events/${event.id}`);
}

function openCreate() {
  editingEvent.value = null;
  formError.value = '';
  showFormModal.value = true;
}

function openEdit(event) {
  editingEvent.value = event;
  formError.value = '';
  showFormModal.value = true;
}

async function handleSubmit(input) {
  saving.value = true;
  formError.value = '';
  try {
    if (editingEvent.value) {
      await eventsStore.updateEvent(editingEvent.value.id, input);
    } else {
      await eventsStore.createEvent(input);
    }
    showFormModal.value = false;
  } catch (error) {
    formError.value = error.message ?? 'Nem sikerült menteni az eseményt.';
  } finally {
    saving.value = false;
  }
}

async function handleDelete(event) {
  const confirmed = window.confirm(
    `Biztosan törlöd a(z) „${event.name}” eseményt, minden kiadásával és kiegyenlítésével?`,
  );
  if (!confirmed) {
    return;
  }
  await eventsStore.deleteEvent(event.id);
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
      <button type="button" class="btn btn--primary" @click="openCreate">+ Új esemény</button>
    </div>

    <p v-if="pullRatio > 0" class="events__pull" :style="{ opacity: pullRatio }">
      {{ pullRatio >= 1 ? 'Frissítés…' : 'Húzd lejjebb a frissítéshez' }}
    </p>

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
          v-for="{ event, status } in eventRows"
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
            <span class="events__state">
              <span v-if="status.key === 'active'" class="events__active" :title="status.title">
                {{ status.label }}
              </span>
              <span
                v-else
                class="stamp stamp--small"
                :class="eventStatusStampClass(status)"
                :title="status.title"
              >
                {{ status.label }}
              </span>
            </span>
          </td>
          <td data-label="" class="align-right events__actions">
            <RowMenu label="Esemény műveletei">
              <button type="button" class="btn btn--ghost btn--small" @click="openEdit(event)">
                Szerkesztés
              </button>
              <button
                type="button"
                class="btn btn--ghost btn--small"
                @click="toggleArchived(event)"
              >
                {{ event.archived ? 'Visszaállítás' : 'Archiválás' }}
              </button>
              <button type="button" class="btn btn--danger btn--small" @click="handleDelete(event)">
                Törlés
              </button>
            </RowMenu>
          </td>
        </tr>
      </tbody>
    </table>

    <EventFormModal
      v-if="showFormModal"
      :event="editingEvent"
      :people="peopleStore.people"
      :saving="saving"
      :error-message="formError"
      @submit="handleSubmit"
      @cancel="showFormModal = false"
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

.events__row {
  cursor: pointer;
}

/* Hover csak igazi kurzorral: érintésnél beragadna a kiemelés. */
@media (hover: hover) and (pointer: fine) {
  .events__row:hover {
    background: var(--forint-soft);
  }
}

.events__name {
  font-weight: 600;
  color: var(--ink);
}

.events__participants {
  color: var(--ink-soft);
  font-size: 0.92rem;
}

.events__state {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  min-width: 8.75rem;
  min-height: 1.7rem;
  white-space: nowrap;
}

.events__actions {
  text-align: right;
  width: 1%;
}

.events__active {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--forint);
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

  .events__table td[data-label='Állapot'] {
    grid-column: 1 / -1;
  }

  .events__state {
    min-width: 0;
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

.events__pull {
  margin: 0 0 var(--space-2);
  text-align: center;
  font-size: 0.85rem;
  color: var(--ink-soft);
}
</style>
