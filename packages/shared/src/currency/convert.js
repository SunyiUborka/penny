import { Decimal } from 'decimal.js';
import { z } from 'zod';
import {
  amountMinorSchema,
  currencyCodeSchema,
  exchangeRateStringSchema,
} from '../schemas/money.js';
import { getCurrencyExponent } from './exponents.js';

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
