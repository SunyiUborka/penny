import { defineStore } from 'pinia';

export const useOfflineStore = defineStore('offline', {
  state: () => ({
    /**
     * Kulcsonkénti frissesség-állapot: `{ [cacheKey]: { stale, fetchedAt } }`.
     *
     * Miért kulcsonként, és nem egyetlen közös jelző: az alkalmazás egyszerre
     * több listát is lekér (pl. az eseménylista nézet az eseményeket és a
     * névjegyzéket is párhuzamosan), és részleges kapcsolat esetén ezek
     * egymástól függetlenül eshetnek vissza cache-re. Egyetlen megosztott
     * `stale` mezőn az utoljára befutó `fetchWithCache`-hívás felülírná a
     * másikét — vagy elrejtve egy valóban elavult listát egy közben frissült
     * másik mögött, vagy feleslegesen mutatva a sávot, amikor épp minden
     * friss. Ezért minden cache-kulcs a saját frissességét tartja nyilván, a
     * sáv pedig az összesítésből (van-e egyáltalán elavult kulcs) dönt. Ne
     * vonjuk ezt vissza egyetlen boolean-re.
     * @type {Record<string, { stale: boolean, fetchedAt: Date | null }>}
     */
    entries: {},
    /** Feltöltésre váró elemek száma. */
    pendingCount: 0,
    /** Elbukott, felhasználói döntésre váró elemek száma. */
    failedCount: 0,
  }),
  getters: {
    /**
     * Igaz, ha legalább egy nyomon követett kulcs elavult (cache-elt) adatot
     * szolgál ki.
     * @param {{ entries: Record<string, { stale: boolean }> }} state
     * @returns {boolean}
     */
    stale: (state) => Object.values(state.entries).some((entry) => entry.stale),

    /**
     * A legrégebbi lekérés időpontja az elavult kulcsok között — a sávon ez a
     * lényeges szám: a képernyőn éppen látható legelavultabb adat kora. Ha
     * semmi sem elavult (vagy még semmi sem sikerült lekérni), nincs mit
     * mutatni.
     * @param {{ entries: Record<string, { stale: boolean, fetchedAt: Date | null }> }} state
     * @returns {Date | null}
     */
    lastFetchedAt: (state) => {
      const staleDates = Object.values(state.entries)
        .filter((entry) => entry.stale && entry.fetchedAt)
        .map((entry) => entry.fetchedAt);
      if (staleDates.length === 0) {
        return null;
      }
      return staleDates.reduce((oldest, date) => (date < oldest ? date : oldest));
    },
  },
  actions: {
    /**
     * @param {string} key
     * @param {Date} fetchedAt
     */
    setFresh(key, fetchedAt) {
      this.entries[key] = { stale: false, fetchedAt };
    },

    /**
     * @param {string} key
     * @param {Date | null} fetchedAt a cache-elt adat kora
     */
    setStale(key, fetchedAt) {
      this.entries[key] = { stale: true, fetchedAt };
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
