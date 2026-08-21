import { ZodError } from 'zod';
import { healthResponseSchema } from '@filler/shared';

const PING_TIMEOUT_MS = 5000;

/**
 * Megnézi, hogy a megadott cím alatt válaszol-e Fillér-szerver. Szándékosan
 * NEM az `apiClient`-en megy: az a jelenlegi bázisútvonalat használja, és a
 * 401-re bejelentkezésre navigál — itt viszont egy még nem beállított,
 * idegen címet vizsgálunk, hitelesítés nélkül.
 *
 * A visszatérési `reason` a felület szövegét választja ki:
 * `unreachable` (nincs válasz), `timeout`, `status` (válaszol, de nem 2xx),
 * `not-filler` (válaszol, de nem a várt törzs).
 *
 * @param {string} base
 * @returns {Promise<{ ok: boolean, reason?: string, statusCode?: number }>}
 */
export async function pingServer(base) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return { ok: false, reason: 'status', statusCode: response.status };
    }
    healthResponseSchema.parse(await response.json());
    return { ok: true };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return { ok: false, reason: 'not-filler' };
    }
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
