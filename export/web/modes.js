// Game modes. Pure ESM. Lane B adds team modes by extending MODES; every
// createMatch() result must satisfy the MatchContract documented in PLAN.md 3.3.
import { FreeForAllMatch } from './free-for-all-match.js';

export const PLAYER_RULES = Object.freeze({
  maxHealth: 100,
  respawnDelay: 1.5,
  spawnProtection: 3,
  regenDelay: 4,
  regenPerSecond: 25,
});

export const MODES = {
  ffa: {
    id: 'ffa',
    name: 'Free for all',
    teams: false,
    botCount: 6,
    killstreaks: true,
    online: true,
    spawnClasses: ['mp_dm_spawn', 'mp_tdm_spawn_team2_start', 'mp_tdm_spawn_allies_start', 'mp_tdm_spawn', 'mp_dm_spawn'],
    teamFor: () => null,
    createMatch: () => new FreeForAllMatch({ scoreLimit: 30, timeLimitSeconds: 300 }),
  },
};

export function getMode(id) {
  return MODES[id] ?? MODES.ffa;
}
