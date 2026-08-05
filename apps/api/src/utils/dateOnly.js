/**
 * ÉÉÉÉ-HH-NN formátumú stringet UTC éjfélre eső Date-té alakít, hogy a
 * DB-ben tárolt nap pontosságú dátum időzóna-függetlenül összehasonlítható
 * legyen.
 * @param {string | null | undefined} dateOnlyString
 * @returns {Date | null}
 */
export function parseDateOnly(dateOnlyString) {
  if (!dateOnlyString) {
    return null;
  }
  return new Date(`${dateOnlyString}T00:00:00.000Z`);
}

/**
 * A mai nap ÉÉÉÉ-HH-NN alakban, UTC szerint — a napi árfolyam-cache
 * kulcsához.
 * @returns {string}
 */
export function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}
