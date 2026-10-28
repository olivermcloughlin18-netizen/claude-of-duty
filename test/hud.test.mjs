import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAP_CAL, MINIMAP_PING_SIZE, minimapCalibration, worldToMinimapUv } from '../export/web/hud.js';

test('minimap uses the authored minimap_corner world bounds', () => {
  assert.deepEqual(MAP_CAL, {
    centerX: -316,
    centerZ: 12,
    size: 7176,
    flipU: 1,
    flipV: -1,
    minimapSpan: 1250,
  });

  // Entity-space corners (3272, 3576) and (-3904, -3600) become
  // Three.js XZ corners (3272, -3576) and (-3904, 3600).
  assert.deepEqual(worldToMinimapUv(3272, -3576), { u: 0, v: 0 });
  assert.deepEqual(worldToMinimapUv(-3904, 3600), { u: 1, v: 1 });
});

test('player spawn projects to its actual location near the bow', () => {
  const uv = worldToMinimapUv(2102, 133);
  assert.ok(Math.abs(uv.u - 0.5168617614269788) < 1e-12);
  assert.ok(Math.abs(uv.v - 0.16304347826086957) < 1e-12);
});

test('enemy firing pings are five times the original size', () => {
  assert.equal(MINIMAP_PING_SIZE, 80);
});

test('worldToMinimapUv accepts a per-map calibration', () => {
  const cal = { centerX: 100, centerZ: 0, size: 200, flipU: 1, flipV: -1 };
  assert.deepEqual(worldToMinimapUv(100, 0, cal), { u: 0.5, v: 0.5 });
  assert.deepEqual(worldToMinimapUv(100, 100, cal), { u: 1, v: 0.5 });
});

test('minimapCalibration falls back to the bounds when a map has no minimap', () => {
  const cal = minimapCalibration({ minimap: null, bounds: { min: [-100, 0, -50], max: [300, 10, 150] } });
  assert.equal(cal.centerX, 100);
  assert.equal(cal.centerZ, 50);
  assert.equal(cal.size, 400);
  assert.equal(cal.image, null);
  const authored = { centerX: 1, centerZ: 2, size: 3, flipU: 1, flipV: 1, span: 9, image: 'm.png' };
  assert.equal(minimapCalibration({ minimap: authored }).minimapSpan, 9);
});

test('leaderboard view shows the top five plus the player when lower', async () => {
  const { leaderboardView } = await import('../export/web/hud.js');
  const standings = Array.from({ length: 8 }, (_, i) => ({ id: i === 6 ? 'player' : `bot-${i}`, name: `P${i}`, score: 8 - i, place: i + 1 }));
  const view = leaderboardView({ modeName: 'Free for all', standings, teams: null });
  assert.deepEqual(view.rows.map((row) => row.id), ['bot-0', 'bot-1', 'bot-2', 'bot-3', 'bot-4', 'player']);
  assert.equal(view.place, 7);
  assert.equal(view.rows.at(-1).me, true);
  assert.equal(leaderboardView({ standings: standings.slice(0, 3).map((e) => ({ ...e, id: e.id })) }).rows.length, 3);
});
