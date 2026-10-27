import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';
import { importNavMesh, init, NavMeshQuery } from '@recast-navigation/core';

import { deserializeCollisionWorld } from '../export/web/collision-world.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'export', 'web', 'maps', 'kestrel');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(DIR, manifest.files.collisionBvh), 'utf8'));
const bin = fs.readFileSync(path.join(DIR, meta.binary));
const world = deserializeCollisionWorld(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const mesh = new THREE.Mesh(world.geometry ?? world.mesh?.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
const raycaster = new THREE.Raycaster();
const floorUnder = (x, y, z) => {
  raycaster.set(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0));
  raycaster.firstHitOnly = true;
  return raycaster.intersectObject(mesh, false)[0];
};

test('manifest has the contract fields and 12+ spawns', () => {
  for (const k of ['id', 'name', 'files', 'spawns', 'playerStart', 'bounds', 'minimap', 'lighting']) assert.ok(manifest[k], k);
  assert.ok(manifest.spawns.length >= 12);
  for (const f of Object.values(manifest.files)) assert.ok(fs.existsSync(path.join(DIR, f)), f);
});

test('every spawn: raycast down from above hits the floor at its feet', () => {
  for (const s of [...manifest.spawns, manifest.playerStart]) {
    const [x, y, z] = s.position;
    const hit = floorUnder(x, y + 60, z);
    assert.ok(hit, `no floor under ${s.position}`);
    assert.ok(Math.abs(hit.point.y - y) < 2, `spawn ${s.position} floats/sinks: floor ${hit.point.y}`);
    // headroom: nothing within 72 above the feet
    raycaster.set(new THREE.Vector3(x, y + 1, z), new THREE.Vector3(0, 1, 0));
    const up = raycaster.intersectObject(mesh, false)[0];
    assert.ok(!up || up.distance > 72, `no headroom at ${s.position}`);
  }
});

test('every spawn is on the navmesh and reachable from every other', async () => {
  await init();
  const { navMesh } = importNavMesh(new Uint8Array(fs.readFileSync(path.join(DIR, manifest.files.navmesh))));
  const query = new NavMeshQuery(navMesh);
  const half = { x: 24, y: 40, z: 24 };
  const snapped = manifest.spawns.map((s) => {
    const r = query.findNearestPoly({ x: s.position[0], y: s.position[1], z: s.position[2] }, { halfExtents: half });
    assert.ok(r.success && r.nearestRef, `spawn ${s.position} not on navmesh`);
    assert.ok(Math.hypot(r.nearestPoint.x - s.position[0], r.nearestPoint.z - s.position[2]) < 8 && Math.abs(r.nearestPoint.y - s.position[1]) < 8, `spawn ${s.position} off walkable ground`);
    return r.nearestPoint;
  });
  let pairs = 0;
  for (let i = 0; i < snapped.length; i += 1) {
    for (let j = i + 1; j < snapped.length; j += 1) {
      const p = query.computePath(snapped[i], snapped[j], { halfExtents: half });
      assert.ok(p.success && p.path.length > 1, `no path ${i}->${j}`);
      const end = p.path[p.path.length - 1];
      assert.ok(Math.hypot(end.x - snapped[j].x, end.z - snapped[j].z) < 12, `path ${i}->${j} stops short`);
      pairs += 1;
    }
  }
  console.log(`reachability: ${pairs} pairs ok`);
  query.destroy();
});
