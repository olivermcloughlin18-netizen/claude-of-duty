#!/usr/bin/env node
// Bake a generated map source (.work/maps/<id>) into export/web/maps/<id>.
//   node .tools/bake_map_package.mjs kestrel
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!id) throw new Error('usage: bake_map_package.mjs <id>');
const src = path.join(root, '.work', 'maps', id);
const out = path.join(root, 'export', 'web', 'maps', id);
fs.mkdirSync(out, { recursive: true });
const run = (script, args) => {
  const r = spawnSync('node', [path.join(root, '.tools', script), ...args], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${script} failed`);
};
run('bake_map.mjs', ['--source', `${src}/map.glb`, '--output', `${out}/${id}_optimized.glb`, '--textures', 'webp']);
run('bake_collision_bvh.mjs', ['--input', `${src}/collision.gltf`, '--output', `${out}/${id}_collision_bvh.bin`]);
run('bake_navmesh.mjs', ['--input', `${src}/collision.gltf`, '--output', `${out}/${id}.navmesh.bin`]);
run('bake_probes.mjs', ['--collision', `${src}/collision.gltf`, '--env', `${src}/env`, '--out', `${out}/${id}_probes`,
  '--spacing', '80', '--rays', '96', '--emitters', `${src}/emitters.json`, '--ambient', '0.12,0.09,0.2']);
for (const d of ['env', 'probe']) fs.cpSync(path.join(src, d), path.join(out, 'textures', d), { recursive: true });
fs.copyFileSync(`${src}/lut.png`, `${out}/textures/lut.png`);
for (const [from, to] of [['vision.json', 'vision.json'], ['minimap.png', 'minimap.png'], ['nav_hints.json', `${id}_nav_hints.json`], ['ladders.json', `${id}_ladders.json`]]) {
  fs.copyFileSync(path.join(src, from), path.join(out, to));
}
const m = JSON.parse(fs.readFileSync(`${src}/manifest.src.json`, 'utf8'));
m.format = 'claude-of-duty-map-v1';
m.files = {
  glb: `${id}_optimized.glb`, collisionBvh: `${id}_collision_bvh.json`, navmesh: `${id}.navmesh.bin`,
  navHints: `${id}_nav_hints.json`, ladders: `${id}_ladders.json`, probes: `${id}_probes.json`,
  vision: 'vision.json', lut: 'textures/lut.png', env: 'textures/env/', probe: 'textures/probe/', minimap: 'minimap.png',
};
m.lighting.paths = { env: 'textures/env/', probe: 'textures/probe/', vision: 'vision.json', lut: 'textures/lut.png' };
fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
let total = 0;
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? walk(p) : (total += fs.statSync(p).size); } }(out));
console.log(`package ${id}: ${(total / 1e6).toFixed(2)} MB`);
