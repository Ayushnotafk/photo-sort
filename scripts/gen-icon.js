#!/usr/bin/env node
'use strict';
/**
 * gen-icon.js – generates build/icon.png and build/icon.ico
 * Pure Node.js, no external dependencies.
 *
 * Design: the PhotoSort camera logo (matching the SVG in index.html)
 * rendered at 512×512, saved as both PNG and a modern PNG-in-ICO file.
 * 512px satisfies macOS icns requirements; the ICO wraps the same PNG.
 */

const zlib = require('node:zlib');
const fs   = require('node:fs');
const path = require('node:path');

// ── Pixel buffer ──────────────────────────────────────────────────────────────

const SIZE = 512;
const buf  = Buffer.alloc(SIZE * SIZE * 4, 0); // RGBA, fully transparent

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}

function blendPixel(x, y, r, g, b, a) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i  = (y * SIZE + x) * 4;
  const sa = a / 255, da = buf[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa < 0.001) return;
  buf[i]     = Math.round((r * sa + buf[i]     * da * (1 - sa)) / oa);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa);
  buf[i + 3] = Math.round(oa * 255);
}

// ── Primitives ────────────────────────────────────────────────────────────────

function fillRRect(x, y, w, h, rx, r, g, b, a = 255) {
  rx = Math.min(rx, Math.floor(w / 2), Math.floor(h / 2));
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const nearL = px < x + rx, nearR = px >= x + w - rx;
      const nearT = py < y + rx, nearB = py >= y + h - rx;
      if ((nearL || nearR) && (nearT || nearB)) {
        const cx = nearL ? x + rx     : x + w - rx;
        const cy = nearT ? y + rx     : y + h - rx;
        const dx = px - cx, dy = py - cy;
        if (dx * dx + dy * dy > rx * rx) continue;
      }
      setPixel(px, py, r, g, b, a);
    }
  }
}

function fillPolygon(points, r, g, b, a) {
  const ys   = points.map(p => p[1]);
  const yMin = Math.max(0,        Math.floor(Math.min(...ys)));
  const yMax = Math.min(SIZE - 1, Math.ceil(Math.max(...ys)));
  const n    = points.length;
  for (let y = yMin; y <= yMax; y++) {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % n];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y))
        xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let j = 0; j + 1 < xs.length; j += 2)
      for (let x = Math.ceil(xs[j]); x <= Math.floor(xs[j + 1]); x++)
        blendPixel(x, y, r, g, b, a);
  }
}

function strokeCircle(cx, cy, radius, sw, r, g, b, a = 255) {
  const inner2 = (radius - sw) * (radius - sw);
  const outer2 = radius * radius;
  const bound  = Math.ceil(radius) + 1;
  for (let dy = -bound; dy <= bound; dy++)
    for (let dx = -bound; dx <= bound; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 >= inner2 && d2 <= outer2) setPixel(cx + dx, cy + dy, r, g, b, a);
    }
}

// ── Icon geometry ─────────────────────────────────────────────────────────────
// The source SVG is 56×56.  We render into a 256×256 canvas with 16px padding.

const PAD   = 16;
const INNER = SIZE - PAD * 2; // 224px

// Map SVG coordinate → canvas pixel
function s(v) { return Math.round(v * INNER / 56) + PAD; }
// Map SVG stroke/radius length → pixels (minimum 2)
function d(v) { return Math.max(2, Math.round(v * INNER / 56)); }

// Accent colour #7c6dfa
const [AR, AG, AB] = [0x7c, 0x6d, 0xfa];
// Background colour #1a1a2e
const [BR, BG, BB] = [0x1a, 0x1a, 0x2e];

// 1. Rounded square background
fillRRect(PAD, PAD, INNER, INNER, 48, BR, BG, BB);

// 2. Camera body – stroke effect: fill accent outer, then bg inner
const CAM_SW = d(2);
const camX = s(10), camY = s(14);
const camW  = s(46) - s(10), camH = s(42) - s(14);
const camRX = d(3);
fillRRect(camX - CAM_SW, camY - CAM_SW, camW + CAM_SW * 2, camH + CAM_SW * 2,
          camRX + CAM_SW, AR, AG, AB);
fillRRect(camX, camY, camW, camH, camRX, BR, BG, BB);

// 3. Mountain silhouette – 40% opacity fill
fillPolygon([
  [s(10), s(36)], [s(20), s(28)], [s(28), s(34)],
  [s(36), s(24)], [s(46), s(34)], [s(46), s(42)], [s(10), s(42)],
], AR, AG, AB, Math.round(0.4 * 255));

// 4. Lens circle – stroke
strokeCircle(s(22), s(26), d(4), CAM_SW, AR, AG, AB);

// ── PNG encoder ───────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(b) {
  let c = 0xFFFFFFFF;
  for (const byte of b) c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len  = Buffer.allocUnsafe(4);
  const crc  = Buffer.allocUnsafe(4);
  const tBuf = Buffer.from(type, 'ascii');
  len.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([tBuf, data])), 0);
  return Buffer.concat([len, tBuf, data, crc]);
}

// Build filter-byte-prefixed scanlines
const rowLen = 1 + SIZE * 4;
const raw    = Buffer.allocUnsafe(SIZE * rowLen);
for (let y = 0; y < SIZE; y++) {
  const base = y * rowLen;
  raw[base] = 0; // filter: None
  buf.copy(raw, base + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.allocUnsafe(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
ihdr[10] = ihdr[11] = ihdr[12] = 0;

const pngData = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG sig
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', zlib.deflateSync(raw)),
  pngChunk('IEND', Buffer.alloc(0)),
]);

// ── ICO encoder ───────────────────────────────────────────────────────────────
// Modern ICO format: single 256×256 frame stored as a PNG blob.
// Supported by Windows Vista+ and all versions of Electron.

function buildIco(pngBuf) {
  const header = Buffer.allocUnsafe(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: ICO
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.allocUnsafe(16);
  entry[0] = 0;  // width  (0 = 256)
  entry[1] = 0;  // height (0 = 256)
  entry[2] = 0;  // color count
  entry[3] = 0;  // reserved
  entry.writeUInt16LE(1,             4); // planes
  entry.writeUInt16LE(32,            6); // bit depth
  entry.writeUInt32LE(pngBuf.length, 8); // image data size
  entry.writeUInt32LE(22,           12); // offset (6 + 16)

  return Buffer.concat([header, entry, pngBuf]);
}

// ── Write files ───────────────────────────────────────────────────────────────

const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });

fs.writeFileSync(path.join(buildDir, 'icon.png'), pngData);
console.log('  icon.png');

fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIco(pngData));
console.log('  icon.ico');
