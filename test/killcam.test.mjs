import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  REPLAY_SECONDS, angleDiff, bracket, lerpAngle, replayStart, timeline, trim,
} from '../export/web/killcam.js';

test('bracket interpolates and clamps', () => {
  const samples = [{ t: 1 }, { t: 2 }, { t: 3 }];
  assert.equal(bracket([], 1), null);
  assert.deepEqual(bracket(samples, 0.5).k, 0);
  assert.equal(bracket(samples, 9).a.t, 3);
  const mid = bracket(samples, 2.25);
  assert.equal(mid.a.t, 2);
  assert.equal(mid.b.t, 3);
  assert.ok(Math.abs(mid.k - 0.25) < 1e-9);
});

test('angles take the short way round', () => {
  assert.ok(Math.abs(angleDiff(3.1, -3.1)) < 0.1);
  assert.ok(Math.abs(lerpAngle(3.1, -3.1, 0.5) - Math.PI) < 0.1);
});

test('timeline lasts REPLAY_SECONDS and ends on the kill plus hold', () => {
  const killT = 20;
  const start = replayStart(0, killT);
  const line = timeline(start, killT);
  assert.ok(Math.abs(line.total - REPLAY_SECONDS) < 1e-9);
  assert.equal(line.contentAt(0), start);
  assert.ok(Math.abs(line.contentAt(line.total) - (killT + 0.4)) < 1e-9);
  assert.equal(replayStart(19, killT), 19);
});

test('trim keeps only the last eight seconds', () => {
  const list = Array.from({ length: 200 }, (_, i) => ({ t: i * 0.05 }));
  trim(list, 10);
  assert.ok(list[0].t >= 2 - 1e-9);
  assert.ok(Math.abs(list.at(-1).t - 9.95) < 1e-9);
});
