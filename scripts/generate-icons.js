#!/usr/bin/env node
/**
 * A Fillér PWA ikonjait állítja elő: bankjegyzöld alapon papírszínű „F",
 * alatta rézszínű vonal. Se npm dependency, se rendszereszköz (ImageMagick,
 * librsvg) nem kell — a PNG-t maga írja ki a node:zlib deflate-jével.
 *
 * A generált fájlokat committeljük, tehát a build nem futtatja ezt a scriptet;
 * csak akkor kell újra lefuttatni, ha az ikon színén vagy formáján
 * változtatunk.
 *
 * Futtatás: node scripts/generate-icons.js
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(import.meta.dirname, '..', 'apps', 'web', 'public', 'icons');

const GREEN = [0x2f, 0x6b, 0x4f]; // --forint
const PAPER = [0xed, 0xee, 0xe6]; // --paper
const BRASS = [0xa9, 0x83, 0x2e]; // --brass

/** Sarokrádiusz a képméret százalékában. */
const CORNER_RADIUS_PCT = 22;

/**
 * A grafika a képméret százalékában (lásd a design spec 6. pontjának
 * táblázatát). Rajzolási sorrendben: a későbbi elem a korábbi fölé kerül.
 */
const SHAPES = [
  { color: PAPER, x0: 36, x1: 46, y0: 20, y1: 68 }, // az „F" szára
  { color: PAPER, x0: 36, x1: 68, y0: 20, y1: 29 }, // az „F" felső szára
  { color: PAPER, x0: 36, x1: 61, y0: 39, y1: 48 }, // az „F" középső szára
  { color: BRASS, x0: 32, x1: 68, y0: 74, y1: 79 }, // rézvonal
];

/** Élsimítás: ennyi × ennyi mintát veszünk pixelenként. */
const SUPERSAMPLE = 4;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

/**
 * @param {Buffer} buffer
 * @returns {number}
 */
function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

/**
 * Egy PNG chunk: hossz, típus, adat, CRC.
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * 8 bites RGBA pixelekből PNG fájl.
 * @param {number} size
 * @param {Buffer} rgba size * size * 4 byte
 * @returns {Buffer}
 */
function encodePng(size, rgba) {
  const stride = size * 4;
  // Minden képsor egy szűrő-byte-tal kezdődik; a 0 azt jelenti: nincs szűrés.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bitmélység
  ihdr[9] = 6; // színtípus: truecolor + alpha
  ihdr[10] = 0; // tömörítés: deflate
  ihdr[11] = 0; // szűrés: adaptív
  ihdr[12] = 0; // nincs interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Benne van-e a pont a lekerekített négyzetben? `radius === 0` esetén ez sima
 * négyzet-teszt.
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} radius
 * @returns {boolean}
 */
function insideRoundedRect(x, y, size, radius) {
  if (x < 0 || y < 0 || x > size || y > size) {
    return false;
  }
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Százalékos koordináta nagyítása a középpont (50%) körül.
 * @param {number} value
 * @param {number} scale
 * @returns {number}
 */
function scaleAbout(value, scale) {
  return 50 + (value - 50) * scale;
}

/**
 * Egyetlen mintavételi pont színe, vagy `null` ha átlátszó.
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} radius
 * @param {Array<{ color: number[], x0: number, x1: number, y0: number, y1: number }>} shapes
 * @returns {number[] | null}
 */
function colorAt(x, y, size, radius, shapes) {
  if (!insideRoundedRect(x, y, size, radius)) {
    return null;
  }
  // Visszafelé megyünk: az utolsó illeszkedő alakzat van legfelül.
  for (let i = shapes.length - 1; i >= 0; i -= 1) {
    const s = shapes[i];
    if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) {
      return s.color;
    }
  }
  return GREEN;
}

/**
 * @param {number} size
 * @param {{ rounded: boolean, scale: number }} options
 * @returns {Buffer} PNG
 */
function render(size, { rounded, scale }) {
  const radius = rounded ? (CORNER_RADIUS_PCT / 100) * size : 0;
  const shapes = SHAPES.map((s) => ({
    color: s.color,
    x0: (scaleAbout(s.x0, scale) / 100) * size,
    x1: (scaleAbout(s.x1, scale) / 100) * size,
    y0: (scaleAbout(s.y0, scale) / 100) * size,
    y1: (scaleAbout(s.y1, scale) / 100) * size,
  }));

  const rgba = Buffer.alloc(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let covered = 0;
      let r = 0;
      let g = 0;
      let b = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        const y = py + (sy + 0.5) / SUPERSAMPLE;
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = px + (sx + 0.5) / SUPERSAMPLE;
          const color = colorAt(x, y, size, radius, shapes);
          if (color !== null) {
            covered += 1;
            r += color[0];
            g += color[1];
            b += color[2];
          }
        }
      }

      if (covered === 0) {
        continue; // marad átlátszó
      }

      const offset = (py * size + px) * 4;
      rgba[offset] = Math.round(r / covered);
      rgba[offset + 1] = Math.round(g / covered);
      rgba[offset + 2] = Math.round(b / covered);
      rgba[offset + 3] = Math.round((covered / samples) * 255);
    }
  }

  return encodePng(size, rgba);
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 1 },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 1 },
  // Maskable: teljes kitöltésű négyzet (a launcher vágja a saját formájára),
  // a grafika 0,75×-re húzva, hogy a biztonságos zónán belül maradjon.
  { file: 'icon-maskable-512.png', size: 512, rounded: false, scale: 0.75 },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const target of TARGETS) {
  const png = render(target.size, { rounded: target.rounded, scale: target.scale });
  const outPath = path.join(OUT_DIR, target.file);
  writeFileSync(outPath, png);
  console.log(`${target.file} — ${target.size}×${target.size}, ${png.length} byte`);
}
