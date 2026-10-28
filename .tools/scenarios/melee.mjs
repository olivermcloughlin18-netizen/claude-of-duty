// Knife melee gate: a real KeyV press one-hit kills a bot at ~50u (knife kill event, killfeed, hitmarker),
// misses a bot at ~200u but still swings, spares a teammate in TDM, cancels a reload, blocks firing during the
// swing, and a bot-attributed knife kill plays a killcam that names the Knife. Mid-swing screenshots hold the
// viewmodel pose with a scenario-side freeze so the frame is deterministic under the slow headless renderer.
import { makeDebug, waitFor } from './_ks-common.mjs';

export const query = '';

export async function run({ page, openGame, screenshot }) {
  const debug = makeDebug(page);
  const checks = {};
  const probe = {};
  const section = async (name, body) => {
    try { await body(); } catch (error) { checks[`${name}Completed`] = false; probe[`${name}Error`] = String(error.message).split('\n')[0]; }
  };
  const melee = () => debug((api) => api.getState().weapon.melee);
  const idle = () => waitFor(page, (api) => api.getState().weapon.melee.cooldown === 0 && !api.getState().weapon.melee.swinging, null, 60000);
  // Put bot `index` `distance` units in front of the player, look at it, and report the real distance.
  const place = (index, distance) => debug((api, [i, d]) => {
    const s = api.getState();
    const f = s.player.forward;
    const flat = Math.hypot(f[0], f[2]) || 1;
    const feet = s.player.feet;
    const p = [feet[0] + (f[0] / flat) * d, feet[1], feet[2] + (f[2] / flat) * d];
    api.teleportEnemy(i, p);
    const at = api.getState().enemies[i].position;
    api.lookAt([at[0], at[1] + 36, at[2]]);
    const now = api.getState();
    const bot = now.enemies[i].position;
    return { distance: Math.round(Math.hypot(bot[0] - now.player.feet[0], bot[2] - now.player.feet[2])), health: now.enemies[i].health };
  }, [index, distance]);
  const freeze = (t) => page.evaluate((T) => {
    const vm = globalThis.hijacked.viewmodel;
    const proto = Object.getPrototypeOf(vm).updateMelee;
    vm.updateMelee = function hold(dt) { if (this.meleeTime < 0) return; this.meleeTime = T - dt; proto.call(this, dt); };
  }, t);
  const thaw = () => page.evaluate(() => { delete globalThis.hijacked.viewmodel.updateMelee; });

  await debug((api) => { api.setActive(true); api.resume(); api.setGraphicsPreset('performance'); });
  await waitFor(page, (api) => api.getState().weapon.ready === true && api.getState().enemies.length >= 6, null, 90000);
  const boot = await debug((api) => api.getState());
  checks.startsIdle = boot.weapon.melee.cooldown === 0 && boot.weapon.melee.swings === 0;
  // Keep the other bots out of the way of the test.
  await debug((api) => { for (let i = 1; i < 6; i += 1) api.killCombatant(`bot-${i}`); });

  await section('kill', async () => {
    const placed = await place(0, 50);
    probe.killPlacement = placed;
    checks.botAtAbout50 = placed.distance >= 40 && placed.distance <= 62;
    await freeze(0.17); // viewmodel held mid-slash while the blow lands
    await page.keyboard.press('KeyV');
    await waitFor(page, (api) => api.getState().enemies[0].dead === true, null, 60000);
    await page.waitForTimeout(400);
    await screenshot('melee-kill');
    await thaw();
    const after = await debug((api) => ({
      state: api.getState(),
      events: api.recentEvents(),
      marker: document.getElementById('hitmarker').dataset.kind,
      feed: document.getElementById('killfeed').textContent,
    }));
    const kill = after.events.find((e) => e.type === 'kill' && e.payload.victimId === 'bot-0')?.payload;
    probe.kill = kill;
    probe.meleeState = after.state.weapon.melee;
    probe.feed = after.feed;
    checks.oneSwingKilled = after.state.weapon.melee.swings === 1 && after.state.weapon.melee.hits === 1 && after.state.weapon.melee.lastHit?.killed === true;
    checks.killEventIsKnife = kill?.weaponId === 'knife' && kill?.cause === 'melee' && kill?.killerId === 'player';
    checks.killfeedSaysKnife = /knife/i.test(after.feed);
    checks.hitmarkerIsKill = after.marker === 'kill';
    checks.killWasOneHit = after.state.weapon.fireCount === 0;
    await idle();
  });

  await section('swingShots', async () => {
    // Pose evidence: wound up, mid-slash and follow-through, bot in front each time.
    for (const [name, t] of [['wind', 0.08], ['slash', 0.17], ['follow', 0.27], ['retract', 0.56]]) {
      await debug((api) => api.respawnEnemies());
      await debug((api) => { for (let i = 1; i < 6; i += 1) api.killCombatant(`bot-${i}`); });
      await place(0, 60);
      await freeze(t);
      await page.keyboard.press('KeyV');
      await waitFor(page, (api) => api.getState().weapon.melee.swings >= 1, null, 60000);
      await page.waitForTimeout(700);
      await screenshot(`melee-${name}`);
      await thaw();
      await idle();
      await debug((api) => api.respawnEnemies());
    }
  });

  await section('miss', async () => {
    await debug((api) => { api.respawnEnemies(); for (let i = 1; i < 6; i += 1) api.killCombatant(`bot-${i}`); });
    await idle();
    const before = await melee();
    const placed = await place(0, 200);
    probe.missPlacement = placed;
    await page.keyboard.press('KeyV');
    await waitFor(page, (api, n) => api.getState().weapon.melee.swings === n + 1 && api.getState().weapon.melee.lastHit !== null && api.getState().weapon.melee.cooldown === 0, before.swings, 60000);
    const after = await debug((api) => api.getState());
    probe.miss = after.weapon.melee;
    checks.missAt200Swings = after.weapon.melee.swings === before.swings + 1 && after.weapon.melee.lastHit.targetId === null;
    checks.missLeavesBotAlive = after.enemies[0].dead === false && after.enemies[0].health === 100;
  });

  await section('reloadCancel', async () => {
    await idle();
    await debug((api) => api.setWeaponAmmo(10, 100));
    await page.keyboard.press('KeyR');
    await waitFor(page, (api) => api.getState().weapon.reloading === true, null, 30000);
    const before = await melee();
    await page.keyboard.press('KeyV');
    await waitFor(page, (api, n) => api.getState().weapon.melee.swings === n + 1, before.swings, 30000);
    const during = await debug((api) => ({ w: api.getState().weapon, vmReloading: hijacked.viewmodel.reloading, fired: hijacked.viewmodel.fire({}) }));
    probe.reloadCancel = { reloading: during.w.reloading, vmReloading: during.vmReloading, magazine: during.w.magazine, swinging: during.w.melee.swinging };
    checks.meleeCancelsReload = during.w.reloading === false && during.vmReloading === false && during.w.magazine === 10 && during.w.reserveAmmo === 100;
    checks.cannotFireDuringSwing = during.fired === false;
    // A real held trigger during recovery must not shoot either.
    const fireCount = during.w.fireCount;
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(250);
    await page.mouse.up({ button: 'left' });
    const held = await debug((api) => api.getState().weapon);
    probe.heldTrigger = { fireCount: held.fireCount, was: fireCount, swinging: held.melee.swinging, cooldown: held.melee.cooldown };
    checks.heldTriggerBlockedWhileRecovering = held.melee.cooldown > 0 ? held.fireCount === fireCount : true;
    await idle();
  });

  await section('killcam', async () => {
    await debug((api) => { api.respawnEnemies(); api.respawnPlayer(); });
    await waitFor(page, (api) => api.getState().systems.killcam.buffered >= 40, null, 120000);
    const kill = await debug((api) => api.killCombatant('player', { attackerId: 'bot-0', weaponId: 'knife', cause: 'melee' }));
    probe.botKnifeKill = kill.killed;
    await waitFor(page, (api) => api.getState().systems.killcam.playing === true, null, 60000);
    await waitFor(page, (api) => api.getState().systems.killcam.seconds >= 0.5, null, 60000);
    await page.waitForTimeout(700);
    await screenshot('melee-killcam');
    const text = await page.evaluate(() => ({
      label: document.querySelector('.kc-label')?.textContent, sub: document.querySelector('.kc-sub')?.textContent,
      feed: document.getElementById('killfeed')?.textContent,
    }));
    probe.killcam = text;
    checks.botKnifeKillKilledPlayer = kill.killed === true && kill.event?.cause === 'melee' && kill.event?.weaponId === 'knife';
    checks.killcamPlaysForKnife = /Killcam/.test(text.label ?? '') && /knife/i.test(text.sub ?? '');
    checks.botKnifeKillInFeed = /knife/i.test(text.feed ?? '');
    await waitFor(page, (api) => api.getState().systems.killcam.playing === false, null, 120000);
    await waitFor(page, (api) => api.getState().player.dead === false, null, 60000);
  });

  // Teammates take nothing in TDM.
  await openGame('mode=tdm');
  await debug((api) => { api.setActive(true); api.resume(); api.setGraphicsPreset('performance'); });
  await waitFor(page, (api) => api.getState().weapon.ready === true && api.getState().enemies.length >= 6, null, 90000);
  await section('teammate', async () => {
    const teams = await debug((api) => Object.fromEntries(api.getState().combatants.map((c) => [c.id, c.team])));
    checks.botZeroIsTeammate = teams['bot-0'] === teams.player;
    const placed = await place(0, 50);
    probe.teammatePlacement = placed;
    await page.keyboard.press('KeyV');
    await waitFor(page, (api) => api.getState().weapon.melee.swings === 1 && api.getState().weapon.melee.lastHit !== null, null, 60000);
    await page.waitForTimeout(300);
    const s = await debug((api) => api.getState());
    probe.teammate = { melee: s.weapon.melee, health: s.enemies[0].health };
    checks.teammateUntouched = s.enemies[0].health === 100 && s.enemies[0].dead === false && s.weapon.melee.lastHit.targetId === null;
    await screenshot('melee-teammate');
    await idle();
    // ...but a hostile in the same match dies to one blow.
    const foe = s.enemies.findIndex((e) => teams[`bot-${e.index}`] !== teams.player);
    await place(foe, 50);
    await page.keyboard.press('KeyV');
    await waitFor(page, (api, i) => api.getState().enemies[i].dead === true, foe, 60000);
    checks.hostileInTdmDies = true;
  });
  return { checks, probe };
}
