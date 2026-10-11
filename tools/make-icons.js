#!/usr/bin/env node

// Generates the PNG icons in src/icons without any image dependency: the shapes are rasterised
// from signed distance functions and written with a minimal PNG encoder.
// Run `node tools/make-icons.js` only when the icon design changes; the output is committed.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZES = [16, 32, 48, 96, 128];
const OUT_DIR = path.join(import.meta.dirname, '..', 'src', 'icons');

const BG_TOP = [99, 102, 241]; // #6366f1
const BG_BOTTOM = [67, 56, 202]; // #4338ca
const FG = [255, 255, 255];

// The "W", in unit coordinates.
const W_POINTS = [
  [0.2, 0.31],
  [0.35, 0.71],
  [0.5, 0.4],
  [0.65, 0.71],
  [0.8, 0.31],
];
const W_HALF_WIDTH = 0.062;

function roundedRectDistance(x, y, halfSize, radius) {
  const dx = Math.abs(x - 0.5) - (halfSize - radius);
  const dy = Math.abs(y - 0.5) - (halfSize - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

function segmentDistance(x, y, [ax, ay], [bx, by]) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(x - (ax + abx * t), y - (ay + aby * t));
}

function letterDistance(x, y) {
  let best = Infinity;
  for (let i = 0; i < W_POINTS.length - 1; i++) {
    best = Math.min(best, segmentDistance(x, y, W_POINTS[i], W_POINTS[i + 1]));
  }
  return best - W_HALF_WIDTH;
}

function render(size) {
  const samples = 4; // 4x4 supersampling
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          if (roundedRectDistance(x, y, 0.5, 0.22) > 0) continue;
          const isLetter = letterDistance(x, y) <= 0;
          const mix = (x + y) / 2;
          const colour = isLetter ? FG : BG_TOP.map((c, i) => c + (BG_BOTTOM[i] - c) * mix);
          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += 1;
        }
      }
      const offset = (py * size + px) * 4;
      if (a > 0) {
        rgba[offset] = Math.round(r / a);
        rgba[offset + 1] = Math.round(g / a);
        rgba[offset + 2] = Math.round(b / a);
        rgba[offset + 3] = Math.round((a / (samples * samples)) * 255);
      }
    }
  }
  return rgba;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(zlib.crc32(body) >>> 0, body.length + 4);
  return out;
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); // filter byte stays 0
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
