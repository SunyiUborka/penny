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
     * sáv pedig a KÉPERNYŐN LÁTHATÓ kulcsok összesítéséből dönt (lásd
     * `visibleKeys`). Ne vonjuk ezt vissza egyetlen boolean-re.
     * @type {Record<string, { stale: boolean, fetchedAt: Date | null }>}
     */
    entries: {},
    /**
     * Azok a cache-kulcsok, amiket az ÉPPEN NYITOTT képernyő mutat. A nézetek
     * jelentik be a mount-jukkor (`setVisibleKeys`), az `offline/cacheKeys.js`
     * függvényeivel.
     *
     * Miért kell ez, és miért nem elég a „van-e egyáltalán elavult kulcs"
     * összesítés: az `entries` a munkamenet alatt gyűlik, eseményenkénti
     * kulcsokkal is (`event:<id>`, `expenses:<id>`). Egy hete megnyitott,
     * azóta elavultra jelölt esemény kulcsa így egy MÁS képernyőn tartotta
     * volna fent a sávot, a „utoljára frissítve" időbélyeg pedig a
     * legrégebbi elavult kulcsé volt — vagyis egy olyan adat koráról
     * beszélt, ami nem is látszik. A sáv állítása („ezen a képernyőn régi
     * adatot látsz") csak akkor lehet igaz, ha pontosan a képernyőn látható
     * kulcsokra nézünk.
     * @type {string[]}
     */
    visibleKeys: [],
    /** Feltöltésre váró elemek száma. */
    pendingCount: 0,
    /** Elbukott, felhasználói döntésre váró elemek száma. */
    failedCount: 0,
  }),
  getters: {
    /**
     * Igaz, ha az ÉPPEN LÁTHATÓ kulcsok közül legalább egy elavult
     * (cache-elt) adatot szolgál ki. Egy be nem jelentett (vagy még le sem
     * kért) kulcsról nem állítunk semmit: a sáv hallgat, amíg nincs olyan
     * látható adat, amiről tudjuk, hogy régi.
     * @param {{ entries: Record<string, { stale: boolean }>, visibleKeys: string[] }} state
     * @returns {boolean}
     */
    stale: (state) => state.visibleKeys.some((key) => state.entries[key]?.stale === true),

    /**
     * A legrégebbi lekérés időpontja a látható, elavult kulcsok között — a
     * sávon ez a lényeges szám: a képernyőn éppen látható legelavultabb adat
     * kora. Ha semmi sem elavult (vagy még semmi sem sikerült lekérni),
     * nincs mit mutatni.
     * @param {{ entries: Record<string, { stale: boolean, fetchedAt: Date | null }>, visibleKeys: string[] }} state
     * @returns {Date | null}
     */
    lastFetchedAt: (state) => {
      const staleDates = state.visibleKeys
        .map((key) => state.entries[key])
        .filter((entry) => entry?.stale && entry.fetchedAt)
        .map((entry) => entry.fetchedAt);
      if (staleDates.length === 0) {
        return null;
      }
      return staleDates.reduce((oldest, date) => (date < oldest ? date : oldest));
    },
  },
  actions: {
    /**
     * A képernyő bejelenti, mely cache-kulcsokból származó adatot mutatja.
     * **Minden nézetnek meg kell hívnia a mount-jakor**, azt is, amelyik
     * semmilyen cache-elt olvasást nem jelenít meg (üres listával — pl. a
     * bejelentkezés és a Szinkronizálás képernyő): a bejelentés az előzőt
     * teljesen leváltja, tehát egy elmaradó hívás az előző képernyő
     * kulcsairól szóló, itt már hamis állítást hagyna a sávon.
     *
     * A már nem látható kulcsok frissesség-állapotát el is dobjuk. Egyrészt
     * mert az `entries` különben a munkamenet végéig gyűlt (minden megnyitott
     * esemény két kulcsot hagyott benne), másrészt mert nincs is rá szükség:
     * amikor egy kulcs újra láthatóvá válik, az azt megjelenítő nézet
     * mount-ja mindig újra le is kéri, tehát a frissesség-állapotát azonnal
     * újra megállapítjuk.
     * @param {string[]} keys
     */
    setVisibleKeys(keys) {
      this.visibleKeys = [...keys];
      for (const key of Object.keys(this.entries)) {
        if (!this.visibleKeys.includes(key)) {
          delete this.entries[key];
        }
      }
    },

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
