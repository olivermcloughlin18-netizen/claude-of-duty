import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ATTACHMENTS, REGION_MULTIPLIERS, WEAPONS, damageFor, getWeapon, resolveWeapon } from '../export/web/weapons.js';
import { MODES, PLAYER_RULES, getMode } from '../export/web/modes.js';

const WEAPON_FIELDS = ['id', 'name', 'class', 'magazineSize', 'reserveAmmo', 'roundsPerMinute', 'damage', 'falloff',
  'pellets', 'spread', 'recoil', 'alertRadius', 'maxRange', 'fireMode', 'fireTypeIcon', 'scope', 'art', 'audio',
  'viewmodelUrl', 'magazineUrl', 'magazineOffset', 'clips'];

// Damage values the inline definitions in index.html shipped with.
const OLD_DAMAGE = { m27: 33, an94: 40, sa58: 55, saritch: 50, scar: 40, sig556: 40, tar21: 40, type95: 33, xm8: 35 };

test('every weapon has every contract field and the nine rifles are intact', () => {
  for (const id of Object.keys(OLD_DAMAGE)) assert.ok(WEAPONS[id], id); // lane A adds more on top of the nine
  for (const def of Object.values(WEAPONS)) {
    for (const field of WEAPON_FIELDS) assert.notEqual(def[field], undefined, `${def.id}.${field}`);
    assert.ok(['ar', 'smg', 'sniper', 'shotgun'].includes(def.class));
    assert.deepEqual(Object.keys(def.audio).sort(), ['gain', 'rate', 'shot']);
    assert.ok(Object.isFrozen(def) && Object.isFrozen(def.clips));
  }
});

test('damageFor matches the old damage x region multiplier at any distance', () => {
  for (const [id, damage] of Object.entries(OLD_DAMAGE)) {
    for (const [region, multiplier] of Object.entries(REGION_MULTIPLIERS)) {
      for (const distance of [0, 300, 4000]) {
        assert.equal(damageFor(WEAPONS[id], { distance, region }), damage * multiplier);
      }
    }
  }
});

test('damageFor interpolates the falloff curve', () => {
  const def = { damage: 100, falloff: [[0, 1], [1000, 0.5], [2000, 0.2]] };
  assert.equal(damageFor(def, { distance: 500, region: 'torso' }), 75);
  assert.equal(damageFor(def, { distance: 5000, region: 'head' }), 40);
});

test('getWeapon aliases hk416 and resolveWeapon validates', () => {
  assert.equal(getWeapon('hk416').id, 'm27');
  assert.equal(getWeapon('nope'), null);
  assert.equal(resolveWeapon('an94').id, 'an94');
  assert.throws(() => resolveWeapon('nope'), /unknown weapon/);
  assert.throws(() => resolveWeapon('m27', ['a', 'b', 'c']), /at most 2/);
  assert.throws(() => resolveWeapon('m27', ['missing']), /unknown attachment/);
  ATTACHMENTS.__test = { name: 'test', apply: (def) => ({ ...def, damage: 1 }) };
  try {
    const def = resolveWeapon('m27', ['__test']);
    assert.equal(def.damage, 1);
    assert.ok(Object.isFrozen(def));
    assert.equal(WEAPONS.m27.damage, 33, 'base definition is untouched');
  } finally { delete ATTACHMENTS.__test; }
});

test('modes carry every field and PLAYER_RULES matches the shipped health setup', () => {
  assert.deepEqual({ ...PLAYER_RULES }, { maxHealth: 100, respawnDelay: 1.5, spawnProtection: 3, regenDelay: 4, regenPerSecond: 25 });
  for (const mode of Object.values(MODES)) {
    for (const field of ['id', 'name', 'teams', 'botCount', 'killstreaks', 'online', 'spawnClasses', 'teamFor', 'createMatch']) {
      assert.notEqual(mode[field], undefined, `${mode.id}.${field}`);
    }
    const match = mode.createMatch();
    for (const method of ['register', 'reset', 'update', 'recordKill', 'finish', 'getState']) {
      assert.equal(typeof match[method], 'function', method);
    }
    for (const key of ['modeId', 'modeName', 'phase', 'scoreLimit', 'timeLimitSeconds', 'elapsedSeconds', 'remainingSeconds',
      'winnerId', 'winnerTeam', 'teams', 'scoreLabel', 'standings', 'feed']) {
      assert.ok(key in match.getState(), key);
    }
  }
  assert.equal(getMode('nope').id, 'ffa');
  assert.equal(MODES.ffa.teamFor(3), null);
});
