const safeName = (value, fallback) => String(value ?? fallback).trim() || fallback;

export class FreeForAllMatch {
  constructor({
    scoreLimit = 30, timeLimitSeconds = 300, feedLimit = 5, modeId = 'ffa', modeName = 'Free for all',
  } = {}) {
    this.modeId = modeId;
    this.modeName = modeName;
    this.scoreLimit = Math.max(1, Math.trunc(Number(scoreLimit) || 30));
    this.timeLimitSeconds = Math.max(1, Number(timeLimitSeconds) || 300);
    this.feedLimit = Math.max(1, Math.trunc(Number(feedLimit) || 5));
    this.combatants = new Map();
    this.reset();
  }

  register(id, name = id, { human = false, team = null } = {}) {
    const key = String(id);
    const previous = this.combatants.get(key);
    const entry = previous ?? { id: key, kills: 0, deaths: 0, streak: 0 };
    entry.name = safeName(name, key);
    entry.human = Boolean(human);
    entry.team = team ?? null;
    this.combatants.set(key, entry);
    return entry;
  }

  reset() {
    this.phase = 'playing';
    this.elapsedSeconds = 0;
    this.winnerId = null;
    this.winnerTeam = null;
    this.feed = [];
    for (const entry of this.combatants?.values?.() ?? []) {
      entry.kills = 0;
      entry.deaths = 0;
      entry.streak = 0;
    }
    return this.getState();
  }

  update(deltaSeconds) {
    if (this.phase !== 'playing') return;
    const dt = Math.max(0, Math.min(Number(deltaSeconds) || 0, 0.25));
    this.elapsedSeconds = Math.min(this.timeLimitSeconds, this.elapsedSeconds + dt);
    if (this.elapsedSeconds >= this.timeLimitSeconds) this.finish();
  }

  // Server-driven scores (online): overwrite counters from an authoritative list.
  setStandings(players = []) {
    for (const player of players) {
      const previous = this.combatants.get(String(player.id));
      const entry = this.register(player.id, player.name ?? previous?.name ?? player.id, {
        human: previous?.human ?? player.id === 'player',
        team: previous?.team ?? player.team ?? null,
      });
      entry.kills = Math.max(0, Math.trunc(Number(player.kills) || 0));
      entry.deaths = Math.max(0, Math.trunc(Number(player.deaths) || 0));
      entry.streak = Math.max(0, Math.trunc(Number(player.streak) || 0));
    }
    return this.getState();
  }

  recordKill(killerId, victimId, event = {}) {
    if (this.phase !== 'playing') return null;
    const killer = this.combatants.get(String(killerId));
    const victim = this.combatants.get(String(victimId));
    if (!victim) return null;

    victim.deaths += 1;
    victim.streak = 0;
    const credited = killer && killer !== victim;
    if (credited) {
      killer.kills += 1;
      killer.streak += 1;
    }
    const entry = {
      killerId: credited ? killer.id : null,
      killer: credited ? killer.name : 'The environment',
      victimId: victim.id,
      victim: victim.name,
      weaponId: event?.weaponId ?? null,
      cause: event?.cause ?? 'bullet',
      at: this.elapsedSeconds,
    };
    this.feed.unshift(entry);
    this.feed.length = Math.min(this.feed.length, this.feedLimit);
    if (credited) this.afterCredit(killer, victim);
    return entry;
  }

  // Subclass seams: how a credited kill scores, and what the score column shows.
  afterCredit(killer) {
    if (killer.kills >= this.scoreLimit) this.finish(killer.id);
  }

  scoreOf(entry) { return entry.kills; }

  teamsState() { return null; }

  get scoreLabel() { return 'Kills'; }

  finish(winnerId = null) {
    if (this.phase === 'ended') return this.winnerId;
    this.phase = 'ended';
    this.winnerId = winnerId && this.combatants.has(String(winnerId))
      ? String(winnerId)
      : this.standings[0]?.id ?? null;
    return this.winnerId;
  }

  get standings() {
    return [...this.combatants.values()]
      .sort((a, b) => this.scoreOf(b) - this.scoreOf(a) || b.kills - a.kills || a.deaths - b.deaths || Number(b.human) - Number(a.human) ||
        a.name.localeCompare(b.name));
  }

  get remainingSeconds() {
    return Math.max(0, this.timeLimitSeconds - this.elapsedSeconds);
  }

  getState() {
    const standings = this.standings.map((entry, index) => ({
      id: entry.id,
      name: entry.name,
      human: entry.human,
      kills: entry.kills,
      deaths: entry.deaths,
      streak: entry.streak,
      team: entry.team ?? null,
      score: this.scoreOf(entry),
      place: index + 1,
    }));
    return {
      modeId: this.modeId,
      modeName: this.modeName,
      phase: this.phase,
      scoreLimit: this.scoreLimit,
      timeLimitSeconds: this.timeLimitSeconds,
      elapsedSeconds: Math.round(this.elapsedSeconds * 1000) / 1000,
      remainingSeconds: Math.ceil(this.remainingSeconds),
      winnerId: this.winnerId,
      winnerTeam: this.winnerTeam,
      teams: this.teamsState(),
      scoreLabel: this.scoreLabel,
      standings,
      feed: this.feed.map((event) => ({ ...event })),
    };
  }
}

export default FreeForAllMatch;
