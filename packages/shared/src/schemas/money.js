import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../currency/exponents.js';

/**
 * Pénzösszeg a pénznem legkisebb egységében, mindig egész szám.
 */
export const amountMinorSchema = z.number().int();

/**
 * Támogatott ISO 4217 pénznemkód.
 */
export const currencyCodeSchema = z.enum(SUPPORTED_CURRENCIES);

/**
 * Árfolyam decimális stringként, pl. "316.5000". Csak számjegyeket és
 * legfeljebb egy tizedespontot tartalmazhat, sosem lehet parseFloat-ra bízva.
 */
export const exchangeRateStringSchema = z
  .string()
  .regex(
    /^\d+(\.\d+)?$/,
    'Az árfolyam decimális számjegyekből álló string kell legyen, pl. "316.5"',
  )
  .refine((value) => Number(value) > 0, 'Az árfolyam pozitív kell legyen');

/**
 * Egy résztvevőt azonosító string (Mongo ObjectId formátumban, de a shared
 * réteg nem köti ki az ObjectId formátumot, hogy DB-független maradjon).
 */
export const personIdSchema = z.string().min(1);
