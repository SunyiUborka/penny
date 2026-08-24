import { z } from 'zod';
import { personIdSchema } from './money.js';

export const CATEGORY_COLORS = ['indigo', 'plum', 'teal', 'rust', 'olive', 'slate'];

export const MAX_CATEGORY_NAME_LENGTH = 32;

export const MAX_EXPENSE_CATEGORIES = 10;

export const categoryColorSchema = z.enum(CATEGORY_COLORS);

const categoryNameSchema = z
  .string()
  .trim()
  .min(1, 'A kategória neve nem lehet üres.')
  .max(
    MAX_CATEGORY_NAME_LENGTH,
    `A kategória neve legfeljebb ${MAX_CATEGORY_NAME_LENGTH} karakter lehet.`,
  );

export const createCategoryBodySchema = z.object({
  name: categoryNameSchema,
  color: categoryColorSchema,
});

export const updateCategoryBodySchema = z
  .object({
    name: categoryNameSchema.optional(),
    color: categoryColorSchema.optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.color !== undefined,
    'Legalább egy módosítandó mező szükséges.',
  );

export const categoryResponseSchema = z.object({
  id: personIdSchema,
  eventId: personIdSchema,
  name: z.string(),
  color: categoryColorSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const categoryListResponseSchema = z.array(categoryResponseSchema);

export const expenseCategoryIdsSchema = z
  .array(personIdSchema)
  .max(
    MAX_EXPENSE_CATEGORIES,
    `Egy kiadásra legfeljebb ${MAX_EXPENSE_CATEGORIES} kategória tehető.`,
  )
  .refine(
    (ids) => new Set(ids).size === ids.length,
    'A kategóriák nem szerepelhetnek duplikáltan.',
  );
