// Knife melee: target selection, swing state and the procedural swing pose.
// Pure ESM (no three, no DOM) so Node tests drive it with fake dependencies.
// Units are world inches. A swing lasts KNIFE.recovery; the blow lands at
// MELEE.hitAt, mid-slash, against whoever is in front of you *then*.
import { KNIFE } from './weapons.js';

export const MELEE = Object.freeze({
  damage: KNIFE.damage,
  range: KNIFE.range,            // strike reach, flat distance from the eye
  lungeRange: KNIFE.range * 2.5, // magnetism reach
  strikeCos: Math.cos(0.95),     // ~54 degrees either side of where you look
  lungeCos: Math.cos(0.6),       // ~34 degrees: magnetism only follows what you face
  hitAt: 0.17,
  recovery: KNIFE.recovery,
  stopDistance: 40,              // the lunge ends this close to the target
  lungeSpeedMax: 1300,
  chestHeight: 36,               // feet to the aim point on a body
  below: 80,                     // vertical reach below/above the eye (chest height)
  above: 40,
});

/**
 * Nearest candidate in front of the eye. candidates: [{id, x, y, z}] aim points.
 * forward: {x, z} (need not be unit). Returns {id, distance, dx, dz} or null.
 */
export function pickTarget(eye, forward, candidates, { range = MELEE.range, cos = MELEE.strikeCos } = {}) {
  const flat = Math.hypot(forward.x, forward.z) || 1;
  const fx = forward.x / flat;
  const fz = forward.z / flat;
  let best = null;
  for (const c of candidates) {
    const dx = c.x - eye.x;
    const dz = c.z - eye.z;
    const dy = c.y - eye.y;
    const distance = Math.hypot(dx, dz);
    if (distance > range || dy < -MELEE.below || dy > MELEE.above) continue;
    // Point blank: the body is on top of you, so any facing counts.
    const facing = distance < 8 ? 1 : (dx * fx + dz * fz) / distance;
    if (facing < cos) continue;
    if (!best || distance < best.distance) best = { id: c.id, distance, dx: dx / (distance || 1), dz: dz / (distance || 1) };
  }
  return best;
}

export function createMelee({
  combatants, getPose, blocked = () => false, canSwing = () => true,
  onSwing = () => {}, onHit = () => {}, selfId = 'player',
}) {
  const state = {
    cooldown: 0, t: -1, pending: false, swings: 0, hits: 0, lastHit: null, lunge: null, lungeTarget: null,
  };

  const candidates = () => combatants.all()
    .filter((c) => c.id !== selfId && !c.dead() && combatants.hostile(selfId, c.id))
    .map((c) => {
      const f = c.feet();
      return { id: c.id, x: f.x, y: f.y + MELEE.chestHeight, z: f.z };
    });

  const pose = () => {
    const p = getPose();
    return { eye: { x: p.eye[0], y: p.eye[1], z: p.eye[2] }, forward: { x: p.forward[0], z: p.forward[2] }, eyeArr: p.eye };
  };

  function resolveBlow() {
    state.pending = false;
    state.lunge = null;
    const p = pose();
    const hit = pickTarget(p.eye, p.forward, candidates());
    const swing = { at: state.swings, targetId: null, killed: false, applied: 0, distance: null };
    if (hit) {
      const target = candidates().find((c) => c.id === hit.id);
      // A wall between you and them stops the blade.
      if (!blocked(p.eyeArr, [target.x, target.y, target.z])) {
        swing.targetId = hit.id;
        swing.distance = Math.round(hit.distance);
        swing.applied = combatants.applyDamage(hit.id, MELEE.damage, {
          attackerId: selfId, weaponId: KNIFE.id, cause: 'melee', region: 'torso',
        });
        swing.killed = Boolean(combatants.get(hit.id)?.dead());
        if (swing.applied > 0) state.hits += 1;
      }
    }
    state.lastHit = swing;
    onHit(swing);
  }

  return {
    state,
    /** Cooldown running: no shooting, reloading or weapon swap until it ends. */
    get active() { return state.cooldown > 0; },
    get swinging() { return state.t >= 0; },
    /** Horizontal velocity to impose on the player this frame, or null. */
    get lunge() { return state.lunge; },

    start() {
      if (state.cooldown > 0 || !canSwing()) return false;
      state.cooldown = MELEE.recovery;
      state.t = 0;
      state.pending = true;
      state.swings += 1;
      const p = pose();
      const near = pickTarget(p.eye, p.forward, candidates(), { range: MELEE.lungeRange, cos: MELEE.lungeCos });
      state.lungeTarget = near && near.distance > MELEE.stopDistance ? near.id : null;
      onSwing();
      return true;
    },

    update(dt) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      if (state.t < 0) return;
      state.t += dt;
      state.lunge = null;
      if (state.pending && state.lungeTarget) {
        const target = combatants.get(state.lungeTarget);
        if (!target || target.dead()) state.lungeTarget = null;
        else {
          const p = pose();
          const f = target.feet();
          const dx = f.x - p.eye.x;
          const dz = f.z - p.eye.z;
          const distance = Math.hypot(dx, dz);
          const remaining = distance - MELEE.stopDistance;
          if (remaining > 0 && state.t < MELEE.hitAt) {
            const speed = Math.min(MELEE.lungeSpeedMax, remaining / Math.max(MELEE.hitAt - state.t, 0.04));
            state.lunge = { x: dx / distance * speed, z: dz / distance * speed };
          }
        }
      }
      if (state.pending && state.t >= MELEE.hitAt) resolveBlow();
      if (state.t >= MELEE.recovery) state.t = -1;
    },

    /** Death, respawn or a menu: drop the swing without landing it. */
    cancel() {
      state.cooldown = 0; state.t = -1; state.pending = false; state.lunge = null; state.lungeTarget = null;
    },

    getState() {
      return {
        cooldown: Math.round(state.cooldown * 1000) / 1000, swinging: state.t >= 0, swings: state.swings,
        hits: state.hits, lastHit: state.lastHit,
      };
    },
  };
}

// ---------- viewmodel pose ----------
// Camera space: +x right, +y up, -z forward. Rotations are Euler YXZ and the
// knife blade points down its local -z, so +y turns the blade to the left.
// Keyframes are [time, position, rotation]; segments ease with smoothstep.
const KEYS = [
  [0.00, [11, -16, -7], [0.7, -0.6, -0.9]],
  [0.07, [8.5, -6, -9], [0.55, -1.05, -0.85]],   // wound up: blade up and out to the right
  [0.17, [1.5, -5.2, -12.5], [0.25, -0.1, -0.35]], // mid-slash: blade across the middle
  [0.26, [-5.5, -6.5, -11.5], [-0.05, 0.95, 0.2]], // follow-through to the left
  [0.40, [-5, -7, -11.5], [-0.05, 0.9, 0.2]],
  [0.56, [4, -12, -8.5], [0.45, -0.3, -0.6]],
  [0.68, [11, -17, -7], [0.7, -0.6, -0.9]],
];
const smooth = (x) => x * x * (3 - 2 * x);
const mix = (a, b, k) => a + (b - a) * k;

/** {visible, p, r, lower}: knife placement and how far the rifle is dropped (0..1) at time t into a swing. */
export function knifePose(t, duration = MELEE.recovery) {
  if (t < 0 || t >= duration) return { visible: false, p: KEYS[0][1], r: KEYS[0][2], lower: 0 };
  let i = 0;
  while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i += 1;
  const [t0, p0, r0] = KEYS[i];
  const [t1, p1, r1] = KEYS[i + 1];
  const k = smooth(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
  const lower = smooth(Math.min(1, t / 0.08)) * (1 - smooth(Math.min(1, Math.max(0, (t - 0.5) / 0.16))));
  return { visible: true, p: p0.map((v, n) => mix(v, p1[n], k)), r: r0.map((v, n) => mix(v, r1[n], k)), lower };
}
