// Lane M gate: two real browser pages join one room on a LOCAL server (the deployed one only allows the Pages
// origin), a real bullet kills the other player, both standings agree, the victim respawns, and the invite link
// works. The server is spawned here on a random port and killed in `finally` / on exit.
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
    // Software rendering: two pages at the harness size run at a few fps and miss clicks.
    for (const target of [page, pageB]) await target.setViewportSize({ width: 800, height: 450 });
    const first = await stateOf(page);
    const room = first.systems.net.room;
    const base = new URL(page.url());
    base.search = '';
    base.searchParams.set('autostart', '1');
    base.searchParams.set('room', room);
    base.searchParams.set('server', serverUrl);
    base.searchParams.set('name', 'Bravo');
    // Two software-rendered pages starve each other: park A behind its menu (no frames) while B boots.
    await debug(page, (api) => { api.pause(); api.showMenu(true); });
    // The 5 s connect cap can lose on a loaded machine and falls back to bots by design; retry the page.
    let bootedOnline = false;
    let attempts = 0;
    for (let attempt = 0; attempt < 6 && !bootedOnline; attempt += 1) {
      await pageB.goto(String(base), { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await pageB.waitForFunction(() => globalThis.hijacked?.debug?.getState().ready === true, null, { timeout: 180_000 });
      attempts += 1;
      bootedOnline = (await stateOf(pageB)).config.online === true;
    }
    for (const target of [page, pageB]) await debug(target, (api) => { api.setActive(true); api.resume(); });
    // The second join starts the match and both clients re-pick a spawn; they must not share one.
    const feetOf = (target) => target.evaluate(() => globalThis.hijacked.player.feetPosition.toArray());
    const [spawnA, spawnB] = [await feetOf(page), await feetOf(pageB)];
    const spawnGap = Math.hypot(spawnA[0] - spawnB[0], spawnA[2] - spawnB[2]);

    // Find an open lane at eye height from A's spawn, and stand B 300u down it.
    const lane = await page.evaluate(async () => {
      const THREE = await import('three');
      const api = globalThis.hijacked;
      const ray = new THREE.Raycaster().ray;
      // A's spawn is a random pick: try it first, then every spawn candidate.
      const origins = [api.player.feetPosition.clone(), ...api.enemies.spawnCandidates.map((c) => c.position)];
      for (const feet of origins) for (let i = 0; i < 16; i += 1) {
        const angle = (i / 16) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        ray.set(new THREE.Vector3(feet.x, feet.y + 40, feet.z), dir);
        if (api.collisionWorld.raycastFirst(ray, 2, 700)) continue;
        // B's spot needs floor too: a drop fall-resets B to its own spawn.
        const b = [feet.x + dir.x * 300, feet.y, feet.z + dir.z * 300];
        ray.set(new THREE.Vector3(b[0], b[1] + 40, b[2]), new THREE.Vector3(0, -1, 0));
        if (api.collisionWorld.raycastFirst(ray, 0, 80)) return { a: [feet.x, feet.y, feet.z], b, candidates: origins.length - 1 };
      }
      return null;
    });
    await debug(page, (api, v) => api.teleportPlayer(v), lane.a);
    await debug(pageB, (api, v) => api.teleportPlayer(v), lane.b);
    await sleep(1500);
    lane.b = await feetOf(pageB); // B can settle off the lane; aim where it really stands
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
    const aBefore = await stateOf(page);
    const bBefore = await stateOf(pageB);
    await screenshot('net-duel-a-aim');
    await shotB('net-duel-b-aim');

    // A fires real bullets until the server reports the kill (re-aiming each pass against recoil).
    const canvas = await page.locator('canvas[data-engine]').boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.bringToFront();
    const aim = () => page.evaluate(async () => {
      // Diagnostic: does the centre ray from A's camera reach a remote hitbox?
      const THREE = await import('three');
      const api = globalThis.hijacked;
      const boxes = [];
      api.scene.traverse((o) => { if (o.userData?.combatantHit) boxes.push(o); });
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(0, 0), api.camera);
      const hit = ray.intersectObjects(boxes, false)[0];
      return { boxes: boxes.length, hit: hit ? { id: hit.object.userData.combatantHit.id, region: hit.object.userData.combatantHit.region, distance: Math.round(hit.distance) } : null };
    });
    const aimProbe = await aim();
    // Cheap polling only: the trigger must come up the moment the kill lands, or A keeps firing at the corpse's
    // old spot and hits the victim as it respawns elsewhere (a legitimate position_mismatch rejection).
    await page.mouse.down({ button: 'left' }); // hold: a click shorter than a frame fires nothing
    for (let i = 0; i < 400; i += 1) {
      await debug(page, (api, v) => api.lookAt(v), chest(lane.b));
      if (await debug(page, (api) => api.recentEvents().some((e) => e.type === 'kill' && e.payload.killerId === 'player'))) break;
      if (i % 40 === 39) await debug(page, (api) => api.setWeaponAmmo(30, 240));
      await sleep(60);
    }
    await page.mouse.up({ button: 'left' });
    await poll(async () => (await stateOf(pageB)).player.dead, 4000, 100);
    await sleep(300);
    await screenshot('net-duel-a-kill');
    await shotB('net-duel-b-dead');
    const bDead = await stateOf(pageB);
    const respawned = await poll(async () => {
      const b = await stateOf(pageB);
      return !b.player.dead && b.player.health >= 99 ? b : null;
    }, 8000, 150);
    await sleep(400);
    await shotB('net-duel-b-respawned');

    const a = await stateOf(page);
    const b = await stateOf(pageB);
    const rank = (state, id) => state.match.standings.find((s) => s.id === id);
    const aId = a.systems.net.id;
    const bId = b.systems.net.id;
    const aEvents = await debug(page, (api) => api.recentEvents());
    const bEvents = await debug(pageB, (api) => api.recentEvents());
    const kill = aEvents.find((e) => e.type === 'kill')?.payload;
    const bKill = bEvents.find((e) => e.type === 'kill')?.payload;
    await debug(page, (api) => { api.pause(); api.showMenu(true); });
    await page.evaluate(() => globalThis.hijacked.frontend.openSetup());
    await sleep(300);
    await page.setViewportSize({ width: 800, height: 1100 }); // the online box sits below the map and mode cards
    await sleep(500);
    await screenshot('net-duel-setup');
    const invite = await page.evaluate(() => {
      const row = document.getElementById('fe-online-invite');
      return { hidden: row.hidden, link: document.getElementById('fe-online-link').value, url: location.href };
    });

    return {
      checks: {
        spawnsApart: spawnGap > 200,
        bothOnline: a.config.online === true && b.config.online === true && a.systems.net.online && b.systems.net.online,
        sameRoomNoBots: a.systems.net.room === room && b.systems.net.room === room && a.enemies.length === 0 && b.enemies.length === 0,
        puppetsVisible: matched !== null && aBefore.systems.net.peers[0]?.hasPuppet === true && bBefore.systems.net.peers[0]?.hasPuppet === true,
        remoteCombatant: a.combatants.some((c) => c.id === `net-${bId}`) && b.combatants.some((c) => c.id === `net-${aId}`),
        realKillOnA: kill?.killerId === 'player' && kill?.victimId === `net-${bId}` && kill?.cause === 'bullet',
        killMirroredOnB: bKill?.killerId === `net-${aId}` && bKill?.victimId === 'player',
        standingsAgree:
          rank(a, 'player')?.kills === 1 && rank(a, `net-${bId}`)?.deaths === 1 &&
          rank(b, `net-${aId}`)?.kills === 1 && rank(b, 'player')?.deaths === 1,
        victimDiedThenRespawned: b.systems.net.deaths >= 1 && b.systems.net.respawns >= 1 && respawned !== null && b.player.dead === false,
        // Claims fired at the corpse (target_dead) or at a victim that has respawned elsewhere (position_mismatch)
        // after the kill are expected and harmless; any rejection before the kill is a real bug.
        noRejectedBeforeKill: (() => {
          const log = a.systems.net.log;
          const kill = log.findIndex((e) => e[1] === 'kill');
          return log.slice(0, kill < 0 ? log.length : kill).every((e) => e[1] !== 'reject');
        })(),
        shotRelayReachedB: bEvents.some((e) => e.type === 'shot' && e.payload.shooterId === `net-${aId}`),
        inviteLink: invite.hidden === false && invite.link.includes(`room=${room}`) && invite.url.includes(`room=${room}`),
        noBrowserErrorsOnPageB: errorsB.length === 0,
      },
      probe: { room, lane, aimProbe, bBootAttempts: attempts, bNotice: await pageB.evaluate(() => document.getElementById('system-notice')?.textContent), kill, bKill, errorsB, invite, aNet: a.systems.net, bNet: b.systems.net, aStandings: a.match.standings, bStandings: b.match.standings },
    };
  } finally {
    await pageB.close().catch(() => {});
    stopServer();
  }
}
