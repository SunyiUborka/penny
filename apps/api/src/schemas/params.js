import { z } from 'zod';

export const idParamsSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Érvénytelen azonosító.'),
});
