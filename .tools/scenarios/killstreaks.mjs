// Lane C acceptance (PLAN.md section 4): streak earning, real Digit3 UAV, air strike
// through the real targeting screen, Little Bird care package, hunter killer.
// The headless GPU is slow (a few fps), so everything waits on game state, not wall time.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findOpenSpot, ks, makeDebug, waitFor } from './_ks-common.mjs';

export const query = '';
export const mapId = 'hijacked';

export async function run({ page, screenshot, artifactRoot }) {
  const debug = makeDebug(page);
  const checks = {};
  const probe = {};
  const frames = [];
  const section = async (name, body) => {
    try { await body(); } catch (error) { checks[`${name}Completed`] = false; probe[`${name}Error`] = String(error.message).split('\n')[0]; }
  };
  const stageBots = (spot, offsets, respawn = true) => debug((api, v) => {
    if (v.respawn) api.respawnEnemies();
    v.offsets.forEach(([dx, dz], i) => api.teleportEnemy(i, [v.spot.x + dx, v.spot.y + 6, v.spot.z + dz]));
    if (v.respawn) api.alertEnemies(0);
  }, { spot, offsets, respawn });
  const standAt = (pair, look) => debug((api, v) => {
    api.teleportPlayer([v.pair.stand.x, v.pair.stand.y + 2, v.pair.stand.z]);
    api.lookAt(v.look ?? [v.pair.spot.x, v.pair.spot.y + 30, v.pair.spot.z]);
  }, { pair, look });

  await debug((api) => { api.setActive(true); api.resume(); api.setGraphicsPreset('performance'); });
  await waitFor(page, (api) => api.getState().systems.killstreaks.fxReady === true, null, 60000);
  const boot = await debug((api) => api.getState());
  checks.ready = boot.ready === true;
  checks.mapMatches = boot.config.mapId === mapId;
  checks.enabled = boot.systems.killstreaks.enabled === true;
  const pair = await findOpenSpot(page);
  probe.pair = pair;
  checks.foundOpenSpot = Boolean(pair);

  await section('uav', async () => {
    // 3 kills -> UAV; the real Digit3 key activates it; the minimap reveals live hostiles
    for (let i = 0; i < 3; i += 1) await debug((api, n) => api.killCombatant(`bot-${n}`), i);
    const afterKills = await ks(debug);
    checks.uavReadyAfter3Kills = afterKills.ready.includes('uav') && afterKills.streak === 3;
    await debug((api) => {
      api.respawnEnemies();
      const p = api.getState().player.feet;
      [[260, 150], [-300, 260], [120, -380], [-180, -250]].forEach(([dx, dz], i) => api.teleportEnemy(i, [p[0] + dx, p[1], p[2] + dz]));
      api.alertEnemies(0);
    });
    await page.waitForTimeout(500);
    await page.keyboard.press('Digit3');
    await waitFor(page, (api) => api.getState().systems.killstreaks.radarActive === true, null, 20000);
    await page.waitForTimeout(1200);
    const uav = await debug((api) => {
      const s = api.getState();
      return { ks: s.systems.killstreaks, revealed: s.hud.revealed, live: s.combatants.filter((c) => c.id !== 'player' && !c.dead).length };
    });
    probe.uav = uav;
    checks.uavActiveViaDigit3 = uav.ks.radarActive === true && !uav.ks.ready.includes('uav') && uav.ks.active.some((a) => a.id === 'uav');
    checks.hudRevealedEqualsLiveHostiles = uav.live > 0 && uav.revealed === uav.live;
    await screenshot('uav');
  });

  await section('airstrike', async () => {
    await debug((api) => { api.respawnPlayer(); api.resume(); });
    await stageBots(pair.spot, [[-90, 40], [0, 0], [80, -60]]);
    await debug((api) => api.grantStreak('airstrike'));
    await standAt(pair);
    await page.keyboard.press('Digit6');
    await waitFor(page, (api) => api.getState().systems.killstreaks.targeting === true, null, 10000);
    const cursor = await page.evaluate(async ({ spot, id }) => {
      const { minimapCalibration, worldToMinimapUv } = await import('./hud.js');
      const maps = await import('./maps.js');
      const map = id === 'hijacked' ? maps.HIJACKED : maps.fromManifest(await (await fetch(`maps/${id}/manifest.json`)).json());
      const cal = minimapCalibration(map);
      const uv = worldToMinimapUv(spot.x, spot.z, cal);
      const rect = document.querySelector('#ks-target canvas').getBoundingClientRect();
      return { x: rect.left + uv.u * rect.width, y: rect.top + uv.v * rect.height, image: cal.image };
    }, { spot: pair.spot, id: mapId });
    probe.cursor = cursor;
    await page.mouse.move(cursor.x - 90, cursor.y - 70);
    await page.mouse.move(cursor.x, cursor.y, { steps: 4 });
    await page.waitForTimeout(300);
    await screenshot('targeting');
    checks.targetingScreenOpen = (await ks(debug)).targeting === true;
    await page.mouse.click(cursor.x, cursor.y);
    await page.waitForTimeout(150);
    const started = await ks(debug);
    checks.confirmStartsStrike = started.targeting === false && started.strike !== null && !started.ready.includes('airstrike');

    await waitFor(page, (api) => api.getState().systems.killstreaks.strike?.jet, null, 120000);
    // CDP screencast gives every rendered frame of the bomb run (the headless GPU is only a few fps)
    const cdp = await page.context().newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => { frames.push(Buffer.from(data, 'base64')); cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}); });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
    let jetShots = 0;
    let exShots = 0;
    for (let i = 0; i < 600; i += 1) {
      const s = (await ks(debug)).strike;
      if (!s) break;
      const near = s.jet && Math.hypot(s.jet[0] - pair.stand.x, s.jet[2] - pair.stand.z) < 2200;
      if (s.exploded === 0) await stageBots(pair.spot, [[-90, 40], [0, 0], [80, -60]], false); // hold the targets in place until the first bomb lands
      if (near && s.exploded === 0) {
        await debug((api, j) => api.lookAt(j), s.jet);
        if (jetShots < 2) { jetShots += 1; await screenshot(`jet${jetShots}`); }
      } else if (s.exploded >= 1) {
        if (exShots === 0) await debug((api, v) => api.lookAt([v.x, v.y + 90, v.z]), pair.spot);
        if (exShots < 3) { exShots += 1; await screenshot(exShots === 2 ? 'explosion' : `explosion-${exShots}`); // the 2nd frame is the fireball peak }
      }
      await page.waitForTimeout(80);
    }
    await cdp.send('Page.stopScreencast').catch(() => {});
    await waitFor(page, (api) => api.getState().systems.killstreaks.strike === null, null, 120000);
    const after = await debug((api) => ({ events: api.recentEvents(), ks: api.getState().systems.killstreaks }));
    const kills = after.events.filter((e) => e.type === 'kill' && e.payload.cause === 'airstrike');
    probe.strikeKills = kills.map((e) => e.payload.victimId);
    checks.airstrikeKilledAtLeast2 = kills.length >= 2;
    checks.fiveBombsFell = after.ks.counters.bombsFallen === 5;
    checks.airstrikeMedal = after.ks.medals.includes('strafe_run_kill');
    await page.waitForTimeout(500);
    await screenshot('aftermath');
  });

  await section('care', async () => {
    await debug((api) => api.respawnPlayer());
    await stageBots(pair.spot, [[400, 400]]);
    await debug((api) => api.grantStreak('carepackage'));
    await standAt(pair, [pair.spot.x, pair.spot.y, pair.spot.z]);
    await page.keyboard.press('Digit5');
    await page.waitForTimeout(200);
    checks.carePackageUsedViaDigit5 = (await ks(debug)).birds.length === 1;
    let birdShot = false;
    let crate = null;
    for (let i = 0; i < 3000; i += 1) {
      const s = await ks(debug);
      crate = s.crates.find((c) => c.state === 'landed') ?? null;
      if (crate) break;
      const bird = s.birds[0];
      if (bird?.model && !bird.dropped && !birdShot && Math.hypot(bird.x - pair.stand.x, bird.z - pair.stand.z) < 1150) {
        await debug((api, b) => api.lookAt([b.x, b.y, b.z]), bird);
        await page.waitForTimeout(40);
        await screenshot('littlebird');
        birdShot = true;
      }
      await page.waitForTimeout(60);
    }
    probe.crate = crate;
    checks.littleBirdModelShown = birdShot;
    checks.crateLandsUnder6s = Boolean(crate) && crate.landedAfter < 6;
    await debug((api, v) => { api.teleportPlayer([v.c.x - 210, v.c.y + 2, v.c.z - 40]); api.lookAt([v.c.x, v.c.y + 30, v.c.z]); }, { c: crate });
    await page.waitForTimeout(1800);
    await screenshot('crate');
    await debug((api, v) => { api.teleportPlayer([v.c.x + 25, v.c.y + 2, v.c.z]); api.lookAt([v.c.x, v.c.y + 20, v.c.z]); }, { c: crate });
    await waitFor(page, (api) => api.getState().systems.killstreaks.counters.captured >= 1, null, 120000);
    const cap = await ks(debug);
    probe.captured = { counters: cap.counters, ready: cap.ready, medals: cap.medals };
    checks.crateCaptureGrantsReward = cap.counters.captured === 1 && cap.medals.includes('capture_enemy_crate');
  });

  await section('hunter', async () => {
    await debug((api) => api.respawnPlayer());
    await stageBots(pair.spot, [[0, 0]]);
    await debug((api) => api.grantStreak('hunter'));
    await standAt(pair, [pair.spot.x, pair.spot.y + 40, pair.spot.z]);
    await page.keyboard.press('Digit4');
    await page.waitForTimeout(200);
    checks.hunterLaunchedViaDigit4 = (await ks(debug)).drones.length === 1;
    let shot = false;
    let elapsed = 0;
    for (let i = 0; i < 3000; i += 1) {
      const s = await ks(debug);
      if (!s.drones.length) break;
      elapsed = Math.max(elapsed, 12 - s.active.find((a) => a.id === 'hunter').seconds);
      if (!shot && s.drones[0].phase === 'hunt' && s.drones[0].y > 250 && Math.hypot(s.drones[0].x - pair.stand.x, s.drones[0].z - pair.stand.z) > 150) {
        shot = true;
        await debug((api, d) => api.lookAt([d.x, d.y, d.z]), s.drones[0]);
        await screenshot('hunter');
      }
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(400);
    const end = await debug((api) => ({ events: api.recentEvents(), ks: api.getState().systems.killstreaks }));
    const kills = end.events.filter((e) => e.type === 'kill' && e.payload.cause === 'hunter');
    probe.hunter = { gameSecondsFlown: elapsed, kills: kills.map((e) => e.payload.victimId) };
    checks.hunterKilledABotUnder15s = kills.length >= 1 && elapsed < 15;
    checks.hunterMedal = end.ks.medals.includes('missile_drone_kill');
  });

  const all = await debug((api) => ({ events: api.recentEvents(), player: api.getState().player, ks: api.getState().systems.killstreaks }));
  checks.noPlayerSelfKill = !all.events.some((e) => e.type === 'kill' && e.payload.victimId === 'player' && e.payload.killerId === 'player');
  checks.playerAlive = all.player.dead === false;

  try {
    const dir = path.join(artifactRoot, 'airstrike-frames');
    await fs.promises.mkdir(dir, { recursive: true });
    await Promise.all(frames.map((buf, i) => fs.promises.writeFile(path.join(dir, `f${String(i).padStart(3, '0')}.jpg`), buf)));
    if (frames.length > 4) {
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', '4', '-i', path.join(dir, 'f%03d.jpg'), '-pix_fmt', 'yuv420p', path.join(artifactRoot, 'airstrike.mp4')]);
      probe.recording = { file: path.join(artifactRoot, 'airstrike.mp4'), frames: frames.length };
    }
  } catch (error) { probe.recordingError = String(error.message).split('\n')[0]; }
  probe.finalState = all.ks;
  return { checks, probe };
}
