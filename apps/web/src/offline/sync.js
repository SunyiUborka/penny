import { Network } from '@capacitor/network';
import { ZodError } from 'zod';
import { expenseResponseSchema, SETTLEMENT_CURRENCY } from '@filler/shared';
import { apiClient, ApiError } from '../api/client.js';
import { listEntries, markFailed, refreshCounts, removeEntry } from './outbox.js';
import { fetchFreshRate } from './rates.js';
import { useExpensesStore } from '../stores/expenses.js';

/** Egyszerre csak egy futás legyen, különben ugyanaz az elem kétszer menne fel. */
let running = false;

/**
 * Azok a HTTP-státuszkódok, amik az elemről magáról szóló, végleges
 * verdiktet jelentenek: a kliens 400-as (érvénytelen) kérést küldött, a
 * célesemény/kiadás 404-gyel eltűnt, vagy a `clientId` 409-cel más
 * eseményhez van kötve (Task 1). Ugyanezzel a tartalommal újraküldve ez
 * mindig ugyanígy elbukna — ezt nem szabad automatikusan újrapróbálni.
 * @type {ReadonlySet<number>}
 */
const PAYLOAD_VERDICT_STATUS_CODES = new Set([400, 404, 409]);

/**
 * Igaz, ha a hiba az elemről szóló végleges verdikt (lásd fent).
 * @param {ApiError} error
 * @returns {boolean}
 */
function isPayloadVerdict(error) {
  return PAYLOAD_VERDICT_STATUS_CODES.has(error.statusCode);
}

/**
 * Az árfolyam frissítése közben történt, a kiadás írásáról semmit nem
 * mondó hiba (hálózathiba a `/rates` felé, vagy a válasza nem illik a
 * sémára). Szándékosan külön típus, nem puszta továbbdobás: a `syncOutbox`
 * osztályozója enélkül a kiváltó kivétel TÍPUSA alapján döntene — egy innen
 * származó `ZodError`-t tévesen a KIADÁS-válasz kontraktus-töréseként
 * kezelne, és véglegesen `failed`-be tenne egy olyan kiadást, amit még fel
 * sem küldtünk. Ez a típus a hiba EREDETE alapján osztályoz, nem a
 * TÍPUSA alapján — a `syncOutbox` ezt ugyanúgy retryable-nek veszi, mint
 * egy sima hálózathibát. Ne egyszerűsítsük vissza puszta `throw error`-ra;
 * az eredeti hiba a `cause`-ban megmarad diagnosztikai célra.
 */
class RateResolutionError extends Error {
  /**
   * @param {unknown} cause
   */
  constructor(cause) {
    super('Az árfolyam frissítése nem sikerült.');
    this.name = 'RateResolutionError';
    this.cause = cause;
  }
}

/**
 * A sorbanállított módosítások feltöltése, létrehozásuk sorrendjében.
 *
 * A `failed` állapotú elemeket nem próbáljuk újra automatikusan: ezek
 * felhasználói döntést igényelnek (lásd a Szinkronizálás képernyőt).
 *
 * Egyszerre csak egy futás engedélyezett (lásd a `running` jelzőt): ha ezt a
 * hívást egy már folyamatban lévő futás közben kezdeményezték (pl. a
 * Szinkronizálás képernyő "Feltöltés most" gombja ütközik egy a háttérben,
 * hálózat-visszatérésre vagy előtérbe kerülésre induló automatikus
 * szinkronnal), ez a hívás azonnal, munka nélkül tér vissza — de ezt a
 * `skipped: true` jelzővel is kimondja, nem csak a nullázott
 * `uploaded`/`failed` számokkal. E nélkül a hívó (a Szinkronizálás képernyő)
 * nem tudná megkülönböztetni "nem volt mit feltölteni" és "most éppen egy
 * másik futás dolgozik" között, és hamisan azt jelentené a felhasználónak,
 * hogy semmi sem történt, miközben a háttérben feltöltés zajlik.
 * @returns {Promise<{ uploaded: number, failed: number, skipped: boolean }>}
 */
export async function syncOutbox() {
  if (running) {
    return { uploaded: 0, failed: 0, skipped: true };
  }
  running = true;
  let uploaded = 0;
  let failed = 0;

  try {
    const entries = await listEntries();
    for (const entry of entries) {
      if (entry.status !== 'pending') {
        continue;
      }

      let response;
      try {
        response = await uploadEntry(entry);
      } catch (error) {
        if (error instanceof RateResolutionError) {
          // Az árfolyam-lekérés hibázott — ez semmit nem mond a KIADÁS
          // írásáról, hiszen az még meg sem történt. Ugyanúgy retryable,
          // mint egy hálózathiba: az elem `pending` marad, itt megállunk.
          break;
        }
        if (error instanceof ApiError && !isPayloadVerdict(error)) {
          // A szerver válaszolt, de nem az elemről mond véleményt: a 401/403
          // azt jelenti, a munkamenet járt le (nem hogy ez a kiadás hibás),
          // a 408/429 és minden 5xx pedig azt, hogy a szerver (vagy egy
          // közte lévő proxy) hibázott. Ugyanez a hiba a következő
          // próbálkozáskor is bekövetkezne, és minden mögötte lévő elem is
          // ugyanebbe a falba ütközne — ezért az elem `pending` marad, és
          // itt megállunk, ahelyett hogy hamisan `failed`-nek jelölnénk (ami
          // soha többé nem próbálkozna újra).
          break;
        }
        if (error instanceof ApiError || error instanceof ZodError) {
          // `ApiError` itt már csak a 400/404/409 lehet: az elemről szóló
          // végleges verdikt. A `ZodError` pedig azt jelenti, hogy a szerver
          // 2xx-et adott — az írás tehát megtörtént —, de a válasz teste nem
          // illik a várt sémára: ez egy megtört szerződés, amit ugyanúgy nem
          // old meg az újrapróbálkozás. Egyik esetben sem mehet fel az elem
          // ilyen formában — megtartjuk, de a felhasználó dönt a sorsáról.
          await markFailed(entry.id, error.message);
          failed += 1;
        } else {
          // Hálózathiba: a sor marad pending, a következő futás újrapróbálja.
          break;
        }
        continue;
      }

      // Az outbox-sor törlése és a lista frissítése már nem hálózati kérés —
      // ha itt hibázik (pl. tele van az IndexedDB, vagy a store dob), az nem
      // jelenti azt, hogy a hálózat elhalt volna. Külön blokkban kezeljük,
      // hogy egy ilyen hiba ne törje meg (ne `break`-elje) a teljes futást
      // úgy, mintha offline lennénk — a szerver-oldali írások idempotensek
      // (Task 1, illetve a lenti 404-kezelés törlésnél), tehát egy sikertelen
      // helyi törlés után a következő futás bátran megismételheti.
      try {
        await removeEntry(entry.id);
      } catch (cleanupError) {
        console.error('Nem sikerült törölni a feltöltött outbox-bejegyzést:', cleanupError);
        continue;
      }
      uploaded += 1;
      try {
        applyUploadResult(entry, response);
      } catch (storeError) {
        console.error('A lista frissítése a feltöltés után nem sikerült:', storeError);
      }
    }
  } finally {
    running = false;
    await refreshCounts();
  }

  return { uploaded, failed, skipped: false };
}

/**
 * A sikeres feltöltés eredményének megjelenítése a listában. Nem az SSE
 * visszhangra várunk: a natív fetch-stream újracsatlakozása akár 30
 * másodpercig is elhúzódhat, ez alatt a kiadás láthatóan eltűnne a
 * listából. A törlés nem jár ide: azt a store már a sorbaállításkor,
 * eagerly eltávolította (lásd `stores/expenses.js` `deleteExpense`-e).
 * @param {object} entry
 * @param {object | null} response a szerver válasza (törlésnél nincs)
 * @returns {void}
 */
function applyUploadResult(entry, response) {
  const store = useExpensesStore();
  // A store egyetlen `expenses` tömböt tart, mindig a ténylegesen megnyitott
  // esemény listáját — nem particionál eseményenként. Ha a szinkron épp egy
  // másik (nem az itt látott) esemény sorbaállított elemét tölti fel, a
  // válasz beszúrása tévedésből átkeverné egy teljesen más esemény kiadását
  // a most látott listába. A store már nyilvántartja, melyik eseményt nézi
  // éppen ez a lap — ezt kérdezzük le az `isViewingEvent` accessoron, nem
  // egy saját, a lista tartalmából (pl. "benne van-e már a szintetikus sor")
  // kitalált közelítést vezetünk be: két párhuzamos nyilvántartás ugyanarról
  // csak széttartana (lásd a Task 5 tanulságait).
  if (!store.isViewingEvent(entry.eventId)) {
    // Ez a lap nem ezt az eseményt mutatja — a store-nak nincs itt dolga. Ha
    // create volt, a szintetikus `pending:<uuid>` sor eltávolítása is
    // felesleges: ebben a store-példányban soha nem is jött létre.
    return;
  }
  if (entry.type === 'create') {
    // A store `upsertExpense`-e az `id` alapján dolgozik, a szerver viszont
    // saját azonosítót ad a létrehozott kiadásnak — emiatt ez sosem
    // cserélné le a szintetikus sort, a felhasználó duplán látná a
    // kiadást. A valódi sort a szerver válaszából szúrjuk be, a
    // szintetikusat pedig itt távolítjuk el. Ez akkor is lefut, ha ez a lap
    // csak MÁSIK tabként nézi ugyanezt az eseményt (nem ő állította sorba a
    // létrehozást) — a szintetikus sor eltávolítása ilyenkor ártalmatlan
    // no-op, a valódi sor beszúrása viszont pont ezt a lapot is megkíméli a
    // 30 másodpercig is elhúzódó SSE-visszhangra várástól.
    store.upsertExpense(response);
    store.removeExpense(`pending:${entry.id}`);
  }
  if (entry.type === 'update') {
    // Ugyanez a `pending` jelző eltüntetésére: a szerkesztés a meglévő sort
    // helyben jelölte `pending: true`-ra (lásd `toPendingUpdate`), a szerver
    // válasza pedig ezt a jelzőt is lecseréli.
    store.upsertExpense(response);
  }
}

/**
 * Egyetlen bejegyzés feltöltése.
 * @param {object} entry
 * @returns {Promise<object | null>} a szerver válasza (törlésnél `null`)
 */
async function uploadEntry(entry) {
  if (entry.type === 'delete') {
    try {
      await apiClient.delete(`/expenses/${entry.expenseId}`);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        // Már nincs mit törölni: vagy ezt a törlést korábban már
        // feltöltöttük, csak a válasz veszett el (megszakadt kapcsolat), vagy
        // valaki más törölte közben ugyanazt a kiadást. A szándék —
        // "ez a kiadás ne létezzen" — mindkét esetben teljesült, ez nem
        // hibaállapot, amiről a felhasználónak döntenie kellene.
        return null;
      }
      throw error;
    }
    return null;
  }

  const payload = await withFreshRate(entry.payload);

  if (entry.type === 'create') {
    return apiClient.post(`/events/${entry.eventId}/expenses`, payload, {
      schema: expenseResponseSchema,
    });
  }

  return apiClient.patch(`/expenses/${entry.expenseId}`, payload, {
    schema: expenseResponseSchema,
  });
}

/**
 * Devizás kiadásnál a feltöltéskor érvényes árfolyammal dolgozunk: a felvitel
 * pillanatában legfeljebb egy cache-elt becslés állt rendelkezésre.
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function withFreshRate(payload) {
  if (payload.currency === SETTLEMENT_CURRENCY || payload.rateSource === 'manual') {
    return payload;
  }
  try {
    const fresh = await fetchFreshRate(payload.currency, SETTLEMENT_CURRENCY);
    return { ...payload, exchangeRate: fresh.rate, rateFetchedAt: fresh.fetchedAt };
  } catch (error) {
    if (error instanceof ApiError) {
      // A szerver ténylegesen nemet mondott az árfolyamra (pl. nem
      // támogatott devizapár) — ez végleges verdikt, a becsléssel megyünk
      // tovább: ez még mindig jobb, mint a kiadást a sorban ragasztani.
      return payload;
    }
    // Hálózathiba vagy sémaeltérés: nem tudjuk, mi a friss árfolyam, de ez
    // nem végleges — nem szabad csendben ráfogni a becslésre, hogy az a
    // végleges érték. Az elemnek `pending`-en kell maradnia, hogy a
    // következő (remélhetőleg sikeres) próbálkozáskor valódi árfolyammal
    // menjen fel. A `RateResolutionError`-ba csomagolva dobjuk tovább, nem
    // nyersen: a `syncOutbox` osztályozója különben a kiváltó kivétel
    // TÍPUSA (pl. egy itteni `ZodError`) alapján tévesen a KIADÁS-válasz
    // kontraktus-töréseként kezelné, és véglegesen `failed`-be tenne egy
    // olyan kiadást, amit még fel sem küldtünk.
    throw new RateResolutionError(error);
  }
}

/**
 * Automatikus szinkron: hálózat visszatérésekor és előtérbe kerüléskor.
 * @returns {Promise<void>}
 */
export async function startAutoSync() {
  // Előtérbe kerüléskor is szinkronizálunk. Szándékosan `visibilitychange`,
  // nem a `@capacitor/app` `appStateChange`-e: az élő-frissítés kör óta a
  // stream újrakapcsolódása és a pótló újratöltés is ezen az eseményen áll
  // (lásd `apps/web/src/stores/expenses.js`), és két párhuzamos
  // előtérbe-kerülés-mechanizmus csak széttartani tudna.
  //
  // A SORREND ITT LÉNYEGES, ne cseréljük vissza. Ez a listener és a lentebbi
  // induló `syncOutbox()` az a két dolog, ami nélkül a sorbanállítás
  // használhatatlan — a hálózatfigyelő ezekhez képest csak egy kényelmi
  // gyorsítás (előbb indul a feltöltés, mint a következő előtérbe kerülés).
  // Ezért a nem létfontosságú rész SOSEM állhat a létfontosságú elé: a
  // `Network.addListener` egy natív plugin-hívás, ami elutasított Promise-t
  // ad, ha a plugin nincs regisztrálva az adott platformon (a Capacitor
  // ilyenkor `"Network" plugin is not implemented on android` kivételt dob a
  // hídon) — ha ez az első utasítás, egyetlen hiányzó natív plugin viszi
  // magával a `visibilitychange` figyelőt és az induló szinkront is, és az
  // egész automatikus feltöltés csendben halott marad (lásd a végső review
  // C1 pontját).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncOutbox().catch(() => {});
    }
  });

  try {
    await Network.addListener('networkStatusChange', (status) => {
      if (status.connected) {
        syncOutbox().catch(() => {
          // A szinkron hibája nem törheti meg az appot; az elemek a sorban
          // maradnak, a következő alkalommal újrapróbáljuk.
        });
      }
    });
  } catch (error) {
    // Nincs hálózatfigyelő (a natív plugin nincs regisztrálva, vagy a hídon
    // hibázott a feliratkozás). Ez degradált, de nem végzetes állapot: a
    // kapcsolat visszatérésére nem indul azonnal feltöltés, viszont az
    // előtérbe kerülés, az indulás és a Szinkronizálás képernyő „Feltöltés
    // most” gombja mind működik tovább. Csak naplózzuk.
    console.error('A hálózatfigyelő feliratkozás nem sikerült:', error);
  }

  await syncOutbox();
}
