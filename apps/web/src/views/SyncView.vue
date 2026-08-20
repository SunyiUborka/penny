<script setup>
import { onMounted, ref, watch } from 'vue';
import { listEntries, markPending, removeEntry } from '../offline/outbox.js';
import { syncOutbox } from '../offline/sync.js';
import { formatDate } from '../utils/format.js';
import { useOfflineStore } from '../stores/offline.js';

const offlineStore = useOfflineStore();

const entries = ref([]);
const busy = ref(false);
const message = ref('');

// A `listEntries()` hívások sorrendben indulnak, de nem garantált, hogy
// sorrendben is térnek vissza (pl. egy a `handleSyncNow` végén indított
// újratöltés versenyezhet egy közben a háttér-szinkron miatt lefutó
// `offlineStore`-figyelő kiváltotta újratöltéssel). Egy növekvő token
// biztosítja, hogy mindig a LEGUTOLJÁRA indított olvasás eredménye íródjon
// ki — egy korábban indult, de később visszatérő olvasás sosem írhatja
// felül egy újabb kérés eredményét.
let loadToken = 0;

async function load() {
  const token = ++loadToken;
  const rows = await listEntries();
  if (token === loadToken) {
    entries.value = rows;
  }
}

onMounted(load);

// A várakozó+elakadt darabszám az egyetlen jel, ami a `refreshCounts()`
// minden hívásakor (minden outbox-mutáción, tehát egy háttérben — nem
// erről a képernyőről — indított szinkronon is) frissül. Erre iratkozunk
// fel ahelyett, hogy saját értesítési csatornát vagy pollozást vezetnénk
// be: ha a szám változik, a lista biztosan elavult, újra kell tölteni. A
// figyelő a komponenssel együtt (a `<script setup>` hatókörében) jön
// létre, ezért Vue automatikusan leállítja, amikor a képernyő elhagyásra
// kerül — nincs szükség kézi leiratkozásra.
watch(
  () => offlineStore.pendingCount + offlineStore.failedCount,
  () => {
    load();
  },
);

async function handleSyncNow() {
  busy.value = true;
  message.value = '';
  try {
    const result = await syncOutbox();
    message.value = `${result.uploaded} elem feltöltve, ${result.failed} elakadt.`;
  } finally {
    busy.value = false;
    await load();
  }
}

/**
 * @param {object} entry
 */
async function handleRetry(entry) {
  await markPending(entry.id);
  await handleSyncNow();
}

/**
 * @param {object} entry
 * @returns {string}
 */
function describe(entry) {
  const label = entry.payload?.description ?? 'kiadás';
  if (entry.type === 'create') {
    return `Új kiadás: ${label}`;
  }
  if (entry.type === 'update') {
    return `Módosítás: ${label}`;
  }
  return 'Törlés';
}

/**
 * @param {object} entry
 */
async function handleDiscard(entry) {
  const confirmed = window.confirm(
    `Biztosan eldobod ezt a tételt: „${describe(entry)}” (${formatDate(entry.createdAt)})? ` +
      'Ez véglegesen elvész, és nem kerül fel a szerverre.',
  );
  if (!confirmed) {
    return;
  }
  await removeEntry(entry.id);
  await load();
}
</script>

<template>
  <main class="sync">
    <span class="eyebrow">Fillér</span>
    <h1>Szinkronizálás</h1>

    <p v-if="entries.length === 0" class="sync__status">
      Minden feltöltve. Nincs várakozó módosítás.
    </p>

    <template v-else>
      <button type="button" class="btn btn--primary" :disabled="busy" @click="handleSyncNow">
        {{ busy ? 'Feltöltés…' : 'Feltöltés most' }}
      </button>
      <p v-if="message" class="sync__status">{{ message }}</p>

      <ul class="sync__list">
        <li v-for="entry in entries" :key="entry.id" class="sync__item">
          <span class="sync__description">{{ describe(entry) }}</span>
          <span class="sync__meta">{{ formatDate(entry.createdAt) }}</span>
          <span v-if="entry.status === 'failed'" class="sync__error" role="alert">
            Elakadt: {{ entry.error }}
          </span>
          <span v-else class="sync__meta">Feltöltésre vár</span>
          <span v-if="entry.status === 'failed'" class="sync__actions">
            <button
              type="button"
              class="btn btn--ghost btn--small"
              :disabled="busy"
              @click="handleRetry(entry)"
            >
              Újra
            </button>
            <button
              type="button"
              class="btn btn--danger btn--small"
              :disabled="busy"
              @click="handleDiscard(entry)"
            >
              Eldobás
            </button>
          </span>
        </li>
      </ul>
    </template>
  </main>
</template>

<style scoped>
.sync__list {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}

.sync__item {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 0.3rem;
}

.sync__meta {
  font-size: 0.8rem;
  color: var(--ink-soft);
}

.sync__error {
  font-size: 0.85rem;
  color: var(--stamp);
}

.sync__actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-1);
}
</style>
