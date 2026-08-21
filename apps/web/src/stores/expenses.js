import { defineStore } from 'pinia';
import { ZodError } from 'zod';
import {
  convertMinorAmount,
  expenseListResponseSchema,
  expenseResponseSchema,
  expenseStreamMessageSchema,
  SETTLEMENT_CURRENCY,
} from '@filler/shared';
import { apiClient, ApiError } from '../api/client.js';
import { openEventStream } from '../api/eventStream.js';
import { fetchWithCache, refreshIntoCache } from '../offline/cache.js';
import { expensesCacheKey } from '../offline/cacheKeys.js';
import { enqueue, listByEvent, refreshCounts } from '../offline/outbox.js';
import { completedUploadCount, isSyncRunning } from '../offline/sync.js';
import { isEstimatedRate, RateResolutionError, withFreshRate } from '../offline/rates.js';

/** Meddig van kiemelve egy frissen érkezett sor. */
const FRESH_MS = 1600;

// Modulszinten, nem a store state-jében: a stream lezárója és a timerek nem
// reaktív adatok, a Pinia state-be téve csak feleslegesen proxyzódnának.
let closeStream = null;
let streamEventId = null;
let visibilityHandler = null;
const freshTimers = new Map();

/**
 * A legutóbb kért esemény azonosítója. A `fetchExpenses` állítja be minden
 * hívásakor — ez az egyetlen hely, ami a „jelenleg látott esemény”-t
 * deklarálja. Egy nagyon gyors, egymást követő navigáció esetén a korábbi
 * kérés válasza később is megérkezhet, mint a következőé — enélkül az a
 * lista beleírna egy másik esemény nézetébe. A `refreshQuietly` is ezt
 * olvassa (lásd `isCurrentEvent`), hogy egy elkésett csendes frissítés se
 * írhassa felül, sem játszhassa vissza az outbox-ot egy már elhagyott
 * esemény nézetében.
 */
let latestFetchEventId = null;

/**
 * Igaz, ha `eventId` még mindig a ténylegesen látott esemény — tehát egy rá
 * vonatkozó, korábban elindított kérés válasza nem elkésett.
 * @param {string} eventId
 * @returns {boolean}
 */
function isCurrentEvent(eventId) {
  return latestFetchEventId === eventId;
}

/**
 * A szerverrel azonos rendezés: dátum szerint csökkenő, egyező dátumon a
 * később rögzített előbb (lásd expenseRepository.listForEvent).
 * @param {{ date: Date, createdAt: Date }} a
 * @param {{ date: Date, createdAt: Date }} b
 */
function compareExpenses(a, b) {
  const byDate = b.date.getTime() - a.date.getTime();
  return byDate === 0 ? b.createdAt.getTime() - a.createdAt.getTime() : byDate;
}

/**
 * Hova kell beszúrni a kiadást, hogy a lista rendezett maradjon.
 * @param {Array<object>} expenses
 * @param {object} expense
 */
function insertIndexFor(expenses, expense) {
  const index = expenses.findIndex((item) => compareExpenses(item, expense) > 0);
  return index === -1 ? expenses.length : index;
}

/**
 * Ugyanaz a számítás, amit a szerver `buildExpenseData`-ja végez — csak
 * (deviza esetén) a felvitelkor/szerkesztéskor ismert, esetleg cache-elt
 * árfolyammal. NE a nyers `amountMinor` kerüljön a listába: az elszámolás
 * ebből a listából számol, tehát egy 10 EUR-os kiadás 10 forintként rontaná el
 * az egyenlegeket. A végleges érték a feltöltéskor, friss árfolyammal dől el.
 *
 * Ezt hívja mind a létrehozás (`toPendingExpense`), mind a szerkesztés
 * (`toPendingUpdate`) sorbaállított alakja — egy helyen, hogy a két út ne
 * csúszhasson szét a forint-átváltás számításában.
 * @param {{ amountMinor: number, currency: string, exchangeRate: string }} payload
 * @returns {number}
 */
function computePendingBaseAmountMinor({ amountMinor, currency, exchangeRate }) {
  return currency === SETTLEMENT_CURRENCY
    ? amountMinor
    : convertMinorAmount({
        amountMinor,
        rate: exchangeRate,
        sourceCurrency: currency,
        targetCurrency: SETTLEMENT_CURRENCY,
      });
}

/**
 * A sorbanállított, újonnan létrehozott kiadás listában megjelenítendő
 * alakja. Az `id` prefixe megkülönbözteti a szervertől kapott kiadásoktól, a
 * `pending` jelzőt pedig a felület használja.
 * @param {object} entry outbox bejegyzés
 * @returns {object}
 */
function toPendingExpense(entry) {
  return {
    ...entry.payload,
    id: `pending:${entry.id}`,
    eventId: entry.eventId,
    date: new Date(entry.payload.date),
    baseAmountMinor: computePendingBaseAmountMinor(entry.payload),
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    pending: true,
  };
}

/**
 * Egy meglévő (szinkronizált vagy már pending) kiadásra alkalmazott,
 * sorbaállított szerkesztés listában megjelenítendő alakja. A forint-érték itt
 * is `computePendingBaseAmountMinor`-ral számol, nem a régi (vagy nyers)
 * összegből marad bent — így egy devizás szerkesztés is helyesen látszik az
 * elszámolásban a feltöltésig.
 * @param {object} existing a listában lévő kiadás
 * @param {object} payload a szerkesztés bemenete (`ExpenseModal` alakja)
 * @returns {object}
 */
function toPendingUpdate(existing, payload) {
  return {
    ...existing,
    ...payload,
    // A `date` az űrlapról (és az outbox payload-ból) ÉÉÉÉ-HH-NN string, a
    // listában viszont Date — a rendezés (compareExpenses) getTime()-ot hív
    // rá.
    date: new Date(payload.date),
    baseAmountMinor: computePendingBaseAmountMinor(payload),
    pending: true,
  };
}

export const useExpensesStore = defineStore('expenses', {
  state: () => ({
    expenses: [],
    loading: false,
    error: null,
    /** Áll-e élő kapcsolat a szerverrel (a UI kapcsolatjelzőjéhez). */
    connected: false,
    /** A frissen érkezett, kiemelt sorok azonosítói. */
    freshIds: new Set(),
  }),
  actions: {
    /**
     * Igaz, ha `eventId` a ténylegesen megnyitott esemény ebben a lapban —
     * ugyanaz a nyilvántartás, amit a modul belül az elkésett válaszok
     * kiszűrésére használ (lásd a modulszintű `isCurrentEvent`-et). Ez az
     * egyetlen hivatalos forrás arra, hogy "melyik eseményt nézi éppen ez a
     * lap" — külső hívók (pl. a szinkron-motor) ezt kérdezzék le, ne egy
     * saját, a lista tartalmából kitalált közelítést vezessenek be
     * (a `expenses` tömb ugyanis nem particionál eseményenként).
     * @param {string} eventId
     * @returns {boolean}
     */
    isViewingEvent(eventId) {
      return isCurrentEvent(eventId);
    },

    /**
     * @param {string} eventId
     */
    async fetchExpenses(eventId) {
      this.loading = true;
      this.error = null;
      latestFetchEventId = eventId;
      try {
        const result = await fetchWithCache({
          key: expensesCacheKey(eventId),
          schema: expenseListResponseSchema,
          request: () =>
            apiClient.get(`/events/${eventId}/expenses`, { schema: expenseListResponseSchema }),
        });
        if (latestFetchEventId !== eventId) {
          // Közben egy másik eseményre navigáltunk, és az a hívás már
          // felülírta, melyik esemény számít „aktuálisnak” — ez a válasz
          // elkésett, nem írhatja felül egy másik esemény listáját.
          return;
        }
        this.expenses = result.value;
      } catch (error) {
        if (latestFetchEventId !== eventId) {
          return;
        }
        this.error = error;
      } finally {
        if (latestFetchEventId === eventId) {
          this.loading = false;
        }
      }
    },

    /**
     * Az app újraindítása után a sorbanállított kiadásoknak is látszaniuk kell
     * a listában, nem csak a szinkron képernyőn.
     * @param {string} eventId
     */
    async loadPending(eventId) {
      const entries = await listByEvent(eventId);
      for (const entry of entries) {
        if (entry.type === 'create') {
          // Ha ehhez a `clientId`-hez MÁR van szerverről kapott sor a
          // listában, a szintetikus sort nem szúrjuk be: a szerver
          // ténylegesen létrehozta a kiadást, csak a POST válasza veszett el
          // (pl. egy proxy időtúllépése a commit UTÁN). Ilyenkor az SSE
          // meghozza a valódi sort, a `createExpense` catch-ága pedig
          // beszúrja a szintetikusat is — a kiadás kétszer látszik, és az
          // elszámolás kétszer is beszámítja. A szerveroldali `clientId`
          // idempotencia csak a FELTÖLTÉST teszi biztonságossá, a
          // MEGJELENÍTÉST nem; enélkül a duplikátum ráadásul ragadós volt,
          // mert minden csendes frissítés újra beszúrta (végső review M11).
          // Az outbox-bejegyzés szándékosan marad: a következő feltöltés a
          // `clientId` alapján a meglévő kiadást kapja vissza, és azzal
          // takarítja el magát.
          const alreadyOnServer = this.expenses.some(
            (expense) =>
              !expense.pending && expense.clientId && expense.clientId === entry.clientId,
          );
          if (!alreadyOnServer) {
            this.upsertExpense(toPendingExpense(entry));
          }
        }
        if (entry.type === 'update' && entry.expenseId) {
          const existing = this.expenses.find((expense) => expense.id === entry.expenseId);
          // Ha a célkiadás nincs (még) a listában — másutt törölték, vagy a
          // lista még nem töltötte be —, nem találunk ki egy sort a
          // semmiből: a feltöltés (és a szinkron képernyő) dönti majd el, mi
          // legyen ezzel a bejegyzéssel.
          if (existing) {
            this.upsertExpense(toPendingUpdate(existing, entry.payload));
          }
        }
        if (entry.type === 'delete' && entry.expenseId) {
          this.removeExpense(entry.expenseId);
        }
      }
      // Az app újraindítása után az outbox számlálói (pending/failed) nulláról
      // indulnának a következő sorbaállításig — enélkül a szinkron képernyő
      // (következő feladat) egy elavult, hamis nulla-állapotot örökölne.
      await refreshCounts();
    },

    /**
     * Újratöltés a „Betöltés…” állapot felvillantása nélkül. Újrakapcsolódás
     * és fül-előtérbe-kerülés után hívjuk: ilyenkor a lista már látszik, és
     * egy villanó betöltés-jelző zavaróbb, mint hasznos.
     *
     * Ez a művelet pótolja a szakadás alatt elmaradt üzeneteket — ezért nincs
     * szerveroldali Last-Event-ID puffer.
     *
     * A kapcsolat pontosan akkor tér vissza, amikor ez lefut (stream
     * újrakapcsolódás, fül előtérbe kerülése, lehúzásos frissítés) — ha csak a
     * szerver listáját tennénk be, egy sorbaálló létrehozás/törlés/szerkesztés
     * sora eltűnne/visszaállna a képernyőn, miközben az outbox (és a pending
     * számláló) még mindig tartalmazza. A `loadPending` visszajátszása ezért
     * ugyanúgy idetartozik ide, mint az `EventDetailView` `fetchExpenses`-t
     * követő láncába.
     *
     * A hívó (stream, `visibilitychange`, lehúzásos frissítés) egy adott
     * eseményhez van kötve az indításkor — ha a felhasználó időközben másik
     * eseményre navigál, mire ez a kérés visszaér, se a lista felülírása, se
     * az outbox visszajátszása nem történhet meg: az `isCurrentEvent`
     * ellenőrzés (a `fetchExpenses` mintájára) mindkét lépés előtt kizárja
     * ezt, nem csak a lista beírása előtt.
     *
     * A szinkron-motorral is versenyezhet: mindketten a `visibilitychange`-re
     * indulnak, tehát a lista `GET`-je könnyen a feltöltés ELŐTTI
     * adatbázis-állapotot tükrözi, miközben a válasza a motor
     * `applyUploadResult`-ja UTÁN kerülne alkalmazásra — az pedig letörölné a
     * frissen feltöltött, valódi sort (feltöltött törlésnél visszahozná a
     * törölt sort), és mivel az outbox-bejegyzés addigra nincs meg, a
     * `loadPending` sem játszaná vissza. Épp az a lyuk, aminek a bezárására az
     * `applyUploadResult` készült. Ezért a válasz alkalmazása előtt
     * megkérdezzük a motort (`isSyncRunning`, `completedUploadCount`): ha
     * közben feltöltés-eredmény landolt, vagy még fut egy kör, ez a válasz
     * elavult lehet — ilyenkor egyszer újrapróbáljuk (a második lekérés már a
     * feltöltés utáni állapotot látja, és a cache-t is helyrehozza), és ha
     * akkor is ütközünk, inkább nem írunk semmit: a képernyőn lévő lista már
     * tartalmazza a motor eredményét.
     * @param {string} eventId
     * @param {number} [attempt] belső: hányadik próbálkozás (a feltöltéssel
     * való ütközés miatt legfeljebb egyszer próbáljuk újra)
     */
    async refreshQuietly(eventId, attempt = 0) {
      try {
        const uploadsBefore = completedUploadCount();
        // `refreshIntoCache`, nem közvetlen `apiClient`: a sikeres csendes
        // frissítés a cache-t is felírja, és az `expenses:<eseményId>`
        // kulcsot frissnek jelöli. Enélkül minden helyreállási út (stream
        // újrakapcsolódás, előtérbe kerülés, lehúzásos frissítés) elkerülte
        // a `setFresh`-t, tehát az offline sáv a munkamenet végéig azt
        // állította, hogy elavult adat látszik — miközben a felhasználó
        // szeme előtt frissült a lista (lásd a végső review I4 pontját).
        // Bukáskor dob, és a `catch` hagyja a láthatót: itt továbbra sincs
        // cache-tartalék, tehát a képernyőn lévő listát nem cserélheti le
        // egy nála régebbi másolat.
        const expenses = await refreshIntoCache({
          key: expensesCacheKey(eventId),
          request: () =>
            apiClient.get(`/events/${eventId}/expenses`, { schema: expenseListResponseSchema }),
        });
        if (!isCurrentEvent(eventId)) {
          // Közben másik eseményre navigáltunk (ugyanaz a helyzet, mint a
          // `fetchExpenses`-nél): ez a válasz elkésett, nem írhatja felül,
          // ami épp látszik.
          return;
        }
        if (isSyncRunning() || completedUploadCount() !== uploadsBefore) {
          // Ütközés a szinkron-motorral (lásd a fenti magyarázatot): ez a
          // lista a feltöltés előtti állapotot tükrözheti. Az ellenőrzés és a
          // lenti beírás között nincs `await`, tehát a motor nem tud
          // közbeszúrni.
          if (attempt === 0) {
            await this.refreshQuietly(eventId, attempt + 1);
          }
          return;
        }
        this.expenses = expenses;
        // Egy korábbi sikertelen betöltés hibaüzenete itt már elavult: a
        // sikeres csendes frissítés a bizonyíték, hogy a kapcsolat helyreállt.
        this.error = null;
        if (!isCurrentEvent(eventId)) {
          // Ugyanaz az ellenőrzés a visszajátszás előtt is: a `loadPending`
          // se játszhassa vissza egy már elhagyott esemény outbox-bejegyzéseit
          // a jelenlegi (más eseményhez tartozó) nézetbe.
          return;
        }
        await this.loadPending(eventId);
      } catch {
        // Csendben bukik is: a látható (elavult) lista többet ér egy
        // hibaüzenetnél, és a következő újratöltés helyrehozza.
      }
    },

    /**
     * Feliratkozás az esemény élő kiadás-frissítéseire. A transzport
     * (EventSource vagy natív fetch-stream) az `openEventStream` dolga — ez a
     * store csak üzeneteket kap.
     * @param {string} eventId
     */
    subscribe(eventId) {
      this.unsubscribe();

      let opened = false;
      streamEventId = eventId;

      closeStream = openEventStream({
        path: `/events/${eventId}/stream`,
        onOpen: () => {
          this.connected = true;
          // Újrakapcsolódás után pótolni kell a szakadás alatt elmaradt
          // üzeneteket — ezért nincs szerveroldali Last-Event-ID puffer.
          if (opened) {
            this.refreshQuietly(eventId);
          }
          opened = true;
        },
        onClose: () => {
          this.connected = false;
        },
        onMessage: (data) => {
          this.applyStreamMessage(data);
        },
      });

      // Előtérbe kerüléskor (fülváltás böngészőben, app-váltás telefonon) a
      // stream lehet, hogy közben elhalt. Ez a frissítés akkor is behozza a
      // kimaradt változásokat, ha az újrakapcsolódás késik.
      visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          this.refreshQuietly(eventId);
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    },

    /**
     * @param {string} [eventId] ha meg van adva, csak akkor zár, ha valóban
     * ehhez az eseményhez tartozik a nyitott stream — így egy későn lefutó
     * onUnmounted nem tudja lezárni a közben már megnyílt új streamet
     */
    unsubscribe(eventId) {
      if (eventId !== undefined && streamEventId !== eventId) {
        return;
      }
      if (closeStream) {
        closeStream();
        closeStream = null;
      }
      streamEventId = null;
      if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
      }
      for (const timer of freshTimers.values()) {
        clearTimeout(timer);
      }
      freshTimers.clear();
      this.freshIds.clear();
      this.connected = false;
      // Enélkül az előző esemény kiadásai látszódnának a következő esemény
      // nézetén, amíg annak `fetchExpenses`-e le nem fut.
      this.expenses = [];
      this.error = null;
    },

    /**
     * @param {string} data az SSE üzenet nyers JSON törzse
     */
    applyStreamMessage(data) {
      let message;
      try {
        message = expenseStreamMessageSchema.parse(JSON.parse(data));
      } catch {
        // Értelmezhetetlen üzenetet eldobunk, nem rontjuk el vele a listát.
        return;
      }

      if (message.type === 'expense.deleted') {
        this.removeExpense(message.expenseId);
        return;
      }

      this.upsertExpense(message.expense, { highlight: true });
    },

    /**
     * Idempotens beszúrás/csere, a lista rendezését megtartva.
     *
     * A saját mutációk után ugyanaz a kiadás az SSE-n is visszajön hozzánk —
     * ezért kell az idempotencia (nem duplikálhat), és ezért nem villantjuk
     * fel újra: az `updatedAt` egyezése azt jelenti, hogy ezt a változást már
     * mi magunk alkalmaztuk.
     * @param {object} expense
     * @param {{ highlight?: boolean }} [options]
     */
    upsertExpense(expense, options = {}) {
      // Ugyanennek a kiadásnak a szintetikus, még fel nem töltött sora nem
      // maradhat a listában, ha a szerverről már megjött a valódi: a
      // `clientId` az egyetlen kapocs a kettő között (az `id`-k szándékosan
      // különböznek). Az `applyUploadResult` a saját feltöltése után az
      // outbox-bejegyzés azonosítójából tudja, melyik szintetikus sort kell
      // levennie — az SSE-n érkező sorról viszont nem tudhatja, ezért kell
      // ez a `clientId`-alapú hálló: enélkül egy commit UTÁN elveszett POST
      // válasza duplán megjelenő kiadást és kétszer beszámított összeget
      // hagyott a képernyőn (végső review M11).
      if (!expense.pending && expense.clientId) {
        const duplicate = this.expenses.find(
          (item) => item.pending && item.id !== expense.id && item.clientId === expense.clientId,
        );
        if (duplicate) {
          this.removeExpense(duplicate.id);
        }
      }
      const index = this.expenses.findIndex((item) => item.id === expense.id);
      const alreadyApplied =
        index !== -1 && this.expenses[index].updatedAt.getTime() === expense.updatedAt.getTime();

      // Kivesszük és rendezetten visszaszúrjuk, mert egy távoli szerkesztés a
      // dátumot is megváltoztathatta, tehát a sor helye is változhat.
      if (index !== -1) {
        this.expenses.splice(index, 1);
      }
      this.expenses.splice(insertIndexFor(this.expenses, expense), 0, expense);

      if (options.highlight && !alreadyApplied) {
        this.markFresh(expense.id);
      }
    },

    /**
     * @param {string} id
     */
    removeExpense(id) {
      this.expenses = this.expenses.filter((expense) => expense.id !== id);
      this.freshIds.delete(id);
      clearTimeout(freshTimers.get(id));
      freshTimers.delete(id);
    },

    /**
     * @param {string} id
     */
    markFresh(id) {
      this.freshIds.add(id);
      clearTimeout(freshTimers.get(id));
      freshTimers.set(
        id,
        setTimeout(() => {
          this.freshIds.delete(id);
          freshTimers.delete(id);
        }, FRESH_MS),
      );
    },

    /**
     * @param {string} eventId
     * @param {object} input
     * @param {{ rateResolvedByForm?: boolean }} [rateMeta] kliensoldali kísérő
     * tény az árfolyam eredetéről (lásd `ExpenseModal.vue`). Létrehozásnál az
     * alapérték `true`: egy új kiadás árfolyamát mindig az űrlap oldja fel,
     * nincs miből örökölni.
     */
    async createExpense(eventId, input, rateMeta = {}) {
      const clientId = crypto.randomUUID();
      const rateResolvedByForm = rateMeta.rateResolvedByForm ?? true;
      let body = { ...input, clientId };
      // Ha az űrlapon BECSÜLT árfolyam van (az űrlap oldotta fel, de nem mai
      // — lásd `isEstimatedRate`), a mentés pillanatában újra feloldjuk.
      // Enélkül a `withFreshRate` csak az outbox-on átmenő tételekre futott:
      // egy közvetlenül sikeres POST teljesen kihagyta, tehát egy három napos
      // becslés VÉGLEGESEN tárolt értékké vált — pending jelzés, `≈` és
      // elszámolás-figyelmeztetés nélkül, vagyis a felhasználó egy elavult
      // becslésből számolt egyenleget látott véglegesként (végső review I5).
      // A modal jegyzete és a dokumentáció is ezt ígéri; ezen az úton a
      // „feltöltés" épp ez a POST.
      // Friss (mai) vagy kézi árfolyamnál nincs mit feloldani: az nem
      // becslés, és egy felesleges `/rates` kör csak lassítaná a mentést —
      // ráadásul egy ilyen felesleges kör átmeneti hibája sorba állítana egy
      // amúgy tökéletes árfolyammal mentendő kiadást.
      //
      // Az `isEstimatedRate` önmagában NEM elég szűrő: egy öröklött, korabeli
      // árfolyam ugyanúgy „öreg", mint egy elavult becslés. Ezért a
      // `rateResolvedByForm` az első feltétel — az mondja meg, hogy egyáltalán
      // a MI feloldásunkról beszélünk-e (végső re-review U2).
      if (rateResolvedByForm && isEstimatedRate(body)) {
        try {
          body = await withFreshRate(body);
        } catch (error) {
          if (!(error instanceof RateResolutionError)) {
            throw error;
          }
          // Az árfolyam nem dőlt el véglegesen (hálózathiba, átmeneti
          // szerverhiba a `/rates` felé) — ilyenkor nem POST-olhatunk
          // becslést véglegesként. A tételt sorba állítjuk: a szinkron-motor
          // a feltöltéskor újra megkísérli a friss árfolyamot, és addig a sor
          // `pending`, tehát a felület `≈`-vel és az elszámolás
          // figyelmeztetéssel jelzi, hogy az érték még nem végleges.
          const pendingEntry = await enqueue({
            type: 'create',
            eventId,
            clientId,
            payload: body,
            rateResolvedByForm,
          });
          this.upsertExpense(toPendingExpense(pendingEntry));
          return null;
        }
      }
      try {
        const expense = await apiClient.post(`/events/${eventId}/expenses`, body, {
          schema: expenseResponseSchema,
        });
        this.upsertExpense(expense);
        return expense;
      } catch (error) {
        if (error instanceof ApiError || error instanceof ZodError) {
          // A szerver válaszolt (validációs hiba, 404), vagy 2xx-et adott,
          // amit nem tudunk a várt sémaként értelmezni: egyik sem
          // hálózathiba, ezt a felhasználónak most kell megoldania, nem
          // sorbanállítással — egy ténylegesen sikerült írást így sem
          // állítanánk sorba még egyszer.
          throw error;
        }
        const entry = await enqueue({
          type: 'create',
          eventId,
          clientId,
          payload: body,
          rateResolvedByForm,
        });
        this.upsertExpense(toPendingExpense(entry));
        return null;
      }
    },

    /**
     * @param {string} id
     * @param {object} input
     * @param {{ rateResolvedByForm?: boolean }} [rateMeta] kliensoldali kísérő
     * tény az árfolyam eredetéről (lásd `ExpenseModal.vue`). Szerkesztésnél az
     * alapérték `false`: ha a hívó nem mondja, hogy az árfolyamot most oldotta
     * fel, akkor a kiadás korabeli árfolyamát őrizzük meg — abból a puszta
     * adatból ez ugyanis nem derül ki (végső re-review U2).
     */
    async updateExpense(id, input, rateMeta = {}) {
      const rateResolvedByForm = rateMeta.rateResolvedByForm ?? false;
      let body = input;
      // Ugyanaz a szabály, mint a `createExpense`-ben, és ugyanabból az okból:
      // ha a szerkesztés SAJÁT árfolyam-feloldást hozott (a felhasználó
      // pénznemet váltott), és az feltehetően becslés, akkor a mentés
      // pillanatában újra feloldjuk — enélkül egy sikeres PATCH véglegesként
      // tárolna egy elavult becslést, `pending` jelzés, `≈` és
      // elszámolás-figyelmeztetés nélkül. Ez nem elméleti: a `/rates`
      // `502 RATE_UNAVAILABLE`-je (kimerült kvóta) mellett az `/expenses`
      // PATCH tökéletesen működik, tehát pontosan ez a helyzet állhat elő.
      //
      // Ha a szerkesztés NEM nyúlt az árfolyamhoz (`rateResolvedByForm`
      // hamis), itt nincs mit tenni: az űrlapon a kiadás korabeli árfolyama
      // van, azt meg kell őrizni — az `isEstimatedRate` erre igazat adna
      // (öreg árfolyam), és pont ez volt a hiba (végső re-review U2).
      if (rateResolvedByForm && isEstimatedRate(body)) {
        try {
          body = await withFreshRate(body);
        } catch (error) {
          if (!(error instanceof RateResolutionError)) {
            throw error;
          }
          const existing = this.expenses.find((expense) => expense.id === id);
          if (!existing) {
            throw error;
          }
          // Az árfolyam nem dőlt el véglegesen: a `createExpense` mintájára
          // inkább sorba állítjuk, mint hogy becslést PATCH-oljunk
          // véglegesként. A sor `pending`, tehát a felület `≈`-vel és az
          // elszámolás figyelmeztetésével jelzi, hogy még nem végleges.
          await enqueue({
            type: 'update',
            eventId: existing.eventId,
            expenseId: id,
            payload: body,
            rateResolvedByForm,
          });
          this.upsertExpense(toPendingUpdate(existing, body));
          return null;
        }
      }
      try {
        const updated = await apiClient.patch(`/expenses/${id}`, body, {
          schema: expenseResponseSchema,
        });
        this.upsertExpense(updated);
        return updated;
      } catch (error) {
        if (error instanceof ApiError || error instanceof ZodError) {
          throw error;
        }
        const existing = this.expenses.find((expense) => expense.id === id);
        if (!existing) {
          // Nincs ismert eseményazonosító, amire a bejegyzést rá tudnánk
          // kötni: a `listByEvent` sosem találná meg, a feltöltő sosem tudná
          // hova irányítani. Inkább hibát mutatunk, mint hogy egy ilyen,
          // soha nem szinkronizálódó bejegyzésben veszne el a módosítás.
          throw error;
        }
        await enqueue({
          type: 'update',
          eventId: existing.eventId,
          expenseId: id,
          payload: body,
          rateResolvedByForm,
        });
        this.upsertExpense(toPendingUpdate(existing, body));
        return null;
      }
    },

    /**
     * @param {string} id
     */
    async deleteExpense(id) {
      const existing = this.expenses.find((expense) => expense.id === id);
      try {
        await apiClient.delete(`/expenses/${id}`);
        this.removeExpense(id);
      } catch (error) {
        if (error instanceof ApiError || error instanceof ZodError) {
          throw error;
        }
        if (!existing) {
          // Ugyanaz az elv, mint a szerkesztésnél: ismert eseményazonosító
          // nélkül a bejegyzés soha nem szinkronizálódna — inkább hibát
          // mutatunk.
          throw error;
        }
        await enqueue({ type: 'delete', eventId: existing.eventId, expenseId: id });
        this.removeExpense(id);
      }
    },
  },
});
