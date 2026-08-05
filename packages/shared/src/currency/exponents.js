/**
 * ISO 4217 tizedesjegy-szám (exponens) pénznemenként. Minden összeg a pénznem
 * legkisebb egységében (amountMinor) tárolódik ennek megfelelően:
 * HUF = forint (0 tizedes), EUR/USD/CHF = cent (2 tizedes).
 *
 * @type {Record<string, number>}
 */
export const CURRENCY_MINOR_EXPONENTS = {
  HUF: 0,
  EUR: 2,
  USD: 2,
  CHF: 2,
  GBP: 2,
  JPY: 0,
  PLN: 2,
  CZK: 2,
  RON: 2,
};

/**
 * A támogatott ISO 4217 pénznemkódok listája.
 * @type {string[]}
 */
export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_MINOR_EXPONENTS);

/**
 * Az elszámolás mindig ebben a pénznemben történik, eseményenkénti
 * alapvaluta-választás nélkül. A kiadások bármely támogatott pénznemben
 * rögzíthetők, az alapösszeg mindig ide kerül átváltva.
 * @type {string}
 */
export const SETTLEMENT_CURRENCY = 'HUF';

/**
 * Egy kiadás összegének felső korlátja a pénznem nagyobb egységében
 * (legfeljebb 6 számjegy), pl. HUF-ban 999999 Ft, EUR-ban 999999 EUR. Sem a
 * frontend input, sem a backend validáció nem enged ennél nagyobb összeget —
 * ez zárja ki az abszurd/hibás értékeket (pl. véletlenül beírt extra
 * számjegyek).
 * @type {number}
 */
export const MAX_EXPENSE_MAJOR_AMOUNT = 999999;

/**
 * Visszaadja egy pénznem tizedesjegy-számát (exponensét).
 * @param {string} currency ISO 4217 kód, pl. "HUF"
 * @returns {number}
 */
export function getCurrencyExponent(currency) {
  const exponent = CURRENCY_MINOR_EXPONENTS[currency];
  if (exponent === undefined) {
    throw new Error(`Ismeretlen pénznem: ${currency}`);
  }
  return exponent;
}
