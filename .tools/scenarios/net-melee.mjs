// Online knife gate: two real browser pages join one room on a LOCAL server (the deployed one only allows the Pages
// origin); a real KeyV press on page A one-hit kills page B through the normal claim path. Both pages must see a
// knife kill event (cause 'melee'), agree on standings, and the server must not reject the claim.
// The server is spawned here on a random port and killed in `finally` / on exit.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer().once('error', reject).listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const port = await freePort();
const serverUrl = `ws://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/server.js'], {
  cwd: root, stdio: 'ignore', env: { ...process.env, PORT: String(port), ALLOWED_ORIGINS: '', TRUST_PROXY: '0' },
});
const stopServer = () => { if (!server.killed) server.kill('SIGKILL'); };
process.on('exit', stopServer);
for (let i = 0; i < 50; i += 1) {
  try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* not up yet */ }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

export const query = `room=NEW&server=${serverUrl}&name=Alpha`;

export async function run({ page, screenshot, artifactRoot }) {
  const pageB = await page.context().newPage();
  const errorsB = [];
  pageB.on('console', (m) => { if (m.type() === 'error') errorsB.push(m.text()); });
  pageB.on('pageerror', (e) => errorsB.push(String(e.stack ?? e.message)));
  pageB.on('requestfailed', (r) => { if (!(r.failure()?.errorText ?? '').includes('ERR_ABORTED')) errorsB.push(`requestfailed ${r.url()}`); });
  const shotB = (name) => pageB.screenshot({ path: path.join(artifactRoot, `${name}.png`) });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const debug = (target, fn, arg) => target.evaluate(([body, value]) => {
    const api = globalThis.hijacked.debug;
    return new Function('api', 'value', `return (${body})(api, value)`)(api, value);
  }, [fn.toString(), arg]);
  const stateOf = (target) => debug(target, (api) => api.getState());
  const poll = async (fn, ms = 20000, step = 150) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(step)) { const value = await fn(); if (value) return value; }
    return null;
  };

  try {
    for (const target of [page, pageB]) await target.setViewportSize({ width: 800, height: 450 });
    const room = (await stateOf(page)).systems.net.room;
    const base = new URL(page.url());
    base.search = '';
    base.searchParams.set('autostart', '1');
    base.searchParams.set('room', room);
    base.searchParams.set('server', serverUrl);
    base.searchParams.set('name', 'Bravo');
    await debug(page, (api) => { api.pause(); api.showMenu(true); });
    let bootedOnline = false;
    for (let attempt = 0; attempt < 6 && !bootedOnline; attempt += 1) {
      await pageB.goto(String(base), { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await pageB.waitForFunction(() => globalThis.hijacked?.debug?.getState().ready === true, null, { timeout: 180_000 });
      bootedOnline = (await stateOf(pageB)).config.online === true;
    }
    for (const target of [page, pageB]) await debug(target, (api) => { api.setActive(true); api.resume(); });
    const feetOf = (target) => target.evaluate(() => globalThis.hijacked.player.feetPosition.toArray());

    // An open spot with B standing 60u from A (inside knife reach, outside the lunge stop distance).
    const lane = await page.evaluate(async () => {
      const THREE = await import('three');
      const api = globalThis.hijacked;
      const ray = new THREE.Raycaster().ray;
      const origins = [api.player.feetPosition.clone(), ...api.enemies.spawnCandidates.map((c) => c.position)];
      for (const feet of origins) for (let i = 0; i < 16; i += 1) {
        const angle = (i / 16) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        ray.set(new THREE.Vector3(feet.x, feet.y + 40, feet.z), dir);
        if (api.collisionWorld.raycastFirst(ray, 2, 300)) continue;
        const b = [feet.x + dir.x * 60, feet.y, feet.z + dir.z * 60];
        ray.set(new THREE.Vector3(b[0], b[1] + 40, b[2]), new THREE.Vector3(0, -1, 0));
        if (api.collisionWorld.raycastFirst(ray, 0, 80)) return { a: [feet.x, feet.y, feet.z], b };
      }
      return null;
    });
    await debug(page, (api, v) => api.teleportPlayer(v), lane.a);
    await debug(pageB, (api, v) => api.teleportPlayer(v), lane.b);
    await sleep(1500);
    lane.b = await feetOf(pageB);
    lane.a = await feetOf(page);
    const chest = (p) => [p[0], p[1] + 43, p[2]];
    await debug(page, (api, v) => api.lookAt(v), chest(lane.b));
    await debug(pageB, (api, v) => api.lookAt(v), chest(lane.a));
    const matched = await poll(async () => {
      const [a, b] = [await stateOf(page), await stateOf(pageB)];
      const seen = a.systems.net.peers[0]?.position;
      return a.systems.net.phase === 'playing' && b.systems.net.phase === 'playing' && seen &&
        Math.hypot(seen[0] - lane.b[0], seen[2] - lane.b[2]) < 20;
    });
    await sleep(500);
    const gap = Math.hypot(lane.a[0] - lane.b[0], lane.a[2] - lane.b[2]);
    await page.bringToFront();
    await screenshot('net-melee-a-before');

    // A presses V (a real key) until the server reports the kill; the lunge may need a second look at B.
    const swings = [];
    for (let i = 0; i < 4; i += 1) {
      await debug(page, (api, v) => api.lookAt(v), chest(await feetOf(pageB)));
      await page.keyboard.press('KeyV');
      const dead = await poll(async () => (await stateOf(pageB)).player.dead, 6000, 100);
      swings.push((await stateOf(page)).weapon.melee);
      if (dead) break;
      await poll(async () => (await stateOf(page)).weapon.melee.cooldown === 0, 5000, 100);
    }
    await sleep(500);
    await screenshot('net-melee-a-kill');
    await shotB('net-melee-b-dead');

    const a = await stateOf(page);
    const b = await stateOf(pageB);
    const rank = (state, id) => state.match.standings.find((s) => s.id === id);
    const aId = a.systems.net.id;
    const bId = b.systems.net.id;
    const aEvents = await debug(page, (api) => api.recentEvents());
    const bEvents = await debug(pageB, (api) => api.recentEvents());
    const kill = aEvents.find((e) => e.type === 'kill')?.payload;
    const bKill = bEvents.find((e) => e.type === 'kill')?.payload;
    const feedA = await page.evaluate(() => document.getElementById('killfeed').textContent);
    const feedB = await pageB.evaluate(() => document.getElementById('killfeed').textContent);
    return {
      checks: {
        bothOnline: a.config.online === true && b.config.online === true,
        puppetsInReach: matched !== null && gap > 20 && gap < 90,
        knifeKillOnA: kill?.killerId === 'player' && kill?.victimId === `net-${bId}` && kill?.weaponId === 'knife' && kill?.cause === 'melee',
        knifeKillMirroredOnB: bKill?.killerId === `net-${aId}` && bKill?.victimId === 'player' && bKill?.weaponId === 'knife' && bKill?.cause === 'melee',
        oneBlowKilled: a.weapon.melee.hits >= 1 && b.systems.net.deaths >= 1,
        serverAcceptedClaim: a.systems.net.rejected === 0 && a.systems.net.recentClaims.some((c) => c.weaponId === 'knife' && c.damage <= 150),
        standingsAgree: rank(a, 'player')?.kills === 1 && rank(a, `net-${bId}`)?.deaths === 1 && rank(b, `net-${aId}`)?.kills === 1 && rank(b, 'player')?.deaths === 1,
        killfeedSaysKnifeOnBoth: /knife/i.test(feedA) && /knife/i.test(feedB),
        noBrowserErrorsOnPageB: errorsB.length === 0,
      },
      probe: { room, lane, gap: Math.round(gap), swings, kill, bKill, feedA, feedB, errorsB, aNet: a.systems.net, bNet: b.systems.net },
    };
  } finally {
    await pageB.close().catch(() => {});
    stopServer();
  }
}
