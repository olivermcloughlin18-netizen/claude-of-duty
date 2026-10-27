#!/usr/bin/env node
// KESTREL HEIGHTS - an original neon-dusk rooftop compound for 6-8 players.
// Generates the whole source package reproducibly (no external assets):
//   .work/maps/kestrel/map.glb              render scene (embedded PNG textures)
//   .work/maps/kestrel/collision.gltf/.bin  collision + navmesh source
//   .work/maps/kestrel/nav_hints.json       spawns + patrol nodes (hijacked_nav_hints schema)
//   .work/maps/kestrel/ladders.json         empty (no ladders on this map)
//   .work/maps/kestrel/emitters.json        light sources for bake_probes --emitters
//   .work/maps/kestrel/env/ probe/ lut.png vision.json minimap.png
//   .work/maps/kestrel/manifest.src.json    spawns, bounds, lighting hints
// Then run `node .tools/bake_map_package.mjs kestrel`.
//
// Layout (inches, x east, z south, y up; x-mirror symmetric halves):
//   north lane  z -1020..-600  open deck garden, towers at both far corners
//   middle      z  -300..300   tiled plaza around a two-storey pavilion
//   south lane  z   600..1020  covered server hall, CQB control room + racks
//   bands       lounges (north) and labs (south) are the tight CQB rooms

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  World, View, paint, fbm, noise2, rng, clamp, mix, encodePng, writeGlb, writeCollisionGltf,
} from './map_kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = 'kestrel';
const OUT = path.join(ROOT, '.work', 'maps', ID);
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------- textures ----
const hash = (a, b, s = 0) => { let h = Math.imul(a + 374761393, 668265263) ^ Math.imul(b + 1274126177, 2246822519) ^ Math.imul(s + 17, 3266489917); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const tint = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

const GLYPHS = {
  A: '01110,10001,10001,11111,10001,10001,10001', B: '11110,10001,10001,11110,10001,10001,11110',
  D: '11110,10001,10001,10001,10001,10001,11110', E: '11111,10000,10000,11110,10000,10000,11111',
  G: '01110,10001,10000,10111,10001,10001,01111', H: '10001,10001,10001,11111,10001,10001,10001',
  I: '11111,00100,00100,00100,00100,00100,11111', K: '10001,10010,10100,11000,10100,10010,10001',
  L: '10000,10000,10000,10000,10000,10000,11111', N: '10001,11001,10101,10011,10001,10001,10001',
  O: '01110,10001,10001,10001,10001,10001,01110', P: '11110,10001,10001,11110,10000,10000,10000',
  R: '11110,10001,10001,11110,10100,10010,10001', S: '01111,10000,10000,01110,00001,00001,11110',
  T: '11111,00100,00100,00100,00100,00100,00100', U: '10001,10001,10001,10001,10001,10001,01110',
  X: '10001,10001,01010,00100,01010,10001,10001',
};
function glyphMask(text, w, h, scale) {
  const rows = new Float32Array(w * h);
  const cw = 6 * scale, total = text.length * cw - scale;
  const ox = Math.floor((w - total) / 2), oy = Math.floor((h - 7 * scale) / 2);
  [...text].forEach((ch, ci) => {
    const g = GLYPHS[ch]?.split(',');
    if (!g) return;
    g.forEach((row, ry) => [...row].forEach((bit, rx) => {
      if (bit !== '1') return;
      for (let y = 0; y < scale; y += 1) for (let x = 0; x < scale; x += 1) {
        const px = ox + ci * cw + rx * scale + x, py = oy + ry * scale + y;
        if (px >= 0 && px < w && py >= 0 && py < h) rows[py * w + px] = 1;
      }
    }));
  });
  return rows;
}
function blur(mask, w, h, r) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    let s = 0, n = 0;
    for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += mask[yy * w + xx]; n += 1;
    }
    out[y * w + x] = s / n;
  }
  return out;
}
function signTex(text, fg) {
  const w = 512, h = 128, mask = glyphMask(text, w, h, 12);
  const glow = blur(mask, w, h, 14);
  const base = paint(w, h, (x, y) => {
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    return edge < 6 ? tint(fg, 0.9) : [14, 14, 20];
  });
  const emi = paint(w, h, (x, y) => {
    const m = mask[y * w + x], g = glow[y * w + x];
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    const k = Math.max(m, g * 0.55) + (edge < 6 ? 0.9 : 0);
    return tint(fg, clamp(k, 0, 1));
  });
  return { base: base.png(), emi: emi.png() };
}

const TEX = {};
const tex = (name, size, fn, ch = 3) => { TEX[name] = paint(size, size, fn, ch).png(); return TEX[name]; };

tex('conc', 512, (x, y, u, v) => {
  let k = 0.82 + fbm(u, v, 8, 4, 1) * 0.3;
  const stain = fbm(u, v, 3, 3, 9);
  if (stain > 0.62) k *= 1 - (stain - 0.62) * 1.1;
  if (x % 256 < 2 || y % 256 < 2) k *= 0.62;
  k += (hash(x, y) - 0.5) * 0.07;
  return [118 * k, 114 * k, 110 * k];
});
tex('conc_dark', 256, (x, y, u, v) => { const k = 0.7 + fbm(u, v, 6, 4, 3) * 0.4 + (hash(x, y) - 0.5) * 0.06; return [74 * k, 76 * k, 82 * k]; });
tex('tile_plaza', 512, (x, y, u, v) => {
  const tx = Math.floor(x / 64), ty = Math.floor(y / 64);
  const gx = x % 64, gy = y % 64;
  if (gx < 2 || gy < 2) return [150, 160, 160];
  const k = 0.8 + hash(tx, ty, 4) * 0.35 + ((tx + ty) % 2 ? 0.08 : 0) + fbm(u, v, 12, 2, 5) * 0.12;
  const gloss = 1 + 0.12 * Math.sin((gx + gy) * 0.1);
  return [34 * k * gloss, 76 * k * gloss, 92 * k * gloss];
});
const cladding = (name, base) => tex(name, 512, (x, y, u, v) => {
  const col = x % 128, row = y;
  let k = 0.92 + fbm(u, v, 6, 3, 11) * 0.16;
  if (col < 2 || col > 125) k *= 0.55;
  else if (col < 4) k *= 1.25;
  if (row % 256 > 120 && row % 256 < 128) k *= 0.8;
  const rivet = [[10, 10], [118, 10], [10, 118], [118, 118]].some(([rx, ry]) => (col - rx) ** 2 + (row % 128 - ry) ** 2 < 6);
  if (rivet) k *= 1.45;
  k *= 1 - 0.28 * Math.pow(row / 512, 3);
  return [base[0] * k, base[1] * k, base[2] * k];
});
cladding('cladding_navy', [40, 54, 84]);
cladding('cladding_plum', [78, 36, 82]);
cladding('cladding_teal', [28, 96, 104]);
cladding('lab_white', [206, 214, 218]);
tex('plaster', 512, (x, y, u, v) => {
  const k = 0.9 + fbm(u, v, 10, 4, 21) * 0.2 + (hash(x, y) - 0.5) * 0.05;
  let s = 1;
  if (y % 256 < 3) s = 0.78;
  return [222 * k * s, 204 * k * s, 176 * k * s];
});
tex('brick_red', 512, (x, y, u, v) => {
  const row = Math.floor(y / 32), off = (row % 2) * 32;
  const bx = Math.floor((x + off) / 64);
  const lx = (x + off) % 64, ly = y % 32;
  if (lx < 3 || ly < 3) return [168, 160, 150];
  const k = 0.7 + hash(bx, row, 2) * 0.5 + fbm(u, v, 20, 2, 7) * 0.2;
  return [150 * k, 62 * k, 48 * k];
});
tex('brick_dark', 512, (x, y, u, v) => {
  const row = Math.floor(y / 32), off = (row % 2) * 32;
  const bx = Math.floor((x + off) / 64);
  const lx = (x + off) % 64, ly = y % 32;
  if (lx < 3 || ly < 3) return [92, 92, 100];
  const k = 0.7 + hash(bx, row, 6) * 0.5 + fbm(u, v, 20, 2, 8) * 0.2;
  return [74 * k, 54 * k, 66 * k];
});
tex('wood_deck', 512, (x, y, u, v) => {
  const plank = Math.floor(y / 64), ly = y % 64;
  const joint = Math.floor(hash(plank, 3) * 400) + 40;
  if (ly < 3 || Math.abs(x - joint) < 2) return [38, 24, 16];
  const grain = noise2(x / 90 + plank * 7.3, y / 3, 64, plank) * 0.45 + noise2(x / 14, y / 2.5, 128, 4) * 0.2;
  const k = 0.7 + hash(plank, 1) * 0.35 + grain * 0.5;
  return [140 * k, 92 * k, 58 * k];
});
tex('grating', 256, (x, y) => {
  const cx = (x % 32) - 16, cy = (y % 32) - 16;
  const d = Math.abs(cx) + Math.abs(cy);
  const ridge = Math.abs(d - 11) < 2 ? 1.5 : 1;
  const ridge2 = Math.abs(cx + cy) < 1.5 || Math.abs(cx - cy) < 1.5 ? 1.25 : 1;
  const k = 0.9 * ridge * (d > 18 ? 0.75 : 1) * ridge2 + (hash(x, y) - 0.5) * 0.06;
  return [64 * k, 70 * k, 80 * k];
});
tex('hazard', 256, (x, y, u, v) => {
  const stripe = Math.floor((x + y) / 32) % 2;
  const wear = 0.75 + fbm(u, v, 8, 3, 4) * 0.4;
  return stripe ? [236 * wear, 184 * wear, 22 * wear] : [26, 26, 30];
});
const container = (name, base) => tex(name, 512, (x, y, u, v) => {
  const ridge = 0.78 + 0.22 * Math.cos((x / 16) * Math.PI * 2);
  const rust = fbm(u, v, 5, 4, 31);
  let k = ridge * (0.9 + fbm(u, v, 14, 2, 3) * 0.2);
  let c = [base[0] * k, base[1] * k, base[2] * k];
  if (rust > 0.6) c = lerp3(c, [120, 62, 30], (rust - 0.6) * 1.8);
  if (y < 16 || y > 496) c = tint(base, 0.35);
  return c;
});
container('container_rust', [168, 70, 44]);
container('container_teal', [30, 128, 132]);
container('container_mustard', [208, 160, 40]);
tex('crate_wood', 256, (x, y, u, v) => {
  const e = Math.min(x, y, 255 - x, 255 - y);
  const brace = Math.abs(x - y) < 10 || Math.abs(x + y - 255) < 10;
  const board = Math.floor(y / 36);
  const grain = noise2(x / 60, y / 3, 64, board) * 0.4;
  let k = 0.8 + hash(board, 5) * 0.25 + grain;
  if (e < 22 || brace) k *= 1.12;
  if (e === 22 || e === 23 || Math.abs(Math.abs(x - y) - 10) < 1) k *= 0.55;
  return [172 * k, 128 * k, 72 * k];
});
tex('turf', 256, (x, y, u, v) => { const k = 0.7 + fbm(u, v, 24, 3, 6) * 0.7; return [34 * k, 108 * k, 44 * k]; });
tex('carpet', 256, (x, y, u, v) => {
  const k = 0.82 + fbm(u, v, 40, 2, 8) * 0.36 + (hash(x, y) - 0.5) * 0.12;
  const lines = (Math.abs(((x + y) % 64) - 32) < 1.5) ? 1.35 : 1;
  return [84 * k * lines, 34 * k * lines, 78 * k * lines];
});
tex('serverfloor', 512, (x, y, u, v) => {
  const gx = x % 128, gy = y % 128;
  if (gx < 3 || gy < 3) return [30, 190, 210];
  const hole = (((gx % 16) - 8) ** 2 + ((gy % 16) - 8) ** 2) < 6;
  const k = 0.7 + fbm(u, v, 6, 3, 2) * 0.3;
  return hole ? [8, 10, 14] : [34 * k, 40 * k, 52 * k];
});
tex('trim_dark', 128, (x, y, u, v) => { const k = 0.8 + fbm(u, v, 8, 3, 9) * 0.4; return [30 * k, 33 * k, 42 * k]; });
tex('hvac', 256, (x, y, u, v) => {
  const louvre = y % 12 < 3 ? 0.55 : 1;
  const k = (0.85 + fbm(u, v, 6, 3, 12) * 0.25) * louvre;
  const fan = (x - 128) ** 2 + (y - 128) ** 2 < 70 ** 2 && (x - 128) ** 2 + (y - 128) ** 2 > 20 ** 2 && ((Math.atan2(y - 128, x - 128) * 4) % (Math.PI * 2)) < Math.PI ? 0.55 : 1;
  return [146 * k * fan, 150 * k * fan, 154 * k * fan];
});
tex('marble', 256, (x, y, u, v) => {
  const vein = Math.abs(fbm(u, v, 4, 4, 14) - 0.5);
  const k = vein < 0.03 ? 0.4 : 0.9 + fbm(u, v, 12, 2, 15) * 0.15;
  return [220 * k, 232 * k, 236 * k];
});
tex('tank', 256, (x, y, u, v) => {
  const band = y % 96 < 5 ? 0.5 : 1;
  const k = (0.8 + fbm(u, v, 6, 3, 19) * 0.3) * band;
  return [86 * k, 118 * k, 148 * k];
});
tex('pipe', 128, (x, y) => { const k = 0.8 + 0.3 * Math.sin((y / 128) * Math.PI); return [178 * k, 98 * k, 62 * k]; });
tex('barrel', 128, (x, y) => { const k = (y % 64 < 4 ? 0.6 : 1) * (0.85 + 0.15 * Math.cos((x / 128) * Math.PI * 2)); return [40 * k, 96 * k, 140 * k]; });
TEX.helipad = paint(512, 512, (x, y) => {
  const dx = x - 256, dy = y - 256, r = Math.hypot(dx, dy);
  const noise = 0.85 + (hash(x, y) - 0.5) * 0.1 + fbm(x / 512, y / 512, 6, 3, 2) * 0.2;
  let c = [54 * noise, 56 * noise, 62 * noise];
  if (r > 210 && r < 238) c = [232, 188, 40];
  const hmask = (() => {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    return (ax > 60 && ax < 92 && ay < 120) || (ay < 18 && ax <= 76);
  })();
  if (hmask) c = [240, 240, 236];
  return c;
}).png();
TEX.streetgrid = paint(512, 512, (x, y) => {
  const road = (x % 256 < 14) || (y % 256 < 14);
  return road ? [210, 120, 60] : [10, 8, 18];
}).png();
TEX.screen = paint(256, 256, (x, y, u, v) => {
  const scan = y % 4 < 2 ? 0.55 : 1;
  const trace = Math.abs(((y * 0.5 + Math.sin(x / 20) * 30) % 64) - 32) < 2 ? 1 : 0.25;
  const k = scan * (0.35 + trace * 0.65);
  return [30 * k, 210 * k, 255 * k];
}).png();

const rackBase = paint(256, 256, (x, y) => {
  const unit = y % 32;
  if (unit < 2) return [6, 7, 10];
  const slot = unit > 8 && unit < 14 && x > 90 && x < 240 && x % 8 < 5;
  return slot ? [4, 4, 6] : [20, 22, 28];
});
TEX.rack = rackBase.png();
TEX.rackEmi = paint(256, 256, (x, y) => {
  const unit = y % 32;
  const led = unit > 12 && unit < 20 && x % 20 > 6 && x % 20 < 11 && x < 80;
  if (!led) return [0, 0, 0];
  const r = hash(Math.floor(x / 20), Math.floor(y / 32), 3);
  return r < 0.5 ? [40, 255, 90] : r < 0.8 ? [255, 190, 40] : [60, 200, 255];
}).png();

function skylineTex(name, palette, seed) {
  TEX[name] = paint(512, 512, (x, y) => {
    const cx = x % 16, cy = y % 24;
    const win = cx > 3 && cx < 13 && cy > 4 && cy < 19;
    const base = 0.8 + fbm(x / 512, y / 512, 6, 3, seed) * 0.4;
    if (win) return [26 * base, 36 * base, 58 * base];
    return [20 * base, 24 * base, 36 * base];
  }).png();
  TEX[`${name}Emi`] = paint(512, 512, (x, y) => {
    const cx = x % 16, cy = y % 24;
    const win = cx > 3 && cx < 13 && cy > 4 && cy < 19;
    const id = hash(Math.floor(x / 16), Math.floor(y / 24), seed);
    if (!win || id > 0.42) return [0, 0, 0];
    return palette[Math.floor(hash(Math.floor(x / 16) + 9, Math.floor(y / 24), seed) * palette.length)];
  }).png();
}
skylineTex('skyA', [[255, 200, 120], [255, 170, 90], [120, 220, 255]], 41);
skylineTex('skyB', [[255, 90, 200], [120, 230, 255], [255, 220, 150]], 52);

const SIGNS = {
  sign_kestrel: signTex('KESTREL', [255, 60, 170]),
  sign_heights: signTex('HEIGHTS', [40, 230, 255]),
  sign_bar: signTex('BAR', [255, 176, 48]),
  sign_lab: signTex('LAB', [150, 255, 80]),
  sign_grid: signTex('GRID', [60, 220, 255]),
};

// ------------------------------------------------------------ materials ----
const W = new World();
const M = (name, def) => W.defMat(name, def);
const T = [128, 128];
M('conc_roof', { tex: TEX.conc, tile: [192, 192] });
M('conc_dark', { tex: TEX.conc_dark, tile: [128, 128] });
M('tile_plaza', { tex: TEX.tile_plaza, tile: [192, 192], rough: 0.4 });
M('cladding_navy', { tex: TEX.cladding_navy, tile: [128, 128] });
M('cladding_plum', { tex: TEX.cladding_plum, tile: [128, 128] });
M('cladding_teal', { tex: TEX.cladding_teal, tile: [128, 128] });
M('lab_white', { tex: TEX.lab_white, tile: [128, 128] });
M('plaster', { tex: TEX.plaster, tile: [160, 160] });
M('brick_red', { tex: TEX.brick_red, tile: [96, 96] });
M('brick_dark', { tex: TEX.brick_dark, tile: [96, 96] });
M('wood_deck', { tex: TEX.wood_deck, tile: [128, 128] });
M('grating', { tex: TEX.grating, tile: [48, 48] });
M('hazard', { tex: TEX.hazard, tile: [64, 64] });
M('container_rust', { tex: TEX.container_rust, tile: [96, 96] });
M('container_teal', { tex: TEX.container_teal, tile: [96, 96] });
M('container_mustard', { tex: TEX.container_mustard, tile: [96, 96] });
M('crate_wood', { tex: TEX.crate_wood, tile: [56, 56] });
M('turf', { tex: TEX.turf, tile: [96, 96] });
M('carpet', { tex: TEX.carpet, tile: [64, 64] });
M('serverfloor', { tex: TEX.serverfloor, tile: [128, 128], rough: 0.5 });
M('trim_dark', { tex: TEX.trim_dark, tile: [64, 64] });
M('hvac', { tex: TEX.hvac, tile: [64, 64] });
M('marble', { tex: TEX.marble, tile: [96, 96], rough: 0.25 });
M('tank', { tex: TEX.tank, tile: [128, 128] });
M('pipe', { tex: TEX.pipe, tile: [32, 32] });
M('barrel', { tex: TEX.barrel, tile: [48, 48] });
M('helipad', { tex: TEX.helipad, tile: [320, 320] });
M('rack', { tex: TEX.rack, emissiveTex: TEX.rackEmi, emissive: [1, 1, 1], tile: [48, 84] });
M('screen', { color: [0.1, 0.1, 0.1, 1], emissiveTex: TEX.screen, emissive: [1, 1, 1], tile: [96, 96] });
M('streetgrid', { color: [0.05, 0.05, 0.08, 1], emissiveTex: TEX.streetgrid, emissive: [0.8, 0.5, 0.3], tile: [400, 400] });
M('skyA', { tex: TEX.skyA, emissiveTex: TEX.skyAEmi, emissive: [1.1, 1.1, 1.1], tile: [256, 512] });
M('skyB', { tex: TEX.skyB, emissiveTex: TEX.skyBEmi, emissive: [1.1, 1.1, 1.1], tile: [256, 512] });
M('glass', { color: [0.5, 0.85, 1, 0.28], blend: true, rough: 0.1 });
M('water', { color: [0.04, 0.16, 0.28, 1], emissive: [0.0, 0.12, 0.22], rough: 0.05 });
M('tank_glow', { color: [0.05, 0.1, 0.05, 1], emissive: [0.3, 1.0, 0.35] });
for (const [n, c] of Object.entries({
  neon_pink: [1.0, 0.18, 0.62], neon_cyan: [0.1, 0.9, 1.0], neon_amber: [1.0, 0.62, 0.12],
  neon_lime: [0.55, 1.0, 0.2], neon_white: [1.0, 0.92, 0.8], neon_red: [1.0, 0.1, 0.1],
})) M(n, { color: [0.03, 0.03, 0.03, 1], emissive: c });
for (const [n, s] of Object.entries(SIGNS)) M(n, { tex: s.base, emissiveTex: s.emi, emissive: [1, 1, 1], tile: [160, 40] });

const ALT = {
  neon_pink: 'neon_cyan', neon_cyan: 'neon_pink', neon_amber: 'neon_lime', neon_lime: 'neon_amber',
  container_rust: 'container_teal', container_teal: 'container_mustard', container_mustard: 'container_rust',
  cladding_navy: 'cladding_plum', cladding_plum: 'cladding_navy', brick_red: 'brick_dark', brick_dark: 'brick_red',
};
const C = new View(W, false);
const west = new View(W, false, ALT);
const east = new View(W, true, ALT);

// ----------------------------------------------------------------- map -----
const X = 1500, Z = 1050;
const IX = 1470, IZ = 1020;
const NOCOL = { collide: false };

// ground sections
const ground = (x0, z0, x1, z1, mat) => C.box(x0, -40, z0, x1, 0, z1, mat);
ground(-X, -Z, -1000, Z, 'conc_roof');
ground(1000, -Z, X, Z, 'conc_roof');
ground(-1000, -Z, 1000, -600, 'wood_deck');
ground(-1000, -600, 1000, -300, 'conc_roof');
ground(-1000, -300, 1000, 300, 'tile_plaza');
ground(-1000, 300, 1000, 600, 'conc_roof');
ground(-1000, 600, 1000, Z, 'serverfloor');

// perimeter walls with trim and neon
C.box(-X, 0, -Z, X, 230, -IZ, 'cladding_navy');
C.box(-X, 0, IZ, X, 230, Z, 'cladding_plum');
C.box(-X, 0, -IZ, -IX, 230, IZ, 'cladding_navy');
C.box(IX, 0, -IZ, X, 230, IZ, 'cladding_plum');
C.box(-X - 4, 230, -Z - 4, X + 4, 240, -IZ, 'trim_dark', { collide: false });
C.box(-X - 4, 230, IZ, X + 4, 240, Z + 4, 'trim_dark', { collide: false });
C.box(-X - 4, 230, -IZ, -IX, 240, IZ, 'trim_dark', { collide: false });
C.box(IX, 230, -IZ, X + 4, 240, IZ, 'trim_dark', { collide: false });
for (const [x0, z0, x1, z1, col] of [
  [-IX, -IZ - 3, IX, -IZ, 'neon_pink'], [-IX, IZ, IX, IZ + 3, 'neon_cyan'],
  [-IX - 3, -IZ, -IX, IZ, 'neon_amber'], [IX, -IZ, IX + 3, IZ, 'neon_lime'],
]) {
  C.box(x0, 205, z0, x1, 211, z1, col, NOCOL);
  C.box(x0, 0, z0, x1, 4, z1, 'trim_dark', NOCOL);
}
C.box(-IX, 0, -IZ + 0, IX, 30, -IZ + 4, 'trim_dark', NOCOL);

// signs live in C (not mirrored) so text always reads correctly
function sign(mat, x0, x1, y0, y1, z, face) {
  const w = x1 - x0, h = y1 - y0;
  const o = face > 0
    ? { tile: [w, -h], uvOffset: [x0, y1] }
    : { tile: [-w, -h], uvOffset: [x1, y1] };
  C.box(x0, y0, face > 0 ? z : z - 4, x1, y1, face > 0 ? z + 4 : z, mat, { ...o, collide: false });
}
sign('sign_kestrel', -540, -60, 100, 220, -IZ, 1);
sign('sign_heights', 60, 540, 100, 220, -IZ, 1);
sign('sign_grid', -240, 240, 84, 144, IZ - 4, -1);
sign('sign_bar', -880, -720, 94, 134, -300, 1);
sign('sign_bar', 720, 880, 94, 134, -300, 1);
sign('sign_lab', -840, -680, 94, 134, 300, -1);
sign('sign_lab', 680, 840, 94, 134, 300, -1);

// ---- central pavilion (two storeys: CQB hall below, sniper roof above)
function pavilion() {
  const X0 = -260, X1 = 260, Z0 = -170, Z1 = 170, t = 14, H = 120, m = 'plaster';
  C.wall('x', Z0 + t / 2, X0, X1, t, H, m, [{ at: 0, w: 80, head: 92 }, { at: -150, w: 70, sill: 40, head: 92 }, { at: 150, w: 70, sill: 40, head: 92 }]);
  C.wall('x', Z1 - t / 2, X0, X1, t, H, m, [{ at: 0, w: 80, head: 92 }, { at: -150, w: 70, sill: 40, head: 92 }, { at: 150, w: 70, sill: 40, head: 92 }]);
  for (const s of [-1, 1]) {
    C.wall('z', s * (260 - t / 2), Z0 + t, Z1 - t, t, H, m, [{ at: 0, w: 80, head: 92 }, { at: -110, w: 60, sill: 40, head: 92 }]);
    // parapet: ring around the roof with a gap where each ramp lands
    C.box(s * 250 - 5, 132, Z0 + 10, s * 250 + 5, 168, 70, 'plaster');
    C.box(s * 250 - 5, 132, 150, s * 250 + 5, 168, Z1 - 10, 'plaster');
    // ramps rise toward the pavilion
    if (s > 0) C.ramp('x', 260, 500, 70, 150, 132, 0, 'conc_roof', { mats: { top: 'grating' } });
    else C.ramp('x', -500, -260, 70, 150, 0, 132, 'conc_roof', { mats: { top: 'grating' } });
    // neon corner posts and cove strip
    for (const z of [Z0, Z1]) C.box(s * 260 - 4, 0, z - 4, s * 260 + 4, 128, z + 4, s > 0 ? 'neon_cyan' : 'neon_pink', NOCOL);
    for (const z of [-0.5, 0.5]) C.box(s * 150 - 100, 112, z * 190 - 3, s * 150 + 100, 116, z * 190 + 3, 'neon_white', NOCOL);
    // stub walls inside
    C.box(s * 160 - 10, 0, 40, s * 160 + 10, 72, 110, 'plaster');
  }
  C.box(X0, 120, Z0, X1, 132, Z1, 'plaster', { mats: { top: 'conc_roof', bottom: 'plaster' } });
  C.box(X0 + 10, 132, Z0, X1 - 10, 168, Z0 + 10, 'plaster');
  C.box(X0 + 10, 132, Z1 - 10, X1 - 10, 168, Z1, 'plaster');
  C.box(X0 - 1, 114, Z0 - 1, X1 + 1, 118, Z0, 'neon_cyan', NOCOL);
  C.box(X0 - 1, 114, Z1, X1 + 1, 118, Z1 + 1, 'neon_pink', NOCOL);
  // desk with neon ring, roof skylight and AC units
  C.cyl(0, 0, 36, 0, 44, 'marble', { seg: 20 });
  C.cyl(0, 0, 38, 44, 46, 'neon_cyan', { seg: 20, collide: false });
  C.box(-60, 132, -40, 60, 144, 40, 'trim_dark');
  C.box(-52, 144, -32, 52, 146, 32, 'glass', { collide: false });
  C.box(-210, 132, -140, -140, 172, -80, 'hvac');
  C.box(140, 132, -140, 210, 172, -80, 'hvac');
  C.box(-210, 132, 90, -170, 156, 130, 'hvac');
}
pavilion();

// fountains + plaza furniture
for (const z of [-250, 250]) {
  C.cyl(0, z, 52, 0, 36, 'brick_dark', { seg: 24, capMat: 'trim_dark', capTile: 128 });
  C.cyl(0, z, 44, 36, 38, 'water', { seg: 24, collide: false });
  C.cyl(0, z, 8, 0, 84, 'marble', { seg: 10 });
  C.cyl(0, z, 12, 84, 88, 'neon_cyan', { seg: 10, collide: false });
}

// ---- features authored on the west half and mirrored east
function half(v) {
  // === NORTH LANE: deck garden
  // west tower with stairs
  v.box(-IX, 0, -IZ, -1210, 144, -840, 'cladding_navy', { mats: { top: 'grating' } });
  v.box(-1222, 144, -IZ, -1210, 180, -968, 'cladding_navy');
  v.box(-1222, 144, -872, -1210, 180, -840, 'cladding_navy');
  v.box(-IX, 144, -852, -1210, 180, -840, 'cladding_navy');
  v.box(-1212, 136, -IZ, -1209, 141, -840, 'neon_pink', NOCOL);
  v.box(-IX, 136, -843, -1210, 141, -840, 'neon_amber', NOCOL);
  v.ramp('x', -1210, -900, -960, -880, 144, 0, 'conc_roof', { mats: { top: 'grating' } });
  v.cyl(-1440, -1000, 4, 144, 330, 'trim_dark', { seg: 8 });
  v.box(-1444, 330, -1004, -1436, 338, -996, 'neon_red', NOCOL);
  v.box(-1458, 144, -940, -1420, 188, -900, 'hvac');
  // containers, pergola, planters, barrier
  v.box(-880, 0, -880, -640, 96, -784, 'container_rust');
  v.box(-420, 0, -700, -180, 96, -604, 'container_teal');
  for (const [px, pz] of [[-470, -940], [-230, -940], [-470, -780], [-230, -780]]) v.box(px - 8, 0, pz - 8, px + 8, 150, pz + 8, 'wood_deck');
  for (const pz of [-940, -780]) v.box(-480, 150, pz - 8, -220, 160, pz + 8, 'wood_deck', NOCOL);
  for (let i = 0; i < 10; i += 1) v.box(-480 + i * 28, 160, -950, -470 + i * 28, 166, -770, 'wood_deck', NOCOL);
  v.box(-420, 0, -930, -290, 22, -900, 'wood_deck');
  v.box(-420, 0, -820, -290, 22, -790, 'wood_deck');
  v.box(-470, 138, -861, -230, 141, -859, 'neon_amber', NOCOL);
  v.box(-140, 0, -960, -20, 40, -900, 'brick_dark', { mats: { top: 'turf' } });
  v.box(-140, 0, -760, -20, 40, -700, 'brick_dark', { mats: { top: 'turf' } });
  v.box(-1000, 0, -780, -988, 56, -640, 'cladding_navy');
  v.box(-1000, 56, -780, -988, 58, -640, 'hazard', NOCOL);
  v.box(-640, 0, -1018, -540, 64, -960, 'hvac');
  v.box(-540, 0, -1018, -480, 40, -980, 'hvac');
  v.cyl(70, -1010, 6, -1000, -760, 'pipe', { axis: 'x', seg: 8, collide: false });
  v.cyl(100, -1010, 5, -1000, -700, 'trim_dark', { axis: 'x', seg: 8, collide: false });
  [[-1000, 'neon_pink'], [-600, 'neon_amber'], [-200, 'neon_pink']].forEach(([x, c]) => {
    v.cyl(x, -640, 5, 0, 190, 'trim_dark', { seg: 8 });
    v.box(x - 10, 188, -666, x + 10, 194, -636, c, NOCOL);
  });
  // north band: lounge (tight CQB) with roof access
  const LX0 = -980, LX1 = -620, LZ0 = -540, LZ1 = -300, t = 16, H = 120, bm = 'brick_red';
  v.wall('x', LZ0 + t / 2, LX0, LX1, t, H, bm, []);
  v.wall('x', LZ1 - t / 2, LX0, LX1, t, H, bm, [{ at: -800, w: 80, head: 92 }]);
  v.wall('z', LX0 + t / 2, LZ0 + t, LZ1 - t, t, H, bm, [{ at: -370, w: 80, head: 92 }, { at: -480, w: 70, sill: 40, head: 92 }]);
  v.wall('z', LX1 - t / 2, LZ0 + t, LZ1 - t, t, H, bm, [{ at: -440, w: 80, head: 92 }, { at: -355, w: 60, sill: 40, head: 92 }]);
  v.wall('z', -790, LZ0 + t, -400, 12, H, 'plaster', [{ at: -470, w: 80, head: 92 }]);
  v.box(LX0, H, LZ0, LX1, H + 12, LZ1, bm, { mats: { top: 'conc_roof' } });
  v.box(LX0, 132, LZ0, -740, 168, LZ0 + 10, bm);
  v.box(LX1 - 10, 132, LZ0, LX1, 168, LZ1, bm);
  v.box(LX0, 132, LZ1 - 10, LX1, 168, LZ1, bm);
  v.box(LX0, 132, LZ0, LX0 + 10, 168, LZ1, bm);
  v.ramp('x', -980, -740, -612, -540, 0, 132, 'conc_roof', { mats: { top: 'grating' } });
  v.box(-740, 0, -612, -620, 132, -540, 'conc_roof', { mats: { top: 'grating' } });
  v.box(-740, 132, -620, -620, 168, -612, bm);
  v.box(-628, 132, -620, -620, 168, -540, bm);
  v.box(LX0 + 16, 0, LZ0 + 16, LX1 - 16, 0.7, LZ1 - 16, 'carpet', NOCOL);
  v.box(-960, 0, -520, -930, 44, -440, 'wood_deck');
  v.box(-960, 44, -520, -958, 46, -440, 'neon_pink', NOCOL);
  v.box(-930, 0, -516, -860, 28, -486, 'carpet');
  v.cyl(-890, -395, 24, 0, 30, 'wood_deck', { seg: 12 });
  v.box(-740, 0, -480, -700, 66, -440, 'trim_dark');
  v.box(-940, 112, -421, -820, 116, -419, 'neon_pink', NOCOL);
  v.box(-760, 112, -421, -660, 116, -419, 'neon_amber', NOCOL);

  // === SOUTH BAND: lab (tight CQB)
  const BX0 = -980, BX1 = -620, BZ0 = 300, BZ1 = 520, lm = 'lab_white';
  v.wall('x', BZ0 + t / 2, BX0, BX1, t, H, lm, [{ at: -760, w: 80, head: 92 }]);
  v.wall('x', BZ1 - t / 2, BX0, BX1, t, H, lm, [{ at: -880, w: 60, sill: 40, head: 92 }, { at: -700, w: 80, head: 92 }]);
  v.wall('z', BX0 + t / 2, BZ0 + t, BZ1 - t, t, H, lm, [{ at: 360, w: 80, head: 92 }, { at: 470, w: 60, sill: 40, head: 92 }]);
  v.wall('z', BX1 - t / 2, BZ0 + t, BZ1 - t, t, H, lm, [{ at: 360, w: 80, head: 92 }, { at: 470, w: 80, head: 92 }]);
  v.wall('x', 410, BX0 + t, BX1 - t, 12, H, 'cladding_teal', [{ at: -880, w: 80, head: 92 }]);
  v.box(BX0, H, BZ0, BX1, H + 12, BZ1, lm, { mats: { top: 'conc_roof' } });
  v.box(-960, 132, 320, -900, 160, 380, 'hvac', NOCOL);
  v.box(-760, 132, 440, -700, 152, 500, 'hvac', NOCOL);
  v.box(BX0 + 16, 0, BZ0 + 16, BX1 - 16, 0.7, BZ1 - 16, 'tile_plaza', NOCOL);
  v.box(-940, 0, 330, -860, 44, 370, 'marble');
  v.box(-900, 0, 316, -840, 84, 336, 'trim_dark');
  v.cyl(-700, 345, 20, 0, 80, 'tank_glow', { seg: 12 });
  v.box(-820, 0, 432, -740, 44, 456, 'marble');
  v.box(-960, 108, 358, -800, 112, 362, 'neon_lime', NOCOL);
  v.box(-780, 108, 455, -680, 112, 459, 'neon_white', NOCOL);

  // === PLAZA: crates, cover, neon gate
  v.box(-720, 0, -200, -664, 112, -144, 'crate_wood');
  v.box(-720, 0, -144, -664, 56, -88, 'crate_wood');
  v.box(-440, 0, -140, -420, 52, -40, 'conc_dark');
  v.box(-440, 0, -140, -360, 52, -120, 'conc_dark');
  v.box(-440, 52, -140, -420, 54, -40, 'hazard', NOCOL);
  for (const pz of [-240, 240]) v.box(-570, 0, pz - 10, -550, 200, pz + 10, 'trim_dark');
  v.box(-570, 196, -240, -550, 212, 240, 'trim_dark', NOCOL);
  v.box(-562, 190, -240, -558, 196, 240, 'neon_pink', NOCOL);
  v.box(-420, 0, 440, -300, 40, 480, 'brick_dark', { mats: { top: 'turf' } });
  v.box(-300, 0, 380, -280, 50, 440, 'conc_dark');

  // north-middle band: pillars + gantry
  for (const px of [-120, -360]) v.box(px - 20, 0, -470, px + 20, 120, -430, 'plaster');
  v.box(-380, 108, -455, -100, 120, -445, 'trim_dark', NOCOL);
  v.box(-300, 0, -380, -180, 48, -368, 'conc_dark');

  // === SOUTH HALL
  for (const px of [-920, -760, -600, -440, -280, -120]) v.box(px - 18, 0, 582, px + 18, 140, 618, 'plaster');
  v.wall('z', -990, 600, 1020, 20, 140, 'cladding_navy', [{ at: 840, w: 120, head: 120 }]);
  v.box(-1000, 120, 780, -980, 124, 900, 'neon_cyan', NOCOL);
  v.box(-880, 0, 700, -560, 84, 736, 'rack', { mats: { top: 'trim_dark' } });
  v.box(-880, 0, 820, -560, 84, 856, 'rack', { mats: { top: 'trim_dark' } });
  v.box(-460, 0, 760, -240, 84, 796, 'rack', { mats: { top: 'trim_dark' } });
  v.box(-960, 0, 940, -904, 56, 996, 'crate_wood');
  v.box(-960, 56, 940, -904, 112, 996, 'crate_wood');
  v.box(-900, 0, 960, -844, 56, 1016, 'crate_wood');
  v.box(-780, 0, 924, -540, 96, 1020, 'container_teal');
  for (const z of [660, 780, 900, 1000]) v.box(-950, 137, z - 5, -30, 140, z + 5, 'neon_pink', NOCOL);
  // sniper platform above the hall's west gate
  v.box(-IX, 0, 760, -1260, 96, IZ, 'cladding_navy', { mats: { top: 'grating' } });
  v.box(-1272, 96, 760, -1260, 132, IZ, 'cladding_navy');
  v.box(-IX, 96, 760, -1420, 132, 772, 'cladding_navy');
  v.box(-1340, 96, 760, -1260, 132, 772, 'cladding_navy');
  v.ramp('z', 560, 760, -1420, -1340, 0, 96, 'conc_roof', { mats: { top: 'grating' } });
  v.cyl(-1420, 980, 36, 96, 190, 'tank', { seg: 16 });
  v.box(-1272, 90, 760, -1269, 95, IZ, 'neon_cyan', NOCOL);

  // === BASE PLAZA
  v.cyl(-1260, 0, 150, 0, 0.8, 'helipad', { seg: 40, collide: false, capTile: 320, tile: [320, 320] });
  for (const s of [-1, 1]) {
    v.box(-1450, 0, s * 312 - 28, -1394, 56, s * 312 + 28, 'crate_wood');
    v.box(-1450, 56, s * 312 - 28, -1394, 112, s * 312 + 28, 'crate_wood');
    v.box(-1394, 0, s * 312 - 28, -1338, 56, s * 312 + 28, 'crate_wood');
    v.box(-1180, 0, s * 360 - 60, -1166, 72, s * 360 + 60, 'cladding_navy');
    v.box(-1166, 60, s * 360 - 60, -1164, 64, s * 360 + 60, 'neon_pink', NOCOL);
    v.cyl(-1100, s * 200, 5, 0, 190, 'trim_dark', { seg: 8 });
    v.box(-1110, 188, s * 200 - 10, -1090, 194, s * 200 + 10, 'neon_amber', NOCOL);
    v.box(-IX + 4, 0, s * 85 - 45, -1396, 60, s * 85 + 45, 'hvac');
  }
  v.cyl(-1210, -120, 14, 0, 36, 'barrel', { seg: 10 });
  v.cyl(-1180, -150, 14, 0, 36, 'barrel', { seg: 10 });
  v.cyl(-1210, 120, 14, 0, 36, 'barrel', { seg: 10 });
}
half(west);
half(east);

// south hall shell + control room (centre)
C.box(-1000, 140, 600, 1000, 152, Z, 'cladding_navy', { mats: { bottom: 'trim_dark', top: 'conc_roof' } });
C.box(-1000, 120, 596, 1000, 152, 604, 'trim_dark');
C.box(-1000, 114, 598, 1000, 119, 602, 'neon_cyan', NOCOL);
(function controlRoom() {
  const X0 = -160, X1 = 160, Z0 = 760, Z1 = 920, t = 14, H = 120, m = 'cladding_teal';
  C.wall('x', Z0 + t / 2, X0, X1, t, H, m, [{ at: 0, w: 80, head: 92 }, { at: -100, w: 70, sill: 40, head: 92 }, { at: 100, w: 70, sill: 40, head: 92 }]);
  C.wall('x', Z1 - t / 2, X0, X1, t, H, m, [{ at: -90, w: 80, head: 92 }]);
  for (const s of [-1, 1]) C.wall('z', s * (160 - t / 2), Z0 + t, Z1 - t, t, H, m, [{ at: 840, w: 80, head: 92 }]);
  C.box(X0, H, Z0, X1, H + 12, Z1, m, { mats: { top: 'conc_roof' } });
  C.box(X0 + 14, 0, Z0 + 14, X1 - 14, 0.7, Z1 - 14, 'carpet', NOCOL);
  C.box(-40, 0, 860, 120, 40, 890, 'trim_dark');
  C.box(-40, 40, 872, 120, 44, 886, 'neon_cyan', NOCOL);
  C.box(-40, 36, 904, 140, 104, 906, 'screen', NOCOL);
  C.box(X0 - 1, 112, Z0 - 1, X1 + 1, 116, Z0, 'neon_cyan', NOCOL);
  C.box(-120, 108, 836, 120, 112, 844, 'neon_white', NOCOL);
}());

// ---- distant skyline + street glow (render only)
(function skyline() {
  const r = rng(1234);
  C.box(-5200, -812, -4600, 5200, -800, 4600, 'streetgrid', { collide: false, tile: [400, 400] });
  const place = (cx, cz) => {
    const w = 180 + r() * 220, d = 180 + r() * 220, h = 500 + r() * 1100;
    const m = r() < 0.5 ? 'skyA' : 'skyB';
    C.box(cx - w / 2, -800, cz - d / 2, cx + w / 2, -800 + h, cz + d / 2, m, { collide: false, tile: [256, 512] });
    if (r() < 0.45) C.box(cx - w / 2 + 20, -800 + h, cz - d / 2 + 20, cx + w / 2 - 20, -800 + h + 14, cz + d / 2 - 20, ['neon_pink', 'neon_cyan', 'neon_amber'][Math.floor(r() * 3)], { collide: false });
    if (r() < 0.3) C.cyl(cx, cz, 5, -800 + h, -800 + h + 220, 'trim_dark', { seg: 6, collide: false });
  };
  for (let x = -3600; x <= 3600; x += 460) {
    for (const z of [-1900, -2400, -2900, 1900, 2400, 2900]) place(x + (r() - 0.5) * 120, z + (r() - 0.5) * 140);
  }
  for (let z = -1400; z <= 1400; z += 460) {
    for (const x of [-1900, -2400, -2900, 1900, 2400, 2900]) place(x + (r() - 0.5) * 140, z + (r() - 0.5) * 120);
  }
}());

// ------------------------------------------------------------- spawns ------
const yawTo = (x, z, tx, tz) => Math.atan2(-(tx - x), -(tz - z));
const spawnsWest = [
  [-1330, 0, -200], [-1330, 0, 200], [-1400, 0, 0], [-1250, 0, -450], [-1250, 0, 450],
  [-1340, 144, -930], [-760, 0, -960], [-350, 0, -985], [-880, 0, -440], [-800, 0, 355],
  [-690, 0, 470], [-560, 0, -150], [-600, 0, 200], [-760, 0, 778], [-520, 0, 880],
  [-300, 0, 660], [-1380, 96, 880], [-740, 0, -690],
];
const spawns = [];
for (const [x, y, z] of spawnsWest) {
  spawns.push({ position: [x, y, z], yaw: yawTo(x, z, 0, 0) });
  spawns.push({ position: [-x, y, z], yaw: yawTo(-x, z, 0, 0) });
}
spawns.push({ position: [0, 0, 110], yaw: yawTo(0, 110, 0, -1000) });
spawns.push({ position: [0, 132, -110], yaw: yawTo(0, -110, 0, -1000) });
spawns.push({ position: [0, 0, 560], yaw: yawTo(0, 560, 0, 0) });
spawns.push({ position: [0, 0, -400], yaw: yawTo(0, -400, 0, 0) });
for (const s of spawns) s.yaw = Math.round(s.yaw * 1e4) / 1e4;
const playerStart = { position: [-1400, 0, 0], yaw: spawns[2].yaw };

// -------------------------------------------------------------- outputs ----
writeGlb(W, path.join(OUT, 'map.glb'), { map: ID });
writeCollisionGltf(W, path.join(OUT, 'collision.gltf'));

const dm = spawns.map((s, i) => ({
  ordinal: i, classname: 'mp_dm_spawn', position: s.position,
  positionObject: { x: s.position[0], y: s.position[1], z: s.position[2] }, yaw: s.yaw,
}));
const nodes = [];
for (const s of spawns) nodes.push({ classname: 'node_pathnode', position: s.position });
for (const [x, z] of [[-1000, -800], [-500, -650], [0, -650], [-500, -400], [0, -300], [-640, 0], [-500, 220], [0, 450], [-500, 650], [-200, 650], [-1100, 600], [-1100, -600], [-30, 20]]) {
  nodes.push({ classname: 'node_pathnode', position: [x, 0, z] });
  if (x !== -30) nodes.push({ classname: 'node_pathnode', position: [-x, 0, z] });
}
fs.writeFileSync(path.join(OUT, 'nav_hints.json'), JSON.stringify({
  format: 'claude-of-duty-nav-hints-v1', map: ID,
  coordinateSystem: { target: 'Three.js y-up', spawnYaw: 'yaw is Object3D rotation.y radians; forward = (-sin yaw, 0, -cos yaw)' },
  pathnodes: nodes, negotiationNodes: [], offMeshConnections: [], spawns: dm,
  counts: { pathnodes: nodes.length, spawns: dm.length },
}, null, 1));
fs.writeFileSync(path.join(OUT, 'ladders.json'), JSON.stringify({ format: 'hijacked-ladders-v1', source: 'none', coordinateSystem: 'three-y-up', pattern: 'ladder', count: 0, volumes: [] }, null, 1));

// probe emitters: neon / interior lights the sky-only bake cannot see
const emit = [];
const E = (x, y, z, col, i = 1, r = 260, mirror = true) => {
  i *= 2.6;
  emit.push({ position: [x, y, z], color: col, intensity: i, radius: r });
  if (mirror) {
    const flip = { '1,0.2,0.6': [0.1, 0.9, 1], '1,0.65,0.15': [0.55, 1, 0.2] }[col.join(',')] ?? col;
    emit.push({ position: [-x, y, z], color: flip, intensity: i, radius: r });
  }
};
const PINK = [1, 0.2, 0.6], AMB = [1, 0.65, 0.15], CY = [0.1, 0.9, 1], LIME = [0.55, 1, 0.2], WHT = [1, 0.9, 0.8];
E(-880, 100, -420, PINK, 1.2); E(-710, 100, -420, AMB, 1.0); E(-900, 100, 360, LIME, 1.1); E(-730, 100, 460, WHT, 1.0);
E(-600, 120, 700, PINK, 1.0, 360); E(-300, 120, 820, PINK, 1.0, 360); E(-600, 120, 960, PINK, 0.9, 320);
E(-1000, 180, -650, PINK, 0.9, 300); E(-600, 180, -650, AMB, 0.9, 300); E(-200, 180, -650, PINK, 0.9, 300);
E(-1100, 180, 200, AMB, 0.9, 300); E(-1100, 180, -200, AMB, 0.9, 300); E(-1260, 20, 0, WHT, 0.5, 260);
E(-360, 100, 0, WHT, 1.0, 360); E(-560, 150, 0, PINK, 0.9, 300); E(-300, 110, -300, CY, 0.8, 300);
E(-470, 135, -860, AMB, 1.0, 300); E(-1330, 170, -930, PINK, 0.7, 260);
E(0, 100, 0, CY, 1.1, 360, false); E(0, 100, 840, CY, 1.3, 300, false); E(0, 110, 240, CY, 0.8, 300, false); E(0, 110, -240, CY, 0.8, 300, false);
E(0, 130, 700, CY, 1.0, 380, false);
fs.writeFileSync(path.join(OUT, 'emitters.json'), JSON.stringify(emit));

// ----------------------------------------------- sky, probe, lut, vision ----
const norm3 = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
const SUN = norm3([-0.7, 0.36, 0.6]);
const ZEN = [0.03, 0.032, 0.13], MID = [0.17, 0.07, 0.32], HOR = [0.9, 0.26, 0.34], HORLOW = [0.32, 0.1, 0.26];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function sky(d, stars = true) {
  const e = d[1];
  let c;
  if (e >= 0) {
    const a = Math.pow(e, 0.5);
    c = lerp3(HOR, lerp3(MID, ZEN, clamp((a - 0.35) * 1.6)), clamp(a * 2.0));
    const az = Math.atan2(d[2], d[0]);
    const band = clamp(1 - e * 4.5) * (0.5 + 0.7 * fbm(az / (Math.PI * 2) + 0.5, 0.5, 5, 3, 3));
    c = [c[0] + band * 0.35, c[1] + band * 0.05, c[2] + band * 0.28];
    const cloud = fbm(az / (Math.PI * 2) + 0.5, e * 0.9, 6, 4, 8);
    if (cloud > 0.55 && e < 0.5) { const k = (cloud - 0.55) * 2.4 * (1 - e * 1.6); c = [c[0] + k * 0.5, c[1] + k * 0.12, c[2] + k * 0.3]; }
  } else {
    c = lerp3(HORLOW, [0.05, 0.02, 0.07], clamp(-e * 3));
  }
  const g = Math.max(dot3(d, SUN), 0);
  const glow = Math.pow(g, 5) * 0.45 + Math.pow(g, 40) * 1.3 + (g > 0.9993 ? 5 : 0);
  c = [c[0] + glow * 1.0, c[1] + glow * 0.52, c[2] + glow * 0.28];
  if (stars && e > 0.12) {
    const sx = Math.floor((d[0] + 2) * 220), sy = Math.floor((d[1] + 2) * 220), sz = Math.floor((d[2] + 2) * 220);
    if (hash(sx, sy * 7 + sz, 99) > 0.9998) { const k = 0.15 + hash(sz, sx, 5) * 0.35; c = [c[0] + k, c[1] + k, c[2] + k * 1.1]; }
  }
  return c;
}
const toSrgb = (v) => 255 * clamp(v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
function faceDir(f, u, v) {
  switch (f) {
    case 0: return norm3([1, -v, -u]);
    case 1: return norm3([-1, -v, u]);
    case 2: return norm3([u, 1, v]);
    case 3: return norm3([u, -1, -v]);
    case 4: return norm3([u, -v, 1]);
    default: return norm3([-u, -v, -1]);
  }
}
const FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
function cube(dir, size, fn) {
  fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  FACES.forEach((name, f) => {
    const px = new Uint8Array(size * size * 3);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const c = fn(faceDir(f, ((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1));
      for (let k = 0; k < 3; k += 1) px[(y * size + x) * 3 + k] = Math.round(toSrgb(c[k]));
    }
    fs.writeFileSync(path.join(OUT, dir, `${name}.png`), encodePng(px, size, size, 3));
  });
}
cube('env', 512, (d) => sky(d, true));
// reflection probe: soft, slightly lifted so metals/glass pick up neon-ish colour
cube('probe', 32, (d) => { const c = sky(d, false); return [c[0] * 0.9 + 0.025, c[1] * 0.9 + 0.02, c[2] * 0.9 + 0.045]; });

// colour grade LUT: 1024x64, cube in the top 32 rows (see POST_SHADER.sampleLut)
{
  const lut = new Uint8Array(1024 * 64 * 3);
  for (let row = 0; row < 64; row += 1) for (let col = 0; col < 1024; col += 1) {
    const b = Math.floor(col / 32) / 31, r = (col % 32) / 31, g = (row % 32) / 31;
    let c = [r, g, b];
    if (row < 32) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const s = (x) => x + (x - 0.5) * 0.18 * (1 - Math.abs(2 * x - 1) * 0.0) * 0.5;
      c = c.map(s);
      const sh = 1 - clamp(lum * 2.2), hi = clamp((lum - 0.45) * 1.8);
      c = [c[0] + hi * 0.05 - sh * 0.02, c[1] - hi * 0.01 + sh * 0.02, c[2] + sh * 0.07 - hi * 0.03];
    }
    const o = (row * 1024 + col) * 3;
    for (let k = 0; k < 3; k += 1) lut[o + k] = Math.round(clamp(c[k]) * 255);
  }
  fs.writeFileSync(path.join(OUT, 'lut.png'), encodePng(lut, 1024, 64, 3));
}
fs.writeFileSync(path.join(OUT, 'vision.json'), JSON.stringify({
  highlight: [0.18, 0.14, 0.15], lowlight: [0.03, 0.02, 0.05], exposure: 1.3, lowlightScale: 1,
  note: 'Same schema as export/web/vision.json; only highlight/lowlight/exposure are read.',
}, null, 1));

// ------------------------------------------------------------- minimap -----
{
  const N = 512, SIZE = 3200, C0 = [0, 0];
  const img = new Float32Array(N * N).fill(-1e9);
  const col = W.col;
  for (let i = 0; i < col.length; i += 9) {
    const t = [[col[i], col[i + 1], col[i + 2]], [col[i + 3], col[i + 4], col[i + 5]], [col[i + 6], col[i + 7], col[i + 8]]];
    const nrm = (() => { const a = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], b = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]]; const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; return n[1] / (Math.hypot(...n) || 1); })();
    if (nrm < 0.2) continue;
    // image u from z (flipU 1), v from x (flipV -1): MAP_CAL convention in hud.js
    const p = t.map(([x, y, z]) => [(0.5 + (z - C0[1]) / SIZE) * N, (0.5 - (x - C0[0]) / SIZE) * N, y]);
    const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0]))), maxX = Math.min(N - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1]))), maxY = Math.min(N - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    const den = (p[1][1] - p[2][1]) * (p[0][0] - p[2][0]) + (p[2][0] - p[1][0]) * (p[0][1] - p[2][1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const l1 = ((p[1][1] - p[2][1]) * (x + 0.5 - p[2][0]) + (p[2][0] - p[1][0]) * (y + 0.5 - p[2][1])) / den;
      const l2 = ((p[2][1] - p[0][1]) * (x + 0.5 - p[2][0]) + (p[0][0] - p[2][0]) * (y + 0.5 - p[2][1])) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < -0.01 || l2 < -0.01 || l3 < -0.01) continue;
      const h = l1 * p[0][2] + l2 * p[1][2] + l3 * p[2][2];
      if (h > img[y * N + x]) img[y * N + x] = h;
    }
  }
  const px = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
    const h = img[y * N + x], o = (y * N + x) * 4;
    if (h < -100) continue;
    if (h < -1) { px.set([0, 0, 0, 0], o); continue; }
    let edge = false;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      if (Math.abs(img[ny * N + nx] - h) > 30 && img[ny * N + nx] > -100) edge = true;
    }
    const k = clamp(h / 180);
    const base = lerp3([30, 70, 90], [130, 190, 210], k);
    const c = edge ? [255, 255, 255] : base;
    px.set([c[0], c[1], c[2], 235], o);
  }
  fs.writeFileSync(path.join(OUT, 'minimap.png'), encodePng(px, N, N, 4));
}

// --------------------------------------------------------- manifest src ----
const b = W.bounds;
fs.writeFileSync(path.join(OUT, 'manifest.src.json'), JSON.stringify({
  id: ID,
  name: 'Kestrel Heights',
  description: 'Neon dusk rooftop compound: open deck lane, tiled plaza pavilion, covered server hall.',
  players: '6-8',
  spawns,
  playerStart,
  bounds: { min: b.min.map((v) => Math.round(v)), max: b.max.map((v) => Math.round(v)) },
  playArea: { min: [-IX, -40, -IZ], max: [IX, 340, IZ] },
  minimap: { image: 'minimap.png', centerX: 0, centerZ: 0, size: 3200, flipU: 1, flipV: -1, minimapSpan: 1250 },
  lighting: {
    sun: { color: '#ff9a6e', intensity: 1.3, position: SUN.map((v) => Math.round(v * 1500)) },
    hemi: { sky: '#7a5aa8', ground: '#2a2040', intensity: 0.35 },
    fog: { color: '#6a3a5e', near: 700, far: 4400 },
    probeIntensity: 0.9,
    environmentIntensity: 0.9,
    exposure: 1.6,
    saturation: 0.9,
    note: 'Pass env/probe/vision/lut paths to applyEnvironmentLighting() and loadGradeLut(); apply sun/hemi/fog from these hints.',
  },
}, null, 1));

console.log(`built ${ID}: ${W.meshes.size} materials, ${W.col.length / 9} collision tris, ${spawns.length} spawns -> ${path.relative(ROOT, OUT)}`);
