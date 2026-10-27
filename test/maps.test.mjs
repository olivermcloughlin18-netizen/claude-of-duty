import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { HIJACKED, MAP_IDS, fromManifest, listMaps, loadMap, synthesiseHints } from '../export/web/maps.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/map-manifest.json', import.meta.url), 'utf8'));

test('fromManifest returns every HIJACKED key with prefixed URLs', () => {
  const entry = fromManifest(fixture);
  for (const key of Object.keys(HIJACKED)) assert.ok(key in entry, key);
  assert.equal(entry.render, 'maps/fixture/fixture_optimized.glb');
  assert.equal(entry.collision, 'maps/fixture/fixture_collision_bvh.json');
  assert.equal(entry.probes.bin, 'maps/fixture/fixture_probes.bin');
  assert.equal(entry.hints, null);
  assert.equal(entry.card, null);
  assert.equal(entry.fallResetY, fixture.bounds.min[1] - 300);
  assert.equal(entry.minimap.image, 'maps/fixture/minimap.png');
  assert.equal(entry.minimap.span, 1250);
  assert.equal(entry.lighting.lut, 'maps/fixture/textures/lut.png');
  assert.equal(entry.background, 0x6a3a5e);
  assert.deepEqual(entry.fallbackSpawn, fixture.playerStart.position);
});

test('absent optional files are null and lighting falls back to Hijacked', () => {
  const entry = fromManifest({ id: 'bare', name: 'Bare', files: { glb: 'a.glb' } });
  assert.equal(entry.minimap, null);
  assert.equal(entry.probes, null);
  assert.equal(entry.ladders, null);
  assert.equal(entry.spawns, null);
  assert.deepEqual(entry.lighting, HIJACKED.lighting);
  assert.deepEqual(entry.bounds, HIJACKED.bounds);
  assert.throws(() => fromManifest({}), /needs an id/);
});

test('hints are synthesised from spawns', () => {
  const hints = synthesiseHints(fromManifest(fixture));
  assert.equal(hints.spawns.length, fixture.spawns.length);
  assert.equal(hints.spawns[0].classname, 'mp_dm_spawn');
  assert.deepEqual(hints.pathnodes[1].position, fixture.spawns[1].position);
});

test('loadMap: hijacked is the literal, manifests load, any failure gives HIJACKED', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await loadMap('hijacked'), HIJACKED);
    const ok = await loadMap('fixture', async (url) => {
      assert.equal(url, 'maps/fixture/manifest.json');
      return { ok: true, json: async () => fixture };
    });
    assert.equal(ok.id, 'fixture');
    assert.equal(await loadMap('fixture', async () => { throw new Error('offline'); }), HIJACKED);
    assert.equal(await loadMap('fixture', async () => ({ ok: false, status: 404 })), HIJACKED);
    assert.equal(await loadMap('fixture', async () => ({ ok: true, json: async () => ({}) })), HIJACKED);
  } finally { console.warn = warn; }
});

test('listMaps reports the registered maps', async () => {
  assert.deepEqual(MAP_IDS.slice(0, 1), ['hijacked']);
  const maps = await listMaps(async () => { throw new Error('should not fetch hijacked'); });
  assert.deepEqual(maps[0], { id: 'hijacked', name: 'Hijacked', card: HIJACKED.card });
});
