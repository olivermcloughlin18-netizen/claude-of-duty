import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEventBus, EVENTS } from '../export/web/game-events.js';

const withErrors = (fn) => {
  const original = console.error;
  const seen = [];
  console.error = (...args) => seen.push(args.join(' '));
  try { fn(seen); } finally { console.error = original; }
  return seen;
};

test('emit delivers payloads, off() unsubscribes, history is bounded', () => {
  const bus = createEventBus({ historyLimit: 2 });
  const got = [];
  const off = bus.on(EVENTS.MEDAL, (payload) => got.push(payload.ref));
  bus.emit('medal', { ref: 'a', name: 'A', xp: 1 });
  off();
  bus.emit('medal', { ref: 'b', name: 'B', xp: 2 });
  bus.emit('medal', { ref: 'c', name: 'C', xp: 3 });
  assert.deepEqual(got, ['a']);
  assert.deepEqual(bus.history().map((entry) => entry.payload.ref), ['b', 'c']);
});

test('unknown types throw on emit and on', () => {
  const bus = createEventBus();
  assert.throws(() => bus.emit('nope', {}), /unknown event type/);
  assert.throws(() => bus.on('nope', () => {}), /unknown event type/);
});

test('undefined required fields are logged, null is allowed', () => {
  const bus = createEventBus();
  const missing = withErrors(() => bus.emit('streak', { id: 'uav', ownerId: 'player' }));
  assert.deepEqual(missing, ['[bus] streak missing phase']);
  const fine = withErrors(() => bus.emit('match', { phase: 'ended', winnerId: null, winnerTeam: null }));
  assert.deepEqual(fine, []);
});

test('a throwing handler is logged and does not stop the others', () => {
  const bus = createEventBus();
  let reached = false;
  bus.on('match', () => { throw new Error('boom'); });
  bus.on('match', () => { reached = true; });
  const seen = withErrors(() => bus.emit('match', { phase: 'playing', winnerId: null, winnerTeam: null }));
  assert.equal(reached, true);
  assert.equal(seen.length, 1);
});
