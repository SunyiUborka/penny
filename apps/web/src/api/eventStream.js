import { apiStreamUrl } from './client.js';
import { getToken } from '../native/token.js';
import { isNativeApp } from '../utils/platform.js';

/** Az első újrakapcsolódási várakozás és a felső korlát. */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

/**
 * Ha ennyi ideig semmi nem érkezik a streamen (se üzenet, se heartbeat),
 * holtnak tekintjük a kapcsolatot. A szerver 20 másodpercenként ping-el
 * (lásd HEARTBEAT_MS az apps/api/src/routes/events.js-ben) — ez a korlát
 * ennek több mint a duplája, hogy egyetlen elveszett ping ne billentse ki
 * azonnal a kapcsolatot, de egy félig nyitva ragadt socket (pl. wifi/mobil
 * hálózatváltás közben) se maradjon észrevétlen a következő előtérbe
 * kerülésig.
 */
const HEARTBEAT_TIMEOUT_MS = 45_000;

/**
 * Meddig kell egy kapcsolatnak élnie ahhoz, hogy „bizonyítottnak” számítson,
 * és az újrakapcsolódási számláló nullázódjon. Enélkül egy olyan szerver,
 * ami elfogadja a kérést, majd azonnal EOF-ol (pl. proxy mögött épp
 * újrainduló API), a számlálót minden körben nullázná — a ciklus
 * másodpercenként pörögne, és minden `onOpen` egy teljes listafrissítést
 * váltana ki. A számláló csak akkor nullázódik, ha a kapcsolat ennyi ideig
 * ténylegesen életben marad.
 */
const ATTEMPT_RESET_MS = 3000;

/**
 * Egy SSE-kapcsolat életciklusa, platformfüggetlen felülettel.
 *
 * Böngészőben `EventSource`: same-origin kérés, a hitelesítést a httpOnly
 * session cookie adja, az újrakapcsolódás a böngészőé. A natív appban ez nem
 * járható — az `EventSource` nem tud `Authorization` fejlécet küldeni, a
 * `CapacitorHttp` által patchelt `fetch` pedig nem streamel. Ott az eredeti,
 * eltárolt `fetch`-fel olvassuk a streamet, Bearer tokennel, és az
 * újrakapcsolódás a mi dolgunk.
 *
 * @param {{
 *   path: string,
 *   onMessage: (data: string) => void,
 *   onOpen: () => void,
 *   onClose: () => void,
 * }} options
 * @returns {() => void} lezáró függvény (többször is hívható)
 */
export function openEventStream(options) {
  const url = apiStreamUrl(options.path);

  if (!isNativeApp()) {
    return openWithEventSource(url, options);
  }
  return openWithFetch(url, options);
}

/**
 * @param {string} url
 * @param {object} options
 * @returns {() => void}
 */
function openWithEventSource(url, options) {
  const source = new EventSource(url);

  source.onopen = () => {
    options.onOpen();
  };
  source.onerror = () => {
    // Az EventSource magától újrapróbálkozik a szerver `retry` mezője
    // szerint; itt csak jelezzük, hogy épp nincs kapcsolat.
    options.onClose();
  };
  source.onmessage = (message) => {
    options.onMessage(message.data);
  };

  return () => {
    source.close();
  };
}

/**
 * @param {string} url
 * @param {object} options
 * @returns {() => void}
 */
function openWithFetch(url, options) {
  const state = { closed: false, controller: null };

  runFetchStream(url, options, state).catch((error) => {
    // Ide csak váratlan hiba jut: a hálózati hibákat a ciklus maga kezeli.
    console.error('Az élő frissítés streamje leállt:', error);
    options.onClose();
  });

  return () => {
    state.closed = true;
    if (state.controller) {
      state.controller.abort();
    }
  };
}

/**
 * Újrakapcsolódó olvasó ciklus. Növekvő várakozással próbálkozik, hogy egy
 * leállt szerver ne kapjon másodpercenkénti kéréseket.
 * @param {string} url
 * @param {object} options
 * @param {{ closed: boolean, controller: AbortController | null }} state
 * @returns {Promise<void>}
 */
async function runFetchStream(url, options, state) {
  const webFetch = globalThis.CapacitorWebFetch;
  if (typeof webFetch !== 'function') {
    // A Capacitor átnevezte vagy nem tartja meg az eredeti fetch-et. Nem
    // streamelünk vakon a patchelt fetch-en (az nem stream), inkább
    // őszintén jelezzük: a kapcsolatjelző „nincs kapcsolat”-ot mutat, és a
    // lehúzásos frissítés marad az út.
    console.error('Nincs elérhető nem patchelt fetch, az élő frissítés kikapcsol.');
    options.onClose();
    return;
  }

  let attempt = 0;

  while (!state.closed) {
    const token = getToken();
    if (!token) {
      // Token nélkül a stream 401-et kapna. Nem próbálkozunk körbe-körbe: a
      // következő bejelentkezés új feliratkozást nyit.
      options.onClose();
      return;
    }

    state.controller = new AbortController();
    let authFailed = false;

    try {
      const response = await webFetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: state.controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        // Lejárt vagy visszavont token: ugyanazzal a hitelesítő adattal
        // örökké próbálkozni értelmetlen, és ez az út megkerüli az
        // apiClient meglévő 401-kezelését is (nem az `apiClient`-en megy
        // át). A következő bejelentkezés úgyis új feliratkozást nyit.
        authFailed = true;
        throw new Error(`Hitelesítés elutasítva: ${response.status}`);
      }

      if (!response.ok || !response.body) {
        throw new Error(`Váratlan stream-válasz: ${response.status}`);
      }

      options.onOpen();

      // A számlálót csak akkor nullázzuk, ha a kapcsolat ATTEMPT_RESET_MS
      // ideig ténylegesen életben marad (ld. a konstans kommentjét) — nem
      // rögtön a fejlécek megérkezésekor.
      const proveAlive = setTimeout(() => {
        attempt = 0;
      }, ATTEMPT_RESET_MS);
      try {
        await readStreamBody(response.body, options.onMessage, state);
      } finally {
        clearTimeout(proveAlive);
      }
    } catch {
      // Megszakadt vagy elutasított kapcsolat: alább újrapróbáljuk (kivéve
      // hitelesítési hibánál, ld. lent).
    }

    if (state.closed) {
      // A leiratkozás szinkron: ha idáig eljutottunk, a hívó már nem vár
      // onClose-t erre a (lezárt) feliratkozásra — egy közben megnyílt új
      // feliratkozás állapotát rontaná el.
      return;
    }

    options.onClose();

    if (authFailed) {
      return;
    }

    await delay(Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS));
    attempt += 1;
  }
}

/**
 * A választörzs olvasása és SSE-blokkokra bontása. Egy blokk üres sorral
 * záródik; a `data:` sorok törzse az üzenet, a `:` kezdetű sor heartbeat, a
 * `retry:` sor a böngésző `EventSource`-ának szól — mindkettőt eldobjuk.
 *
 * Emellett egy "watchdog" időzítőt tart karban: minden beérkező darab
 * (üzenet vagy heartbeat egyaránt) újraindítja. Ha ez lejár, a kapcsolatot
 * megszakítjuk — ez az egyetlen módja, hogy egy félig nyitva ragadt
 * socketet (a `reader.read()` az ilyet a hálózat szintjén sosem venné
 * észre) a meglévő újrakapcsolódási út feldolgozza.
 * @param {ReadableStream} body
 * @param {(data: string) => void} onMessage
 * @param {{ closed: boolean, controller: AbortController | null }} state
 * @returns {Promise<void>}
 */
async function readStreamBody(body, onMessage, state) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let watchdog = scheduleHeartbeatWatchdog(state);

  try {
    while (!state.closed) {
      const { value, done } = await reader.read();
      if (done) {
        return;
      }

      clearTimeout(watchdog);
      watchdog = scheduleHeartbeatWatchdog(state);

      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const payload = dataFromBlock(block);
        if (payload !== '') {
          onMessage(payload);
        }
        separator = buffer.indexOf('\n\n');
      }
    }
  } finally {
    clearTimeout(watchdog);
  }
}

/**
 * @param {{ controller: AbortController | null }} state
 * @returns {ReturnType<typeof setTimeout>}
 */
function scheduleHeartbeatWatchdog(state) {
  return setTimeout(() => {
    if (state.controller) {
      state.controller.abort();
    }
  }, HEARTBEAT_TIMEOUT_MS);
}

/**
 * @param {string} block egy SSE-blokk az üres sor nélkül
 * @returns {string} a `data:` sorok összefűzött törzse, vagy üres string
 */
function dataFromBlock(block) {
  return block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n');
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
