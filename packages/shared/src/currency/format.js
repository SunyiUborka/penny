import { z } from 'zod';
import { amountMinorSchema, currencyCodeSchema } from '../schemas/money.js';
import { getCurrencyExponent } from './exponents.js';

const formatMoneyInputSchema = z.object({
  amountMinor: amountMinorSchema,
  currency: currencyCodeSchema,
  locale: z.string().default('hu-HU'),
});

/**
 * Megjelenítésre formáz egy pénzösszeget a legkisebb egységből, Intl-lel.
 * Ez az egyetlen hely a kódbázisban, ahol pénzösszeg major egységre alakítása
 * megengedett — kizárólag kijelzés céljából, sosem tárolásra vagy számításra.
 *
 * @param {{ amountMinor: number, currency: string, locale?: string }} input
 * @returns {string}
 */
export function formatMoney(input) {
  const { amountMinor, currency, locale } = formatMoneyInputSchema.parse(input);
  const exponent = getCurrencyExponent(currency);
  const majorAmount = amountMinor / 10 ** exponent;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(majorAmount);
}
