import { z } from 'zod';

/**
 * Nap pontosságú dátum, ÉÉÉÉ-HH-NN formátumban (pl. "2026-08-03"). Az
 * események kezdő/befejező dátumára és a kiadások dátumára is ez vonatkozik.
 */
export const dateOnlyStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'A dátum ÉÉÉÉ-HH-NN formátumú kell legyen.');
