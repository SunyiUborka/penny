<script setup>
import { computed } from 'vue';
import { useOfflineStore } from '../stores/offline.js';
import { formatDate } from '../utils/format.js';

const offlineStore = useOfflineStore();

const lastFetchedLabel = computed(() => {
  if (!offlineStore.lastFetchedAt) {
    return 'ismeretlen időpont';
  }
  const time = offlineStore.lastFetchedAt.toLocaleTimeString('hu-HU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formatDate(offlineStore.lastFetchedAt)} ${time}`;
});
</script>

<template>
  <p v-if="offlineStore.stale" class="offline-banner" role="status">
    Offline — utoljára frissítve: {{ lastFetchedLabel }}
  </p>
</template>

<style scoped>
.offline-banner {
  margin: 0;
  padding: var(--space-2) var(--space-4);
  text-align: center;
  font-size: 0.85rem;
  background: var(--stamp-soft);
  color: var(--ink);
}
</style>
