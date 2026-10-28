import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coverReason, nextStrafeSide, pickFlankPoint, reactionDelay } from '../export/web/bot-brain.js';
import { enemyShotSpread } from '../export/web/enemy-tactics.js';

test('reaction delay stays in the human 200-450 ms band and grows with range and target speed', () => {
  for (const roll of [0, 0.5, 1]) {
    for (const distance of [0, 400, 850, 3000]) {
      const t = reactionDelay(distance, 250, roll);
      assert.ok(t >= 0.2 && t <= 0.45, `${t}`);
    }
  }
  assert.ok(reactionDelay(800, 0, 0.5) > reactionDelay(100, 0, 0.5));
  assert.ok(reactionDelay(400, 300, 0.5) > reactionDelay(400, 0, 0.5));
  assert.equal(reactionDelay(0, 0, 0), 0.2);
  assert.equal(reactionDelay(850, 300, 1), 0.45);
});

test('cover: hurt, outgunned and reloading bots hide; cooldown stops flip-flopping', () => {
  const base = { health: 100, maxHealth: 100, reloading: false, visibleHostiles: 1, cooldown: 0, roll: 0 };
  assert.equal(coverReason(base), null);
  assert.equal(coverReason({ ...base, health: 40 }), 'hurt');
  assert.equal(coverReason({ ...base, health: 60, visibleHostiles: 2 }), 'outgunned');
  assert.equal(coverReason({ ...base, health: 100, visibleHostiles: 2 }), null);
  assert.equal(coverReason({ ...base, reloading: true, roll: 0.3 }), 'reload');
  assert.equal(coverReason({ ...base, reloading: true, roll: 0.9 }), null);
  assert.equal(coverReason({ ...base, health: 10, cooldown: 2 }), null);
});

test('flank point sits on the requested side, off the straight line, and fans a squad out', () => {
  const from = { x: 0, z: 0 }; const goal = { x: 0, z: -600 };
  const points = [
    { x: 0, z: -300 }, // on the direct line: rejected
    { x: 300, z: -200 }, { x: -300, z: -200 }, { x: 560, z: -260 }, { x: 5, z: 400 },
  ];
  const right = pickFlankPoint(points, from, goal, 1);
  const left = pickFlankPoint(points, from, goal, -1);
  assert.ok(right && left && right.x !== left.x);
  assert.ok(Math.sign(right.x) !== Math.sign(left.x));
  const second = pickFlankPoint(points, from, goal, 1, [right]);
  assert.notEqual(second, right);
  assert.equal(pickFlankPoint([{ x: 0, z: -300 }], from, goal, 1), null);
});

test('strafe flips when blocked and sometimes on its own', () => {
  assert.equal(nextStrafeSide(1, true, 0.9), -1);
  assert.equal(nextStrafeSide(1, false, 0.9), 1);
  assert.equal(nextStrafeSide(-1, false, 0.1), 1);
});

test('hit chance: wider spread at range and when shooter or target move', () => {
  assert.ok(enemyShotSpread(750) > 1.5 * enemyShotSpread(250));
  assert.ok(enemyShotSpread(500, { shooterSpeed: 230 }) > enemyShotSpread(500));
});
