import { CATEGORY_COLORS, isHexCategoryColor } from '@filler/shared';
import { hexToOklch, oklchToHex } from './oklch.js';

const LIGHT_LIGHTNESS = 0.47;
const DARK_LIGHTNESS = 0.74;
const MAX_CHROMA = 0.15;

let lightDarkSupported = null;

/**
 * @returns {boolean}
 */
function supportsLightDark() {
  if (lightDarkSupported === null) {
    lightDarkSupported =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('color', 'light-dark(#000000, #ffffff)');
  }
  return lightDarkSupported;
}

/**
 * @param {string} hex `#rrggbb`
 * @returns {{ light: string, dark: string }}
 */
export function categoryHexPair(hex) {
  const { c, h } = hexToOklch(hex);
  const chroma = Math.min(c, MAX_CHROMA);
  return {
    light: oklchToHex({ l: LIGHT_LIGHTNESS, c: chroma, h }),
    dark: oklchToHex({ l: DARK_LIGHTNESS, c: chroma, h }),
  };
}

/**
 * @param {string | null | undefined} color
 * @returns {Record<string, string>}
 */
export function categoryColorStyle(color) {
  if (!color) {
    return {};
  }
  if (CATEGORY_COLORS.includes(color)) {
    return { '--cat-color': `var(--cat-${color})` };
  }
  if (!isHexCategoryColor(color)) {
    return {};
  }
  const pair = categoryHexPair(color);
  return {
    '--cat-color': supportsLightDark() ? `light-dark(${pair.light}, ${pair.dark})` : pair.light,
  };
}

/**
 * @param {string | null | undefined} color
 * @returns {string} `#rrggbb`, a színválasztó beviteli mezőjének
 */
export function categoryColorInputValue(color) {
  if (color && isHexCategoryColor(color)) {
    return categoryHexPair(color).light;
  }
  return '#2c6a6b';
}
