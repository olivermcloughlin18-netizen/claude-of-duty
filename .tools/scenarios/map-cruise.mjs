// Cruise Liner gate: FFA boot + movement + bots patrolling several areas + nothing falls,
// then TDM spawns split stern vs bow, then screenshots of six spots.
import { makeDebug, waitFor } from './_ks-common.mjs';

export const query = 'map=cruise';

export async function run({ page, openGame, screenshot }) {
  const debug = makeDebug(page);
  const inside = (p, b) => p.every((v, i) => v >= b.min[i] && v <= b.max[i]);
  await debug((api) => { api.setActive(true); api.resume(); });
  await page.waitForTimeout(500);
  const start = await debug((api) => api.getState());
  const bounds = await page.evaluate(() => fetch('maps/cruise/manifest.json').then((r) => r.json()).then((m) => m.bounds));

  await page.keyboard.down('KeyW');
  // SwiftShader can render only a handful of frames per second: hold W until it has really moved
  for (let i = 0; i < 25; i += 1) {
    await page.waitForTimeout(1000);
    const f = await debug((api) => api.getState().player.feet);
    if (Math.hypot(f[0] - start.player.feet[0], f[2] - start.player.feet[2]) > 80) break;
  }
  await page.keyboard.up('KeyW');
  const moved = await debug((api) => api.getState().player);
  const dist = Math.hypot(moved.feet[0] - start.player.feet[0], moved.feet[2] - start.player.feet[2]);

  // patrol: sample each bot's position for a while, bucket by 600u of x and by deck
  const seen = start.enemies.map(() => new Set());
  const travelled = start.enemies.map(() => 0);
  let last = start.enemies.map((e) => e.position);
  let minY = 1e9;
  const t0 = Date.now();
  let elapsed = 0;
  while (Date.now() - t0 < 240000 && elapsed < 75) {
    await page.waitForTimeout(1000);
    const st = await debug((api) => ({ e: api.getState().enemies.map((e) => e.position), t: api.getState().match.elapsedSeconds }));
    elapsed = st.t;
    st.e.forEach((p, i) => {
      seen[i].add(`${Math.floor(p[0] / 600)}:${p[1] > 250 ? 3 : p[1] > 100 ? 2 : 1}`);
      travelled[i] += Math.hypot(p[0] - last[i][0], p[2] - last[i][2]);
      minY = Math.min(minY, p[1]);
    });
    last = st.e;
  }
  const union = new Set(seen.flatMap((x) => [...x]));
  const finalState = await debug((api) => api.getState());

  await debug((api) => api.pause());
  const views = [
    ['pool', [-1450, F2(), 330], [-1450, F2(), -200]],
    ['promenade', [-1400, 60, 800], [1200, 60, 800]],
    ['atrium', [-300, 60, 250], [150, 330, -100]],
    ['corridor', [-2700, 60, 0], [-2000, 60, 0]],
    ['bridge', [2000, 400, 0], [2400, 380, 0]],
    ['overview', [-3500, 760, 1500], [200, 100, 0]],
    ['bow', [3300, 60, 0], [2300, 100, 0]],
    ['funnel', [700, 400, -350], [1200, 500, 0]],
  ];
  function F2() { return 230; }
  for (const [name, eye, target] of views) {
    await debug((api, v) => { api.teleportPlayer(v[0]); api.lookAt(v[1]); }, [eye, target]);
    await page.waitForTimeout(500);
    await screenshot(`cruise-${name}`);
  }
  const perf = (await debug((api) => api.getState())).performance;

  // TDM: allies spawn nearer the stern (-x), axis toward the bow
  await openGame('mode=tdm&map=cruise');
  await debug((api) => { api.setActive(true); api.resume(); });
  await page.waitForTimeout(500);
  const tdm = await debug((api) => api.getState());
  const team = Object.fromEntries(tdm.combatants.map((c) => [c.id, c.team]));
  const mean = (l) => l.reduce((s, v) => s + v, 0) / l.length;
  const ax = mean(tdm.enemies.filter((e) => team[`bot-${e.index}`] === 'axis').map((e) => e.position[0]));
  const al = mean(tdm.enemies.filter((e) => team[`bot-${e.index}`] === 'allies').map((e) => e.position[0]));

  return {
    checks: {
      mapIsCruise: start.config.mapId === 'cruise',
      botsInBounds: start.enemies.length >= 6 && start.enemies.every((e) => inside(e.position, bounds)),
      playerGrounded: moved.grounded === true && inside(start.player.feet, bounds),
      wMoves: dist > 80,
      botsPatrolSeveralAreas: travelled.every((d) => d > 250) && union.size >= 10,
      nothingFell: minY > -20 && finalState.player.feet[1] > -20,
      tdmTeamsSplit: tdm.config.mapId === 'cruise' && al < ax,
    },
    probe: { dist, travelled: travelled.map(Math.round), unionAreas: union.size, elapsed, startBots: start.enemies.map((e) => e.position.map(Math.round)), minY, perf, tdm: { allies: Math.round(al), axis: Math.round(ax) } },
  };
}
