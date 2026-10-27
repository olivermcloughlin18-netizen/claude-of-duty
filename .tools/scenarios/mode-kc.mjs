// Lane B acceptance: Kill Confirmed. Tag drop, confirm (+1), deny, bot detour, 30 s expiry.
import { makeDebug, waitFor } from './_ks-common.mjs';

export const query = 'mode=kc';

export async function run({ page, screenshot }) {
  const debug = makeDebug(page);
  const checks = {};
  const probe = {};
  const only = process.env.KC_ONLY;
  const section = async (name, body) => {
    if (only && only !== name) return;
    try { await body(); } catch (error) { checks[`${name}Completed`] = false; probe[`${name}Error`] = String(error.message).split('\n')[0]; }
  };
  const mr = () => debug((api) => api.getState().systems.modeRules);
  const score = (team) => debug((api, t) => api.getState().match.teams.find((x) => x.id === t).score, team);
  await debug((api) => { api.setActive(true); api.resume(); api.setGraphicsPreset('performance'); });
  const boot = await debug((api) => api.getState());
  checks.modeIsKc = boot.config.modeId === 'kc' && boot.match.scoreLimit === 40 && boot.match.scoreLabel === 'Confirms';
  checks.teams = boot.combatants.filter((c) => c.team === 'allies').length === 4 && boot.combatants.filter((c) => c.team === 'axis').length === 4;

  await section('confirm', async () => {
    await debug((api) => api.restartMatch());
    const kill = await debug((api) => api.killCombatant('bot-3'));
    let s = await mr();
    probe.tagAfterKill = s.tags;
    checks.killDropsTag = kill.killed && s.tags.length === 1 && s.tags[0].team === 'axis' && s.tags[0].victimId === 'bot-3';
    checks.killAloneDoesNotScore = (await score('allies')) === 0;
    // view from 230u away for the screenshot
    const [tx, ty, tz] = s.tags[0].position;
    await debug((api, t) => { api.pause(); api.teleportPlayer([t[0] - 230, t[1] + 2, t[2]]); api.lookAt([t[0], t[1] + 14, t[2]]); }, [tx, ty, tz]);
    await page.waitForTimeout(700);
    await screenshot('kc-tag');
    await debug((api, t) => { api.resume(); api.teleportPlayer([t[0], t[1] + 2, t[2]]); }, [tx, ty, tz]);
    await waitFor(page, (api) => api.getState().systems.modeRules.confirms === 1, null, 30000);
    await page.waitForTimeout(250);
    await screenshot('kc-confirm-pop');
    s = await mr();
    checks.hostileTagConfirms = s.confirms === 1 && s.tags.length === 0 && (await score('allies')) === 1;
    probe.playerScore = await debug((api) => api.getState().match.standings.find((e) => e.id === 'player').score);
    checks.playerCreditedConfirm = probe.playerScore === 1;
  });

  await section('deny', async () => {
    await debug((api) => { api.restartMatch(); });
    const kill = await debug((api) => api.killCombatant('bot-1', { attackerId: 'bot-4' }));
    const s = await mr();
    checks.friendlyDeathDropsAlliesTag = kill.killed && s.tags.length === 1 && s.tags[0].team === 'allies';
    const [tx, ty, tz] = s.tags[0].position;
    await debug((api, t) => { api.teleportPlayer([t[0], t[1] + 2, t[2]]); }, [tx, ty, tz]);
    await waitFor(page, (api) => api.getState().systems.modeRules.denies === 1, null, 30000);
    const after = await mr();
    const teams = await debug((api) => api.getState().match.teams);
    probe.deny = { after, teams };
    checks.ownTagDenies = after.denies === 1 && after.tags.length === 0 && after.confirms === 0 && teams.every((t) => t.score === 0);
    const events = await debug((api) => api.recentEvents());
    checks.denyMedal = events.some((e) => e.type === 'medal' && e.payload.ref === 'retrieve_own_tags');
  });

  await section('detour', async () => {
    await debug((api) => { api.restartMatch(); });
    const where = await debug((api) => api.getState().enemies.find((e) => e.index === 3).position);
    // ally bot-0 waits 250u from where axis bot-3 dies; the player stays out of the way
    const start = await debug((api, p) => {
      const at = api.teleportEnemy(0, [p[0] + 250, p[1] + 6, p[2]]);
      api.teleportPlayer([p[0] - 1200, p[1] + 6, p[2]]);
      return at;
    }, where);
    await page.waitForTimeout(300);
    await debug((api) => api.killCombatant('bot-3'));
    const begun = Date.now();
    let assigned = false;
    let closest = Infinity;
    let confirmed = false;
    let tagPos = null;
    while (Date.now() - begun < 120000) {
      const s = await debug((api) => ({ ks: api.getState().systems.modeRules, bot0: api.getState().enemies[0], match: api.getState().match }));
      tagPos ??= s.ks.tags[0]?.position ?? null;
      if (s.ks.detours.some((d) => d.id === 'bot-0')) assigned = true;
      if (tagPos) closest = Math.min(closest, Math.hypot(s.bot0.position[0] - tagPos[0], s.bot0.position[2] - tagPos[2]));
      confirmed = s.match.standings.find((e) => e.id === 'bot-0')?.score >= 1;
      if (confirmed || s.ks.tags.length === 0 || closest < 40) break;
      await page.waitForTimeout(250);
    }
    probe.detour = { start, tagPos, assigned, closest: Math.round(closest), confirmed };
    checks.botDetourAssigned = assigned;
    checks.botWalksToTag = confirmed || closest < 60;
  });

  await section('expiry', async () => {
    await debug((api) => { api.restartMatch(); api.respawnPlayer(); });
    const where = await debug((api) => api.getState().enemies.find((e) => e.index === 6).position);
    await debug((api) => api.killCombatant('bot-6'));
    const s = await mr();
    checks.expiryTagDropped = s.tags.length === 1;
    // park everyone else on the valid spawn points farthest from the tag
    await debug((api, p) => {
      const far = globalThis.hijacked.enemies.spawnCandidates
        .map((c) => c.position).filter((v) => Math.hypot(v.x - p[0], v.z - p[2]) > 1500)
        .sort((a, b) => Math.hypot(b.x - p[0], b.z - p[2]) - Math.hypot(a.x - p[0], a.z - p[2]));
      api.getState().enemies.filter((e) => e.index !== 6).forEach((e, i) => {
        const v = far[i % far.length];
        api.teleportEnemy(e.index, [v.x, v.y + 6, v.z]);
      });
      const v = far[Math.min(far.length - 1, 7)];
      api.teleportPlayer([v.x, v.y + 6, v.z]);
    }, where);
    // let the tag age for real, then fast-forward most of the 30 s (the sim runs ~0.3x real time)
    await waitFor(page, (api) => api.getState().systems.modeRules.tags[0]?.age >= 3, null, 120000);
    await debug((api) => api.ageTags(24));
    const begun = Date.now();
    let max = 0;
    let gone = false;
    while (Date.now() - begun < 330000) {
      const now = await mr();
      if (now.tags.length === 0) { gone = true; break; }
      max = Math.max(max, now.tags[0].age);
      await page.waitForTimeout(500);
    }
    const teams = await debug((api) => api.getState().match.teams);
    probe.expiry = { gone, maxAgeSeen: max, teams };
    checks.tagExpiresAt30s = gone && max >= 27 && max < 31;
  });

  return { checks, probe };
}
