import { FreeForAllMatch } from './free-for-all-match.js';

// 15 tiers over the arsenal, close-quarters guns first. Every tier is a kill;
// the final tier's kill wins (scoreLimit = ladder length). Only ids from weapons.js.
export const GUN_GAME_LADDER = Object.freeze([
  'scar_pump', 't25_smg', 'tar_smg', 'xm8', 'type95', 'sig556', 'tar21', 'scar',
  'm27', 'an94', 'saritch', 'sa58', 'fal_marksman', 'smr_bolt', 'scar_pump',
]);

export class GunGameMatch extends FreeForAllMatch {
  constructor(options = {}) {
    super({ scoreLimit: GUN_GAME_LADDER.length, modeId: 'gun', modeName: 'Gun Game', ...options });
  }

  get scoreLabel() { return 'Tier'; }

  tierOf(id) {
    return Math.min(this.combatants.get(String(id))?.kills ?? 0, GUN_GAME_LADDER.length - 1);
  }

  scoreOf(entry) { return Math.min(entry.kills + 1, GUN_GAME_LADDER.length); }
}

export default GunGameMatch;
