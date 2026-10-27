import { FreeForAllMatch } from './free-for-all-match.js';

const TEAM_NAMES = { allies: 'Allies', axis: 'Axis' };

// Two-team match. TDM scores every hostile kill; Kill Confirmed (scoreOnKill
// false) scores only through confirm(), called when a hostile tag is collected.
export class TeamMatch extends FreeForAllMatch {
  constructor({ scoreOnKill = true, label = 'Score', ...options } = {}) {
    super(options);
    this.scoreOnKill = scoreOnKill;
    this.label = label;
  }

  reset() {
    this.teamScores = { allies: 0, axis: 0 };
    for (const entry of this.combatants?.values?.() ?? []) entry.confirms = 0;
    return super.reset();
  }

  get scoreLabel() { return this.label; }

  scoreOf(entry) { return this.scoreOnKill ? entry.kills : entry.confirms ?? 0; }

  teamsState() {
    return ['allies', 'axis'].map((id) => ({ id, name: TEAM_NAMES[id], score: this.teamScores[id] }));
  }

  afterCredit(killer, victim) {
    if (this.scoreOnKill && killer.team && killer.team !== victim.team) this.addTeamScore(killer.team);
  }

  // Kill Confirmed: `collectorId` picked up a hostile tag.
  confirm(collectorId) {
    const entry = this.combatants.get(String(collectorId));
    if (this.phase !== 'playing' || !entry?.team) return false;
    entry.confirms = (entry.confirms ?? 0) + 1;
    this.addTeamScore(entry.team);
    return true;
  }

  addTeamScore(team) {
    this.teamScores[team] += 1;
    if (this.teamScores[team] >= this.scoreLimit) this.finish();
  }

  finish() {
    if (this.phase === 'ended') return this.winnerId;
    const { allies, axis } = this.teamScores;
    this.phase = 'ended';
    this.winnerTeam = allies === axis ? null : allies > axis ? 'allies' : 'axis';
    this.winnerId = (this.standings.find((entry) => entry.team === this.winnerTeam) ?? this.standings[0])?.id ?? null;
    return this.winnerId;
  }
}

export default TeamMatch;
