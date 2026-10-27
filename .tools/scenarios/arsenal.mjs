// Lane A acceptance: every weapon equips and fires; shotgun/sniper/SMG damage
// against a teleported bot; semi/burst trigger behaviour; scope overlay with the
// viewmodel hidden; a saved class persisting across a reload. Screenshots:
// class-editor, sniper-ads, shotgun-hip, suppressor.
export const query = '';

export async function run({ page, screenshot, openGame }) {
  const debug = (fn, arg) => page.evaluate(([body, value]) => {
    const api = globalThis.hijacked.debug;
    return new Function('api', 'value', `return (${body})(api, value)`)(api, value);
  }, [fn.toString(), arg]);
  const wait = (ms) => page.waitForTimeout(ms);
  const fireCount = () => debug((api) => api.getState().weapon.fireCount);
  // The CI-class machine can run the game at a few fps, so durations are measured
  // in simulated seconds (match clock), not wall time.
  const gameSeconds = (seconds) => page.evaluate(async (target) => {
    const api = globalThis.hijacked.debug;
    const start = api.getState().match.elapsedSeconds;
    const limit = performance.now() + 60000;
    while (api.getState().match.elapsedSeconds - start < target && performance.now() < limit) await new Promise((r) => setTimeout(r, 25));
  }, seconds);
  // Press until the trigger has produced a round (or 15 s of wall time), then release.
  const click = async () => {
    const before = await fireCount();
    await page.mouse.down({ button: 'left' });
    await page.waitForFunction((n) => globalThis.hijacked.debug.getState().weapon.fireCount > n, before, { timeout: 15000 }).catch(() => {});
    await page.mouse.up({ button: 'left' });
  };

  await debug((api) => { api.setActive(true); api.resume(); });
  await page.waitForFunction(() => globalThis.hijacked.debug.getState().systems.loadout?.ready === true, null, { timeout: 60000 });
  await debug((api) => api.loadAllWeapons());
  const canvas = await page.locator('canvas[data-engine]').boundingBox();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);

  // ---- 1. every weapon equips and fires
  const ids = await debug((api) => api.getState().weapon.availableWeapons);
  const fired = {};
  for (const id of ids) {
    await debug((api, w) => api.selectWeapon(w), id);
    await wait(120);
    const before = await fireCount();
    await click();
    fired[id] = (await fireCount()) - before;
    await debug((api) => api.respawnPlayer());
  }

  // ---- 2. find a long clear lane and stage a bot on it
  const lane = await debug((api) => {
    const h = globalThis.hijacked;
    const nodes = h.hints.pathnodes.filter((_, i) => i % 6 === 0).map((n) => n.position);
    const ray = h.weaponEffects.raycaster;
    const origin = h.camera.position.clone();
    const dir = h.camera.position.clone();
    const down = h.camera.position.clone().set(0, -1, 0);
    const distances = [1500, 1200, 900, 200, 150];
    const floorAt = (x, y, z) => {
      origin.set(x, y + 90, z);
      ray.set(origin, down);
      ray.near = 0; ray.far = 400;
      const hit = ray.intersectObject(h.collisionRoot, true)[0];
      return hit ? hit.point.y : null;
    };
    const sees = (eye, target) => {
      origin.set(...eye);
      dir.set(target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]);
      const length = dir.length();
      dir.normalize();
      ray.set(origin, dir);
      ray.near = 0; ray.far = length;
      return ray.intersectObject(h.collisionRoot, true).length === 0;
    };
    for (const n of nodes) {
      const fy = floorAt(n[0], n[1], n[2]);
      if (fy === null) continue;
      const o = [n[0], fy, n[2]];
      for (let k = 0; k < 24; k += 1) {
        const a = (k / 24) * Math.PI * 2;
        const dx = Math.sin(a); const dz = -Math.cos(a);
        const floor = {};
        let ok = true;
        for (const d of distances) {
          const y = floorAt(o[0] + dx * d, fy, o[2] + dz * d);
          if (y === null || Math.abs(y - fy) > 40 || !sees([o[0], fy + 60, o[2]], [o[0] + dx * d, y + 45, o[2] + dz * d])) { ok = false; break; }
          floor[d] = y;
        }
        if (ok) return { origin: o, dir: [dx, dz], floor };
      }
    }
    return null;
  });
  if (!lane) throw new Error('no clear 1700u lane with floor found');

  const stage = async (distance, weaponId, { ads = false } = {}) => {
    await debug((api) => { api.respawnEnemies(); api.respawnPlayer(); });
    const [ox, oy, oz] = lane.origin;
    const [dx, dz] = lane.dir;
    await debug((api, v) => {
      api.teleportPlayer(v.eye);
      for (let i = 1; i < 6; i += 1) api.killCombatant(`bot-${i}`, { attackerId: null, cause: 'environment' });
      api.teleportEnemy(0, v.bot);
      api.selectWeapon(v.weapon);
    }, {
      eye: [ox, oy, oz], dir: [dx, dz], weapon: weaponId,
      bot: [ox + dx * distance, lane.floor[distance], oz + dz * distance],
    });
    await wait(250);
    await debug((api, v) => api.lookAt(v), [ox + dx * distance, lane.floor[distance] + 45, oz + dz * distance]);
    if (ads) {
      await page.mouse.down({ button: 'right' });
      await page.waitForFunction(() => globalThis.hijacked.viewmodel.aimBlend > 0.95, null, { timeout: 20000 });
    }
    const position = await debug((api) => api.getState().enemies[0].position);
    return position;
  };
  const shoot = async ({ ads = false, oneRound = false } = {}) => {
    if (oneRound) await debug((api) => api.setWeaponAmmo(1, 0));
    // Bots wander between staging and the shot; re-aim at the current chest.
    await debug((api) => { const p = api.getState().enemies[0].position; api.lookAt([p[0], p[1] + 45, p[2]]); });
    const rounds = await fireCount();
    await click();
    await wait(300);
    const out = await debug((api) => {
      const e = api.getState().enemies[0];
      return { dead: e.dead, health: e.health, rounds: api.getState().weapon.fireCount };
    });
    out.rounds -= rounds;
    out.damage = 100 - out.health;
    if (ads) {
      await page.mouse.up({ button: 'right' });
      await page.waitForFunction(() => globalThis.hijacked.viewmodel.aimBlend < 0.1, null, { timeout: 20000 });
    }
    return out;
  };

  const results = {};
  const attempts = {};
  // Stage and shoot, retrying (up to 4x) when the wandering bot dodged every round.
  const duel = async (name, distance, weaponId, options = {}, hook = null) => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await stage(distance, weaponId, options);
      if (attempt === 1 && hook) await hook();
      results[name] = await shoot(options);
      attempts[name] = attempt;
      if (results[name].damage > 0) break;
    }
  };
  let scopedState;
  await duel('shotgunNear', 150, 'scar_pump', {}, () => screenshot('shotgun-hip'));
  await duel('shotgunFar', 900, 'scar_pump');
  await duel('sniper', 1500, 'smr_bolt', { ads: true }, async () => {
    scopedState = await debug((api) => ({ ...api.getState().systems.loadout, viewmodelVisible: globalThis.hijacked.viewmodel.scene.visible,
      overlay: document.getElementById('scope-overlay')?.dataset.on, fov: globalThis.hijacked.camera.fov }));
    await screenshot('sniper-ads');
  });
  await page.waitForFunction(() => globalThis.hijacked.camera.fov > 74.5, null, { timeout: 20000 }).catch(() => {});
  const unscoped = await debug((api) => ({ ...api.getState().systems.loadout, viewmodelVisible: globalThis.hijacked.viewmodel.scene.visible,
    overlay: document.getElementById('scope-overlay')?.dataset.on, fov: globalThis.hijacked.camera.fov }));
  await duel('smgNear', 200, 'tar_smg', { ads: true, oneRound: true });
  await duel('smgFar', 1200, 'tar_smg', { ads: true, oneRound: true });

  // ---- 3. trigger modes: hold 1 s
  const holdCount = async (weaponId) => {
    await debug((api, w) => { api.respawnPlayer(); api.selectWeapon(w); }, weaponId);
    await wait(150);
    const before = await fireCount();
    await page.mouse.down({ button: 'left' });
    await gameSeconds(1);
    await page.mouse.up({ button: 'left' });
    await gameSeconds(0.5);
    return (await fireCount()) - before;
  };
  const holds = { semi: await holdCount('sa58'), burst: await holdCount('sig556'), auto: await holdCount('m27') };

  // ---- 4. suppressor screenshot and class editor
  await debug(async (api) => { api.respawnPlayer(); return api.applyClass(4); });
  await wait(400);
  await debug((api) => { api.lookAt([globalThis.hijacked.camera.position.x + 100, globalThis.hijacked.camera.position.y, globalThis.hijacked.camera.position.z]); });
  await wait(200);
  const ghost = await debug((api) => api.getState().weapon);
  await screenshot('suppressor');
  await debug(async (api) => { api.respawnPlayer(); return api.applyClass(2); });
  await wait(500);
  await debug((api) => { const c = globalThis.hijacked.camera.position; api.lookAt([c.x + 100, c.y, c.z]); });
  await wait(300);
  await screenshot('sniper-hip');
  await debug((api) => { api.pause(); api.showMenu(true); });
  await page.evaluate(() => globalThis.hijacked.frontend.openClass());
  await wait(1200);
  await screenshot('class-editor');
  await page.evaluate(() => globalThis.hijacked.frontend.closeClass());

  // ---- 5. a saved class persists across a reload
  await debug((api) => api.saveClass(1, { name: 'Persist', primary: 'fal_marksman', primaryAttachments: ['grip', 'longbarrel'],
    secondary: 'scar_pump', secondaryAttachments: ['extmag'] }));
  await openGame();
  await page.waitForFunction(() => globalThis.hijacked.debug.getState().systems.loadout?.ready === true, null, { timeout: 60000 });
  const persisted = await debug((api) => ({ weapon: api.getState().weapon, loadout: api.getState().systems.loadout }));
  await page.evaluate(() => localStorage.removeItem('cod.classes.v1'));

  const damages = (r) => r.damage ?? 0;
  return {
    checks: {
      allWeaponsFire: ids.length >= 14 && ids.every((id) => fired[id] >= 1),
      shotgunOneShotsAt150: results.shotgunNear.dead === true,
      shotgunSurvivesAt900: results.shotgunFar.dead === false && results.shotgunFar.damage > 0,
      sniperKillsAt1500: results.sniper.dead === true,
      smgFalloff: damages(results.smgFar) > 0 && damages(results.smgFar) < damages(results.smgNear),
      semiHoldFiresOne: holds.semi === 1,
      burstHoldFiresThree: holds.burst === 3,
      autoHoldFiresMany: holds.auto > 6,
      scopeOverlayShown: scopedState.scoped === true && scopedState.overlay === 'true' && scopedState.viewmodelVisible === false && scopedState.fov < 30,
      scopeReleased: unscoped.scoped === false && unscoped.viewmodelVisible === true && unscoped.fov > 70,
      ghostClass: ghost.attachments.join() === 'suppressor,grip' && ghost.id === 't25_smg',
      classPersists: persisted.loadout.classIndex === 1 && persisted.loadout.primary.id === 'fal_marksman'
        && persisted.weapon.attachments.join() === 'grip,longbarrel' && persisted.weapon.loadout.secondary === 'scar_pump',
    },
    probe: { ids, fired, lane, results, attempts, holds, scopedState, unscoped, ghost, persisted },
  };
}
