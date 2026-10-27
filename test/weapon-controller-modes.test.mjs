import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WeaponController } from '../export/web/weapon-controller.js';
import { WEAPONS } from '../export/web/weapons.js';

// Hold the trigger for `seconds` in 10 ms steps and count rounds fired.
function hold(weapon, seconds, { release = null } = {}) {
  let shots = 0;
  weapon.setTrigger(true);
  for (let t = 0; t < seconds; t += 0.01) {
    if (release != null && t >= release) weapon.setTrigger(false);
    shots += weapon.update(0.01);
  }
  weapon.setTrigger(false);
  return shots;
}

test('semi fires one round per pull however long it is held', () => {
  const weapon = WeaponController.fromDefinition(WEAPONS.sa58);
  assert.equal(hold(weapon, 1), 1);
  assert.equal(hold(weapon, 1), 1, 'a second pull fires again');
});

test('burst fires three rounds per pull and finishes after release', () => {
  const weapon = WeaponController.fromDefinition(WEAPONS.sig556);
  assert.equal(hold(weapon, 1), 3);
  const quick = WeaponController.fromDefinition(WEAPONS.xm8);
  assert.equal(hold(quick, 1, { release: 0.005 }), 3, 'releasing early still completes the burst');
});

test('bolt and pump cannot be click-spammed past their cycle', () => {
  for (const id of ['smr_bolt', 'scar_pump']) {
    const weapon = WeaponController.fromDefinition(WEAPONS[id]);
    let shots = 0;
    for (let i = 0; i < 20; i += 1) { // 20 clicks in 0.6 s
      weapon.setTrigger(true);
      shots += weapon.update(0.02);
      weapon.setTrigger(false);
      shots += weapon.update(0.01);
    }
    assert.equal(shots, 1, `${id} fired once inside its cycle`);
    for (let i = 0; i < 100; i += 1) weapon.update(0.01); // cycle completes
    weapon.setTrigger(true);
    assert.equal(weapon.update(0.001), 1, `${id} fires again after the cycle`);
  }
});

test('auto still fires on cadence and configure() refills with new stats', () => {
  const weapon = WeaponController.fromDefinition(WEAPONS.m27);
  assert.equal(hold(weapon, 1) >= 12, true);
  weapon.configure(WEAPONS.scar_pump);
  assert.equal(weapon.fireMode, 'pump');
  assert.equal(weapon.magazine, 6);
  assert.equal(weapon.reserveAmmo, 36);
  assert.throws(() => new WeaponController({ fireMode: 'laser' }), /unknown fireMode/);
});
