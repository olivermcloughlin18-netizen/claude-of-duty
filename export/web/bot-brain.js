// Pure decision helpers for offline bots (no THREE, no DOM): unit-tested in test/bot-brain.test.mjs.

/** Seconds before a bot's first shot at a newly seen target: 0.2-0.45 s, longer at range and vs moving targets. */
export function reactionDelay(distance, targetSpeed, roll, { min = 0.2, max = 0.45, range = 850, speed = 300 } = {}) {
  const far = Math.min(1, Math.max(0, (Number(distance) || 0) / range));
  const moving = Math.min(1, Math.max(0, (Number(targetSpeed) || 0) / speed));
  const jitter = Math.min(1, Math.max(0, Number(roll) || 0));
  return min + (max - min) * Math.min(1, jitter * 0.45 + far * 0.35 + moving * 0.2);
}

/** Why a bot wants to break line of sight right now, or null. `cooldown` is seconds until it may hide again. */
export function coverReason({ health, maxHealth, reloading, visibleHostiles = 1, cooldown = 0, roll = 0 }) {
  if (cooldown > 0) return null;
  const hurt = health / maxHealth;
  if (hurt < 0.5) return 'hurt';
  if (visibleHostiles >= 2 && hurt < 0.65) return 'outgunned';
  if (reloading && roll < 0.6) return 'reload';
  return null;
}

const angleBetween = (ax, az, bx, bz) => Math.atan2(ax * bz - az * bx, ax * bx + az * bz);

/**
 * Pick a waypoint that approaches `goal` from the side. `side` is +1/-1, `avoid` are other bots' waypoints
 * (kept >200u apart so a squad fans out). Returns one of `points` or null.
 */
export function pickFlankPoint(points, from, goal, side, avoid = []) {
  const gx = goal.x - from.x; const gz = goal.z - from.z;
  let best = null; let bestCost = Infinity;
  for (const p of points) {
    const px = p.x - from.x; const pz = p.z - from.z;
    const out = Math.hypot(px, pz);
    const back = Math.hypot(goal.x - p.x, goal.z - p.z);
    if (out < 150 || out > 700 || back < 120 || back > 750) continue;
    const angle = angleBetween(gx, gz, px, pz) * side;
    if (angle < 0.6 || angle > 2.1) continue;
    let cost = Math.abs(angle - 1.15) * 120 + out * 0.1;
    for (const a of avoid) if (Math.hypot(a.x - p.x, a.z - p.z) < 200) cost += 400;
    if (cost < bestCost) { bestCost = cost; best = p; }
  }
  return best;
}

/** Direction (+1/-1) of the next strafe leg; flips when the last leg was blocked by a wall or ledge. */
export function nextStrafeSide(current, blocked, roll) {
  if (blocked) return -current;
  return roll < 0.35 ? -current : current;
}
