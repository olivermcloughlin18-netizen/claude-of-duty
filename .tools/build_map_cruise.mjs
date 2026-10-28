#!/usr/bin/env node
// AURORA STAR - an original sunny-afternoon cruise liner for 6-8 players.
// Generates the whole source package reproducibly (no external assets), same
// outputs as build_map_kestrel.mjs into .work/maps/cruise/, then run
//   node .tools/bake_map_package.mjs cruise
//
// Layout (inches, x east/bow, z south, y up; ~7300 x 1800, about 2x Hijacked):
//   stern bay (open, spawn)  x -3600..-2750   under an L2 terrace from -3150
//   aft cabin block          x -2750..-1850   corridor grid, suites, cabins
//   theatre                  x -1850..-1000   stage, seat banks
//   foyer / atrium / foyer   x -1000.. 900    two-deck void with grand stairs
//   restaurant, fore cabins  x   900..2300
//   bow forecastle (open)    x  2300..3700
//   L2 (y 168) lido deck over everything x -3150..2300: pool, loungers, bar;
//   L3 (y 336) sports/funnel deck x 1000..1600, bridge on the superstructure.
//   Covered promenades run down both sides at L1 with lifeboats outboard.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  World, paint, fbm, noise2, clamp, mix, encodePng, writeGlb, writeCollisionGltf,
} from './map_kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = 'cruise';
const OUT = path.join(ROOT, '.work', 'maps', ID);
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------- textures ----
const hash = (a, b, s = 0) => { let h = Math.imul(a + 374761393, 668265263) ^ Math.imul(b + 1274126177, 2246822519) ^ Math.imul(s + 17, 3266489917); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const tint = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

const GLYPHS = {
  A: '01110,10001,10001,11111,10001,10001,10001', B: '11110,10001,10001,11110,10001,10001,11110',
  C: '01111,10000,10000,10000,10000,10000,01111', D: '11110,10001,10001,10001,10001,10001,11110',
  E: '11111,10000,10000,11110,10000,10000,11111', F: '11111,10000,10000,11110,10000,10000,10000',
  G: '01110,10001,10000,10111,10001,10001,01111', H: '10001,10001,10001,11111,10001,10001,10001',
  I: '11111,00100,00100,00100,00100,00100,11111', L: '10000,10000,10000,10000,10000,10000,11111',
  M: '10001,11011,10101,10101,10001,10001,10001', N: '10001,11001,10101,10011,10001,10001,10001',
  O: '01110,10001,10001,10001,10001,10001,01110', P: '11110,10001,10001,11110,10000,10000,10000',
  R: '11110,10001,10001,11110,10100,10010,10001', S: '01111,10000,10000,01110,00001,00001,11110',
  T: '11111,00100,00100,00100,00100,00100,00100', U: '10001,10001,10001,10001,10001,10001,01110',
  ' ': '00000,00000,00000,00000,00000,00000,00000',
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
function signTex(text, fg, bg, w = 512, h = 128, scale = 12, glow = 0.35) {
  const mask = glyphMask(text, w, h, scale);
  const base = paint(w, h, (x, y) => {
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    if (mask[y * w + x]) return fg;
    return edge < 5 ? tint(fg, 0.85) : bg;
  });
  const emi = paint(w, h, (x, y) => (mask[y * w + x] ? tint(fg, glow) : [0, 0, 0]));
  return { base: base.png(), emi: emi.png() };
}

const TEX = {};
const tex = (name, size, fn, ch = 3) => { TEX[name] = paint(size, size, fn, ch).png(); return TEX[name]; };

// row 0 is the BOTTOM of a wall face (uv v grows with world y)
tex('white_paint', 256, (x, y, u, v) => {
  const k = 0.94 + fbm(u, v, 8, 3, 41) * 0.08 + (hash(x, y) - 0.5) * 0.02;
  const seam = (x % 128 < 1.5 || y % 128 < 1.5) ? 0.9 : 1;
  return [238 * k * seam, 241 * k * seam, 244 * k * seam];
});
tex('hull_white', 512, (x, y, u, v) => {
  let k = 0.95 + fbm(u, v, 6, 3, 43) * 0.07 + (hash(x, y) - 0.5) * 0.015;
  if (x % 128 < 2) k *= 0.86;
  if (y % 170 < 2) k *= 0.88;
  const px = x % 64 - 32, py = (y - 400) * 0.57;
  const d = Math.hypot(px, py);
  if (d < 12) return [24, 44, 66];
  if (d < 15.5) return [200, 204, 208];
  const streak = noise2(x / 6, y / 90, 64, 5) > 0.7 && py > 0 && py < 40 && Math.abs(px) < 8 ? 0.82 : 1;
  return [236 * k * streak, 240 * k * streak, 244 * k * streak];
});
tex('hull_navy', 256, (x, y, u, v) => { const k = 0.9 + fbm(u, v, 8, 3, 44) * 0.2; return [18 * k, 34 * k, 66 * k]; });
tex('hull_red', 128, (x, y, u, v) => { const k = 0.9 + fbm(u, v, 8, 2, 45) * 0.2; return [148 * k, 30 * k, 36 * k]; });
tex('teak', 512, (x, y, u, v) => {
  const plank = Math.floor(y / 64), ly = y % 64;
  const joint = Math.floor(hash(plank, 3) * 400) + 40;
  if (ly < 3 || Math.abs(x - joint) < 2) return [48, 30, 18];
  const grain = noise2(x / 90 + plank * 7.3, y / 3, 64, plank) * 0.4 + noise2(x / 14, y / 2.5, 128, 4) * 0.18;
  const k = 0.78 + hash(plank, 1) * 0.3 + grain * 0.5;
  return [184 * k, 128 * k, 78 * k];
});
tex('deck_steel', 256, (x, y, u, v) => {
  let k = 0.9 + fbm(u, v, 10, 3, 46) * 0.16 + (hash(x, y) - 0.5) * 0.09;
  if (x % 128 < 2 || y % 128 < 2) k *= 0.7;
  const rivet = [[8, 8], [120, 8], [8, 120], [120, 120]].some(([rx, ry]) => (x % 128 - rx) ** 2 + (y % 128 - ry) ** 2 < 5);
  if (rivet) k *= 1.3;
  return [126 * k, 148 * k, 150 * k];
});
tex('deck_tile', 256, (x, y, u, v) => {
  const gx = x % 64, gy = y % 64;
  if (gx < 2 || gy < 2) return [190, 188, 178];
  const k = 0.93 + hash(Math.floor(x / 64), Math.floor(y / 64), 7) * 0.1 + fbm(u, v, 10, 2, 47) * 0.05;
  return [222 * k, 214 * k, 196 * k];
});
tex('pool_tile', 256, (x, y, u, v) => {
  const gx = x % 16, gy = y % 16;
  if (gx < 1 || gy < 1) return [150, 215, 225];
  const k = 0.8 + hash(Math.floor(x / 16), Math.floor(y / 16), 8) * 0.4 + fbm(u, v, 8, 2, 48) * 0.15;
  return [24 * k, 150 * k, 190 * k];
});
TEX.water = paint(256, 256, (x, y, u, v) => {
  const w1 = Math.abs(fbm(u, v, 6, 3, 49) - 0.5), w2 = Math.abs(fbm(u + 0.3, v, 9, 2, 50) - 0.5);
  const caustic = clamp(1 - Math.min(w1, w2) * 14);
  return [40 + caustic * 150, 150 + caustic * 90, 205 + caustic * 40, 120 + caustic * 70];
}, 4).png();
tex('coping', 256, (x, y, u, v) => { const k = 0.92 + fbm(u, v, 12, 2, 51) * 0.1; return (x % 128 < 2) ? [180, 176, 168] : [230 * k, 226 * k, 216 * k]; });
tex('cushion', 128, (x) => (Math.floor(x / 16) % 2 ? [244, 246, 248] : [42, 106, 190]));
tex('awning', 128, (x) => (Math.floor(x / 16) % 2 ? [246, 246, 240] : [200, 40, 48]));
tex('awning_blue', 128, (x) => (Math.floor(x / 16) % 2 ? [246, 246, 240] : [30, 70, 150]));
tex('ceiling', 256, (x, y, u, v) => {
  let k = 0.96 + fbm(u, v, 10, 2, 52) * 0.05;
  if (x % 128 < 2 || y % 128 < 2) k *= 0.82;
  return [236 * k, 232 * k, 220 * k];
});
const wallTex = (name, wains, upper, trim, seed, pattern) => tex(name, 256, (x, y, u, v) => {
  const k = 0.92 + fbm(u, v, 10, 3, seed) * 0.14 + (hash(x, y) - 0.5) * 0.03;
  if (y < 4) return [40, 36, 34];
  if (y >= 108 && y < 116) return trim;
  if (y < 108) {
    const panel = (x % 64 < 2 || y % 108 < 3 || y > 100) ? 0.72 : 1;
    return tint(wains, k * panel);
  }
  if (pattern === 'stripe' && x % 32 < 3) return tint(upper, k * 0.86);
  if (pattern === 'damask' && ((x % 32) - 16) ** 2 + ((y % 40) - 20) ** 2 < 40) return tint(upper, k * 0.88);
  return tint(upper, k);
});
wallTex('wall_cream', [104, 66, 40], [232, 224, 204], [196, 160, 80], 61, 'plain');
wallTex('wall_wood', [88, 52, 30], [150, 98, 58], [206, 170, 84], 62, 'stripe');
wallTex('wall_blue', [30, 52, 92], [90, 130, 168], [200, 166, 84], 63, 'damask');
wallTex('wall_cabin', [150, 120, 84], [214, 222, 224], [236, 236, 230], 64, 'plain');
wallTex('wall_bridge', [58, 66, 78], [110, 124, 138], [220, 180, 40], 65, 'plain');
wallTex('wall_white', [220, 224, 228], [238, 241, 244], [190, 196, 204], 66, 'plain');
tex('carpet_red', 256, (x, y, u, v) => {
  const k = 0.84 + fbm(u, v, 40, 2, 71) * 0.3 + (hash(x, y) - 0.5) * 0.1;
  if (x % 128 < 10 || x % 128 > 117) return tint([196, 160, 70], k);
  const diamond = Math.abs(x % 64 - 32) + Math.abs(y % 64 - 32) < 14 ? 1.25 : 1;
  return [132 * k * diamond, 28 * k * diamond, 40 * k * diamond];
});
tex('carpet_navy', 256, (x, y, u, v) => {
  const k = 0.84 + fbm(u, v, 40, 2, 72) * 0.3 + (hash(x, y) - 0.5) * 0.1;
  const star = Math.abs(x % 64 - 32) + Math.abs(y % 64 - 32) < 6 ? 1.9 : 1;
  return [34 * k * star, 52 * k * star, 106 * k * (star > 1 ? 1.1 : 1)];
});
tex('carpet_teal', 256, (x, y, u, v) => {
  const k = 0.84 + fbm(u, v, 40, 2, 73) * 0.3 + (hash(x, y) - 0.5) * 0.1;
  const lines = (Math.abs(((x + y) % 64) - 32) < 1.5) ? 1.3 : 1;
  return [36 * k * lines, 112 * k * lines, 116 * k * lines];
});
tex('marble_check', 256, (x, y, u, v) => {
  const dark = (Math.floor(x / 64) + Math.floor(y / 64)) % 2 === 1;
  const vein = Math.abs(fbm(u, v, 5, 4, 74) - 0.5) < 0.025 ? 0.78 : 1;
  const k = (0.92 + fbm(u, v, 12, 2, 75) * 0.12) * vein;
  if (x % 64 < 1 || y % 64 < 1) return [120, 116, 108];
  return dark ? [44 * k, 48 * k, 54 * k] : [232 * k, 228 * k, 218 * k];
});
tex('parquet', 256, (x, y) => {
  const bx = Math.floor(x / 32), by = Math.floor(y / 32);
  const horiz = (bx + by) % 2 === 0;
  const lx = horiz ? y % 8 : x % 8;
  const k = 0.76 + hash(bx, by, 9) * 0.34 + noise2(x / 5, y / 40, 64, 3) * 0.12;
  if (lx < 1 || x % 32 < 1 || y % 32 < 1) return [60, 36, 22];
  return [168 * k, 112 * k, 66 * k];
});
tex('stage', 256, (x, y) => {
  const k = 0.5 + noise2(x / 80, y / 3, 64, 6) * 0.3 + hash(Math.floor(y / 32), 2) * 0.12;
  if (y % 32 < 2) return [20, 12, 8];
  return [96 * k, 58 * k, 34 * k];
});
tex('velvet', 128, (x, y, u, v) => { const k = 0.8 + fbm(u, v, 24, 2, 76) * 0.4; return [150 * k, 20 * k, 34 * k]; });
tex('curtain', 128, (x) => { const f = 0.62 + 0.38 * Math.cos((x / 128) * Math.PI * 8); return [160 * f, 22 * f, 36 * f]; });
tex('tablecloth', 128, (x, y) => ((x % 64 < 2 || y % 64 < 2) ? [212, 214, 222] : [244, 244, 240]));
tex('bedding', 128, (x, y) => ((y < 40) ? [248, 248, 244] : (Math.floor(x / 24) % 2 ? [60, 110, 170] : [78, 128, 188])));
tex('wood_dark', 128, (x, y) => { const k = 0.7 + noise2(x / 60, y / 3, 32, 5) * 0.5; return [96 * k, 58 * k, 34 * k]; });
tex('wood_light', 128, (x, y) => { const k = 0.72 + noise2(x / 60, y / 3, 32, 6) * 0.5; return [190 * k, 146 * k, 96 * k]; });
tex('steel', 128, (x, y) => { const k = 0.82 + 0.2 * Math.sin((x / 128) * Math.PI * 2) + (hash(x, y) - 0.5) * 0.05; return [150 * k, 158 * k, 166 * k]; });
tex('lifeboat', 256, (x, y, u, v) => {
  const k = 0.92 + fbm(u, v, 10, 2, 77) * 0.14;
  if (y > 118 && y < 138) return [244 * k, 244 * k, 238 * k];
  if (x % 128 < 3) return [150 * k, 70 * k, 20 * k];
  return [244 * k, 108 * k, 22 * k];
});
tex('boat_white', 128, (x, y, u, v) => { const k = 0.92 + fbm(u, v, 10, 2, 78) * 0.1; return y > 100 ? [30 * k, 70 * k, 140 * k] : [236 * k, 238 * k, 240 * k]; });
tex('funnel_navy', 256, (x, y, u, v) => { const k = 0.9 + fbm(u, v, 8, 3, 79) * 0.16; return [26 * k, 44 * k, 92 * k]; });
tex('gold', 64, (x, y) => { const k = 0.85 + 0.2 * Math.sin(y / 64 * Math.PI * 2); return [214 * k, 170 * k, 60 * k]; });
tex('court', 256, (x, y, u, v) => {
  const k = 0.9 + fbm(u, v, 12, 2, 80) * 0.16;
  const r = Math.hypot(x - 128, y - 128);
  const line = x < 6 || x > 249 || y < 6 || y > 249 || Math.abs(x - 128) < 3 || (r < 42 && r > 38);
  return line ? [244, 244, 240] : [34 * k, 108 * k, 158 * k];
});
tex('crate', 256, (x, y) => {
  const e = Math.min(x, y, 255 - x, 255 - y);
  const brace = Math.abs(x - y) < 10 || Math.abs(x + y - 255) < 10;
  let k = 0.82 + hash(Math.floor(y / 36), 5) * 0.22 + noise2(x / 60, y / 3, 64, 2) * 0.3;
  if (e < 20 || brace) k *= 1.1;
  if (e === 20 || e === 21) k *= 0.55;
  return [186 * k, 140 * k, 82 * k];
});
tex('stair_x', 128, (x) => { const f = x % 32; return f < 4 ? [214, 176, 80] : f < 8 ? [80, 24, 34] : [118, 30, 42]; });
tex('stair_deck_x', 128, (x) => { const f = x % 32; return f < 4 ? [236, 232, 150] : [96, 112, 116]; });
tex('hatch', 128, (x, y, u, v) => {
  const e = Math.min(x, y, 127 - x, 127 - y);
  const k = 0.9 + fbm(u, v, 8, 2, 81) * 0.14;
  return e < 8 ? [220 * k, 180 * k, 40 * k] : [96 * k, 112 * k, 114 * k];
});
tex('plant', 128, (x, y, u, v) => { const k = 0.6 + fbm(u, v, 12, 3, 82) * 0.8; return [34 * k, 110 * k, 48 * k]; });
tex('soil', 64, (x, y) => [72 + hash(x, y) * 30, 52 + hash(y, x) * 20, 36]);
tex('tarmac', 128, (x, y, u, v) => { const k = 0.8 + fbm(u, v, 20, 2, 83) * 0.3; return [66 * k, 70 * k, 76 * k]; });
TEX.screen = paint(256, 256, (x, y) => {
  const scan = y % 4 < 2 ? 0.6 : 1;
  const ring = Math.abs(Math.hypot(x - 128, y - 128) % 40 - 20) < 1.2 ? 1 : 0.25;
  return [30 * scan * ring, 210 * scan * (0.4 + ring * 0.6), 120 * scan * ring];
}).png();
tex('ocean', 512, (x, y, u, v) => {
  const w = fbm(u, v, 14, 4, 90), w2 = fbm(u * 3, v * 3, 10, 3, 91);
  const crest = clamp((w - 0.62) * 5) * 0.5 + clamp((w2 - 0.7) * 4) * 0.25;
  const k = 0.78 + w * 0.5;
  return lerp3([14 * k, 78 * k, 124 * k], [200, 226, 240], crest);
});
TEX.foam = paint(256, 256, (x, y, u, v) => {
  const a = clamp((fbm(u, v, 18, 3, 92) - 0.35) * 3.2);
  return [244, 250, 252, a * 255];
}, 4).png();

const SIGNS = {
  sign_aurora: signTex('AURORA STAR', [24, 40, 88], [238, 241, 244], 1024, 128, 9, 0),
  sign_theatre: signTex('THEATRE', [236, 196, 90], [28, 20, 22], 512, 128, 11, 0.55),
  sign_atrium: signTex('ATRIUM', [236, 196, 90], [28, 20, 22], 512, 128, 11, 0.55),
  sign_bridge: signTex('BRIDGE', [250, 250, 250], [20, 30, 56], 512, 128, 11, 0.5),
  sign_pool: signTex('POOL', [250, 250, 250], [24, 120, 170], 512, 128, 14, 0.4),
};

// ------------------------------------------------------------ materials ----
const W = new World();
const M = (name, def) => W.defMat(name, def);
const mt = (name, tile, extra = {}) => M(name, { tex: TEX[name], tile, ...extra });
mt('white_paint', [128, 128]);
mt('hull_white', [512, 290]);
mt('hull_navy', [128, 128]);
mt('hull_red', [64, 64]);
mt('teak', [128, 128], { rough: 0.7 });
mt('deck_steel', [128, 128]);
mt('deck_tile', [128, 128], { rough: 0.45 });
mt('pool_tile', [96, 96], { rough: 0.3 });
M('water', { tex: TEX.water, tile: [140, 140], blend: true, rough: 0.05, emissive: [0.02, 0.1, 0.14] });
mt('coping', [128, 128], { rough: 0.5 });
mt('cushion', [64, 64]);
mt('awning', [64, 64]);
mt('awning_blue', [64, 64]);
mt('ceiling', [128, 128]);
for (const n of ['wall_cream', 'wall_wood', 'wall_blue', 'wall_cabin', 'wall_bridge', 'wall_white']) mt(n, [128, 128]);
mt('carpet_red', [96, 96]);
mt('carpet_navy', [96, 96]);
mt('carpet_teal', [96, 96]);
mt('marble_check', [128, 128], { rough: 0.2 });
mt('parquet', [96, 96], { rough: 0.5 });
mt('stage', [96, 96]);
mt('velvet', [48, 48]);
mt('curtain', [64, 64]);
mt('tablecloth', [48, 48]);
mt('bedding', [64, 64]);
mt('wood_dark', [64, 64]);
mt('wood_light', [64, 64]);
mt('steel', [64, 64], { rough: 0.35 });
mt('lifeboat', [128, 128]);
mt('boat_white', [96, 96]);
mt('funnel_navy', [128, 128]);
mt('gold', [32, 32], { rough: 0.3 });
mt('court', [280, 520]);
mt('crate', [56, 56]);
mt('hatch', [64, 64]);
mt('plant', [64, 64]);
mt('soil', [32, 32]);
mt('tarmac', [96, 96]);
mt('stair_x', [64, 64]);
mt('stair_deck_x', [64, 64]);
M('screen', { color: [0.1, 0.1, 0.1, 1], emissiveTex: TEX.screen, emissive: [1, 1, 1], tile: [60, 60] });
M('ocean', { tex: TEX.ocean, tile: [800, 800], rough: 0.2, emissive: [0.02, 0.1, 0.16] });
M('foam', { tex: TEX.foam, tile: [260, 260], blend: true, rough: 0.9, emissive: [0.25, 0.25, 0.25] });
M('glass', { color: [0.62, 0.86, 1, 0.22], blend: true, rough: 0.1 });
M('lamp', { color: [0.05, 0.05, 0.04, 1], emissive: [1.0, 0.86, 0.6] });
M('core_glow', { color: [0.05, 0.08, 0.1, 1], emissive: [0.3, 0.8, 1.0] });
M('red_light', { color: [0.1, 0.02, 0.02, 1], emissive: [1.0, 0.1, 0.08] });
M('black_trim', { color: [0.05, 0.055, 0.065, 1], rough: 0.6 });
M('white_solid', { color: [0.92, 0.94, 0.96, 1], rough: 0.5 });
M('rail_chrome', { color: [0.8, 0.84, 0.88, 1], rough: 0.25 });
for (const [n, s] of Object.entries(SIGNS)) M(n, { tex: s.base, emissiveTex: s.emi, emissive: [1, 1, 1], tile: [160, 40] });

// ---------------------------------------------------------- authoring kit ----
/** Authoring context: z mirrored by s, y offset. All coordinates are in the authored (s=+1) frame. */
class Ctx {
  constructor(s = 1, y = 0) { this.s = s; this.y = y; }
  at(y) { return new Ctx(this.s, y); }
  box(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    const a = this.s * z0, b = this.s * z1;
    W.box(Math.min(x0, x1), this.y + y0, Math.min(a, b), Math.max(x0, x1), this.y + y1, Math.max(a, b), mat, o);
  }
  slab(pts, tops, yb, mat, o = {}) { W.slab(pts.map((p) => [p[0], this.s * p[1]]), tops.map((t) => this.y + t), this.y + yb, mat, o); }
  cyl(c1, c2, r, a, b, mat, o = {}) {
    const axis = o.axis ?? 'y';
    if (axis === 'y') W.cyl(c1, this.s * c2, r, this.y + a, this.y + b, mat, o);
    else if (axis === 'x') W.cyl(this.y + c1, this.s * c2, r, Math.min(a, b), Math.max(a, b), mat, o);
    else { const p = this.s * a, q = this.s * b; W.cyl(c1, this.y + c2, r, Math.min(p, q), Math.max(p, q), mat, o); }
  }
  /** Wall along `axis` at coordinate c from a..b, thickness t, height h, openings [{at,w,sill,head}]. */
  wall(axis, c, a, b, t, h, mat, openings = [], o = {}) {
    const ops = [...openings].sort((p, q) => p.at - q.at);
    const put = (s0, s1, y0, y1) => {
      if (s1 - s0 < 0.5 || y1 - y0 < 0.5) return;
      if (axis === 'x') this.box(s0, y0, c - t / 2, s1, y1, c + t / 2, mat, o);
      else this.box(c - t / 2, y0, s0, c + t / 2, y1, s1, mat, o);
    };
    let cursor = a;
    for (const op of ops) {
      const s0 = op.at - op.w / 2, s1 = op.at + op.w / 2;
      put(cursor, s0, 0, h);
      put(s0, s1, 0, op.sill ?? 0);
      put(s0, s1, op.head ?? h, h);
      cursor = s1;
    }
    put(cursor, b, 0, h);
  }
  /** Walkable ramp along x, rising from hA at a0 to hB at a1, across z b0..b1, solid down to yb. */
  stair(a0, a1, b0, b1, hA, hB, yb, o = {}) {
    const pts = [[a0, b0], [a0, b1], [a1, b1], [a1, b0]];
    this.slab(pts, [hA, hA, hB, hB], yb, o.top ?? 'stair_x', { mats: { side: 'white_paint', bottom: 'white_paint' } });
    const t = 6, up = o.up ?? 50;
    const side = (s0, s1) => this.slab([[a0, s0], [a0, s1], [a1, s1], [a1, s0]], [hA + up, hA + up, hB + up, hB + up], yb, 'white_paint', { mats: { top: 'rail_chrome' } });
    if (o.left !== false) side(b0 - t, b0);
    if (o.right !== false) side(b1, b1 + t);
  }
}
const sym = (fn) => { fn(new Ctx(1, 0)); fn(new Ctx(-1, 0)); };
const NOCOL = { collide: false };
const F2 = 168, F3 = 336, C1 = 128, C2 = 296;
const T = 14;
const pillar = (x, z, y0 = 0, y1 = C1, mat = 'white_paint', r = 7) => W.box(x - r, y0, z - r, x + r, y1, z + r, mat);

/** Wall-mounted sign planes. signZ: on a z-facing wall; signX: on an x-facing wall. */
function signZ(mat, x0, x1, y0, y1, z, face) {
  const w = x1 - x0, h = y1 - y0;
  const o = face > 0 ? { tile: [w, -h], uvOffset: [x0, y1] } : { tile: [-w, -h], uvOffset: [x1, y1] };
  W.box(x0, y0, face > 0 ? z : z - 3, x1, y1, face > 0 ? z + 3 : z, mat, { ...o, collide: false });
}
function signX(mat, x, z0, z1, y0, y1, face) {
  const w = z1 - z0, h = y1 - y0;
  const o = face > 0 ? { tile: [-w, -h], uvOffset: [z1, y1] } : { tile: [w, -h], uvOffset: [z0, y1] };
  W.box(face > 0 ? x : x - 3, y0, z0, face > 0 ? x + 3 : x, y1, z1, mat, { ...o, collide: false });
}

// ------------------------------------------------------------ outline ------
const OUTLINE = [[-3600, -900], [3000, -900], [3700, -90], [3700, 90], [3000, 900], [-3600, 900]];
function seg2(p, q, ref = [0, 0], ext = 0) {
  const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
  const ux = dx / l, uz = dz / l;
  let nx = -uz, nz = ux; // inward normal: towards `ref`
  if (nx * (ref[0] - (p[0] + q[0]) / 2) + nz * (ref[1] - (p[1] + q[1]) / 2) < 0) { nx = -nx; nz = -nz; }
  return { p: [p[0] - ux * ext, p[1] - uz * ext], q: [q[0] + ux * ext, q[1] + uz * ext], nx, nz };
}
/** Prism strip along p-q covering offsets [o0,o1] from the line (positive = inward). */
function strip(p, q, o0, o1, y0, y1, mat, o = {}, ref = [0, 0], ext = 0) {
  const s = seg2(p, q, ref, ext);
  const pt = (pp, off) => [pp[0] + s.nx * off, pp[1] + s.nz * off];
  W.slab([pt(s.p, o0), pt(s.q, o0), pt(s.q, o1), pt(s.p, o1)], [y1, y1, y1, y1], y0, mat, o);
}
/** Bulwark + glass + chrome top bar along an edge at base y; ref is a point on the deck side. */
function railEdge(p, q, y, ref = [0, 0], posts = false) {
  strip(p, q, 0, 14, y, y + 36, 'white_paint', { mats: { top: 'coping' } }, ref, 6);
  strip(p, q, 5, 9, y + 36, y + 112, 'glass', {}, ref, 6);
  strip(p, q, 3, 11, y + 112, y + 118, 'rail_chrome', NOCOL, ref, 6);
  if (posts) {
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const n = Math.max(1, Math.round(Math.hypot(dx, dz) / 200));
    const s = seg2(p, q, ref);
    for (let i = 0; i <= n; i += 1) {
      const cx = p[0] + (dx * i) / n + s.nx * 7, cz = p[1] + (dz * i) / n + s.nz * 7;
      W.box(cx - 3, y + 36, cz - 3, cx + 3, y + 114, cz + 3, 'rail_chrome', NOCOL);
    }
  }
}

// ---- ocean, foam, hull
W.box(-40000, -343, -40000, 40000, -340, 40000, 'ocean', { collide: false, tile: [800, 800] });
W.box(-3700, -339.6, -1000, 3000, -339.5, 1000, 'foam', { collide: false, tile: [260, 260] });
W.slab([[3000, -1000], [3790, -110], [3790, 110], [3000, 1000]], [-339.5, -339.5, -339.5, -339.5], -339.6, 'foam', { collide: false, tile: [260, 260] });
for (let i = 0; i < OUTLINE.length; i += 1) {
  const p = OUTLINE[i], q = OUTLINE[(i + 1) % OUTLINE.length];
  strip(p, q, -11, 0, -290, 36, 'hull_white', { collide: false, tile: [512, 290], uvOffset: [0, -290] });
  strip(p, q, -13, 0, -420, -300, 'hull_navy', NOCOL);
  strip(p, q, -12, 0, -300, -290, 'hull_red', NOCOL);
  railEdge(p, q, 0, [0, 0], true);
}
signZ('sign_aurora', 2330, 2930, -150, -75, 911, 1);
signZ('sign_aurora', 2330, 2930, -150, -75, -911, -1);
signX('sign_aurora', -3611, -300, 300, -150, -75, -1);

// ------------------------------------------------------------ floors L1 ----
const floor = (x0, x1, z0, z1, mat) => W.box(x0, -40, z0, x1, 0, z1, mat, { mats: { side: 'white_paint', bottom: 'white_paint' } });
floor(-3600, -2750, -900, 900, 'teak');
floor(-2750, 2300, 730, 900, 'teak');
floor(-2750, 2300, -900, -730, 'teak');
floor(2300, 3000, -900, 900, 'deck_steel');
W.slab([[3000, -900], [3700, -90], [3700, 90], [3000, 900]], [0, 0, 0, 0], -40, 'deck_steel', { mats: { side: 'white_paint', bottom: 'white_paint' } });
floor(-2750, -1850, -730, 730, 'carpet_red');
floor(-1850, -1000, -730, 730, 'carpet_navy');
floor(-1000, -500, -730, 730, 'parquet');
floor(-500, 500, -730, 730, 'marble_check');
floor(500, 900, -730, 730, 'parquet');
floor(900, 1700, -730, 730, 'carpet_teal');
floor(1700, 2300, -730, 730, 'carpet_red');

// ------------------------------------------------------------ L2 slab ------
const XS = [-3150, -1950, -1750, -1150, -950, -380, 380, 2300];
const ZS = [-900, -480, -340, -170, 170, 340, 480, 900];
const POOL = [-1750, -1150, -170, 170];
const VOID = [-380, 380, -480, 480];
for (let i = 0; i + 1 < XS.length; i += 1) for (let j = 0; j + 1 < ZS.length; j += 1) {
  const [x0, x1, z0, z1] = [XS[i], XS[i + 1], ZS[j], ZS[j + 1]];
  if (x0 === POOL[0] && x1 === POOL[1] && z0 === POOL[2] && z1 === POOL[3]) continue;
  if (x0 >= VOID[0] && x1 <= VOID[1] && z0 >= VOID[2] && z1 <= VOID[3]) continue;
  const around = x0 >= -1950 && x1 <= -950 && z0 >= -340 && z1 <= 340;
  W.box(x0, C1, z0, x1, F2, z1, around ? 'deck_tile' : 'teak', { mats: { side: 'white_paint', bottom: 'ceiling' } });
}
{
  const [px0, px1, pz0, pz1] = POOL, t = 4;
  W.box(px0, 128, pz0, px1, 136, pz1, 'pool_tile', { mats: { bottom: 'ceiling' } });
  const lining = { mats: { top: 'coping' } };
  W.box(px0, 136, pz0, px1, F2, pz0 + t, 'pool_tile', lining);
  W.box(px0, 136, pz1 - t, px1, F2, pz1, 'pool_tile', lining);
  W.box(px0, 136, pz0 + t, px0 + t, F2, pz1 - t, 'pool_tile', lining);
  W.box(px1 - t, 136, pz0 + t, px1, F2, pz1 - t, 'pool_tile', lining);
  W.box(px0 + t, 160, pz0 + t, px1 - t, 160.6, pz1 - t, 'water', { collide: false, tile: [140, 140] });
}
// L2 perimeter rails (gaps at the stern and bow stair landings)
for (const [a, b] of [
  [[-3150, -900], [2300, -900]], [[2300, 900], [-3150, 900]],
  [[2300, -900], [2300, -790]], [[2300, -630], [2300, -500]], [[2300, 500], [2300, 630]], [[2300, 790], [2300, 900]],
  [[-3150, -900], [-3150, -790]], [[-3150, -630], [-3150, 630]], [[-3150, 790], [-3150, 900]],
]) railEdge(a, b, F2, [0, 0], a[0] === b[0] ? false : true);

// ----------------------------------------------- promenade + lifeboats ----
sym((c) => {
  for (let x = -2700; x <= 2250; x += 300) pillar(x, c.s * 876);
  for (const x of [-2400, -1560, -720, 120, 960, 1800]) {
    c.box(x - 40, 0, 744, x + 40, 20, 768, 'wood_light');
    c.box(x - 40, 20, 764, x + 40, 44, 770, 'wood_light');
  }
  for (const x of [-2550, -2050, -1550, -1050, -550, 550, 1050, 1550, 2050]) {
    c.cyl(95, 972, 44, x - 150, x + 150, 'lifeboat', { axis: 'x', seg: 10, collide: false, tile: [128, 128] });
    c.cyl(95, 972, 30, x - 168, x + 168, 'white_solid', { axis: 'x', seg: 8, collide: false });
    c.box(x - 150, 52, 960, x + 150, 56, 984, 'white_solid', NOCOL);
    for (const dx of [-110, 110]) {
      c.box(x + dx - 3, 36, 918, x + dx + 3, 122, 924, 'rail_chrome', NOCOL);
      c.box(x + dx - 3, 114, 918, x + dx + 3, 122, 972, 'rail_chrome', NOCOL);
    }
  }
});

// ----------------------------------------------------- stern bay (L1) ----
sym((c) => {
  c.cyl(-3470, 230, 40, 0, 56, 'steel', { seg: 14 });
  c.cyl(-3470, 230, 44, 56, 62, 'rail_chrome', { seg: 14, collide: false });
  c.box(-3560, 0, 190, -3380, 20, 270, 'deck_steel');
  c.box(-3520, 0, 440, -3430, 56, 530, 'crate');
  c.box(-3430, 0, 440, -3340, 56, 530, 'crate');
  c.box(-3520, 56, 460, -3450, 106, 520, 'crate');
  c.box(-3040, 0, 500, -3000, 100, 560, 'white_paint');
  c.stair(-3490, -3150, 640, 780, 0.4, F2, 0, { top: 'stair_deck_x' });
  for (const x of [-3580, -3300]) c.cyl(x, 878, 9, 0, 22, 'black_trim', { seg: 8 });
  for (let i = 0; i < 3; i += 1) {
    c.box(-3585, 0, 330 + i * 40, -3520, 12, 360 + i * 40, 'cushion', NOCOL);
    c.box(-3585, 12, 330 + i * 40, -3566, 28, 360 + i * 40, 'cushion', NOCOL);
  }
});
// tender boat on a cradle: central cover for the spawn
W.cyl(40, 0, 70, -3430, -3170, 'boat_white', { axis: 'x', seg: 12, tile: [96, 96] });
W.cyl(40, 0, 56, -3170, -3140, 'boat_white', { axis: 'x', seg: 8 });
W.cyl(40, 0, 56, -3460, -3430, 'boat_white', { axis: 'x', seg: 8 });
W.box(-3420, 0, -50, -3190, 40, 50, 'deck_steel');
for (const z of [-820, -420, 0, 420, 820]) { pillar(-3140, z, 0, C1, 'white_paint', 9); pillar(-2780, z, 0, C1, 'white_paint', 9); }
W.box(-3000, 0, -250, -2960, 44, 250, 'wood_dark', { mats: { top: 'gold' } });
W.box(-2992, 44, -250, -2968, 90, -246, 'lamp', NOCOL);
W.box(-2992, 44, 246, -2968, 90, 250, 'lamp', NOCOL);

// ------------------------------------------------------ interior shells ----
const doorH = 108;
const door = (at, w = 84) => ({ at, w, head: doorH });
const window_ = (at, w = 70) => ({ at, w, sill: 44, head: 104 });
const wallsLayer = new Ctx(1, 0);
const bulk = (x, ops, mat, t = T) => wallsLayer.wall('z', x, -730, 730, t, C1, mat, ops);
const wide = (at, w = 200) => ({ at, w, head: 112 });
bulk(-2750, [door(-360), door(0), door(360)], 'wall_white', 18);
bulk(-1850, [door(-360), door(0), door(360)], 'wall_wood');
bulk(-1000, [{ at: -480, w: 160, head: doorH }, { at: 0, w: 200, head: doorH }, { at: 480, w: 160, head: doorH }], 'wall_wood');
bulk(-500, [wide(-460), wide(0, 220), wide(460)], 'wall_wood');
bulk(500, [wide(-460), wide(0, 220), wide(460)], 'wall_wood');
bulk(900, [{ at: -400, w: 160, head: doorH }, { at: 0, w: 140, head: doorH }, { at: 400, w: 160, head: doorH }], 'wall_blue');
bulk(1700, [door(-360), door(0), door(360)], 'wall_white');
bulk(2300, [door(-360, 90), door(0, 90), door(360, 90)], 'wall_white', 18);

sym((c) => {
  const zone = (x0, x1, mat, ops) => c.wall('x', -730, x0, x1, T, C1, mat, ops);
  zone(-2750, -1850, 'wall_cabin', [window_(-2637), window_(-2412), window_(-2112), window_(-1937)]);
  zone(-1850, -1000, 'wall_wood', [door(-1650, 90), door(-1200, 90), window_(-1480, 100), window_(-1380, 100)]);
  zone(-1000, -500, 'wall_cream', [window_(-900, 100), door(-750, 100), window_(-600, 100)]);
  zone(-500, 500, 'wall_wood', [-380, -130, 130, 380].map((at) => ({ at, w: 120, head: 112 })));
  zone(500, 900, 'wall_cream', [window_(600, 100), door(700, 100), window_(800, 100)]);
  zone(900, 1700, 'wall_blue', [
    { at: 1000, w: 90, sill: 30, head: 112 }, { at: 1150, w: 90, sill: 30, head: 112 }, door(1300, 100),
    { at: 1450, w: 90, sill: 30, head: 112 }, { at: 1600, w: 90, sill: 30, head: 112 },
  ]);
  zone(1700, 2300, 'wall_cabin', [window_(1825), window_(2000), window_(2175)]);
});

/** Corridor grid of cabins (authored on +z, mirrored). Cross corridor between cutA..cutB joins C0 and C-N. */
function cabinBlock(cfg) {
  const { x0, x1, cutA, cutB, c0Doors, cnDoors, rowDividers, suiteDividers } = cfg;
  sym((c) => {
    const run = (zc, ops) => {
      for (const [a, b] of [[x0, cutA], [cutB, x1]]) c.wall('x', zc, a, b, 10, C1, 'wall_cabin', ops.filter((x) => x > a && x < b).map((x) => door(x, 76)));
    };
    run(65, c0Doors);
    run(300, cnDoors);
    c.wall('x', 420, x0, x1, 10, C1, 'wall_cabin', [...c0Doors, ...cnDoors].map((x) => door(x, 76)));
    for (const x of rowDividers) c.wall('z', x, 65, 300, 8, C1, 'wall_cabin');
    for (const x of suiteDividers) c.wall('z', x, 420, 730, 8, C1, 'wall_cabin');
    c.wall('z', cutA, 65, 300, 10, C1, 'wall_cabin');
    c.wall('z', cutB, 65, 300, 10, C1, 'wall_cabin');
    for (const x of [...c0Doors, ...cnDoors]) {
      for (const [z0, z1] of [[70, 300], [425, 730]]) {
        const mid = (z0 + z1) / 2;
        c.box(x - 30, 0, z1 - 150, x + 30, 22, z1 - 10, 'bedding');
        c.box(x - 70, 0, mid - 15, x - 50, 108, mid + 25, 'wood_dark');
        c.box(x + 54, 0, z1 - 30, x + 80, 24, z1 - 10, 'wood_light');
      }
    }
  });
  for (let x = x0 + 100; x < x1; x += 200) {
    for (const z of [-360, 0, 360]) W.box(x - 20, 124, z - 4, x + 20, 128, z + 4, 'lamp', NOCOL);
  }
}
cabinBlock({ x0: -2750, x1: -1850, cutA: -2300, cutB: -2200, c0Doors: [-2637, -2412], cnDoors: [-2112, -1937], rowDividers: [-2525, -2025], suiteDividers: [-2525, -2025] });
cabinBlock({ x0: 1700, x1: 2300, cutA: 1950, cutB: 2050, c0Doors: [1825], cnDoors: [2175], rowDividers: [], suiteDividers: [2000] });

// ----------------------------------------------------------- theatre ------
{
  W.box(-1770, 0, -720, -1690, 36, 720, 'stage', { mats: { top: 'stage', side: 'wood_dark' } });
  W.box(-1766, 36, -716, -1762, 150, 716, 'curtain', NOCOL);
  new Ctx(1, 0).stair(-1690, -1590, -120, 120, 36, 0.4, 0, { left: false, right: false });
  sym((c) => {
    for (let r = 0; r < 6; r += 1) {
      const x = -1540 + r * 82;
      c.box(x, 0, 70, x + 36, 40, 330, 'velvet');
      c.box(x, 0, 400, x + 36, 40, 650, 'velvet');
      c.box(x + 30, 40, 70, x + 36, 62, 330, 'velvet', NOCOL);
      c.box(x + 30, 40, 400, x + 36, 62, 650, 'velvet', NOCOL);
    }
    c.box(-1770, 120, 0, -1690, 128, 700, 'black_trim', NOCOL);
    for (const z of [100, 300, 500]) c.box(-1750, 112, z - 8, -1740, 120, z + 8, 'lamp', NOCOL);
  });
  signX('sign_theatre', -993, -300, -164, 84, 118, 1);
  signX('sign_theatre', -993, 164, 300, 84, 118, 1);
}

// ----------------------------------------------------------- foyers -------
sym((c) => {
  c.box(-960, 0, 350, -880, 44, 380, 'wood_dark', { mats: { top: 'gold' } });
  c.box(-960, 0, 560, -900, 44, 580, 'wood_dark', { mats: { top: 'gold' } });
  c.box(-780, 0, 130, -740, 24, 250, 'wood_light');
  c.cyl(-680, 440, 26, 0, 30, 'soil', { seg: 10, capMat: 'soil' });
  c.cyl(-680, 440, 20, 30, 88, 'plant', { seg: 8, collide: false });
  c.box(-640, 0, 640, -560, 40, 700, 'wood_dark', { mats: { top: 'gold' } });
  c.box(880, 0, 350, 820, 44, 380, 'wood_dark', { mats: { top: 'gold' } });
  c.box(740, 0, 140, 780, 24, 250, 'wood_light');
  c.cyl(620, 440, 26, 0, 30, 'soil', { seg: 10, capMat: 'soil' });
  c.cyl(620, 440, 20, 30, 88, 'plant', { seg: 8, collide: false });
  c.box(600, 0, 640, 680, 40, 700, 'wood_dark', { mats: { top: 'gold' } });
  for (const x of [-860, -720, 580, 740]) c.box(x - 30, 118, 300, x + 30, 122, 306, 'lamp', NOCOL);
});

// ---------------------------------------------------------- atrium --------
{
  const N0 = new Ctx(1, 0);
  // grand stairs: north flight rises westward onto the L2 deck, south flight rises eastward
  N0.stair(-40, -380, -480, -370, 0.4, F2, 0, { left: false, right: true, up: 54 });
  N0.stair(40, 380, 370, 480, 0.4, F2, 0, { left: true, right: false, up: 54 });
  const rail = (x0, z0, x1, z1) => {
    W.box(x0, F2, z0, x1, F2 + 54, z1, 'glass');
    W.box(x0, F2 + 54, z0, x1, F2 + 60, z1, 'rail_chrome', NOCOL);
  };
  rail(-386, -370, -380, 480);
  rail(380, -480, 386, 370);
  rail(-40, -486, 380, -480);
  rail(-380, 480, 40, 486);
  for (const z of [150, 420, 650]) for (const s of [-1, 1]) { pillar(-440, s * z, 0, C1, 'wall_wood', 14); pillar(440, s * z, 0, C1, 'wall_wood', 14); }
  W.cyl(0, 0, 100, 0, 22, 'marble_check', { seg: 24, capMat: 'marble_check', capTile: 128 });
  W.cyl(0, 0, 92, 22, 24, 'water', { seg: 24, collide: false });
  W.cyl(0, 0, 26, 0, 420, 'core_glow', { seg: 14 });
  W.cyl(0, 0, 40, 24, 36, 'gold', { seg: 14, collide: false });
  W.cyl(0, 0, 40, 300, 310, 'gold', { seg: 14, collide: false });
  W.cyl(0, 0, 36, F2 + 80, F2 + 86, 'gold', { seg: 14, collide: false });
  for (const [x, z] of [[-440, 0], [440, 0], [0, -610], [0, 610]]) W.cyl(x, z, 40, 112, 118, 'lamp', { seg: 12, collide: false });
  signZ('sign_atrium', -60, 60, 84, 118, -723, 1);
  signZ('sign_atrium', -60, 60, 84, 118, 723, -1);
  // glass dome over the void (visual only)
  W.box(-380, 436, -480, 380, 440, 480, 'glass', NOCOL);
  for (const x of [-380, 0, 380]) W.box(x - 3, 436, -480, x + 3, 442, 480, 'rail_chrome', NOCOL);
  for (const z of [-480, -240, 0, 240, 480]) W.box(-380, 436, z - 3, 380, 442, z + 3, 'rail_chrome', NOCOL);
  for (const [x, z] of [[-380, -480], [380, -480], [-380, 480], [380, 480]]) W.box(x - 6, F2, z - 6, x + 6, 440, z + 6, 'rail_chrome', NOCOL);
}

// -------------------------------------------------------- restaurant ------
sym((c) => {
  for (const [x, z] of [[980, 150], [980, 520], [1160, 260], [1160, 600], [1400, 130], [1400, 460], [1580, 300], [1580, 620]]) {
    c.cyl(x, z, 34, 0, 32, 'tablecloth', { seg: 12, capMat: 'tablecloth', capTile: 48 });
    c.cyl(x, z, 5, 32, 38, 'gold', { seg: 6, collide: false });
    for (const [dx, dz] of [[44, 0], [-44, 0], [0, 44], [0, -44]]) c.box(x + dx - 9, 0, z + dz - 9, x + dx + 9, 18, z + dz + 9, 'wood_dark', NOCOL);
  }
  c.box(1240, 0, 30, 1330, 38, 120, 'wood_dark', { mats: { top: 'marble_check' } });
  c.box(1240, 0, 120, 1260, 38, 380, 'wood_dark', { mats: { top: 'marble_check' } });
  pillar(1100, c.s * 260, 0, C1, 'wall_blue', 12);
  pillar(1500, c.s * 260, 0, C1, 'wall_blue', 12);
  for (const x of [1000, 1300, 1600]) c.box(x - 30, 118, 300, x + 30, 122, 306, 'lamp', NOCOL);
});

// ----------------------------------------------------------- bow (L1) ----
sym((c) => {
  c.box(2800, 0, 60, 2960, 62, 130, 'deck_steel');
  c.cyl(2880, 95, 30, 62, 78, 'steel', { seg: 10 });
  c.cyl(3180, 200, 24, 0, 72, 'steel', { seg: 12 });
  c.cyl(3180, 200, 28, 72, 78, 'rail_chrome', { seg: 12, collide: false });
  c.box(2420, 0, 380, 2540, 70, 440, 'hatch');
  c.box(2620, 0, 560, 2720, 60, 620, 'crate');
  c.box(2620, 60, 570, 2690, 100, 610, 'crate');
  c.cyl(26, 640, 24, 2440, 2540, 'lifeboat', { axis: 'x', seg: 8, tile: [64, 64] });
  for (const x of [2400, 2700]) c.cyl(x, 872, 9, 0, 24, 'black_trim', { seg: 8 });
  c.stair(2640, 2300, 640, 780, 0.4, F2, 0, { top: 'stair_deck_x' });
});
W.box(2470, 0, -50, 2520, 14, 50, 'hatch', NOCOL);
W.cyl(3450, 0, 3, 36, 190, 'rail_chrome', { seg: 6, collide: false });
W.box(3450, 160, -30, 3452, 188, 0, 'hull_red', NOCOL);
W.box(3200, 0, -110, 3260, 30, 110, 'deck_steel');

// ======================================================= LIDO DECK (L2) ====
const lounger = (c, x, z, alongX = true) => {
  if (alongX) {
    c.box(x - 36, F2, z - 14, x + 36, F2 + 12, z + 14, 'white_solid', NOCOL);
    c.box(x - 34, F2 + 12, z - 12, x + 8, F2 + 16, z + 12, 'cushion', NOCOL);
    c.slab([[x + 8, z - 12], [x + 8, z + 12], [x + 34, z + 12], [x + 34, z - 12]], [F2 + 16, F2 + 16, F2 + 30, F2 + 30], F2 + 12, 'cushion', NOCOL);
  } else {
    c.box(x - 14, F2, z - 36, x + 14, F2 + 12, z + 36, 'white_solid', NOCOL);
    c.box(x - 12, F2 + 12, z - 34, x + 12, F2 + 16, z + 8, 'cushion', NOCOL);
    c.slab([[x - 12, z + 8], [x + 12, z + 8], [x + 12, z + 34], [x - 12, z + 34]], [F2 + 16, F2 + 16, F2 + 30, F2 + 30], F2 + 12, 'cushion', NOCOL);
  }
};
sym((c) => {
  const d = c.at(F2);
  for (let r = 0; r < 3; r += 1) for (let k = 0; k < 4; k += 1) lounger(c, -3000 + r * 150 + (r % 2) * 20, 430 + k * 90, false);
  for (let r = 0; r < 4; r += 1) lounger(c, -2700 + r * 130, 800, true);
  for (let k = 0; k < 7; k += 1) lounger(c, -1900 + k * 110, 250, true);
  for (let k = 0; k < 5; k += 1) lounger(c, -1800 + k * 130, 520, true);
  for (let k = 0; k < 4; k += 1) lounger(c, 400 + k * 110, 740, true);
  for (let k = 0; k < 3; k += 1) lounger(c, 1560, 300 + k * 90, false);
  for (const [x, z] of [[-2850, 520], [-2570, 620], [-1830, 400], [-1560, 400], [-1300, 400], [-1070, 400], [-1560, 700], [-1100, 700]]) {
    d.cyl(x, z, 2.5, 0, 112, 'rail_chrome', { seg: 6, collide: false });
    d.cyl(x, z, 46, 112, 118, 'awning', { seg: 10, collide: false, capTile: 90, capOffset: [x - 45, z - 45] });
  }
  d.cyl(-2050, 140, 62, 0, 20, 'coping', { seg: 16, capMat: 'coping', capTile: 128 });
  d.cyl(-2050, 140, 54, 20, 21, 'water', { seg: 16, collide: false });
  for (const x of [-3050, -2800, -2300, -2050, -1250]) { d.box(x - 40, 0, 840, x + 40, 28, 880, 'wood_dark'); d.box(x - 36, 28, 844, x + 36, 58, 876, 'plant', NOCOL); }
  // circular pool bar with a canopy, aft of the atrium
  d.cyl(-700, 280, 70, 0, 46, 'wood_dark', { seg: 18, capMat: 'gold', capTile: 64 });
  for (const a of [0, 1, 2, 3]) d.cyl(-700 + Math.cos(a * Math.PI / 2 + 0.78) * 60, 280 + Math.sin(a * Math.PI / 2 + 0.78) * 60, 3, 46, 130, 'rail_chrome', { seg: 6, collide: false });
  d.cyl(-700, 280, 78, 130, 136, 'awning_blue', { seg: 14, collide: false, capTile: 100, capOffset: [-778, 202] });
  for (const a of [0, 1, 2, 3, 4]) d.cyl(-700 + Math.cos(a * 1.2566) * 92, 280 + Math.sin(a * 1.2566) * 92, 10, 0, 28, 'velvet', { seg: 8, collide: false });
  // deck houses and planters break the long lanes
  d.box(-2450, 0, 560, -2330, 118, 700, 'white_paint', { mats: { top: 'steel' } });
  d.box(-1450, 0, 640, -1330, 110, 760, 'white_paint', { mats: { top: 'steel' } });
  d.box(-500, 0, 580, -440, 60, 700, 'white_paint', { mats: { top: 'steel' } });
  d.box(120, 0, 560, 240, 112, 640, 'white_paint', { mats: { top: 'steel' } });
  d.box(780, 0, 620, 900, 96, 760, 'white_paint', { mats: { top: 'steel' } });
  d.box(500, 0, 640, 600, 44, 700, 'wood_dark', { mats: { top: 'plant' } });
  d.box(1620, 0, 560, 1690, 56, 700, 'wood_dark', { mats: { top: 'plant' } });
  const cabana = (x, z) => {
    for (const [dx, dz] of [[-50, -40], [50, -40], [-50, 40], [50, 40]]) d.cyl(x + dx, z + dz, 4, 0, 120, 'white_solid', { seg: 6 });
    d.box(x - 58, 120, z - 48, x + 58, 126, z + 48, 'awning', { collide: false, mats: { top: 'awning', bottom: 'awning', side: 'white_paint' } });
    d.box(x - 34, 0, z - 28, x + 34, 14, z + 28, 'cushion', NOCOL);
  };
  cabana(-2600, 380); cabana(-1150, 520); cabana(1250, 700);
});
signZ('sign_pool', -1430, -1350, F2 + 66, F2 + 100, 640, -1);
signZ('sign_pool', -1430, -1350, F2 + 66, F2 + 100, -640, 1);

// ----------------------------------------------------- L3 sports deck -----
{
  const [x0, x1, z0, z1] = [1000, 1600, -560, 560];
  W.box(x0, C2, z0, x1, F3, z1, 'deck_steel', { mats: { top: 'tarmac', bottom: 'ceiling', side: 'white_paint' } });
  W.box(1300, F3, -260, 1580, F3 + 0.5, 260, 'court', { collide: false, tile: [280, 520], uvOffset: [1300, -260] });
  for (const x of [1010, 1300, 1590]) for (const z of [-550, 0, 550]) pillar(x, z, F2, C2, 'white_paint', 12);
  for (const [x, z] of [[1150, -300], [1150, 300], [1450, -300], [1450, 300], [1300, 0]]) W.box(x - 18, C2 - 3, z - 18, x + 18, C2, z + 18, 'lamp', NOCOL);
  const cen = [1300, 0];
  railEdge([1600, -560], [1600, 560], F3, cen);
  railEdge([1000, -560], [1600, -560], F3, cen);
  railEdge([1600, 560], [1000, 560], F3, cen);
  railEdge([1000, -430], [1000, 430], F3, cen);
  W.cyl(1180, 0, 130, F3, F3 + 380, 'funnel_navy', { seg: 28, tile: [128, 128] });
  W.cyl(1180, 0, 134, F3 + 250, F3 + 300, 'gold', { seg: 28, collide: false });
  W.cyl(1180, 0, 136, F3 + 372, F3 + 392, 'black_trim', { seg: 28, collide: false });
  sym((c) => {
    c.box(1040, F3, 440, 1100, F3 + 70, 500, 'white_paint', { mats: { top: 'steel' } });
    c.cyl(1570, 120, 3, F3, F3 + 120, 'rail_chrome', { seg: 6 });
    c.box(1566, F3 + 100, 90, 1572, F3 + 132, 150, 'white_solid', NOCOL);
    c.box(1330, F3, 400, 1410, F3 + 22, 430, 'wood_light');
    c.stair(660, 1000, 430, 540, F2 + 0.4, F3, F2, { top: 'stair_deck_x' });
  });
}

// ---------------------------------------------------- superstructure ------
{
  const sx0 = 1700, sx1 = 2300, sz = 500;
  const lc = new Ctx(1, F2);
  const h = C2 - F2;
  lc.wall('x', -sz, sx0, sx1, T, h, 'wall_white', [{ at: 2200, w: 90, head: 108 }]);
  lc.wall('x', sz, sx0, sx1, T, h, 'wall_white', [{ at: 2200, w: 90, head: 108 }]);
  lc.wall('z', sx0, -sz, sz, T, h, 'wall_white', [{ at: -240, w: 100, head: 108 }, { at: 240, w: 100, head: 108 }, { at: 0, w: 80, sill: 30, head: 108 }]);
  lc.wall('z', sx1, -sz, sz, T, h, 'wall_white', [-380, -230, -80, 80, 230, 380].map((at) => ({ at, w: 110, sill: 30, head: 112 })));
  W.box(sx0 + 7, F2, -sz + 7, sx1 - 7, F2 + 0.4, sz - 7, 'carpet_navy', NOCOL);
  sym((c) => {
    const d = c.at(F2);
    d.box(1800, 0, 300, 2100, 22, 380, 'velvet');
    d.box(2200, 0, 150, 2270, 44, 380, 'wood_dark', { mats: { top: 'gold' } });
    d.cyl(1850, 200, 20, 0, 108, 'white_paint', { seg: 8 });
    d.cyl(2100, 130, 18, 0, 108, 'white_paint', { seg: 8 });
    d.box(1900, 120, 60, 1960, 124, 66, 'lamp', NOCOL);
    d.stair(1760, 2100, 410, 490, 0.4, F3 - F2, 0, { left: false, right: false });
  });
  // bridge deck (L3 roof of the lounge) with stair openings, plus wings over the lido lanes
  const slabL3 = (x0, z0, x1, z1) => W.box(x0, C2, z0, x1, F3, z1, 'deck_steel', { mats: { top: 'wall_bridge', bottom: 'ceiling', side: 'white_paint' } });
  slabL3(1700, -400, 2300, 400);
  for (const s of [-1, 1]) {
    const a = s > 0 ? 400 : -500, b = s > 0 ? 500 : -400;
    slabL3(2100, a, 2300, b); slabL3(1700, a, 1760, b);
    slabL3(1760, s > 0 ? 490 : -500, 2100, s > 0 ? 500 : -490);
    slabL3(1700, s > 0 ? 500 : -880, 2300, s > 0 ? 880 : -500);
    for (const [x, z] of [[1710, 870], [2290, 870], [1710, 510], [2290, 510]]) W.box(x - 8, F2, s * z - 8, x + 8, C2, s * z + 8, 'white_paint');
    W.box(1750, F3, s > 0 ? 400 : -490, 1760, F3 + 46, s > 0 ? 490 : -400, 'glass');
  }
  const cen = [2000, 0];
  railEdge([1700, -880], [2300, -880], F3, cen);
  railEdge([2300, 880], [1700, 880], F3, cen);
  railEdge([2300, -880], [2300, -400], F3, cen);
  railEdge([2300, 400], [2300, 880], F3, cen);
  railEdge([1700, -880], [1700, 880], F3, cen);
  // bridge room x 1900..2300, z -400..400
  const bc = new Ctx(1, F3);
  bc.wall('z', 2294, -400, 400, 12, 128, 'wall_bridge', [-300, -200, -100, 0, 100, 200, 300].map((at) => ({ at, w: 80, sill: 36, head: 116 })));
  for (const zc of [-394, 394]) bc.wall('x', zc, 1900, 2300, 12, 128, 'wall_bridge', [{ at: 2200, w: 90, head: 108 }, { at: 2020, w: 90, sill: 36, head: 116 }]);
  bc.wall('z', 1900, -400, 400, 12, 128, 'wall_bridge', [{ at: 0, w: 100, head: 108 }]);
  W.box(1890, F3 + 128, -406, 2306, F3 + 142, 406, 'white_paint', { mats: { bottom: 'ceiling', top: 'steel' } });
  const b = new Ctx(1, F3);
  b.box(2200, 0, -300, 2250, 36, 300, 'black_trim');
  b.box(2214, 36, -300, 2220, 70, 300, 'screen', NOCOL);
  for (const z of [-180, 0, 180]) { b.box(2150, 0, z - 16, 2180, 30, z + 16, 'velvet'); b.cyl(2165, z, 4, 30, 38, 'rail_chrome', { seg: 6, collide: false }); }
  b.box(1950, 0, -300, 2010, 40, -200, 'wood_dark', { mats: { top: 'gold' } });
  b.box(1950, 0, 200, 2010, 40, 300, 'wood_dark', { mats: { top: 'gold' } });
  b.box(2000, 118, -4, 2040, 124, 4, 'lamp', NOCOL);
  W.cyl(2090, 0, 6, F3 + 142, F3 + 260, 'rail_chrome', { seg: 6, collide: false });
  W.box(2060, F3 + 260, -60, 2120, F3 + 270, 60, 'white_solid', NOCOL);
  W.box(2250, F3 + 142, -10, 2262, F3 + 154, 10, 'red_light', NOCOL);
  W.box(2262, F3 + 142, -52, 2266, F3 + 150, -48, 'rail_chrome', NOCOL);
  W.box(2262, F3 + 142, 48, 2266, F3 + 150, 52, 'rail_chrome', NOCOL);
  signX('sign_bridge', 2266, -60, 60, F3 + 142, F3 + 172, 1);
}

// ---------------------------------------------------- deck lighting -------
for (let x = -3000; x <= 2200; x += 250) for (const z of [-880, 880]) W.box(x - 14, C1 - 3, z - 14, x + 14, C1, z + 14, 'lamp', NOCOL);

// ----------------------------------------------------------- spawns -------
const yawTo = (x, z, tx, tz) => Math.atan2(-(tx - x), -(tz - z));
const aft = [
  [-3400, 0, -300], [-3400, 0, 300], [-3250, 0, 480], [-3250, 0, -480], [-2950, 0, -600], [-2950, 0, 600], [-2900, F2, -400], [-2900, F2, 400],
];
const mid = [[-650, F2, -700], [0, 0, -620], [0, 0, 620], [650, F2, 700]];
const fore = [
  [3350, 0, -120], [3350, 0, 120], [2900, 0, -500], [2900, 0, 500], [2500, 0, -250], [1950, F2, -250], [1950, F2, 250], [2000, 0, 0],
];
const spawns = [...aft, ...mid, ...fore].map(([x, y, z]) => {
  const tx = x < -1800 ? 2000 : x > 1300 ? -2000 : x < 0 ? 400 : -400;
  return { position: [x, y, z], yaw: Math.round(yawTo(x, z, tx, 0) * 1e4) / 1e4 };
});
const playerStart = { position: [-3500, 0, -120], yaw: Math.round(yawTo(-3500, -120, 2000, 0) * 1e4) / 1e4 };

// -------------------------------------------------------------- outputs ----
writeGlb(W, path.join(OUT, 'map.glb'), { map: ID });
writeCollisionGltf(W, path.join(OUT, 'collision.gltf'));

const dm = spawns.map((s, i) => ({
  ordinal: i, classname: 'mp_dm_spawn', position: s.position,
  positionObject: { x: s.position[0], y: s.position[1], z: s.position[2] }, yaw: s.yaw,
}));
const nodes = spawns.map((s) => ({ classname: 'node_pathnode', position: s.position }));
const patrol = [
  [-3200, 0, -450], [-3200, 0, 450], [-2900, 0, 0], [-2650, 0, 0], [-2250, 0, 0], [-1950, 0, 0],
  [-2650, 0, -360], [-2650, 0, 360], [-2250, 0, -360], [-2250, 0, 360], [-1950, 0, -360], [-1950, 0, 360], [-2250, 0, -180], [-2250, 0, 180],
  [-2400, 0, -810], [-2400, 0, 810], [-1600, 0, -810], [-1600, 0, 810], [-800, 0, -810], [-800, 0, 810], [0, 0, -810], [0, 0, 810],
  [800, 0, -810], [800, 0, 810], [1600, 0, -810], [1600, 0, 810], [2100, 0, -810], [2100, 0, 810],
  [-1500, 0, 0], [-1450, 0, -365], [-1450, 0, 365], [-1060, 0, -550], [-1060, 0, 550], [-750, 0, 0], [-750, 0, -450], [-750, 0, 450],
  [-300, 0, 0], [300, 0, 0], [0, 0, -250], [0, 0, 250], [700, 0, 0], [700, 0, -450], [700, 0, 450],
  [1100, 0, 0], [1300, 0, -400], [1300, 0, 400], [1500, 0, 0], [1600, 0, -560], [1600, 0, 560],
  [1825, 0, -360], [1825, 0, 360], [1825, 0, 0], [2175, 0, -360], [2175, 0, 360], [2175, 0, 0], [2000, 0, -180], [2000, 0, 180],
  [2500, 0, 0], [2700, 0, -300], [2700, 0, 300], [3100, 0, 0], [3100, 0, -400], [3100, 0, 400], [2750, 0, -780], [2750, 0, 780],
  [-2500, F2, -300], [-2500, F2, 300], [-2300, F2, -700], [-2300, F2, 700], [-1850, F2, -600], [-1850, F2, 600], [-1450, F2, -300], [-1450, F2, 300],
  [-1450, F2, -520], [-1450, F2, 520], [-1000, F2, 0], [-1000, F2, -650], [-1000, F2, 650], [-500, F2, 0], [500, F2, 0], [0, F2, -650], [0, F2, 650],
  [-700, F2, -450], [-700, F2, 450], [1000, F2, -700], [1000, F2, 700], [960, F2, 0], [1450, F2, 0], [1500, F2, -650], [1500, F2, 650],
  [1900, F2, 0], [2000, F2, -250], [2000, F2, 250], [2280, F2, -740], [2280, F2, 740], [1200, F2, -850], [1200, F2, 850],
  [1450, F3, 0], [1450, F3, -350], [1450, F3, 350], [1100, F3, -420], [1100, F3, 420], [1500, F3, 0],
  [2100, F3, 0], [2000, F3, -140], [2000, F3, 140], [2150, F3, -650], [2150, F3, 650],
];
for (const [x, y, z] of patrol) nodes.push({ classname: 'node_pathnode', position: [x, y, z] });
fs.writeFileSync(path.join(OUT, 'nav_hints.json'), JSON.stringify({
  format: 'claude-of-duty-nav-hints-v1', map: ID,
  coordinateSystem: { target: 'Three.js y-up', spawnYaw: 'yaw is Object3D rotation.y radians; forward = (-sin yaw, 0, -cos yaw)' },
  pathnodes: nodes, negotiationNodes: [], offMeshConnections: [], spawns: dm,
  counts: { pathnodes: nodes.length, spawns: dm.length },
}, null, 1));
fs.writeFileSync(path.join(OUT, 'ladders.json'), JSON.stringify({ format: 'hijacked-ladders-v1', source: 'none', coordinateSystem: 'three-y-up', pattern: 'ladder', count: 0, volumes: [] }, null, 1));

// probe emitters: ceiling lights inside (the sky-only bake cannot see them)
const emit = [];
const E = (x, y, z, col, i = 1, r = 260) => emit.push({ position: [x, y, z], color: col, intensity: i * 2.6, radius: r });
const WARM = [1, 0.82, 0.55], COOL = [0.75, 0.9, 1];
for (const x of [-2650, -2400, -2100, -1900]) for (const z of [-360, 0, 360]) E(x, 110, z, WARM, 0.9, 200);
for (const x of [-2640, -2410, -2110, -1940]) for (const z of [-575, -180, 180, 575]) E(x, 100, z, WARM, 0.5, 150);
for (const x of [-1750, -1500, -1250]) for (const z of [-450, 0, 450]) E(x, 110, z, WARM, 1.0, 320);
for (const x of [-800, 700]) for (const z of [-450, 0, 450]) E(x, 110, z, WARM, 0.9, 300);
for (const x of [-350, 350]) for (const z of [-600, 0, 600]) E(x, 110, z, WARM, 1.0, 340);
E(0, 160, 0, COOL, 1.5, 420); E(0, 330, 0, COOL, 1.2, 420);
for (const x of [1050, 1300, 1550]) for (const z of [-500, 0, 500]) E(x, 110, z, WARM, 1.0, 320);
for (const x of [1830, 2000, 2170]) for (const z of [-360, 0, 360]) E(x, 110, z, WARM, 0.8, 200);
for (const x of [1850, 2100]) for (const z of [-300, 0, 300]) E(x, F2 + 110, z, WARM, 0.9, 280);
for (const x of [2000, 2200]) for (const z of [-250, 250]) E(x, F3 + 110, z, COOL, 0.8, 260);
for (const x of [-3050, -2900]) for (const z of [-450, 0, 450]) E(x, 110, z, WARM, 0.8, 260);
for (const x of [-2400, -1200, 0, 1200, 2000]) for (const z of [-820, 820]) E(x, 110, z, WARM, 0.6, 240);
for (const [x, z] of [[1150, -300], [1150, 300], [1450, -300], [1450, 300]]) E(x, C2 - 10, z, WARM, 0.8, 260);
fs.writeFileSync(path.join(OUT, 'emitters.json'), JSON.stringify(emit));

// ----------------------------------------------- sky, probe, lut, vision ----
const norm3 = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
const SUN = norm3([-0.45, 0.62, 0.55]);
const ZEN = [0.1, 0.27, 0.62], MID = [0.24, 0.46, 0.8], HOR = [0.72, 0.84, 0.95], SEA_H = [0.58, 0.74, 0.86], SEA_D = [0.03, 0.14, 0.26];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function sky(d, clouds = true) {
  const e = d[1];
  let c;
  if (e >= 0) {
    const a = Math.pow(e, 0.55);
    c = lerp3(HOR, lerp3(MID, ZEN, clamp((a - 0.3) * 1.5)), clamp(a * 1.8));
    if (clouds) {
      const az = Math.atan2(d[2], d[0]);
      const cloud = fbm(az / (Math.PI * 2) + 0.5, e * 1.1, 7, 4, 18);
      if (cloud > 0.52 && e < 0.8) c = lerp3(c, [0.97, 0.97, 0.98], clamp((cloud - 0.52) * 3.2) * (1 - e * 0.9) * 0.85);
    }
  } else {
    c = lerp3(SEA_H, SEA_D, clamp(-e * 2.5));
  }
  const g = Math.max(dot3(d, SUN), 0);
  const glow = Math.pow(g, 6) * 0.35 + Math.pow(g, 60) * 1.4 + (g > 0.9995 ? 6 : 0);
  return [c[0] + glow, c[1] + glow * 0.92, c[2] + glow * 0.75];
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
cube('probe', 32, (d) => { const c = sky(d, false); return [c[0] * 0.95 + 0.02, c[1] * 0.95 + 0.02, c[2] * 0.95 + 0.025]; });

{
  const lut = new Uint8Array(1024 * 64 * 3);
  for (let row = 0; row < 64; row += 1) for (let col = 0; col < 1024; col += 1) {
    const b = Math.floor(col / 32) / 31, r = (col % 32) / 31, g = (row % 32) / 31;
    let c = [r, g, b];
    if (row < 32) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      c = c.map((x) => x + (x - 0.5) * 0.09);
      const hi = clamp((lum - 0.5) * 1.6), sh = 1 - clamp(lum * 2.4);
      c = [c[0] + hi * 0.03 + sh * 0.005, c[1] + hi * 0.012, c[2] - hi * 0.02 + sh * 0.025];
    }
    const o = (row * 1024 + col) * 3;
    for (let k = 0; k < 3; k += 1) lut[o + k] = Math.round(clamp(c[k]) * 255);
  }
  fs.writeFileSync(path.join(OUT, 'lut.png'), encodePng(lut, 1024, 64, 3));
}
fs.writeFileSync(path.join(OUT, 'vision.json'), JSON.stringify({
  highlight: [0.17, 0.158, 0.14], lowlight: [0.04, 0.043, 0.05], exposure: 1.2, lowlightScale: 1,
  note: 'Same schema as export/web/vision.json; only highlight/lowlight/exposure are read.',
}, null, 1));

// ------------------------------------------------------------- minimap -----
const colB = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < W.col.length; i += 3) for (let k = 0; k < 3; k += 1) { colB.min[k] = Math.min(colB.min[k], W.col[i + k]); colB.max[k] = Math.max(colB.max[k], W.col[i + k]); }
const MM = { n: 1024, size: 7600, cx: 50, cz: 0 };
{
  const { n: N, size: SIZE, cx, cz } = MM;
  const img = new Float32Array(N * N).fill(-1e9);
  const col = W.col;
  for (let i = 0; i < col.length; i += 9) {
    const t = [[col[i], col[i + 1], col[i + 2]], [col[i + 3], col[i + 4], col[i + 5]], [col[i + 6], col[i + 7], col[i + 8]]];
    const a = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], b = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    if (n[1] / (Math.hypot(...n) || 1) < 0.2) continue;
    // image u from z (flipU 1), v from x (flipV -1): MAP_CAL convention in hud.js
    const p = t.map(([x, y, z]) => [(0.5 + (z - cz) / SIZE) * N, (0.5 - (x - cx) / SIZE) * N, y]);
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
    let edge = false;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      if (Math.abs(img[ny * N + nx] - h) > 30 && img[ny * N + nx] > -100) edge = true;
    }
    const base = lerp3([40, 90, 120], [170, 220, 240], clamp(h / 340));
    const c = edge ? [255, 255, 255] : base;
    px.set([c[0], c[1], c[2], 235], o);
  }
  fs.writeFileSync(path.join(OUT, 'minimap.png'), encodePng(px, N, N, 4));
}

// --------------------------------------------------------- manifest src ----
fs.writeFileSync(path.join(OUT, 'manifest.src.json'), JSON.stringify({
  id: ID,
  name: 'Cruise Liner',
  description: 'Sunny-afternoon cruise ship at sea: lido deck with pool, covered promenades, two-deck atrium, theatre, cabin corridors and a bow bridge.',
  players: '6-8',
  spawns,
  playerStart,
  bounds: { min: [colB.min[0], -440, colB.min[2]].map(Math.round), max: colB.max.map(Math.round) },
  playArea: { min: [-3600, -40, -900], max: [3700, 700, 900] },
  minimap: { image: 'minimap.png', centerX: MM.cx, centerZ: MM.cz, size: MM.size, flipU: 1, flipV: -1, minimapSpan: 1250 },
  lighting: {
    sun: { color: '#fff1d6', intensity: 1.5, position: SUN.map((v) => Math.round(v * 1500)) },
    hemi: { sky: '#a8c8f0', ground: '#3a5a78', intensity: 0.45 },
    fog: { color: '#b8d4ee', near: 900, far: 5200 },
    probeIntensity: 1.0,
    environmentIntensity: 1.0,
    exposure: 1.3,
    saturation: 1.0,
    probeAmbient: [0.2, 0.19, 0.18],
    note: 'Pass env/probe/vision/lut paths to applyEnvironmentLighting() and loadGradeLut(); apply sun/hemi/fog from these hints.',
  },
}, null, 1));

let tris = 0; for (const m of W.meshes.values()) tris += m.pos.length / 9;
console.log(`built ${ID}: ${W.meshes.size} materials, ${W.col.length / 9} collision tris, ${tris} render tris, ${spawns.length} spawns, ${nodes.length} pathnodes -> ${path.relative(ROOT, OUT)}`);
