import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Combatants } from '../export/web/combatants.js';
import { createEventBus } from '../export/web/game-events.js';

function entry(id, team = null, hp = 100, extra = {}) {
  const state = { hp, applied: [] };
  return {
    id, name: id, kind: 'bot', team, actor: { id },
    position: () => ({ x: extra.x ?? 0, y: 0, z: 0 }),
    feet: () => ({ x: extra.x ?? 0, y: 0, z: 0 }),
    dead: () => state.hp <= 0,
    hitboxes: () => [{ id }],
    applyDamage(amount, info) {
      const applied = Math.min(state.hp, amount);
      state.hp -= applied;
      state.applied.push({ amount: applied, info });
      return applied;
    },
    state,
  };
}

function setup(entries) {
  const bus = createEventBus();
  const combatants = new Combatants({ bus });
  for (const e of entries) combatants.add(e);
  return { bus, combatants };
}

test('hostile matrix: world, same id, null teams, differing teams', () => {
  const { combatants } = setup([entry('a', 'allies'), entry('b', 'allies'), entry('c', 'axis'), entry('d', null)]);
  assert.equal(combatants.hostile('a', 'a'), false);
  assert.equal(combatants.hostile(null, 'a'), true);
  assert.equal(combatants.hostile('a', 'b'), false);
  assert.equal(combatants.hostile('a', 'c'), true);
  assert.equal(combatants.hostile('a', 'd'), true);
  assert.equal(combatants.hostile('d', 'd'), false);
  combatants.setTeam('d', 'axis');
  assert.equal(combatants.teamOf('d'), 'axis');
  assert.equal(combatants.hostile('c', 'd'), false);
});

test('friendly fire, self damage and dead victims all apply 0', () => {
  const a = entry('a', 'allies');
  const b = entry('b', 'allies');
  const c = entry('c', 'axis', 10);
  const { combatants, bus } = setup([a, b, c]);
  assert.equal(combatants.applyDamage('b', 50, { attackerId: 'a' }), 0, 'friendly fire');
  assert.equal(combatants.applyDamage('a', 50, { attackerId: 'a' }), 0, 'self damage');
  assert.equal(combatants.applyDamage('a', 0, { attackerId: 'c' }), 0, 'zero amount');
  assert.equal(combatants.applyDamage('a', 30, { attackerId: 'c', cause: 'environment' }), 30);
  assert.equal(combatants.applyDamage('a', 30, { attackerId: 'a', cause: 'environment' }), 30, 'environment may self-damage');
  assert.equal(combatants.applyDamage('c', 50, { attackerId: 'a', weaponId: 'm27', region: 'head' }), 10);
  assert.equal(combatants.applyDamage('c', 50, { attackerId: 'a' }), 0, 'dead victim');
  const damage = bus.history().filter((event) => event.type === 'damage');
  assert.equal(damage.length, 3);
  assert.deepEqual(damage.at(-1).payload, {
    attackerId: 'a', victimId: 'c', amount: 10, weaponId: 'm27', cause: 'bullet', region: 'head',
  });
});

test('lastHit is recorded before the entry sees the damage', () => {
  const victim = entry('v', 'axis');
  const { combatants } = setup([entry('k', 'allies'), victim]);
  let seen = null;
  const original = victim.applyDamage.bind(victim);
  victim.applyDamage = (amount, info) => {
    seen = combatants.lastHit('v');
    return original(amount, info);
  };
  combatants.applyDamage('v', 40, { attackerId: 'k', weaponId: 'an94', region: 'torso' });
  assert.equal(seen.attackerId, 'k');
  assert.equal(seen.weaponId, 'an94');
  assert.equal(seen.cause, 'bullet');
  assert.equal(typeof seen.at, 'number');
});

test('radiusDamage falls off linearly and honours isExposed', () => {
  const { combatants } = setup([
    entry('near', 'axis', 500, { x: 0 }), entry('mid', 'axis', 500, { x: 50 }),
    entry('far', 'axis', 500, { x: 200 }), entry('covered', 'axis', 500, { x: 10 }),
  ]);
  const results = combatants.radiusDamage([0, 0, 0], 100, 100, { attackerId: null, weaponId: 'strike', cause: 'airstrike' },
    (e) => e.id !== 'covered');
  const byId = Object.fromEntries(results.map((r) => [r.id, r.applied]));
  assert.equal(byId.near, 100);
  assert.equal(byId.mid, 50);
  assert.equal(byId.far, undefined);
  assert.equal(byId.covered, undefined);
});

test('resolveHit maps bot and puppet hitboxes and ignores dead entries', () => {
  const bot = entry('bot-0', 'axis');
  const puppet = entry('net-7', null);
  const { combatants } = setup([bot, puppet]);
  assert.equal(combatants.idOf(bot.actor), 'bot-0');
  const botHit = { object: { userData: { enemyHit: { enemy: bot.actor, multiplier: 2, region: 'head' } } } };
  const puppetHit = { object: { userData: { combatantHit: { id: 'net-7', multiplier: 0.75, region: 'legs' } } } };
  assert.deepEqual(combatants.resolveHit(botHit), { id: 'bot-0', region: 'head', multiplier: 2 });
  assert.deepEqual(combatants.resolveHit(puppetHit), { id: 'net-7', region: 'legs', multiplier: 0.75 });
  assert.equal(combatants.resolveHit({ object: { userData: {} } }), null);
  bot.state.hp = 0;
  assert.equal(combatants.resolveHit(botHit), null);
  assert.equal(combatants.hitTargets().length, 1);
  assert.deepEqual(combatants.getState(), [{ id: 'bot-0', team: 'axis', dead: true }, { id: 'net-7', team: null, dead: false }]);
});
