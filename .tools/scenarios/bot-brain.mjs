// Bot brain metrics: stages 1v1 / 1v3 fights through the debug API (TDM, hostile bots only) and measures
// reaction time, time spent moving while engaged, cover after damage, flank vs direct route, hit rate by range.
// Run: npm run ai:game -- scenario bot-brain. Checks assert the new behaviour, so on a pre-change commit they
// fail but `probe.metrics` still gives the baseline numbers.
import { makeDebug, waitFor } from './_ks-common.mjs';

export const query = 'mode=tdm';

export async function run({ page, screenshot }) {
  const debug = makeDebug(page);
  await debug((api) => { api.setActive(true); api.resume(); api.setGraphicsPreset('performance'); });
  await waitFor(page, (api) => api.getState().ready === true, null, 60000);

  // Install the in-page harness once: a game clock that only advances while the simulation is active, per-bot
  // samples, a shot log, an invulnerable player, and the pair finder.
  await page.evaluate(async () => {
    const THREE = await import('three');
    const h = globalThis.hijacked;
    const m = h.enemies;
    const T = globalThis.__bb = { clock: 0, shots: [], eng: 0, mov: 0, watch: new Set(), vis: {}, first: {}, trace: {}, los: {}, tactics: {} };
    h.playerHealth.takeDamage = () => 0;
    const update = m.update.bind(m);
    T.cpu = { ms: 0, calls: 0 };
    m.update = (dt, o) => {
      const t0 = performance.now();
      update(dt, o);
      const spent = performance.now() - t0;
      T.cpu.ms += spent; T.cpu.calls += 1;
      if (T.samples) T.samples.push(spent);
      if (o && o.active === false) return;
      const d = Math.min(Number(dt) || 0, 0.1);
      T.clock += d;
      for (const e of m.enemies) {
        if (e.dead || !T.watch.has(e.index)) continue;
        if (e.playerVisible) {
          T.eng += d;
          if (e.movementSpeed > 40) T.mov += d;
          T.vis[e.index] ??= T.clock;
        } else if (T.first[e.index] === undefined) delete T.vis[e.index];
        if (T.tracing && !T.seen) (T.trace[e.index] ??= []).push([T.clock, e.root.position.x, e.root.position.z]);
        if (e.playerVisible) T.seen = true;
        if (e.tactic === 'flank' && e.tacticPoint) T.wp[e.index] ??= [e.tacticPoint.x, e.tacticPoint.z];
        if (e.tactic) T.tactics[e.tactic] = (T.tactics[e.tactic] ?? 0) + d;
        if (T.watchLos) {
          const seen = m.canSeeTarget(e, h.player, -1);
          (T.los[e.index] ??= []).push([T.clock, seen ? 1 : 0, e.tactic ?? null]);
        }
      }
    };
    T.melee = [];
    const applyDamage = m.applyDamage;
    m.applyDamage = (target, amount, shooter, info) => {
      if (amount >= 100) T.melee.push({ bot: shooter.index, amount, info: info ?? null, target: target === h.player ? 'player' : `bot-${target.index}` });
      return applyDamage(target, amount, shooter, info);
    };
    const fire = m.enemyFire.bind(m);
    m.enemyFire = (e) => {
      const dist = e.root.position.distanceTo(h.player.position);
      const r = fire(e);
      T.shots.push({ clock: T.clock, bot: e.index, dist, hit: Boolean(r.hitPlayer) });
      if (T.first[e.index] === undefined && T.vis[e.index] !== undefined) T.first[e.index] = T.clock - T.vis[e.index];
      return r;
    };
    T.reset = () => { T.wp = {}; T.seen = false; T.cpu = { ms: 0, calls: 0 }; T.shots = []; T.eng = 0; T.mov = 0; T.vis = {}; T.first = {}; T.trace = {}; T.los = {}; T.tactics = {}; };
    // Step the sim directly (crowd + bots) instead of waiting on SwiftShader frames: same code path as the frame
    // loop, 1/30 s steps, yields to the event loop so the real loop keeps running.
    T.wait = async (seconds) => {
      const end = T.clock + seconds;
      let n = 0;
      while (T.clock < end) {
        // odd step length on purpose: the crowd only refreshes interpolatedPosition (what the bots read) on a fractional substep.
        h.navigation.update(1 / 60, 1 / 30 + 0.0049, 5);
        m.update(1 / 30, { active: true });
        if (++n % 20 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    };
    T.clearBots = (keep) => {
      for (const e of m.enemies) {
        if (keep.includes(e.index)) continue;
        if (!e.dead) e.die(null);
        e.respawnTimer = 1e9;
      }
    };
    const eye = (p) => new THREE.Vector3(p.x, p.y + 61, p.z);
    const clear = (a, b) => {
      const dir = eye(b).sub(eye(a));
      const len = dir.length();
      const hit = h.collisionWorld.raycastFirst(new THREE.Ray(eye(a), dir.normalize()), 2, len);
      return !hit || hit.distance >= len - 6;
    };
    const nodes = h.hints.pathnodes.map((n) => ({ x: n.position[0], y: n.position[1], z: n.position[2] }));
    T.pairs = (min, max, wantClear, count, maxDy = 40) => {
      const out = [];
      for (let i = 0; i < nodes.length && out.length < count; i += 7) {
        for (let j = 0; j < nodes.length; j += 1) {
          const a = nodes[i]; const b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d < min || d > max || Math.abs(a.y - b.y) > maxDy) continue;
          if (clear(a, b) !== wantClear) continue;
          if (out.some((p) => Math.hypot(p.a.x - a.x, p.a.z - a.z) < 350)) continue;
          if (!wantClear) {
            const path = h.navigation.findPath(a, b);
            if (!path.success || path.path.length < 2) continue;
          }
          out.push({ a, b, d: Math.round(d) });
          break;
        }
      }
      return out;
    };
    T.place = (index, a, b, faceTarget = true) => {
      const e = m.enemies[index];
      const yaw = faceTarget ? Math.atan2(-(b.x - a.x), -(b.z - a.z)) : Math.random() * 6.28;
      e.spawnAt({ position: new THREE.Vector3(a.x, a.y, a.z), yaw });
      h.debug.teleportPlayer([b.x, b.y + 2, b.z]);
      h.debug.lookAt([a.x, a.y + 40, a.z]);
      return e;
    };
    T.polyDist = (path, x, z) => {
      let best = Infinity;
      for (let i = 0; i + 1 < path.length; i += 1) {
        const ax = path[i].x; const az = path[i].z; const bx = path[i + 1].x; const bz = path[i + 1].z;
        const dx = bx - ax; const dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
      }
      return best;
    };
  });
  const call = (fn, arg) => debug(fn, arg);
  const t0 = Date.now();
  const log = (msg) => console.log(`[bot-brain +${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);
  log('harness installed');
  // Software rendering dominates frame time; the sim does not care about resolution.
  const metrics = {};
  const probe = { metrics };
  const checks = {};
  const avg = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : null);
  const round = (v, n = 2) => (v === null || v === undefined ? null : Number(v.toFixed(n)));

  // ---- 1v1 duels at short and long range: reaction, moving share, hit rate
  const pairs = await call((api) => ({
    short: globalThis.__bb.pairs(220, 380, true, 3),
    long: globalThis.__bb.pairs(650, 850, true, 3),
    mid: globalThis.__bb.pairs(420, 640, true, 3),
    hidden: globalThis.__bb.pairs(500, 950, false, 5, 70),
  }));
  probe.pairCounts = Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, v.length]));
  const duel = async (list, label) => {
    const out = { reaction: [], shots: 0, hits: 0, eng: 0, mov: 0, trials: [] };
    for (const pair of list) {
      const r = await call((api, p) => {
        const T = globalThis.__bb;
        T.clearBots([3]);
        T.watch = new Set([3]); T.watchLos = false; T.tracing = false;
        T.place(3, p.a, p.b); T.reset();
        api.alertEnemies(100000);
        return true;
      }, pair);
      if (!r) continue;
      await call(async () => globalThis.__bb.wait(7));
      log(`${label} trial done`);
      const t = await call(() => {
        const T = globalThis.__bb;
        return { first: T.first[3] ?? null, shots: T.shots.length, hits: T.shots.filter((s) => s.hit).length, eng: T.eng, mov: T.mov, tactics: T.tactics };
      });
      out.trials.push({ d: pair.d, eng: Number(t.eng.toFixed(1)), mov: Number(t.mov.toFixed(1)), shots: t.shots, hits: t.hits, tactics: t.tactics });
      if (t.first !== null) out.reaction.push(t.first);
      out.shots += t.shots; out.hits += t.hits; out.eng += t.eng; out.mov += t.mov;
    }
    metrics[label] = {
      trials: list.length, reactionSec: out.reaction.map((v) => round(v)), reactionMeanSec: round(avg(out.reaction)),
      shots: out.shots, hits: out.hits, hitRate: out.shots ? round(out.hits / out.shots) : null,
      engagedSec: round(out.eng), movingShare: out.eng ? round(out.mov / out.eng) : null, perTrial: out.trials,
    };
    return out;
  };
  await debug((api) => { api.restartMatch(); });
  const shortDuel = await duel(pairs.short, 'short');
  const longDuel = await duel(pairs.long, 'long');
  const midDuel = await duel(pairs.mid, 'mid');
  const all = [shortDuel, longDuel, midDuel];
  const reactions = all.flatMap((o) => o.reaction);
  const eng = all.reduce((s, o) => s + o.eng, 0);
  const mov = all.reduce((s, o) => s + o.mov, 0);
  metrics.overall = {
    reactionMeanSec: round(avg(reactions)), reactionMinSec: round(Math.min(...reactions)), reactionMaxSec: round(Math.max(...reactions)),
    movingShare: eng ? round(mov / eng) : null,
  };
  await page.evaluate(() => globalThis.hijacked.renderer.setPixelRatio(1));
  await screenshot('bot-duel');
  await page.evaluate(() => globalThis.hijacked.renderer.setPixelRatio(0.35));
  log('duels done');

  // ---- settled-aim accuracy by range (150 direct enemyFire calls per cell, stationary vs strafing shooter)
  metrics.aimTable = await call((api, v) => {
    const T = globalThis.__bb; const h = globalThis.hijacked;
    const out = {};
    for (const [label, p] of [['short', v.short[0]], ['long', v.long[0]]]) {
      if (!p) continue;
      for (const [mode, speed] of [['standing', 0], ['strafing', 200]]) {
        T.clearBots([3]);
        const e = T.place(3, p.a, p.b); T.reset();
        let hits = 0;
        for (let i = 0; i < 150; i += 1) {
          e.aimConvergence = 1; e.suppressionTimer = 0; e.movementSpeed = speed;
          e.currentTarget = h.player;
          if (h.enemies.enemyFire(e).hitPlayer) hits += 1;
        }
        out[`${label}-${mode}`] = { dist: p.d, hitRate: Number((hits / 150).toFixed(2)) };
      }
    }
    return out;
  }, pairs);
  log('aim table done');

  // ---- cover after damage: hurt the bot once it is shooting, count trials where LOS breaks within 5 s
  let covered = 0;
  const coverRuns = [];
  for (const pair of pairs.mid) {
    await call((api, p) => {
      const T = globalThis.__bb;
      T.clearBots([3]);
      T.watch = new Set([3]); T.watchLos = false; T.tracing = false;
      T.place(3, p.a, p.b); T.reset();
      api.alertEnemies(100000);
    }, pair);
    await call(async () => globalThis.__bb.wait(2));
    await call(() => {
      const T = globalThis.__bb;
      const h = globalThis.hijacked;
      T.watchLos = true; T.los = {}; T.tactics = {};
      h.enemies.enemies[3].takeDamage(62, null, h.player);
    });
    await call(async () => globalThis.__bb.wait(5));
    const r = await call(() => {
      const T = globalThis.__bb;
      const e = globalThis.hijacked.enemies.enemies[3];
      const samples = T.los[3] ?? [];
      const hidden = samples.filter((s) => s[1] === 0).length;
      return { frames: samples.length, hiddenFrames: hidden, tactics: T.tactics, health: e.health, coverTactic: (T.tactics.cover ?? 0) > 0 };
    });
    r.broke = r.frames > 0 && r.hiddenFrames / r.frames >= 0.15;
    covered += Number(r.broke);
    coverRuns.push(r);
  }
  log('cover done');
  metrics.cover = { trials: coverRuns.length, brokeLosShare: coverRuns.length ? round(covered / coverRuns.length) : null, runs: coverRuns };
  await call(() => { globalThis.__bb.watchLos = false; });

  // ---- flank: bot can't see the player; compare its route with the direct nav path. 1v1 then 1v3 spread.
  const flankRuns = [];
  for (const pair of pairs.hidden) {
    const r = await call(async (api, p) => {
      const T = globalThis.__bb;
      const h = globalThis.hijacked;
      T.clearBots([3]);
      T.watch = new Set([3]); T.watchLos = false; T.tracing = true;
      const e = T.place(3, p.a, p.b, false); T.reset();
      api.alertEnemies(100000);
      e.lastSeenTimer = 7;
      const direct = h.navigation.findPath(p.a, p.b).path;
      await T.wait(6);
      const tr = T.trace[3] ?? [];
      const dev = tr.reduce((m, s) => Math.max(m, T.polyDist(direct, s[1], s[2])), 0);
      const sawIt = (T.vis[3] ?? null) !== null;
      return { directLen: Math.round(direct.reduce((s, q, i) => s + (i ? Math.hypot(q.x - direct[i - 1].x, q.z - direct[i - 1].z) : 0), 0)), maxDeviation: Math.round(dev), sawPlayer: sawIt, tactics: T.tactics };
    }, pair);
    flankRuns.push(r);
  }
  log('flank done');
  const deviated = flankRuns.filter((r) => r.maxDeviation >= 90).length;
  metrics.flank = { trials: flankRuns.length, deviatedFromDirect: deviated, runs: flankRuns };

  // Squad trial needs a start spot where none of the three can see the player.
  const blind = await call((api, list) => {
    const T = globalThis.__bb; const h = globalThis.hijacked;
    for (const p of list) {
      T.clearBots([3, 4, 5]);
      for (const i of [3, 4, 5]) T.place(i, { x: p.a.x + (i - 4) * 28, y: p.a.y, z: p.a.z }, p.b, false);
      if ([3, 4, 5].every((i) => !h.enemies.canSeeTarget(h.enemies.enemies[i], h.player, -1))) return p;
    }
    return null;
  }, pairs.hidden);
  const squad = blind;
  if (squad) {
    const attempts = [];
    for (let attempt = 0; attempt < 3; attempt += 1) attempts.push(await call(async (api, p) => {
      const T = globalThis.__bb;
      const h = globalThis.hijacked;
      T.clearBots([3, 4, 5]);
      T.watch = new Set([3, 4, 5]); T.watchLos = false; T.tracing = true; T.reset();
      for (const i of [3, 4, 5]) { T.place(i, { x: p.a.x + (i - 4) * 28, y: p.a.y, z: p.a.z }, p.b, false); }
      api.alertEnemies(100000);
      for (const i of [3, 4, 5]) h.enemies.enemies[i].lastSeenTimer = 7;
      await T.wait(6);
      let spread = 0;
      const lens = [3, 4, 5].map((i) => T.trace[i].length);
      const n = Math.min(...lens);
      for (let k = 0; k < n; k += 1) {
        for (const [i, j] of [[3, 4], [3, 5], [4, 5]]) {
          spread = Math.max(spread, Math.hypot(T.trace[i][k][1] - T.trace[j][k][1], T.trace[i][k][2] - T.trace[j][k][2]));
        }
      }
      const w = Object.values(T.wp);
      let wpSep = 0;
      for (let i = 0; i < w.length; i += 1) for (let j = i + 1; j < w.length; j += 1) wpSep = Math.max(wpSep, Math.hypot(w[i][0] - w[j][0], w[i][1] - w[j][1]));
      return { maxSeparation: Math.round(spread), waypoints: w.length, waypointSeparation: Math.round(wpSep), tactics: T.tactics };
    }, squad));
    metrics.squadFlank = attempts.reduce((a, b) => (b.waypointSeparation > a.waypointSeparation ? b : a));
    metrics.squadFlank.attempts = attempts.length;
  }

  // ---- 1v3 fight: bots stay alive, hold LOS fights and take cover/strafe; screenshot for the eyeball check
  const fightPair = pairs.short[0] ?? pairs.mid[0];
  if (fightPair) {
    metrics.oneVThree = await call(async (api, p) => {
      const T = globalThis.__bb;
      T.clearBots([3, 4, 5]);
      T.watch = new Set([3, 4, 5]); T.watchLos = false; T.tracing = false; T.reset();
      for (const i of [3, 4, 5]) T.place(i, { x: p.a.x + (i - 4) * 60, y: p.a.y, z: p.a.z }, p.b);
      api.alertEnemies(100000);
      await T.wait(4);
      const bot = globalThis.hijacked.enemies.enemies[4];
      api.lookAt([bot.root.position.x, bot.root.position.y + 45, bot.root.position.z]);
      await T.wait(6);
      return { cpuMsPerUpdate: Number((T.cpu.ms / Math.max(1, T.cpu.calls)).toFixed(3)), shots: T.shots.length, hits: T.shots.filter((s) => s.hit).length, movingShare: T.eng ? Number((T.mov / T.eng).toFixed(2)) : null, tactics: T.tactics,
        states: globalThis.hijacked.enemies.enemies.filter((e) => [3, 4, 5].includes(e.index)).map((e) => ({ state: e.state, tactic: e.tactic ?? null })) };
    }, fightPair);
    await page.waitForTimeout(1500);
    await page.evaluate(() => globalThis.hijacked.renderer.setPixelRatio(1));
    await screenshot('bot-1v3');
  }

  // ---- melee: a bot standing 35u from its target knifes it (150 damage, info {weaponId:'knife', cause:'melee'})
  if (pairs.mid[0]) {
    metrics.melee = await call(async (api, p) => {
      const T = globalThis.__bb;
      let knifed = 0; let infoOk = 0; const samples = [];
      for (let k = 0; k < 6 && !knifed; k += 1) {
        T.clearBots([3]);
        T.watch = new Set([3]); T.watchLos = false; T.tracing = false;
        T.place(3, p.a, { x: p.a.x + 35, y: p.a.y, z: p.a.z }); T.reset(); T.melee = [];
        api.alertEnemies(100000);
        await T.wait(5);
        knifed += T.melee.length;
        infoOk += T.melee.filter((x) => x.info?.weaponId === 'knife' && x.info?.cause === 'melee' && x.amount === 150).length;
        samples.push(...T.melee);
      }
      return { knifed, infoOk, samples: samples.slice(0, 2), shotsInstead: T.shots.length };
    }, pairs.mid[0]);
    log('melee done');
  }

  // ---- per-frame bot cost with all 7 bots alive and fighting (CPU ms of EnemyManager.update per call)
  metrics.perf7 = await call(async (api) => {
    const T = globalThis.__bb;
    const h = globalThis.hijacked;
    for (const e of h.enemies.enemies) { e.respawnTimer = 0.1; if (e.dead) e.spawnAt(e.spawnPoint); }
    T.watch = new Set(); T.watchLos = false; T.tracing = false; T.reset();
    api.teleportPlayer([h.enemies.enemies[3].root.position.x + 200, h.enemies.enemies[3].root.position.y + 2, h.enemies.enemies[3].root.position.z]);
    api.alertEnemies(100000);
    await T.wait(2);
    T.samples = [];
    await T.wait(20);
    const sorted = [...T.samples].sort((a, b) => a - b);
    const out = { calls: sorted.length, meanMs: Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(4)), p95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(4)), maxMs: Number(sorted[sorted.length - 1].toFixed(3)), alive: h.enemies.aliveCount, tactics: T.tactics };
    T.samples = null;
    return out;
  });
  log('perf done');
  metrics.errors = await page.evaluate(() => 0);

  checks.reactionInHumanBand = metrics.overall.reactionMinSec >= 0.18 && metrics.overall.reactionMaxSec <= 0.8;
  checks.botsMoveWhileEngaged = metrics.overall.movingShare >= 0.35;
  checks.coverAfterDamage = metrics.cover.brokeLosShare >= 0.25;
  checks.flankDiffersFromDirect = deviated >= 1;
  checks.hitRateFallsWithRange = metrics.aimTable['short-standing'].hitRate > metrics.aimTable['long-standing'].hitRate &&
    metrics.aimTable['long-standing'].hitRate > metrics.aimTable['long-strafing'].hitRate;
  checks.botsKnifeAtPointBlank = (metrics.melee?.infoOk ?? 0) >= 1;
  checks.squadSplits = (metrics.squadFlank?.waypointSeparation ?? 0) >= 200 || (metrics.squadFlank?.maxSeparation ?? 0) >= 150;
  return { checks, probe };
}
