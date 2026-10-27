import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StreakTracker, rollCrateReward, streakForKills, stripPlan, minimapUvToWorld, normalizeId, system } from '../export/web/killstreaks.js';
import { MAP_CAL, worldToMinimapUv } from '../export/web/hud.js';

test('streaks are earned at 3, 4, 5 and 7 kills only', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(streakForKills), [null, null, 'uav', 'hunter', 'carepackage', null, 'airstrike', null]);
});

test('tracker: death resets the count but held streaks survive, one of each', () => {
  const t = new StreakTracker();
  const earned = [1, 2, 3, 4].map(() => t.onKill());
  assert.deepEqual(earned, [null, null, 'uav', 'hunter']);
  t.onDeath();
  assert.equal(t.count, 0);
  assert.deepEqual(t.held, ['uav', 'hunter']);
  assert.equal(t.grant('uav'), false);
  assert.equal(t.take('uav'), true);
  assert.equal(t.take('uav'), false);
  assert.equal(t.latest(), 'hunter');
});

test('crate rewards follow the 40/30/15/15 table', () => {
  assert.deepEqual([0, 0.39, 0.4, 0.69, 0.7, 0.84, 0.85, 0.99].map(rollCrateReward), ['uav', 'uav', 'hunter', 'hunter', 'airstrike', 'airstrike', 'ammo', 'ammo']);
});

test('air strike plan: 5 bombs 150u apart, centred on the target along dir', () => {
  const plan = stripPlan({ x: 100, z: 50 }, { x: 0, z: 1 });
  assert.equal(plan.length, 5);
  assert.deepEqual(plan.map((p) => p.offset), [-300, -150, 0, 150, 300]);
  assert.deepEqual(plan.map((p) => p.z), [-250, -100, 50, 200, 350]);
  assert.ok(plan.every((p) => p.x === 100));
});

test('minimap uv inverts exactly for Hijacked and a flipped calibration', () => {
  for (const cal of [MAP_CAL, { centerX: 10, centerZ: -20, size: 3200, flipU: -1, flipV: 1 }]) {
    const { u, v } = worldToMinimapUv(321, -654, cal);
    const w = minimapUvToWorld(u, v, cal);
    assert.ok(Math.abs(w.x - 321) < 1e-6 && Math.abs(w.z + 654) < 1e-6);
  }
});

test('aliases and the system contract', () => {
  assert.equal(normalizeId('hk'), 'hunter');
  assert.equal(normalizeId('nope'), null);
  for (const key of ['name', 'debug', 'init', 'update', 'onKey', 'onTouchAction', 'reset', 'getState']) assert.ok(key in system, key);
  assert.equal(system.radarActive, false);
  assert.equal(system.onKey('Digit3'), false);
});
