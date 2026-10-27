// Game modes. Pure ESM. Lane B adds team modes by extending MODES; every
// createMatch() result must satisfy the MatchContract documented in PLAN.md 3.3.
import { FreeForAllMatch } from './free-for-all-match.js';
import { GunGameMatch } from './gun-game-match.js';
import { TeamMatch } from './team-match.js';

export const PLAYER_RULES = Object.freeze({
  maxHealth: 100,
  respawnDelay: 1.5,
  spawnProtection: 3,
  regenDelay: 4,
  regenPerSecond: 25,
});

// Bots 0-2 fight beside the player (allies), 3-6 are axis.
const teamFor = (botIndex) => (botIndex < 3 ? 'allies' : 'axis');
const TEAM_SPAWN_CLASSES = ['mp_tdm_spawn_allies_start', 'mp_tdm_spawn_axis_start', 'mp_tdm_spawn', 'mp_dm_spawn'];

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
  tdm: {
    id: 'tdm',
    name: 'Team Deathmatch',
    teams: true,
    botCount: 7,
    killstreaks: true,
    online: false,
    spawnClasses: TEAM_SPAWN_CLASSES,
    teamFor,
    createMatch: () => new TeamMatch({
      scoreLimit: 50, timeLimitSeconds: 480, modeId: 'tdm', modeName: 'Team Deathmatch',
    }),
  },
  kc: {
    id: 'kc',
    name: 'Kill Confirmed',
    teams: true,
    botCount: 7,
    killstreaks: true,
    online: false,
    spawnClasses: TEAM_SPAWN_CLASSES,
    teamFor,
    createMatch: () => new TeamMatch({
      scoreLimit: 40, timeLimitSeconds: 600, modeId: 'kc', modeName: 'Kill Confirmed',
      scoreOnKill: false, label: 'Confirms',
    }),
  },
  gun: {
    id: 'gun',
    name: 'Gun Game',
    teams: false,
    botCount: 6,
    killstreaks: false,
    online: false,
    spawnClasses: ['mp_dm_spawn', 'mp_tdm_spawn_team2_start', 'mp_tdm_spawn_allies_start', 'mp_tdm_spawn', 'mp_dm_spawn'],
    teamFor: () => null,
    createMatch: () => new GunGameMatch({ timeLimitSeconds: 600 }),
  },
};

export function getMode(id) {
  return MODES[id] ?? MODES.ffa;
}
