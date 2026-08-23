<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ZodError } from 'zod';
import { settlementProgressOf } from '@filler/shared';
import { ApiError } from '../api/client.js';
import { useEventsStore } from '../stores/events.js';
import { usePeopleStore } from '../stores/people.js';
import { useExpensesStore } from '../stores/expenses.js';
import { useSettlementPaymentsStore } from '../stores/settlementPayments.js';
import { useOfflineStore } from '../stores/offline.js';
import {
  eventCacheKey,
  expensesCacheKey,
  PEOPLE_CACHE_KEY,
  settlementPaymentsCacheKey,
} from '../offline/cacheKeys.js';
import EventFormModal from '../components/EventFormModal.vue';
import ExpenseTable from '../components/ExpenseTable.vue';
import SettlementPanel from '../components/SettlementPanel.vue';
import { formatDate } from '../utils/format.js';
import { computeEventSettlement } from '../utils/settlement.js';
import { eventStatusBadge, eventStatusStampClass } from '../utils/eventStatus.js';

const route = useRoute();
const router = useRouter();
const eventsStore = useEventsStore();
const peopleStore = usePeopleStore();
const expensesStore = useExpensesStore();
const paymentsStore = useSettlementPaymentsStore();
const offlineStore = useOfflineStore();

const event = ref(null);
const loading = ref(true);
/**
 * A betöltési hiba SZÖVEGE, nem puszta boolean: offline, cache-elt másolat
 * nélkül a régi „Nem sikerült betölteni az eseményt." a hálózathiányt is
 * elhallgatta. Üres string = nincs hiba.
 * @type {import('vue').Ref<string>}
 */
const loadError = ref('');
const activeTab = computed(() => (route.params.tab === 'elszamolas' ? 'settlement' : 'expenses'));

function selectTab(tab) {
  router.replace({
    name: 'event-detail',
    params: { id: route.params.id, tab: tab === 'settlement' ? 'elszamolas' : 'kiadasok' },
  });
}
const showEditModal = ref(false);
const saving = ref(false);
const formError = ref('');

const participantNames = computed(() => {
  if (!event.value) {
    return '';
  }
  return event.value.participantIds.map((id) => peopleStore.nameById(id)).join(', ');
});

const statusBadge = computed(() => {
  if (!event.value) {
    return null;
  }
  const live =
    expensesStore.loading || paymentsStore.loading
      ? null
      : computeEventSettlement({
          event: event.value,
          expenses: expensesStore.expenses,
          payments: paymentsStore.payments,
        });
  return eventStatusBadge({
    archived: event.value.archived,
    settlement: live ? settlementProgressOf(live.transfers) : event.value.settlement,
  });
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
  loadError.value = '';
  try {
    // A `fetchPeople` maga sosem dob (a saját `error` állapotába teszi a
    // hibát), tehát a névjegyzék hiánya nem üríti ki ezt a képernyőt.
    await peopleStore.fetchPeople();
    // A `fetchEvent` a cache-en keresztül megy (`event:<id>`), tehát offline
    // is megjön, ha ezt az eseményt korábban már megnyitottuk — és ilyenkor
    // a képernyő teljes egészében megjelenik: kiadástábla, elszámolás,
    // „+ Új kiadás" gomb, vagyis az offline írás is elérhető marad.
    event.value = await eventsStore.fetchEvent(route.params.id);
  } catch (error) {
    // Ide már csak az jut, amiről a cache sem tud segíteni: vagy a szerver
    // válaszolt (`ApiError`, pl. 404 törölt eseményre) / megtört a
    // kontraktus (`ZodError`) — ezeket a `fetchWithCache` szándékosan nem
    // takarja el —, vagy átvitel-szintű hiba történt ÉS ehhez az eseményhez
    // nincs helyi másolat. A kettő nem ugyanaz, és a felhasználónak sem
    // ugyanazt kell tennie, ezért nem mondhatjuk rájuk ugyanazt.
    loadError.value =
      error instanceof ApiError || error instanceof ZodError
        ? 'Nem sikerült betölteni az eseményt.'
        : 'Nincs kapcsolat, és ez az esemény még nem szerepel a helyi tárban. Kapcsolódj a hálózathoz, és nyisd meg újra.';
  } finally {
    loading.value = false;
  }
}

/**
 * Az esemény csendes újratöltése — ugyanaz a filozófia, mint az
 * `expensesStore.refreshQuietly`-nél: nincs „Betöltés…” felvillanás, és
 * hiba esetén a jelenleg látszó eseményt hagyja érintetlenül. Ez tartja
 * frissen az `event.participantIds`-t, amiből a SettlementPanel számol —
 * enélkül egy másik eszközön felvett résztvevő elavulttá tenné a listát
 * (lásd SettlementPanel.vue).
 * @returns {Promise<void>}
 */
async function refreshEventQuietly() {
  try {
    // Szándékosan a cache-tartalék NÉLKÜLI változat: itt már látszik egy
    // esemény, egy cache-re-esés csak lecserélhetné egy régebbi másolatra.
    event.value = await eventsStore.refreshEvent(route.params.id);
  } catch {
    // Csendben bukik is: a látható (esetleg elavult) esemény többet ér egy
    // hibaüzenetnél, a következő újrakapcsolódás vagy előtér-váltás
    // helyrehozza.
  }
}

/**
 * A képernyő SAJÁT (nem a kiadáslistából jövő) adatainak csendes frissítése:
 * az esemény és a névjegyzék. A kiadáslistát a kiadás-store maga frissíti
 * (`refreshQuietly`), ugyanezekre az alkalmakra feliratkozva.
 *
 * A névjegyzék miért tartozik ide: a fejléc résztvevő-nevei és a táblázat
 * „Kifizette"/„Osztozók" oszlopai ebből jönnek, tehát a `people` kulcs is
 * ezen a képernyőn LÁTHATÓ — ha ez az egy kulcs sosem frissülne, egy
 * helyreállás után is elavult maradna, és (helyesen) fenntartaná az offline
 * sávot azon a képernyőn, aminek az adata épp a szemünk előtt frissült
 * (végső re-review U1).
 * @returns {Promise<void>}
 */
async function refreshScreenQuietly() {
  await Promise.all([
    refreshEventQuietly(),
    peopleStore.refreshQuietly(),
    // A kiegyenlítés-listát is itt frissítjük, nem a saját store-jából
    // vezérelve: a kiadásokéval ellentétben nincs sorbanállítása, tehát
    // nincs mit visszajátszani — a csendes újratöltés a teljes helyreállása.
    paymentsStore.refreshQuietly(route.params.id),
  ]);
}

function handleVisibility() {
  if (document.visibilityState === 'visible') {
    refreshScreenQuietly();
  }
}

// Az első kapcsolódást a `load()` már lefedi — csak az azt KÖVETŐ
// újrakapcsolódásokra akarunk reagálni (ugyanaz a minta, mint az
// expensesStore `subscribe`-jának `opened` jelzője).
let everConnected = false;
watch(
  () => expensesStore.connected,
  (connected) => {
    if (!connected) {
      return;
    }
    if (!everConnected) {
      everConnected = true;
      return;
    }
    refreshScreenQuietly();
  },
);

onMounted(() => {
  // Ez a képernyő három cache-kulcsból mutat adatot: magából az eseményből, a
  // kiadáslistájából és a névjegyzékből (a nevek). Az offline sáv pontosan
  // ezekre néz, és semmi másra — egy korábban megnyitott, MÁS esemény elavult
  // kulcsa itt nem állíthat semmit (lásd `stores/offline.js` `setVisibleKeys`).
  offlineStore.setVisibleKeys([
    eventCacheKey(route.params.id),
    expensesCacheKey(route.params.id),
    settlementPaymentsCacheKey(route.params.id),
    PEOPLE_CACHE_KEY,
  ]);

  // A feliratkozás és a kiadás-betöltés itt van, nem a kiadás-fül
  // komponensében: a két fül `v-if`-fel váltakozik, tehát az ott nyitott
  // stream az Elszámolás fülre váltva lezárulna — pedig az elszámolás épp
  // ebből a listából számol.
  //
  // Feliratkozás ELŐBB, mint a lista betöltése: így a két művelet közben
  // felvitt kiadás sem maradhat le.
  expensesStore.subscribe(route.params.id);
  expensesStore
    .fetchExpenses(route.params.id)
    .then(() => {
      return expensesStore.loadPending(route.params.id);
    })
    .catch(() => {
      // Csendben bukik is, a `fetchExpenses` mintájára: a store már
      // beállította a saját `error` állapotát, itt nincs mit tenni.
    });

  // A kiegyenlítések ugyanezen a streamen jönnek (a kiadás-store irányítja
  // ide a rá vonatkozó üzeneteket), tehát külön feliratkozás nem kell — csak
  // a kezdeti lista.
  paymentsStore.fetchPayments(route.params.id);

  load();

  document.addEventListener('visibilitychange', handleVisibility);
});

onUnmounted(() => {
  expensesStore.unsubscribe(route.params.id);
  // Enélkül az előző esemény szelvényei látszódnának a következő esemény
  // nézetén, amíg annak `fetchPayments`-e le nem fut (ugyanaz a szabály,
  // amit a kiadás-store `unsubscribe`-ja követ).
  paymentsStore.reset();
  document.removeEventListener('visibilitychange', handleVisibility);
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
  const confirmed = window.confirm(
    'Biztosan törlöd az eseményt, minden kiadását és kiegyenlítését?',
  );
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
    <p v-else-if="loadError" role="alert" class="event-detail__status">{{ loadError }}</p>

    <template v-else>
      <header class="receipt event-detail__header">
        <div>
          <span class="eyebrow">Esemény</span>
          <h1>{{ event.name }}</h1>
          <p class="event-detail__meta">{{ participantNames }} {{ dateRangeLabel }}</p>
        </div>
        <div class="event-detail__side">
          <div class="event-detail__stamps">
            <span
              v-if="event.archived"
              class="stamp stamp--small"
              :class="eventStatusStampClass(statusBadge)"
              :title="statusBadge.title"
            >
              {{ statusBadge.label }}
            </span>
            <span class="stamp" title="Új kiadás felvételekor előre kijelölt pénznem">
              {{ event.defaultCurrency }}
            </span>
          </div>
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
          @click="selectTab('expenses')"
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
          @click="selectTab('settlement')"
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
        <ExpenseTable
          v-if="activeTab === 'expenses'"
          :event="event"
          :people="peopleStore.people"
          @refresh="refreshScreenQuietly"
        />
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

.event-detail__stamps {
  display: flex;
  align-items: center;
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
    padding: var(--space-4) var(--space-3);
  }

  .event-detail__header {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-3) var(--space-3);
  }

  .event-detail__header h1 {
    font-size: 1.3rem;
  }

  .event-detail__meta {
    font-size: 0.82rem;
    margin-top: 0.2em;
  }

  .event-detail__side {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .event-detail__panel {
    padding: var(--space-3);
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
