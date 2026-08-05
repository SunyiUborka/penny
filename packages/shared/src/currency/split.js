import { z } from 'zod';
import { amountMinorSchema, personIdSchema } from '../schemas/money.js';

const splitEquallyInputSchema = z.object({
  amountMinor: amountMinorSchema,
  participantIds: z.array(personIdSchema).min(1),
});

/**
 * @typedef {{ personId: string, shareMinor: number }} Share
 */

/**
 * Egyenlő arányban osztja fel az összeget a résztvevők között. Ha nem
 * osztható maradék nélkül, a maradék legkisebb egységeket determinisztikusan
 * osztja szét: a résztvevő-azonosítók szerint (string) rendezve, elölről
 * egyesével kapják meg a plusz egységet. A visszaadott részek összege
 * pontosan az összeggel egyezik, és az eredeti participantIds sorrendjét
 * követi.
 *
 * @param {{ amountMinor: number, participantIds: string[] }} input
 * @returns {Share[]}
 */
export function splitEqually(input) {
  const { amountMinor, participantIds } = splitEquallyInputSchema.parse(input);

  const count = participantIds.length;
  const baseShare = Math.floor(amountMinor / count);
  const remainder = amountMinor - baseShare * count;

  const extraRecipientIds = new Set([...participantIds].sort().slice(0, remainder));

  return participantIds.map((personId) => ({
    personId,
    shareMinor: baseShare + (extraRecipientIds.has(personId) ? 1 : 0),
  }));
}
