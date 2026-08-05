import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URL: z.string().min(1),
  APP_PASSWORD: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  CURRENCY_API_KEY: z.string().min(1),
  CURRENCY_API_URL: z.string().url().default('https://api.getgeoapi.com/v2/currency/convert'),
});

/**
 * @typedef {z.infer<typeof envSchema>} Env
 */

/**
 * Betölti és validálja a környezeti változókat. Hibás/hiányzó változó esetén
 * a folyamat azonnal, beszédesen hibázzon el induláskor.
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {Env}
 */
export function loadEnv(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Érvénytelen környezeti változók:\n${details}`);
  }
  return result.data;
}
