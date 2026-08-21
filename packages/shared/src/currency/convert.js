import { Decimal } from 'decimal.js';
import { z } from 'zod';
import {
  amountMinorSchema,
  currencyCodeSchema,
  exchangeRateStringSchema,
} from '../schemas/money.js';
import { getCurrencyExponent, SETTLEMENT_CURRENCY } from './exponents.js';

const convertMinorAmountInputSchema = z.object({
  amountMinor: amountMinorSchema,
  rate: exchangeRateStringSchema,
  sourceCurrency: currencyCodeSchema,
  targetCurrency: currencyCodeSchema,
});

/**
 * @typedef {{
 *   amountMinor: number,
 *   rate: string,
 *   sourceCurrency: string,
 *   targetCurrency: string,
 * }} ConvertMinorAmountInput
 */

/**
 * Átváltja egy összeget a forrás pénznem legkisebb egységéből a cél pénznem
 * legkisebb egységébe, decimal.js-szel, fél felfelé kerekítéssel:
 * targetAmountMinor = round(amountMinor × rate × 10^(targetExp − sourceExp)).
 *
 * @param {ConvertMinorAmountInput} input
 * @returns {number} egész szám, a cél pénznem legkisebb egységében
 */
export function convertMinorAmount(input) {
  const { amountMinor, rate, sourceCurrency, targetCurrency } =
    convertMinorAmountInputSchema.parse(input);

  const sourceExponent = getCurrencyExponent(sourceCurrency);
  const targetExponent = getCurrencyExponent(targetCurrency);

  const scale = new Decimal(10).pow(targetExponent - sourceExponent);
  const result = new Decimal(amountMinor).times(rate).times(scale);

  return result.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

const convertExpenseAmountsInputSchema = z
  .object({
    amountMinor: amountMinorSchema.positive(),
    items: z
      .array(
        z
          .object({ amountMinor: amountMinorSchema.positive() })
          // Teherviselő passthrough: a visszatérési tételek `...item`
          // spreaddel jönnek létre (lásd lejjebb), tehát a `description` és a
          // `sharedWithIds` KIZÁRÓLAG emiatt marad a tételen. Ha ez törlődik,
          // a store `toPendingExpense`/`toPendingUpdate`-je osztozók nélküli
          // tételeket kap, a `computeSettlement` bemeneti sémája dob, és egy
          // sorbanálló tételes számla az egész esemény elszámolását hibába
          // viszi. NE töröld.
          .passthrough(),
      )
      .min(1)
      .optional(),
    currency: currencyCodeSchema,
    exchangeRate: exchangeRateStringSchema,
  })
  // A hívók teljes kiadás-payloadot adnak át (dátum, fizető, osztozók is
  // benne van) — a `.passthrough()` megtartja a top-level extra kulcsokat,
  // tehát a függvény hívható a teljes payloaddal, szűrés nélkül. Ez a
  // visszatérési érték szempontjából ártalmatlan, mert a törzs csak a négy
  // ismert mezőt (amountMinor, items, currency, exchangeRate) destrukturálja.
  .passthrough();

/**
 * Egy kiadás (és tételei) forint-összegének kiszámítása. Ez a **pénzlogika
 * egyetlen helye** erre a számításra: a backend `buildExpenseData`-ja, a
 * kliens sorbanállított-előnézete és az űrlap forint-előnézete is ezt hívja.
 *
 * Devizás kiadásnál minden tétel KÜLÖN váltódik a kiadás egyetlen
 * árfolyamával, és a kiadás `baseAmountMinor`-ja a tételek forint-összegeinek
 * ÖSSZEGE — nem a végösszeg egyszeri átváltása. Ez nem stílus kérdése: az
 * elszámolás a `baseAmountMinor`-t írja a fizető „kifizette" oldalára, a
 * tételekből számolt részeket pedig a tartozás oldalára. Két különböző
 * kerekítésből néhány fillér elszivárogna, és megsérülne a
 * `computeSettlement` invariánsa, hogy az egyenlegek összege pontosan 0.
 *
 * @param {{ amountMinor: number, items?: object[], currency: string, exchangeRate: string }} input
 * @returns {{ baseAmountMinor: number, items: object[] | undefined }}
 */
export function convertExpenseAmounts(input) {
  const { amountMinor, items, currency, exchangeRate } =
    convertExpenseAmountsInputSchema.parse(input);

  const toBaseAmountMinor = (minorAmount) =>
    currency === SETTLEMENT_CURRENCY
      ? minorAmount
      : convertMinorAmount({
          amountMinor: minorAmount,
          rate: exchangeRate,
          sourceCurrency: currency,
          targetCurrency: SETTLEMENT_CURRENCY,
        });

  if (!items) {
    return { baseAmountMinor: toBaseAmountMinor(amountMinor), items: undefined };
  }

  const convertedItems = items.map((item) => ({
    ...item,
    baseAmountMinor: toBaseAmountMinor(item.amountMinor),
  }));

  return {
    baseAmountMinor: convertedItems.reduce((sum, item) => sum + item.baseAmountMinor, 0),
    items: convertedItems,
  };
}
