import { CATEGORY_COLORS } from '@filler/shared';

/**
 * @param {string | null | undefined} color
 * @returns {Record<string, string>} a `--cat-color` egyedi tulajdonságot beállító style objektum
 */
export function categoryColorStyle(color) {
  if (!color || !CATEGORY_COLORS.includes(color)) {
    return {};
  }
  return { '--cat-color': `var(--cat-${color})` };
}
