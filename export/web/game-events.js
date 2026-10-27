// Typed event bus shared by every system. Pure ESM.
//
// Ids are 'player', 'bot-<n>' and 'net-<serverId>'. Team = 'allies'|'axis'.
// Cause = 'bullet'|'airstrike'|'hunter'|'crate'|'environment'.
//
// Payloads (every field required; null is allowed, undefined is a bug):
//   kill   {killerId|null, victimId, weaponId, cause, region:'head'|'torso'|'legs'|null,
//           victimPosition:[x,y,z], killerPosition|null, at}
//   damage {attackerId|null, victimId, amount, weaponId, cause, region}
//   shot   {shooterId, weaponId, origin, end, hitId|null}
//   match  {phase:'playing'|'ended', winnerId|null, winnerTeam|null}
//   medal  {ref, name, xp}
//   streak {id, ownerId, phase:'earned'|'activated'|'ended'}

export const EVENTS = Object.freeze({
  KILL: 'kill', DAMAGE: 'damage', SHOT: 'shot', MATCH: 'match', MEDAL: 'medal', STREAK: 'streak',
});

const FIELDS = Object.freeze({
  kill: ['killerId', 'victimId', 'weaponId', 'cause', 'region', 'victimPosition', 'killerPosition', 'at'],
  damage: ['attackerId', 'victimId', 'amount', 'weaponId', 'cause', 'region'],
  shot: ['shooterId', 'weaponId', 'origin', 'end', 'hitId'],
  match: ['phase', 'winnerId', 'winnerTeam'],
  medal: ['ref', 'name', 'xp'],
  streak: ['id', 'ownerId', 'phase'],
});

export function createEventBus({ historyLimit = 50 } = {}) {
  const handlers = Object.fromEntries(Object.values(EVENTS).map((type) => [type, new Set()]));
  const log = [];

  const known = (type) => {
    if (!Object.hasOwn(handlers, type)) throw new Error(`[bus] unknown event type "${type}"`);
  };

  return {
    on(type, fn) {
      known(type);
      handlers[type].add(fn);
      return () => handlers[type].delete(fn);
    },
    emit(type, payload = {}) {
      known(type);
      for (const field of FIELDS[type]) {
        if (payload[field] === undefined) console.error(`[bus] ${type} missing ${field}`);
      }
      log.push({ type, payload });
      if (log.length > historyLimit) log.shift();
      for (const fn of [...handlers[type]]) {
        try { fn(payload); } catch (error) { console.error(`[bus] ${type} handler failed:`, error); }
      }
    },
    history() {
      return log.map((entry) => ({ type: entry.type, payload: entry.payload }));
    },
  };
}
