// Lane B acceptance: Team Deathmatch on Hijacked, then again on Kestrel Heights.
// Teams, friendly fire, bot targeting, UAV (hostiles only) and air strike friendly fire.
import { findOpenSpot, makeDebug, waitFor } from './_ks-common.mjs';

export const query = 'mode=tdm';

async function pass({ page, openGame, screenshot, tag, first }) {
  const debug = makeDebug(page);
  const checks = {};
  const probe = {};
  const section = async (name, body) => {
    try { await body(); } catch (error) { checks[`${name}Completed`] = false; probe[`${name}Error`] = String(error.message).split('\n')[0]; }
  };
  if (!first) await openGame(tag === 'kestrel' ? 'mode=tdm&map=kestrel' : 'mode=tdm');
  await debug((api) => { api.setActive(true); api.resume(); api.setGraphicsPreset('performance'); });
  await waitFor(page, (api) => api.getState().systems.killstreaks.fxReady === true, null, 60000);

  const boot = await debug((api) => api.getState());
  const teamOf = Object.fromEntries(boot.combatants.map((c) => [c.id, c.team]));
  const count = (team) => boot.combatants.filter((c) => c.team === team).length;
  checks.modeIsTdm = boot.config.modeId === 'tdm' && boot.match.modeId === 'tdm';
  checks.fourVersusFour = count('allies') === 4 && count('axis') === 4 && teamOf.player === 'allies' &&
    ['bot-0', 'bot-1', 'bot-2'].every((id) => teamOf[id] === 'allies');
  checks.scoreAndClock = boot.match.scoreLimit === 50 && boot.match.timeLimitSeconds === 480 && boot.match.teams?.length === 2;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;
  const pf = boot.player.feet;
  const dAllies = mean(boot.enemies.filter((e) => teamOf[`bot-${e.index}`] === 'allies').map((e) => dist(e.position, pf)));
  const dAxis = mean(boot.enemies.filter((e) => teamOf[`bot-${e.index}`] === 'axis').map((e) => dist(e.position, pf)));
  probe.spawnDistances = { allies: Math.round(dAllies), axis: Math.round(dAxis) };
  checks.teamsSpawnApart = dAxis > dAllies;
  checks.markersListed = boot.systems.modeRules.modeId === 'tdm';

  // friendly fire + hostile kill on a fresh match
  await section('rules', async () => {
    await debug((api) => api.restartMatch());
    const ff = await debug((api) => ({
      ally: api.killCombatant('bot-0'),
      axisOnAxis: api.killCombatant('bot-4', { attackerId: 'bot-3' }),
      allyOnPlayer: api.killCombatant('player', { attackerId: 'bot-1' }),
      allyHealth: api.getState().enemies[0].health,
    }));
    checks.friendlyFireLeavesAlive = !ff.ally.killed && !ff.axisOnAxis.killed && !ff.allyOnPlayer.killed && ff.allyHealth === 100;
    const hostile = await debug((api) => ({ kill: api.killCombatant('bot-3'), teams: api.getState().match.teams }));
    probe.hostile = hostile.teams;
    checks.hostileKillScoresAllies = hostile.kill.killed && hostile.teams.find((t) => t.id === 'allies').score === 1 &&
      hostile.teams.find((t) => t.id === 'axis').score === 0;
  });

  // no bot targets a teammate during 5 s of game time after alert
  await section('targeting', async () => {
    await debug((api) => { api.restartMatch(); api.respawnEnemies(); api.alertEnemies(100000); });
    const start = (await debug((api) => api.getState().match.elapsedSeconds));
    let violations = 0;
    let engaged = 0;
    let samples = 0;
    const begun = Date.now();
    while (Date.now() - begun < 150000) {
      const s = await debug((api) => { const st = api.getState(); return { t: st.match.elapsedSeconds, enemies: st.enemies, combatants: st.combatants }; });
      const team = Object.fromEntries(s.combatants.map((c) => [c.id, c.team]));
      for (const e of s.enemies) {
        if (e.dead || !e.targetId) continue;
        engaged += 1;
        if (team[`bot-${e.index}`] === team[e.targetId]) violations += 1;
      }
      samples += 1;
      if (s.t - start >= 5) break;
      await page.waitForTimeout(200);
    }
    probe.targeting = { violations, engaged, samples };
    checks.noBotTargetsTeammate = violations === 0 && engaged > 0;
  });

  await section('uav', async () => {
    await debug((api) => { api.restartMatch(); api.respawnEnemies(); api.grantStreak('uav'); });
    const used = await debug((api) => api.useStreak('uav'));
    await waitFor(page, (api) => api.getState().systems.killstreaks.radarActive === true, null, 20000);
    await page.waitForTimeout(1500);
    const hud = await debug((api) => api.getState().hud);
    probe.uav = hud;
    checks.uavRevealsHostilesOnly = used.ok && hud.revealed >= 1 && hud.revealed <= 4 && hud.friendly >= 1 && hud.friendly <= 3 &&
      hud.contacts === 7;
  });

  await section('airstrike', async () => {
    const pair = await findOpenSpot(page);
    probe.pair = pair;
    checks.foundOpenSpot = Boolean(pair);
    const stage = (v) => debug((api, w) => {
      [[0, 0, 0], [-90, 40, 3], [60, -70, 4], [80, 60, 5]].forEach(([dx, dz, bot]) => api.teleportEnemy(bot, [w.spot.x + dx, w.spot.y + 6, w.spot.z + dz]));
      api.teleportEnemy(0, [w.spot.x - 10, w.spot.y + 6, w.spot.z - 10]);
      api.teleportPlayer([w.stand.x, w.stand.y + 2, w.stand.z]);
    }, v);
    await debug((api) => { api.restartMatch(); api.respawnEnemies(); api.respawnPlayer(); api.grantStreak('airstrike'); });
    await stage(pair);
    const used = await debug((api, w) => api.useStreak('airstrike', [w.spot.x, w.spot.y, w.spot.z]), pair);
    checks.airstrikeStarted = used.ok === true;
    const begun = Date.now();
    while (Date.now() - begun < 240000) {
      const s = await debug((api) => api.getState().systems.killstreaks);
      if (!s.strike && s.counters.bombsFallen > 0) break;
      if (s.strike && s.strike.exploded === 0) await stage(pair);
      await page.waitForTimeout(100);
    }
    const events = await debug((api) => api.recentEvents());
    const teamOfId = (id) => (id === 'player' || ['bot-0', 'bot-1', 'bot-2'].includes(id) ? 'allies' : 'axis');
    const strikeKills = events.filter((e) => e.type === 'kill' && e.payload.cause === 'airstrike').map((e) => e.payload.victimId);
    const strikeDamage = events.filter((e) => e.type === 'damage' && e.payload.cause === 'airstrike').map((e) => e.payload.victimId);
    probe.strike = { strikeKills, strikeDamage };
    checks.airstrikeKilledHostiles = strikeKills.length >= 1 && strikeKills.every((id) => teamOfId(id) === 'axis');
    checks.airstrikeNoFriendlyDamage = strikeDamage.length >= 1 && strikeDamage.every((id) => teamOfId(id) === 'axis');
  });

  // markers: bring the allies in front of the player and look at them
  await section('markers', async () => {
    await debug((api) => { api.restartMatch(); api.respawnEnemies(); api.respawnPlayer(); api.pause(); });
    const where = await debug((api) => {
      const p = api.getState().player.feet;
      const look = [p[0] + 300, p[1] + 60, p[2]];
      api.teleportPlayer([p[0], p[1] + 2, p[2]]);
      api.lookAt(look);
      return p;
    });
    await page.waitForTimeout(600);
    // put the three allies a short way ahead along the view direction
    const dir = await debug((api) => { const s = api.getState(); return s.player.forward ?? null; });
    probe.dir = dir;
    await debug((api, p) => {
      [[220, -90], [330, 20], [260, 120]].forEach(([dx, dz], i) => api.teleportEnemy(i, [p[0] + dx, p[1] + 6, p[2] + dz]));
    }, where);
    await page.waitForTimeout(800);
    const s = await debug((api) => api.getState());
    probe.markers = s.systems.modeRules.friendlyMarkers;
    checks.friendlyMarkersShown = s.systems.modeRules.friendlyMarkers >= 1;
    await screenshot(`tdm-markers${first ? '' : '-' + tag}`);
  });

  await section('scoreboard', async () => {
    await debug((api) => { api.killCombatant('bot-3'); api.killCombatant('bot-5'); api.finishMatch(); });
    await page.waitForTimeout(500);
    const s = await debug((api) => api.getState().match);
    checks.winnerIsTeam = s.phase === 'ended' && s.winnerTeam === 'allies';
    await screenshot(`team-scoreboard${first ? '' : '-' + tag}`);
  });

  return { checks, probe };
}

export async function run(args) {
  const hijacked = await pass({ ...args, tag: 'hijacked', first: true });
  const kestrel = await pass({ ...args, tag: 'kestrel', first: false });
  const checks = {};
  for (const [k, v] of Object.entries(hijacked.checks)) checks[`hijacked_${k}`] = v;
  for (const [k, v] of Object.entries(kestrel.checks)) checks[`kestrel_${k}`] = v;
  return { checks, probe: { hijacked: hijacked.probe, kestrel: kestrel.probe } };
}
