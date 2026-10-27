import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ATTACHMENTS, WEAPONS, damageFor, resolveWeapon } from '../export/web/weapons.js';

const byClass = (name) => Object.values(WEAPONS).filter((def) => def.class === name);

test('arsenal ships at least 2 SMGs, 2 snipers and 1 shotgun', () => {
  assert.ok(byClass('smg').length >= 2);
  assert.ok(byClass('sniper').length >= 2);
  assert.ok(byClass('shotgun').length >= 1);
  for (const def of byClass('sniper')) assert.equal(def.scope, true);
});

test('rifle fire modes match their HUD icons', () => {
  const iconMode = { hud_mp_firerate_auto: 'auto', hud_mp_firerate_single: 'semi', hud_mp_firerate_burst: 'burst',
    hud_mp_firerate_bolt: 'bolt', hud_mp_firerate_pump: 'pump' };
  for (const def of Object.values(WEAPONS)) assert.equal(def.fireMode, iconMode[def.fireTypeIcon], def.id);
  assert.deepEqual(['sa58', 'saritch', 'sig556', 'xm8'].map((id) => WEAPONS[id].fireMode), ['semi', 'semi', 'burst', 'burst']);
  assert.equal(WEAPONS.m27.fireMode, 'auto');
  assert.equal(WEAPONS.an94.fireMode, 'auto');
});

test('class tuning: shotgun and SMG falloff, sniper one-shots', () => {
  const shotgun = WEAPONS.scar_pump;
  assert.equal(shotgun.pellets, 8);
  assert.ok(shotgun.pellets * damageFor(shotgun, { distance: 150, region: 'torso' }) >= 100);
  assert.ok(shotgun.pellets * damageFor(shotgun, { distance: 900, region: 'torso' }) < 100);
  for (const smg of byClass('smg')) {
    assert.ok(damageFor(smg, { distance: 1200, region: 'torso' }) < damageFor(smg, { distance: 200, region: 'torso' }), smg.id);
  }
  assert.ok(damageFor(WEAPONS.smr_bolt, { distance: 1500, region: 'torso' }) >= 100);
});

test('attachments apply the specified multipliers and cap at two', () => {
  assert.equal(Object.keys(ATTACHMENTS).length, 6);
  const base = WEAPONS.tar_smg;
  const sup = resolveWeapon('tar_smg', ['suppressor']);
  assert.equal(sup.alertRadius, 400);
  assert.equal(sup.suppressed, true);
  assert.ok(sup.audio.gain < base.audio.gain);
  assert.equal(resolveWeapon('tar_smg', ['extmag']).magazineSize, 48);
  assert.equal(resolveWeapon('tar_smg', ['fastmag']).reloadSpeed, 1.4);
  assert.equal(resolveWeapon('tar_smg', ['grip']).recoil.yaw, base.recoil.yaw * 0.7);
  assert.equal(resolveWeapon('tar_smg', ['rapid']).roundsPerMinute, 1125);
  const longer = resolveWeapon('tar_smg', ['longbarrel']);
  assert.equal(longer.falloff[1][0], 560);
  assert.equal(longer.falloff.at(-1)[0], base.falloff.at(-1)[0] * 1.4);
  assert.deepEqual([...resolveWeapon('tar_smg', ['grip', 'rapid']).attachments], ['grip', 'rapid']);
  assert.throws(() => resolveWeapon('tar_smg', ['grip', 'rapid', 'extmag']), /at most 2/);
  assert.throws(() => resolveWeapon('tar_smg', ['grip', 'grip']), /duplicate/);
  assert.equal(WEAPONS.tar_smg.roundsPerMinute, 900, 'base untouched');
});

test('every definition reports a true max per shot for the server table', () => {
  for (const def of Object.values(WEAPONS)) {
    assert.ok(Number.isInteger(def.pellets) && def.pellets >= 1, def.id);
    assert.ok(def.damage > 0 && def.roundsPerMinute > 0, def.id);
    assert.ok(def.falloff.every(([, factor]) => factor <= 1), `${def.id} falloff never exceeds 1`);
  }
});
