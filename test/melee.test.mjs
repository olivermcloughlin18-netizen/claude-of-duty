import test from 'node:test';
import assert from 'node:assert/strict';
import { MELEE, createMelee, knifePose, pickTarget } from '../export/web/melee.js';
import { KNIFE, WEAPONS, getWeapon, lookupWeapon } from '../export/web/weapons.js';
import { Combatants } from '../export/web/combatants.js';
import { createEventBus } from '../export/web/game-events.js';

const eye = { x: 0, y: 60, z: 0 };
const forward = { x: 0, z: -1 };
const at = (id, x, z, y = 24) => ({ id, x, y: y + 36, z }); // aim point = feet + 36

test('registry: knife is a known damage source but never a class primary', () => {
  assert.equal(lookupWeapon('knife'), KNIFE);
  assert.equal(KNIFE.damage, 150);
  assert.equal(getWeapon('knife'), null, 'getWeapon (loadouts) must not accept it');
  assert.equal(WEAPONS.knife, undefined, 'no viewmodel slot or class card');
  assert.equal(lookupWeapon('m27').id, 'm27');
});

test('pickTarget: reach, facing cone and height', () => {
  assert.equal(pickTarget(eye, forward, [at('near', 0, -50)])?.id, 'near');
  assert.equal(pickTarget(eye, forward, [at('far', 0, -200)]), null, 'outside 72u');
  assert.equal(pickTarget(eye, forward, [at('behind', 0, 50)]), null);
  assert.equal(pickTarget(eye, forward, [at('side', 60, -10)]), null, 'beside you, outside the cone');
  assert.equal(pickTarget(eye, forward, [at('upstairs', 0, -30, 300)]), null);
  assert.equal(pickTarget(eye, forward, [at('hugging', 0, 5)])?.id, 'hugging', 'point blank counts from any facing');
  assert.equal(pickTarget(eye, forward, [at('a', 0, -70), at('b', 0, -40)]).id, 'b', 'nearest wins');
  assert.equal(pickTarget(eye, forward, [at('lunge', 0, -170)], { range: MELEE.lungeRange, cos: MELEE.lungeCos })?.id, 'lunge');
});

function world({ teams = false } = {}) {
  const bus = createEventBus();
  const combatants = new Combatants({ bus, now: () => 0 });
  const bodies = new Map();
  const add = (id, x, z, team = null) => {
    const body = { hp: 100, x, z };
    bodies.set(id, body);
    combatants.add({
      id, name: id, kind: 'bot', team, actor: {}, position: () => ({ x: body.x, y: 0, z: body.z }),
      feet: () => ({ x: body.x, y: 0, z: body.z }), dead: () => body.hp <= 0, hitboxes: () => [],
      applyDamage: (amount) => { const dealt = Math.min(amount, body.hp); body.hp -= dealt; return dealt; },
    });
  };
  combatants.add({
    id: 'player', name: 'YOU', kind: 'player', team: teams ? 'allies' : null, actor: {}, position: () => eye,
    feet: () => ({ x: 0, y: 0, z: 0 }), dead: () => false, hitboxes: () => [], applyDamage: () => 0,
  });
  const swings = [];
  const melee = createMelee({
    combatants, getPose: () => ({ eye: [0, 60, 0], forward: [0, 0, -1] }),
    onSwing: () => swings.push('swing'), onHit: (s) => swings.push(s),
  });
  const run = (seconds) => { for (let t = 0; t < seconds; t += 1 / 60) melee.update(1 / 60); };
  return { combatants, bodies, add, melee, swings, run };
}

test('swing: one-hit kill at 50u, lunge closes a far target, recovery gates the next swing', () => {
  const w = world();
  w.add('bot-0', 0, -50);
  assert.equal(w.melee.start(), true);
  assert.equal(w.melee.start(), false, 'cannot restart mid-swing');
  w.run(MELEE.hitAt + 0.05);
  assert.equal(w.bodies.get('bot-0').hp, 0, 'killed in one hit');
  assert.deepEqual([w.swings.at(-1).killed, w.swings.at(-1).targetId], [true, 'bot-0']);
  assert.equal(w.melee.active, true, 'still recovering');
  w.run(MELEE.recovery);
  assert.equal(w.melee.active, false);
  assert.equal(w.melee.start(), true);
});

test('swing: a miss still swings, nothing dies at 200u', () => {
  const w = world();
  w.add('bot-0', 0, -200);
  assert.equal(w.melee.start(), true);
  w.run(MELEE.recovery);
  assert.equal(w.bodies.get('bot-0').hp, 100);
  assert.equal(w.melee.getState().lastHit.targetId, null);
  assert.equal(w.melee.getState().swings, 1);
});

test('swing: lunge magnetism pulls toward a target within 2.5x reach and stops short of it', () => {
  const w = world();
  w.add('bot-0', 0, -160);
  w.melee.start();
  w.melee.update(1 / 60);
  assert.ok(w.melee.lunge && w.melee.lunge.z < -100, 'lunging forward');
  assert.ok(Math.abs(w.melee.lunge.x) < 1e-6);
  const w2 = world();
  w2.add('bot-0', 0, -300);
  w2.melee.start(); w2.melee.update(1 / 60);
  assert.equal(w2.melee.lunge, null, 'beyond 180u: no magnetism');
});

test('teammates are ignored (no damage, no lunge); only hostiles die', () => {
  const w = world({ teams: true });
  w.add('mate', 0, -50, 'allies');
  w.add('foe', 30, -300, 'axis');
  w.melee.start(); w.run(MELEE.recovery);
  assert.equal(w.bodies.get('mate').hp, 100);
  const w2 = world({ teams: true });
  w2.add('mate', 0, -50, 'allies');
  w2.melee.start(); w2.melee.update(1 / 60);
  assert.equal(w2.melee.lunge, null);
  w2.run(MELEE.recovery);
  assert.equal(w2.bodies.get('mate').hp, 100);
});

test('walls stop the blade; cancel drops a pending blow', () => {
  const bus = createEventBus();
  const combatants = new Combatants({ bus, now: () => 0 });
  let hp = 100;
  combatants.add({ id: 'bot-0', name: 'b', kind: 'bot', team: null, actor: {}, position: () => ({ x: 0, y: 0, z: -40 }),
    feet: () => ({ x: 0, y: 0, z: -40 }), dead: () => hp <= 0, hitboxes: () => [], applyDamage: (a) => { hp -= a; return a; } });
  combatants.add({ id: 'player', name: 'YOU', kind: 'player', team: null, actor: {}, position: () => eye,
    feet: () => ({ x: 0, y: 0, z: 0 }), dead: () => false, hitboxes: () => [], applyDamage: () => 0 });
  const melee = createMelee({ combatants, getPose: () => ({ eye: [0, 60, 0], forward: [0, 0, -1] }), blocked: () => true });
  melee.start();
  for (let t = 0; t < 0.8; t += 1 / 60) melee.update(1 / 60);
  assert.equal(hp, 100);
  const m2 = createMelee({ combatants, getPose: () => ({ eye: [0, 60, 0], forward: [0, 0, -1] }) });
  m2.start(); m2.cancel(); for (let t = 0; t < 0.8; t += 1 / 60) m2.update(1 / 60);
  assert.equal(hp, 100);
  assert.equal(m2.active, false);
});

test('knifePose: hidden outside a swing, rifle lowered mid-swing, back by the end', () => {
  assert.equal(knifePose(-1).visible, false);
  assert.equal(knifePose(MELEE.recovery + 0.01).visible, false);
  const mid = knifePose(MELEE.hitAt);
  assert.equal(mid.visible, true);
  assert.ok(mid.lower > 0.99);
  assert.ok(knifePose(0.65).lower < 0.2);
  assert.ok(MELEE.recovery >= 0.6 && MELEE.recovery <= 0.8);
  assert.ok(MELEE.range >= 64 && MELEE.range <= 80);
});
