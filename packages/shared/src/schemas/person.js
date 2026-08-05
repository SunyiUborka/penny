import { z } from 'zod';
import { personIdSchema } from './money.js';

export const createPersonBodySchema = z.object({
  name: z.string().trim().min(1, 'A név nem lehet üres.'),
});

export const updatePersonBodySchema = createPersonBodySchema;

export const personResponseSchema = z.object({
  id: personIdSchema,
  name: z.string(),
  // z.coerce.date(): a backend valódi Date instance-t ad (érintetlenül
  // marad), a frontend a fetch().json() után ISO stringet kap, amit ez
  // Date-té alakít. Ugyanaz a séma validálja mindkét oldalon a határátlépést.
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const personListResponseSchema = z.array(personResponseSchema);
