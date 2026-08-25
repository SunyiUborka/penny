/**
 * @param {number} channel 0..255
 * @returns {number} lineáris fényerő 0..1
 */
function toLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * @param {number} value lineáris fényerő 0..1
 * @returns {number} 0..255
 */
function toSrgb(value) {
  const gamma = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, gamma)) * 255);
}

/**
 * @param {string} hex `#rrggbb`
 * @returns {{ l: number, c: number, h: number }}
 */
export function hexToOklch(hex) {
  const r = toLinear(parseInt(hex.slice(1, 3), 16));
  const g = toLinear(parseInt(hex.slice(3, 5), 16));
  const b = toLinear(parseInt(hex.slice(5, 7), 16));

  const long = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const medium = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const short = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const l = 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short;
  const a = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short;
  const bb = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short;

  return { l, c: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

/**
 * @param {{ l: number, c: number, h: number }} colour
 * @returns {{ r: number, g: number, b: number, inGamut: boolean }}
 */
function oklchToRgb(colour) {
  const a = Math.cos(colour.h) * colour.c;
  const b = Math.sin(colour.h) * colour.c;

  const long = (colour.l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (colour.l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (colour.l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const r = 4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short;
  const g = -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short;
  const bl = -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short;

  const inGamut = [r, g, bl].every((value) => value >= -0.0001 && value <= 1.0001);
  return { r, g, b: bl, inGamut };
}

/**
 * @param {{ l: number, c: number, h: number }} colour
 * @returns {string} `#rrggbb`, a színezetet megtartva a gamutba szorítva
 */
export function oklchToHex(colour) {
  let chroma = colour.c;
  let rgb = oklchToRgb({ ...colour, c: chroma });
  for (let step = 0; step < 40 && !rgb.inGamut; step += 1) {
    chroma *= 0.94;
    rgb = oklchToRgb({ ...colour, c: chroma });
  }
  const hex = [rgb.r, rgb.g, rgb.b]
    .map((value) => toSrgb(value).toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}
