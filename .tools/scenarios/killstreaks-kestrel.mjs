// Air strike once on Kestrel Heights: targeting screen on map.minimap, bomb run, kills.
import { findOpenSpot, ks, makeDebug, waitFor } from './_ks-common.mjs';

export const query = 'map=kestrel';

export async function run({ page, screenshot }) {
  const debug = makeDebug(page);
  const checks = {};
  const probe = {};
  await debug((api) => { api.setActive(true); api.resume(); api.setGraphicsPreset('performance'); });
  await waitFor(page, (api) => api.getState().systems.killstreaks.fxReady === true, null, 60000);
  const boot = await debug((api) => api.getState());
  checks.mapIsKestrel = boot.config.mapId === 'kestrel';
  const pair = await findOpenSpot(page);
  const spot = pair?.spot;
  probe.pair = pair;
  checks.foundOpenSpot = Boolean(pair);
  await debug((api, v) => {
    api.respawnEnemies();
    [[-90, 40], [0, 0], [80, -60]].forEach(([dx, dz], i) => api.teleportEnemy(i, [v.spot.x + dx, v.spot.y + 6, v.spot.z + dz]));
    api.alertEnemies(0);
    api.teleportPlayer([v.stand.x, v.stand.y + 2, v.stand.z]);
    api.grantStreak('airstrike');
    api.lookAt([v.spot.x, v.spot.y + 30, v.spot.z]);
  }, pair);
  await page.keyboard.press('Digit6');
  await waitFor(page, (api) => api.getState().systems.killstreaks.targeting === true, null, 5000);
  const cursor = await page.evaluate(async (s) => {
    const { minimapCalibration, worldToMinimapUv } = await import('./hud.js');
    const maps = await import('./maps.js');
    const map = maps.fromManifest(await (await fetch('maps/kestrel/manifest.json')).json());
    const cal = minimapCalibration(map);
    const uv = worldToMinimapUv(s.x, s.z, cal);
    const rect = document.querySelector('#ks-target canvas').getBoundingClientRect();
    return { x: rect.left + uv.u * rect.width, y: rect.top + uv.v * rect.height, image: cal.image };
  }, spot);
  probe.cursor = cursor;
  checks.kestrelMinimapImageUsed = Boolean(cursor.image);
  await page.mouse.move(cursor.x, cursor.y, { steps: 3 });
  await page.waitForTimeout(250);
  await screenshot('targeting-kestrel');
  await page.mouse.click(cursor.x, cursor.y);
  let shots = 0;
  for (let i = 0; i < 200; i += 1) {
    const s = (await ks(debug)).strike;
    if (!s) break;
    if (s.exploded === 0) await debug((api, v) => [[-90, 40], [0, 0], [80, -60]].forEach(([dx, dz], i) => api.teleportEnemy(i, [v.x + dx, v.y + 6, v.z + dz])), spot); // hold targets until the first bomb lands
    if (s.exploded >= 1 && shots < 2) { shots += 1; await debug((api, v) => api.lookAt([v.x, v.y + 90, v.z]), spot); await screenshot(`explosion-kestrel${shots}`); }
    await page.waitForTimeout(80);
  }
  await waitFor(page, (api) => api.getState().systems.killstreaks.strike === null, null, 120000);
  const end = await debug((api) => ({ events: api.recentEvents(), ks: api.getState().systems.killstreaks, dead: api.getState().player.dead }));
  const kills = end.events.filter((e) => e.type === 'kill' && e.payload.cause === 'airstrike');
  probe.kills = kills.map((e) => e.payload.victimId);
  checks.airstrikeKilledAtLeast2 = kills.length >= 2 && end.ks.counters.bombsFallen === 5;
  checks.noPlayerSelfKill = !end.events.some((e) => e.type === 'kill' && e.payload.victimId === 'player');
  checks.playerAlive = end.dead === false;
  return { checks, probe };
}
