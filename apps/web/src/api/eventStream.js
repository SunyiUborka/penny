import { apiStreamUrl } from './client.js';
import { getToken } from '../native/token.js';
import { isNativeApp } from '../utils/platform.js';

/** Az első újrakapcsolódási várakozás és a felső korlát. */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

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

    try {
      const response = await webFetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: state.controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Váratlan stream-válasz: ${response.status}`);
      }

      attempt = 0;
      options.onOpen();
      await readStreamBody(response.body, options.onMessage, state);
    } catch {
      // Megszakadt vagy elutasított kapcsolat: alább újrapróbáljuk.
    }

    options.onClose();

    if (state.closed) {
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
 * @param {ReadableStream} body
 * @param {(data: string) => void} onMessage
 * @param {{ closed: boolean }} state
 * @returns {Promise<void>}
 */
async function readStreamBody(body, onMessage, state) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (!state.closed) {
    const { value, done } = await reader.read();
    if (done) {
      return;
    }

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
