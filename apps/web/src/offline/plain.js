/**
 * Sima (klónozható) adatmásolat készítése az IndexedDB-be írás előtt.
 *
 * Miért kell. Az IndexedDB a strukturált klónozást használja, az pedig
 * `Proxy`-t NEM tud lemásolni — a Vue reaktív állapota viszont pontosan az:
 * egy `ref([])` `.value`-ja reaktív tömb-proxy. Ha ilyen érték kerül a
 * `put`-ba, a hívás `DataCloneError`-ral elhasal:
 * „[object Array] could not be cloned”.
 *
 * Ez nem elméleti: az űrlap `sharedWithIds` mezője reaktív tömbként jutott el
 * a sorbanállításig, tehát MINDEN sorba tett kiadás elbukott az első íráson —
 * vagyis az offline írás, az egész réteg értelme, futásidőben nem működött.
 * A hiba kódolvasással nem látszik (a típusok stimmelnek, a build zöld), csak
 * futásidőben, ezért a védelem a TÁROLÁSI HATÁRON van, nem az egyes hívási
 * helyeken: egy új hívó nem tudja elfelejteni.
 *
 * A `Date`-et szándékosan megtartjuk (a strukturált klónozás is tudja), mert
 * az árfolyam `fetchedAt`-je Date, és egy JSON-körút sztringgé rontaná —
 * onnantól a becslés-számítás (`isToday`) hibás típust kapna.
 *
 * @template T
 * @param {T} value
 * @returns {T} ugyanaz az adat, de sima objektumokból/tömbökből
 */
export function toPlain(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return /** @type {T} */ (new Date(value.getTime()));
  }
  if (Array.isArray(value)) {
    return /** @type {T} */ (value.map((item) => toPlain(item)));
  }
  /** @type {Record<string, unknown>} */
  const plain = {};
  for (const [key, item] of Object.entries(value)) {
    plain[key] = toPlain(item);
  }
  return /** @type {T} */ (plain);
}
