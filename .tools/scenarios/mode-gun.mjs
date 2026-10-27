// Lane B acceptance: Gun Game. Ladder start, tier-up swap, no death setback, 15 tiers win.
import { makeDebug, waitFor } from './_ks-common.mjs';

export const query = 'mode=gun';

const LADDER = ['scar_pump', 't25_smg', 'tar_smg', 'xm8', 'type95', 'sig556', 'tar21', 'scar', 'm27', 'an94', 'saritch', 'sa58', 'fal_marksman', 'smr_bolt', 'scar_pump'];

export async function run({ page, screenshot }) {
  const debug = makeDebug(page);
  const checks = {};
  const probe = {};
  await debug((api) => { api.setActive(true); api.resume(); api.setGraphicsPreset('performance'); });
  await waitFor(page, (api) => api.getState().weapon.loadout.primary === 'scar_pump', null, 60000);
  const boot = await debug((api) => api.getState());
  checks.modeIsGun = boot.config.modeId === 'gun' && boot.match.modeId === 'gun' && boot.match.scoreLimit === 15;
  checks.startsOnTier1 = boot.systems.modeRules.ladderIndex === 0 && boot.weapon.loadout.primary === LADDER[0] && !boot.weapon.loadout.secondary;
  checks.noStreaks = boot.systems.killstreaks.enabled === false;
  probe.bootWeapon = boot.weapon.loadout;

  const kill = await debug((api) => api.killCombatant('bot-0'));
  await page.waitForTimeout(400);
  await screenshot('gun-tier');
  await waitFor(page, (api) => api.getState().weapon.loadout.primary === 't25_smg', null, 60000);
  const after = await debug((api) => api.getState());
  checks.killAdvancesToLadder1 = kill.killed && after.systems.modeRules.ladderIndex === 1 && after.weapon.loadout.primary === LADDER[1] &&
    !after.weapon.loadout.secondary && after.weapon.id === LADDER[1];
  checks.scoreIsTier = after.match.standings.find((e) => e.id === 'player').score === 2 && after.match.scoreLabel === 'Tier';

  // dying costs nothing
  await debug((api) => { api.killCombatant('player', { attackerId: 'bot-2' }); });
  await debug((api) => { api.respawnPlayer(); });
  const dead = await debug((api) => api.getState().systems.modeRules.ladderIndex);
  checks.deathIsNoSetback = dead === 1;

  // climb the rest of the ladder: 14 more kills, tiers 2..14 then the winning kill
  const seen = [];
  for (let kills = 1; kills < 15; kills += 1) {
    await debug((api) => api.respawnEnemies());
    const result = await debug((api, n) => api.killCombatant(`bot-${n % 6}`), kills);
    if (!result.killed) { probe.failedKill = kills; break; }
    seen.push(await debug((api) => api.getState().systems.modeRules.ladderIndex));
  }
  probe.tiers = seen;
  await page.waitForTimeout(300);
  const end = await debug((api) => api.getState());
  probe.end = { phase: end.match.phase, winnerId: end.match.winnerId, tier: end.systems.modeRules.ladderIndex };
  checks.ladderWalksInOrder = seen.slice(0, 13).every((v, i) => v === i + 2);
  checks.finishingLadderWins = end.match.phase === 'ended' && end.match.winnerId === 'player' && end.systems.modeRules.ladderIndex === 14;
  await screenshot('gun-win');
  return { checks, probe };
}
