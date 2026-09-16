// Evidence-support generator: produces real PNG image bytes for provider tests
// without shipping binary fixtures into the repo. Two images:
//   renderNotesImage()  — blocky "handwritten" note card with jitter + noise,
//                         legible enough for a vision model to transcribe.
//   renderNoiseImage()  — pure random gray noise: an "unreadable photo" used to
//                         exercise the app-side validation failure handling
//                         against a REAL Gemini call (not a fake).
//
// PNG is encoded here with zlib (deflate + crc32, Node ≥ 22.15), no image deps.

import { deflateSync } from "node:zlib";

// PNG requires an IEEE 802.3 (CRC-32) over each chunk. Computed locally — a
// tiny table-driven implementation is deterministic and avoids depending on
// Node's zlib.crc32 exposing signed/unsigned inconsistently across versions.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// 5x7 bitmap glyphs, 7 rows of 5-bit masks (leftmost column = bit 4). Only the
// subset needed for the test note card is defined — this is test-fixture
// plumbing, so no attempt is made to look like a real handwriting font.
const GLYPHS: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [14, 17, 1, 14, 1, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  A: [14, 17, 17, 31, 17, 17, 17],
  E: [31, 16, 16, 30, 16, 16, 31],
  H: [17, 17, 17, 31, 17, 17, 17],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 21, 19, 19, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  X: [17, 17, 10, 4, 10, 17, 17],
  "+": [0, 0, 4, 31, 4, 0, 0],
  "=": [0, 0, 31, 0, 31, 0, 0],
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const SCALE = 8;
const CHAR_PITCH = GLYPH_W * SCALE + 10;
const LINE_PITCH = GLYPH_H * SCALE + 34;

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw);

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function drawLine(
  buf: Buffer,
  width: number,
  text: string,
  x0: number,
  y0: number,
): void {
  const height = buf.length / (width * 4);
  for (const ch of text) {
    const glyph = GLYPHS[ch.toUpperCase()] ?? GLYPHS[" "];
    const dx = Math.floor(Math.random() * 3) - 1; // hand-written jitter
    const dy = Math.floor(Math.random() * 3) - 1;
    for (let r = 0; r < GLYPH_H; r++) {
      const mask = glyph[r];
      for (let c = 0; c < GLYPH_W; c++) {
        if (((mask >> (4 - c)) & 1) === 0) continue;
        for (let sy = 0; sy < SCALE; sy++) {
          for (let sx = 0; sx < SCALE; sx++) {
            const px = x0 + c * SCALE + sx + dx;
            const py = y0 + r * SCALE + sy + dy;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const o = (py * width + px) * 4;
            buf[o] = 30;
            buf[o + 1] = 30;
            buf[o + 2] = 30;
            buf[o + 3] = 255;
          }
        }
      }
    }
    x0 += CHAR_PITCH;
  }
}

export function renderNotesImage(): Buffer {
  const width = 760;
  const height = 300;
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 250;
    buf[i + 1] = 250;
    buf[i + 2] = 250;
    buf[i + 3] = 255;
  }
  // faint paper noise so it reads as a photo, not a synthetic canvas
  for (let i = 0; i < buf.length; i += 4) {
    if (Math.random() < 0.12) {
      const v = 235 + Math.floor(Math.random() * 18);
      buf[i] = v;
      buf[i + 1] = v;
      buf[i + 2] = v;
    }
  }
  drawLine(buf, width, "MATH NOTES", 90, 26);
  drawLine(buf, width, "2x + 3 = 7", 90, 26 + LINE_PITCH);
  drawLine(buf, width, "x = 2", 90, 26 + LINE_PITCH * 2);
  return encodePng(width, height, buf);
}

export function renderNoiseImage(): Buffer {
  const size = 400;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < buf.length; i += 4) {
    const v = 60 + Math.floor(Math.random() * 130);
    buf[i] = v;
    buf[i + 1] = v;
    buf[i + 2] = v;
    buf[i + 3] = 255;
  }
  return encodePng(size, size, buf);
}