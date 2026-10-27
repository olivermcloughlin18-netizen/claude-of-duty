// Shared helpers for generating original map sources without Blender:
// a tiny PNG encoder, tileable noise, a convex-solid mesh builder that emits
// render + collision geometry, and a glTF/GLB writer. Units are inches, y-up.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ------------------------------------------------------------------ PNG ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** 8-bit PNG, filter 0 only (bake_probes' reader requires that for env faces). */
export function encodePng(pixels, width, height, channels = 3) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- noise ----
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;

const LATTICE = (() => { const r = rng(7); const t = new Float32Array(4096); for (let i = 0; i < t.length; i += 1) t[i] = r(); return t; })();
function lat(ix, iy, per, seed) {
  const x = ((ix % per) + per) % per;
  const y = ((iy % per) + per) % per;
  return LATTICE[(Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(seed, 83492791)) >>> 0 & 4095];
}
/** Tileable value noise; x/y in lattice units, wraps every `per`. */
export function noise2(x, y, per, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return mix(
    mix(lat(xi, yi, per, seed), lat(xi + 1, yi, per, seed), sx),
    mix(lat(xi, yi + 1, per, seed), lat(xi + 1, yi + 1, per, seed), sx),
    sy,
  );
}
export function fbm(u, v, freq, oct = 4, seed = 0) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o += 1) {
    const f = freq * 2 ** o;
    sum += noise2(u * f, v * f, f, seed + o) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Paint a size x size (or w x h) texture; fn(x, y, u, v) -> [r,g,b(,a)] 0..255. */
export function paint(w, h, fn, channels = 3) {
  const data = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const c = fn(x, y, x / w, y / h);
      const o = (y * w + x) * channels;
      for (let k = 0; k < channels; k += 1) data[o + k] = Math.round(clamp(c[k] ?? 255, 0, 255));
    }
  }
  return { w, h, channels, data, png: () => encodePng(data, w, h, channels) };
}

// ---------------------------------------------------------------- world ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export class World {
  constructor() {
    this.mats = new Map();
    this.meshes = new Map();
    this.col = [];
    this.bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  }

  /** def: {color:[r,g,b,a 0..1], tex:Buffer(png), emissive:[r,g,b], emissiveTex:Buffer, tile:[w,h], rough, blend} */
  defMat(name, def) { this.mats.set(name, { tile: [128, 128], rough: 0.85, ...def }); return name; }

  _mesh(mat) {
    if (!this.mats.has(mat)) throw new Error(`unknown material ${mat}`);
    if (!this.meshes.has(mat)) this.meshes.set(mat, { pos: [], nrm: [], uv: [] });
    return this.meshes.get(mat);
  }

  _tri(mat, v, n, o, kind) {
    // v: 3 verts, n: 3 normals (or 1), o: options
    if (o.render !== false) {
      const m = this._mesh(mat);
      const def = this.mats.get(mat);
      const tile = o.tile ?? def.tile;
      const fn = norm(cross(sub(v[1], v[0]), sub(v[2], v[0])));
      const ax = Math.abs(fn[0]), ay = Math.abs(fn[1]), az = Math.abs(fn[2]);
      const off = o.uvOffset ?? [0, 0];
      for (let i = 0; i < 3; i += 1) {
        const p = v[i];
        let a, b;
        if (ay >= ax && ay >= az) { a = p[0] - off[0]; b = p[2] - off[1]; }
        else if (ax >= az) { a = p[2] - off[0]; b = p[1] - off[1]; }
        else { a = p[0] - off[0]; b = p[1] - off[1]; }
        m.pos.push(p[0], p[1], p[2]);
        const nn = n[i] ?? n[0];
        m.nrm.push(nn[0], nn[1], nn[2]);
        m.uv.push(a / tile[0], b / tile[1]);
      }
    }
    if (o.collide !== false && o.collide !== 'no') {
      for (const p of v) this.col.push(p[0], p[1], p[2]);
    }
    for (const p of v) {
      for (let c = 0; c < 3; c += 1) {
        if (p[c] < this.bounds.min[c]) this.bounds.min[c] = p[c];
        if (p[c] > this.bounds.max[c]) this.bounds.max[c] = p[c];
      }
    }
  }

  /** Convex prism: 4 plan points, 4 top heights, flat bottom at yb. */
  slab(pts, tops, yb, mat, o = {}) {
    const col = o.collide ?? true;
    const opts = { ...o, collide: col };
    const top = pts.map((p, i) => [p[0], tops[i], p[1]]);
    const bot = pts.map((p) => [p[0], yb, p[1]]);
    const all = [...top, ...bot];
    const c = all.reduce((s, p) => [s[0] + p[0] / 8, s[1] + p[1] / 8, s[2] + p[2] / 8], [0, 0, 0]);
    const mats = o.mats ?? {};
    const faces = [{ v: top, kind: 'top' }];
    const noBottom = o.noBottom ?? yb <= 0.001;
    if (!noBottom) faces.push({ v: [bot[3], bot[2], bot[1], bot[0]], kind: 'bottom' });
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      const hi = tops[i] - yb, hj = tops[j] - yb;
      if (hi < 1e-3 && hj < 1e-3) continue;
      if (hi < 1e-3) faces.push({ v: [bot[i], bot[j], top[j]], kind: 'side' });
      else if (hj < 1e-3) faces.push({ v: [bot[i], bot[j], top[i]], kind: 'side' });
      else faces.push({ v: [bot[i], bot[j], top[j], top[i]], kind: 'side' });
    }
    for (const f of faces) {
      const m = mats[f.kind] ?? mat;
      for (let k = 1; k + 1 < f.v.length; k += 1) {
        let tri = [f.v[0], f.v[k], f.v[k + 1]];
        let n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
        if (Math.hypot(...n) < 1e-6) continue;
        const centre = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3, (tri[0][2] + tri[1][2] + tri[2][2]) / 3];
        if (dot(n, sub(centre, c)) < 0) { tri = [tri[0], tri[2], tri[1]]; n = [-n[0], -n[1], -n[2]]; }
        this._tri(m, tri, [norm(n)], opts, f.kind);
      }
    }
  }

  box(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    this.slab([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [y1, y1, y1, y1], y0, mat, o);
  }

  /** Cylinder / pipe. axis 'y': centre (c1,c2)=(x,z), span a..b in y. axis 'x': (c1,c2)=(y,z); 'z': (c1,c2)=(x,y). */
  cyl(c1, c2, r, a, b, mat, o = {}) {
    const seg = o.seg ?? 16;
    const axis = o.axis ?? 'y';
    const map = (p, q, h) => (axis === 'y' ? [c1 + p, h, c2 + q] : axis === 'x' ? [h, c1 + p, c2 + q] : [c1 + p, c2 + q, h]);
    const opts = { ...o, collide: o.collide ?? true };
    const ring = [];
    for (let i = 0; i < seg; i += 1) ring.push([Math.cos((i / seg) * Math.PI * 2), Math.sin((i / seg) * Math.PI * 2)]);
    const centre = map(0, 0, (a + b) / 2);
    const radial = (i) => norm(sub(map(ring[i][0], ring[i][1], (a + b) / 2), centre));
    const fixWind = (tri, ref) => {
      const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
      const cc = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3, (tri[0][2] + tri[1][2] + tri[2][2]) / 3];
      return dot(n, sub(cc, ref)) < 0 ? [tri[0], tri[2], tri[1]] : tri;
    };
    for (let i = 0; i < seg; i += 1) {
      const j = (i + 1) % seg;
      const p0 = map(ring[i][0] * r, ring[i][1] * r, a), p1 = map(ring[j][0] * r, ring[j][1] * r, a);
      const q0 = map(ring[i][0] * r, ring[i][1] * r, b), q1 = map(ring[j][0] * r, ring[j][1] * r, b);
      const ni = radial(i), nj = radial(j);
      for (const [tri, ns] of [[[p0, p1, q1], [ni, nj, nj]], [[p0, q1, q0], [ni, nj, ni]]]) {
        const fixed = fixWind(tri, centre);
        const swapped = fixed[1] !== tri[1];
        this._tri(mat, fixed, swapped ? [ns[0], ns[2], ns[1]] : ns, { ...opts, tile: o.tile }, 'side');
      }
      const capMat = o.capMat ?? mat;
      for (const [h, p, q, sign] of [[b, q0, q1, 1], [a, p0, p1, -1]]) {
        if (sign < 0 && (o.noBottom ?? Math.min(a, b) <= 0.001) && axis === 'y') continue;
        const cp = map(0, 0, h);
        const tri = fixWind([cp, p, q], centre);
        const n = norm(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])));
        this._tri(capMat, tri, [n], { ...opts, uvOffset: o.capOffset ?? [c1 - 0.5 * (o.capTile ?? 128), c2 - 0.5 * (o.capTile ?? 128)], tile: o.capTile ? [o.capTile, o.capTile] : o.tile }, sign > 0 ? 'top' : 'bottom');
      }
    }
  }
}

/** Mirror a World across x=0 (sx = +1 mirrors an authored west half to the east). */
export class View {
  constructor(world, mirrored, alt = {}) { this.w = world; this.m = mirrored; this.alt = alt; this.sx = mirrored ? -1 : 1; }
  mat(n) { return this.m && this.alt[n] ? this.alt[n] : n; }
  X(x) { return this.m ? -x : x; }
  _o(o) { const r = { ...o }; if (r.mats) r.mats = Object.fromEntries(Object.entries(r.mats).map(([k, v]) => [k, this.mat(v)])); if (r.capMat) r.capMat = this.mat(r.capMat); return r; }
  slab(pts, tops, yb, mat, o = {}) { this.w.slab(pts.map((p) => [this.X(p[0]), p[1]]), tops, yb, this.mat(mat), this._o(o)); }
  box(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    const a = this.X(x0), b = this.X(x1);
    this.w.box(Math.min(a, b), y0, z0, Math.max(a, b), y1, z1, this.mat(mat), this._o(o));
  }
  cyl(c1, c2, r, a, b, mat, o = {}) {
    const axis = o.axis ?? 'y';
    if (axis === 'y') this.w.cyl(this.X(c1), c2, r, a, b, this.mat(mat), this._o(o));
    else if (axis === 'x') this.w.cyl(c1, c2, r, Math.min(this.X(a), this.X(b)), Math.max(this.X(a), this.X(b)), this.mat(mat), this._o(o));
    else this.w.cyl(this.X(c1), c2, r, a, b, this.mat(mat), this._o(o));
  }
  /** Axis-aligned wall segment with openings: {at, w, sill=0, head=h}. */
  wall(axis, c, a, b, t, h, mat, openings = [], o = {}) {
    const ops = [...openings].sort((p, q) => p.at - q.at);
    const put = (s0, s1, y0, y1) => {
      if (s1 - s0 < 0.5 || y1 - y0 < 0.5) return;
      if (axis === 'x') this.box(s0, y0, c - t / 2, s1, y1, c + t / 2, mat, o);
      else this.box(c - t / 2, y0, s0, c + t / 2, y1, s1, mat, o);
    };
    // the authored opening positions are in the authored frame; View.box mirrors for us
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
  /** Ramp/stair-shaped wedge with side cheek walls. axis 'x' rises along x from hA at xa to hB at xb. */
  ramp(axis, a0, a1, b0, b1, hA, hB, mat, o = {}) {
    // a0..a1 run axis; b0..b1 across
    const pts = axis === 'x' ? [[a0, b0], [a0, b1], [a1, b1], [a1, b0]] : [[b0, a0], [b1, a0], [b1, a1], [b0, a1]];
    this.slab(pts, [hA, hA, hB, hB], 0, mat, { mats: o.mats });
    const t = o.cheek ?? 8, up = o.cheekUp ?? 30;
    const cm = o.cheekMat ?? mat;
    const side = (s0, s1) => {
      const p = axis === 'x' ? [[a0, s0], [a0, s1], [a1, s1], [a1, s0]] : [[s0, a0], [s1, a0], [s1, a1], [s0, a1]];
      this.slab(p, [hA + up, hA + up, hB + up, hB + up], 0, cm);
    };
    if (!o.noCheek) { side(b0 - t, b0); side(b1, b1 + t); }
  }
}

// ----------------------------------------------------------------- glTF ----
function padTo4(buf, fill = 0) { const r = (4 - (buf.length % 4)) % 4; return r ? Buffer.concat([buf, Buffer.alloc(r, fill)]) : buf; }

/** Write the render scene as a self-contained GLB (PNG textures embedded). */
export function writeGlb(world, file, extras = {}) {
  const parts = [];
  const bufferViews = [], accessors = [], images = [], textures = [], materials = [], meshes = [], nodes = [];
  let offset = 0;
  const addView = (buf, target) => {
    const b = padTo4(buf);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    parts.push(b);
    offset += b.length;
    return bufferViews.length - 1;
  };
  const texIndex = new Map();
  const addTex = (png) => {
    if (!png) return undefined;
    if (!texIndex.has(png)) {
      images.push({ bufferView: addView(png), mimeType: 'image/png' });
      textures.push({ sampler: 0, source: images.length - 1 });
      texIndex.set(png, textures.length - 1);
    }
    return texIndex.get(png);
  };
  for (const [name, m] of world.meshes) {
    const def = world.mats.get(name);
    const matIdx = materials.length;
    const pbr = { baseColorFactor: def.color ?? [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: def.rough };
    const bt = addTex(def.tex);
    if (bt !== undefined) pbr.baseColorTexture = { index: bt };
    const mat = { name, pbrMetallicRoughness: pbr, doubleSided: false };
    if (def.emissive) mat.emissiveFactor = def.emissive;
    const et = addTex(def.emissiveTex);
    if (et !== undefined) mat.emissiveTexture = { index: et };
    if (def.blend) { mat.alphaMode = 'BLEND'; mat.doubleSided = true; }
    materials.push(mat);

    const count = m.pos.length / 3;
    const pos = Float32Array.from(m.pos), nrm = Float32Array.from(m.nrm), uv = Float32Array.from(m.uv);
    const idx = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) idx[i] = i;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i += 1) for (let c = 0; c < 3; c += 1) { min[c] = Math.min(min[c], pos[i * 3 + c]); max[c] = Math.max(max[c], pos[i * 3 + c]); }
    const acc = (view, type, ct, n, extra = {}) => { accessors.push({ bufferView: view, componentType: ct, count: n, type, ...extra }); return accessors.length - 1; };
    const aPos = acc(addView(Buffer.from(pos.buffer), 34962), 'VEC3', 5126, count, { min, max });
    const aNrm = acc(addView(Buffer.from(nrm.buffer), 34962), 'VEC3', 5126, count);
    const aUv = acc(addView(Buffer.from(uv.buffer), 34962), 'VEC2', 5126, count);
    const aIdx = acc(addView(Buffer.from(idx.buffer), 34963), 'SCALAR', 5125, count);
    meshes.push({ name, primitives: [{ attributes: { POSITION: aPos, NORMAL: aNrm, TEXCOORD_0: aUv }, indices: aIdx, material: matIdx }] });
    nodes.push({ name, mesh: meshes.length - 1 });
  }
  const json = {
    asset: { version: '2.0', generator: 'claude-of-duty map_kit', extras },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: offset }],
    ...(images.length ? { images, textures, samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] } : {}),
  };
  const jsonBuf = padTo4(Buffer.from(JSON.stringify(json)), 0x20);
  const bin = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, ch(jsonBuf.length, 0x4e4f534a), jsonBuf, ch(bin.length, 0x004e4942), bin]));
}

/** Collision mesh as .gltf + .bin (the layout bake_collision_bvh / bake_probes read). */
export function writeCollisionGltf(world, file) {
  const pos = Float32Array.from(world.col);
  const n = pos.length / 3;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) idx[i] = i;
  const min = world.bounds.min, max = world.bounds.max;
  const binName = `${path.basename(file, '.gltf')}.bin`;
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  const gltf = {
    asset: { version: '2.0', generator: 'claude-of-duty map_kit' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'collision', mesh: 0 }],
    meshes: [{ name: 'collision', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5125, count: n, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength },
    ],
    buffers: [{ uri: binName, byteLength: bin.length }],
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(gltf));
  fs.writeFileSync(path.join(path.dirname(file), binName), bin);
}
