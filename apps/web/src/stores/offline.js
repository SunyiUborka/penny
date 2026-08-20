import { defineStore } from 'pinia';

export const useOfflineStore = defineStore('offline', {
  state: () => ({
    /** A megjelenített adat cache-ből jön-e (tehát elavult lehet). */
    stale: false,
    /** @type {Date | null} */
    lastFetchedAt: null,
    /** Feltöltésre váró elemek száma. */
    pendingCount: 0,
    /** Elbukott, felhasználói döntésre váró elemek száma. */
    failedCount: 0,
  }),
  actions: {
    /**
     * @param {Date} fetchedAt
     */
    setFresh(fetchedAt) {
      this.stale = false;
      this.lastFetchedAt = fetchedAt;
    },

    /**
     * @param {Date | null} fetchedAt a cache-elt adat kora
     */
    setStale(fetchedAt) {
      this.stale = true;
      this.lastFetchedAt = fetchedAt;
    },

    /**
     * @param {{ pending: number, failed: number }} counts
     */
    setCounts(counts) {
      this.pendingCount = counts.pending;
      this.failedCount = counts.failed;
    },
  },
});
