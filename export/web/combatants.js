// Combatant registry: the single place damage flows through. Pure ESM.
//
// entry (all required): { id, name, kind:'player'|'bot'|'remote', team, actor,
//   position(), feet(), dead(), hitboxes(), applyDamage(amount, info) -> applied }
// position()/feet() return {x,y,z}; hitboxes() returns Object3D[].
import { EVENTS } from './game-events.js';

const REQUIRED = ['id', 'name', 'kind', 'team', 'actor', 'position', 'feet', 'dead', 'hitboxes', 'applyDamage'];
const xyz = (point) => (Array.isArray(point) ? { x: point[0], y: point[1], z: point[2] } : point);

export class Combatants {
  constructor({ bus, now = () => performance.now() / 1000 } = {}) {
    this.bus = bus;
    this.now = now;
    this.entries = new Map();
    this.byActor = new Map();
    this.hits = new Map();
  }

  add(entry) {
    for (const field of REQUIRED) {
      if (entry?.[field] === undefined) throw new Error(`combatant missing ${field}`);
    }
    this.entries.set(entry.id, entry);
    if (entry.actor) this.byActor.set(entry.actor, entry.id);
    return entry;
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    if (entry.actor && this.byActor.get(entry.actor) === id) this.byActor.delete(entry.actor);
    this.hits.delete(id);
    return true;
  }

  get(id) { return this.entries.get(id) ?? null; }

  all() { return [...this.entries.values()]; }

  idOf(actor) { return actor ? this.byActor.get(actor) ?? null : null; }

  setTeam(id, team) {
    const entry = this.entries.get(id);
    if (entry) entry.team = team ?? null;
  }

  teamOf(id) { return this.entries.get(id)?.team ?? null; }

  hostile(aId, bId) {
    if (aId === bId) return false;
    if (aId === null || aId === undefined) return true;
    const a = this.teamOf(aId);
    const b = this.teamOf(bId);
    if (a === null || b === null) return true;
    return a !== b;
  }

  hitTargets() {
    return this.all().flatMap((entry) => (entry.dead() ? [] : entry.hitboxes()));
  }

  resolveHit(hit) {
    const data = hit?.object?.userData;
    let id = null;
    let region;
    let multiplier;
    if (data?.enemyHit) {
      id = this.idOf(data.enemyHit.enemy);
      ({ region, multiplier } = data.enemyHit);
    } else if (data?.combatantHit) {
      ({ id, region, multiplier } = data.combatantHit);
    }
    const entry = id ? this.entries.get(id) : null;
    if (!entry || entry.dead()) return null;
    return { id, region: region ?? 'torso', multiplier: multiplier ?? 1 };
  }

  applyDamage(victimId, amount, { attackerId = null, weaponId = null, cause = 'bullet', region = null } = {}) {
    const victim = this.entries.get(victimId);
    const damage = Number(amount) || 0;
    if (!victim || damage <= 0 || victim.dead()) return 0;
    if (attackerId === victimId && cause !== 'environment') return 0;
    if (attackerId && attackerId !== victimId && !this.hostile(attackerId, victimId)) return 0;

    const info = { attackerId, weaponId, cause, region };
    this.hits.set(victimId, { ...info, at: this.now() });
    const applied = victim.applyDamage(damage, info) ?? 0;
    if (applied > 0) {
      this.bus.emit(EVENTS.DAMAGE, { attackerId, victimId, amount: applied, weaponId, cause, region });
    }
    return applied;
  }

  lastHit(id) { return this.hits.get(id) ?? null; }

  radiusDamage(center, radius, maxDamage, info, isExposed = () => true) {
    const origin = xyz(center);
    const results = [];
    for (const entry of this.all()) {
      if (entry.dead()) continue;
      const position = entry.position();
      const distance = Math.hypot(position.x - origin.x, position.y - origin.y, position.z - origin.z);
      if (distance >= radius || !isExposed(entry, origin)) continue;
      const applied = this.applyDamage(entry.id, maxDamage * (1 - distance / radius), info);
      results.push({ id: entry.id, applied, killed: entry.dead() });
    }
    return results;
  }

  getState() {
    return this.all().map((entry) => ({ id: entry.id, team: entry.team, dead: Boolean(entry.dead()) }));
  }
}
