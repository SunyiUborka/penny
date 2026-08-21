<script setup>
import { onMounted, ref, watch } from 'vue';
import { listEntries, markPending, removeEntry } from '../offline/outbox.js';
import { isSyncRunning, syncOutbox } from '../offline/sync.js';
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

onMounted(() => {
  // Ez a képernyő egyetlen cache-elt OLVASÁST sem jelenít meg: a sor
  // közvetlenül az outboxból jön, ami mindig a legfrissebb helyi állapot.
  // Ezért üres a bejelentés — az offline sáv itt nem állíthatja, hogy régi
  // adatot látunk (lásd `stores/offline.js` `setVisibleKeys`).
  offlineStore.setVisibleKeys([]);
  load();
});

// A várakozó és az elakadt darabszám az egyetlen jel, ami a `refreshCounts()`
// minden hívásakor (minden outbox-mutáción, tehát egy háttérben — nem
// erről a képernyőről — indított szinkronon is) frissül. Erre iratkozunk
// fel ahelyett, hogy saját értesítési csatornát vagy pollozást vezetnénk
// be: ha valamelyik szám változik, a lista biztosan elavult, újra kell
// tölteni. A figyelő a komponenssel együtt (a `<script setup>` hatókörében)
// jön létre, ezért Vue automatikusan leállítja, amikor a képernyő elhagyásra
// kerül — nincs szükség kézi leiratkozásra.
//
// A kettőt PÁRBAN figyeljük, nem az ÖSSZEGÜKET. A `markFailed` egy tételt
// várakozóból elakadtba tesz: `pending 1→0`, `failed 0→1` — az összeg
// változatlan, tehát az összegre kötött figyelő nem sült el. A képernyő így
// tovább mutatta a „Feltöltésre vár" feliratot, „Újra"/„Eldobás" nélkül, egy
// véglegesen elakadt tételre: pont az az egy képernyő állított valótlant,
// aminek egyetlen dolga az igazat mondani a sorról (végső review I7).
watch(
  () => [offlineStore.pendingCount, offlineStore.failedCount],
  () => {
    load();
  },
);

async function handleSyncNow() {
  busy.value = true;
  message.value = '';
  try {
    const result = await syncOutbox();
    message.value = result.skipped
      ? 'Már folyik egy feltöltés a háttérben — várj, amíg befejeződik.'
      : `${result.uploaded} elem feltöltve, ${result.failed} elakadt.`;
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
  // Nem dobunk el tételt, amíg egy feltöltési kör fut: a motor a kör elején
  // készített listából dolgozik, tehát egy épp feltöltés alatt lévő tétel
  // akkor is felmehet, ha a helyi bejegyzését közben töröltük — a
  // felhasználó pedig azt látná, hogy az eldobott kiadás mégis megjelent.
  // Kétszer kérdezzük meg: a megerősítő párbeszéd ELŐTT (hogy ne kérdezzünk
  // olyanról, amit nem is fogunk megtenni) és közvetlenül a törlés ELŐTT
  // (mert a megerősítés akár másodpercekig nyitva lehet, és közben elindulhat
  // egy háttér-szinkron). A törlés maga már szinkron döntés utáni egyetlen
  // lépés, tehát a maradék rés elhanyagolható.
  if (isSyncRunning()) {
    message.value = 'Épp folyik egy feltöltés a háttérben — várj, amíg befejeződik.';
    return;
  }
  const confirmed = window.confirm(
    `Biztosan eldobod ezt a tételt: „${describe(entry)}” (${formatDate(entry.createdAt)})? ` +
      'Ez véglegesen elvész, és nem kerül fel a szerverre.',
  );
  if (!confirmed) {
    return;
  }
  if (isSyncRunning()) {
    message.value = 'Épp folyik egy feltöltés a háttérben — várj, amíg befejeződik.';
    return;
  }
  message.value = '';
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
          <span class="sync__actions">
            <!--
              „Újra" csak elakadt tételre: egy még várakozó tétel újrapróbálása
              értelmetlen, hiszen épp arra vár. „Eldobás" viszont MINDKETTŐRE
              jár. A kiadástábla azért nem engedi szerkeszteni a függőben lévő
              sorokat, mert az ezen a képernyőn eldobható — ez az indoklás
              addig üres volt, amíg az eldobás csak az elakadt tételekre
              jelent meg: egy offline elírt összeget (500 000 helyett 50 000)
              se javítani, se eldobni nem lehetett (végső review M8).
            -->
            <button
              v-if="entry.status === 'failed'"
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
.sync {
  max-width: 560px;
  margin: 0 auto;
  padding: var(--space-8) var(--space-6);
}

.sync__status {
  color: var(--ink-soft);
}

.sync__description {
  font-weight: 600;
}

.btn--small {
  font-size: 0.78rem;
  padding: 0.4em 0.7em;
}

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
