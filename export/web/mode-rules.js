// Lane B: mode rules system (PLAN.md section 4). Inert in FFA; otherwise it owns
//  - TDM / Kill Confirmed: team spawns, overhead friendly markers, dog tags
//  - Gun Game: the weapon ladder and its tier-up callout
// The match objects themselves live in team-match.js / gun-game-match.js.
import { EVENTS } from './game-events.js';
import { GUN_GAME_LADDER } from './gun-game-match.js';

const TAG_RADIUS = 48; // pickup range (planar)
const TAG_LIFE = 30; // seconds a tag survives
const DETOUR_RANGE = 800; // bots walk to tags this close
const TEAM_COLOR = { allies: 0x7fd0ff, axis: 0xff5a4a };
const MARKER_HEAD = 100; // marker anchor above a bot's feet
const CONFIRM_MEDAL = { ref: 'kill_confirmed', name: 'Kill Confirmed', xp: 100, icon: 'hud_medals_cleanup.png' };
const DENY_MEDAL = { ref: 'retrieve_own_tags', name: 'Retrieved', xp: 50, icon: 'hud_medals_retrieval.png' };

const CSS = `
#mr-root { position: absolute; inset: 0; overflow: hidden; pointer-events: none; font: 700 12px/1 var(--fe-ui, system-ui, sans-serif); }
.mr-marker { position: absolute; left: 0; top: 0; display: none; flex-direction: column; align-items: center; gap: 2px; will-change: transform; }
.mr-marker b { color: #b8ffd0; letter-spacing: .14em; font-size: 11px; text-shadow: 0 1px 3px #000, 0 0 6px rgba(0,0,0,.8); }
.mr-marker i { width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-top: 12px solid #58e08a; filter: drop-shadow(0 1px 2px #000); }
.mr-pop { position: absolute; left: 50%; top: 36%; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 12px; padding: 8px 20px;
  background: rgba(3, 10, 14, .62); box-shadow: 0 2px 0 var(--c, #7fd0ff); color: #fff; letter-spacing: .22em; font-size: 20px; text-transform: uppercase;
  animation: mr-pop 1.5s cubic-bezier(.2, .9, .3, 1) forwards; }
.mr-pop img { width: 34px; height: 34px; object-fit: contain; filter: drop-shadow(0 0 6px var(--c, #7fd0ff)); }
.mr-pop small { font-size: 14px; color: var(--c, #7fd0ff); letter-spacing: .12em; }
.mr-pop.tier { top: 24%; font-size: 24px; }
@keyframes mr-pop { 0% { opacity: 0; transform: translate(-50%, -50%) scale(1.7); } 14% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  78% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -62%) scale(.96); } }
`;

const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

let ctx = null;
let root = null;
let kind = 'ffa';
let offs = [];
let markers = new Map(); // combatant id -> element
let visibleMarkers = 0;
let tags = [];
let tagSeq = 0;
let tagKit = null; // shared geometry/materials per team
let tagGroup = null;
let clock = 0;
let confirms = 0;
let denies = 0;
let ladderIndex = null;
let ladderPending = null;
let ladderRetryAt = 0;

const text = (value) => document.createTextNode(value);

function pop(label, { color = '#7fd0ff', icon = null, sub = null, tier = false } = {}) {
  if (!root) return;
  const element = document.createElement('div');
  element.className = `mr-pop${tier ? ' tier' : ''}`;
  element.style.setProperty('--c', color);
  if (icon) {
    const image = document.createElement('img');
    image.src = icon;
    image.alt = '';
    element.append(image);
  }
  element.append(text(label));
  if (sub) {
    const small = document.createElement('small');
    small.textContent = sub;
    element.append(small);
  }
  root.append(element);
  const remove = () => element.remove();
  element.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, 2500);
}

// ------------------------------------------------------------------ teams
// Splits `spawns` for a manifest map in two along the longest bounds axis; the
// half holding the player's start becomes the allies.
function splitSpawns(spawns, map) {
  const b = map.bounds;
  const axis = b && b.max[0] - b.min[0] < b.max[2] - b.min[2] ? 2 : 0;
  const sorted = [...spawns].sort((p, q) => p.position[axis] - q.position[axis]);
  const half = sorted.length >> 1;
  const low = sorted.slice(0, half);
  const high = sorted.slice(half);
  const start = map.playerStart?.position ?? map.fallbackSpawn;
  const mean = (list) => list.reduce((sum, s) => sum + s.position[axis], 0) / Math.max(1, list.length);
  const lowIsAllies = !start || Math.abs(mean(low) - start[axis]) <= Math.abs(mean(high) - start[axis]);
  return lowIsAllies ? { allies: low, axis: high } : { allies: high, axis: low };
}

function teamSpawnPlan(enemies, map) {
  const spawns = enemies.hints?.spawns ?? [];
  const by = (name) => spawns.filter((spawn) => spawn.classname === name);
  const allies = by('mp_tdm_spawn_allies_start');
  const axis = by('mp_tdm_spawn_axis_start');
  if (allies.length >= 4 && axis.length >= 4) {
    return { starts: { allies, axis }, pool: [...by('mp_tdm_spawn'), ...allies, ...axis] };
  }
  return { starts: splitSpawns(spawns, map), pool: spawns };
}

function setupTeams() {
  const { enemies, map, mode } = ctx;
  if (!enemies) return;
  const plan = teamSpawnPlan(enemies, map);
  if (plan.pool.length) {
    enemies.setTeamSpawns(plan);
    enemies.placeAtStarts((enemy) => mode.teamFor(enemy.index));
  }
  // The player starts with the allies on the allies' side of the map.
  const start = enemies.teamStarts?.allies?.[0];
  if (start && !map.playerStart && ctx.player.setSpawn) {
    ctx.player.setSpawn(start.position, { eye: false });
    ctx.player.respawn?.();
  }
}

function updateMarkers() {
  const { camera, combatants, THREE } = ctx;
  const team = combatants.teamOf('player');
  const vector = updateMarkers.vector ??= new THREE.Vector3();
  const width = window.innerWidth;
  const height = window.innerHeight;
  let shown = 0;
  for (const entry of combatants.all()) {
    if (entry.id === 'player' || !team || entry.team !== team) continue;
    let element = markers.get(entry.id);
    if (!element) {
      element = document.createElement('div');
      element.className = 'mr-marker';
      const name = document.createElement('b');
      name.textContent = entry.name;
      element.append(name, document.createElement('i'));
      root.append(element);
      markers.set(entry.id, element);
    }
    const feet = entry.feet();
    vector.set(feet.x, feet.y + MARKER_HEAD, feet.z).project(camera);
    const onScreen = !entry.dead() && vector.z < 1 && Math.abs(vector.x) < 1.05 && Math.abs(vector.y) < 1.05;
    element.style.display = onScreen ? 'flex' : 'none';
    if (!onScreen) continue;
    shown += 1;
    const x = (vector.x * 0.5 + 0.5) * width;
    const y = (-vector.y * 0.5 + 0.5) * height;
    element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
  visibleMarkers = shown;
}

// ------------------------------------------------------------------- tags
function buildTagKit() {
  const { THREE } = ctx;
  const texture = new THREE.TextureLoader().load('ui/hud/waypoint_dogtags.png');
  texture.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.BoxGeometry(11, 16, 1.4);
  const kit = { plate, perTeam: {} };
  for (const [team, hex] of Object.entries(TEAM_COLOR)) {
    kit.perTeam[team] = {
      plate: new THREE.MeshBasicMaterial({ color: hex, toneMapped: false, fog: false }),
      sprite: new THREE.SpriteMaterial({ map: texture, color: hex, depthTest: false, transparent: true, fog: false, toneMapped: false }),
    };
  }
  tagKit = kit;
  tagGroup = new THREE.Group();
  tagGroup.name = 'dog-tags';
  ctx.scene.add(tagGroup);
}

function dropTag(event) {
  const victim = ctx.combatants.get(event.victimId);
  if (!victim?.team || !tagKit) return;
  const { THREE } = ctx;
  const feet = victim.feet();
  const mats = tagKit.perTeam[victim.team];
  const mesh = new THREE.Group();
  const a = new THREE.Mesh(tagKit.plate, mats.plate);
  const b = new THREE.Mesh(tagKit.plate, mats.plate);
  b.position.set(3, -2, 1.6);
  const sprite = new THREE.Sprite(mats.sprite);
  sprite.scale.set(30, 30, 1);
  sprite.position.y = 26;
  sprite.renderOrder = 40;
  mesh.add(a, b, sprite);
  mesh.position.set(feet.x, feet.y + 16, feet.z);
  tagGroup.add(mesh);
  tags.push({ id: ++tagSeq, team: victim.team, victimId: victim.id, mesh, sprite, age: 0, baseY: feet.y + 16 });
}

function removeTag(tag) {
  tagGroup.remove(tag.mesh);
  tags = tags.filter((entry) => entry !== tag);
}

function collect(tag, collectorId) {
  const team = ctx.combatants.teamOf(collectorId);
  const isPlayer = collectorId === 'player';
  if (team && team !== tag.team) {
    if (!ctx.match.confirm?.(collectorId)) return;
    if (isPlayer) {
      confirms += 1;
      pop('Kill confirmed', { color: css(TEAM_COLOR[tag.team]), icon: 'ui/hud/waypoint_dogtags.png', sub: '+1' });
      ctx.showMedal(CONFIRM_MEDAL);
    }
  } else if (isPlayer) {
    denies += 1;
    pop('Tag retrieved', { color: css(TEAM_COLOR[tag.team]), icon: 'ui/hud/waypoint_dogtags.png', sub: 'denied' });
    ctx.showMedal(DENY_MEDAL);
  }
  removeTag(tag);
}

function updateTags(dt, frame) {
  clock += frame.simulationActive ? dt : 0;
  const { combatants } = ctx;
  for (const tag of tags) {
    if (frame.simulationActive) tag.age += dt;
    tag.mesh.rotation.y = clock * 2.6 + tag.id;
    tag.mesh.position.y = tag.baseY + Math.sin(clock * 3 + tag.id) * 2.5;
    const blink = tag.age > TAG_LIFE - 5 && Math.floor(tag.age * 5) % 2 === 0;
    tag.mesh.visible = !blink;
  }
  if (!frame.simulationActive) return;
  for (const tag of [...tags]) if (tag.age >= TAG_LIFE) removeTag(tag);

  const collectors = combatants.all().filter((entry) => !entry.dead());
  for (const tag of [...tags]) {
    const hit = collectors.find((entry) => {
      const feet = entry.feet();
      return Math.hypot(feet.x - tag.mesh.position.x, feet.z - tag.mesh.position.z) <= TAG_RADIUS &&
        Math.abs(feet.y - tag.baseY) < 90;
    });
    if (hit) collect(tag, hit.id);
  }

  // Idle bots walk to the nearest tag in range (patrol only; combat wins).
  for (const entry of collectors) {
    if (entry.kind !== 'bot' || !entry.actor.setDetour) continue;
    const feet = entry.feet();
    let best = null;
    let bestDistance = DETOUR_RANGE;
    for (const tag of tags) {
      const distance = Math.hypot(feet.x - tag.mesh.position.x, feet.z - tag.mesh.position.z);
      if (distance < bestDistance) { best = tag; bestDistance = distance; }
    }
    if (best) {
      if (entry.actor.detour?.tagId !== best.id) {
        const point = best.mesh.position.clone();
        point.y = best.baseY - 16;
        point.tagId = best.id;
        entry.actor.setDetour(point);
      }
    } else if (entry.actor.detour) entry.actor.setDetour(null);
  }
}

function clearTags() {
  for (const tag of [...tags]) removeTag(tag);
  for (const entry of ctx.combatants.all()) entry.actor?.setDetour?.(null);
  confirms = 0;
  denies = 0;
}

// -------------------------------------------------------------- gun game
function ladderWeapon() {
  return GUN_GAME_LADDER[ladderIndex];
}

function reconcileLadder() {
  const want = ladderWeapon();
  const have = ctx.weapons.loadout();
  if (ladderPending || (have.primary === want && !have.secondary) || performance.now() < ladderRetryAt) return;
  ladderPending = ctx.weapons.setLoadout({ primary: want, secondary: null })
    .then((ok) => { if (!ok) ladderRetryAt = performance.now() + 1000; })
    .catch(() => { ladderRetryAt = performance.now() + 1000; })
    .finally(() => { ladderPending = null; });
}

function tierUp(index) {
  ladderIndex = index;
  const def = ctx.weapons.definition(ladderWeapon());
  pop(`Tier ${index + 1} / ${GUN_GAME_LADDER.length}`, {
    color: index === GUN_GAME_LADDER.length - 1 ? '#ffd24a' : '#7fd0ff', sub: def?.name ?? ladderWeapon(), tier: true,
  });
  reconcileLadder();
}

function onKill(event) {
  if (kind === 'kc') dropTag(event);
  if (kind === 'gun' && event.killerId === 'player' && event.victimId !== 'player') {
    const next = ctx.match.tierOf('player');
    if (next > ladderIndex) tierUp(next);
  }
}

// ------------------------------------------------------------------ system
export const system = {
  name: 'modeRules',
  debug: {},
  init(context) {
    ctx = context;
    kind = ctx.mode.id;
    if (kind === 'ffa' || !['tdm', 'kc', 'gun'].includes(kind)) { kind = 'ffa'; return; }
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    root = document.createElement('div');
    root.id = 'mr-root';
    ctx.overlay.append(root);
    offs.push(ctx.bus.on(EVENTS.KILL, onKill));
    if (kind === 'gun') {
      ladderIndex = 0;
      ctx.weapons.load([...new Set(GUN_GAME_LADDER)]);
      reconcileLadder();
    } else {
      setupTeams();
      if (kind === 'kc') buildTagKit();
    }
  },
  update(dt, frame) {
    if (kind === 'ffa') return;
    if (kind === 'gun') { reconcileLadder(); return; }
    updateMarkers();
    if (kind === 'kc') updateTags(dt, frame);
  },
  onKey() { return false; },
  onTouchAction() { return false; },
  reset() {
    if (kind === 'kc') clearTags();
    if (kind === 'gun') { ladderIndex = 0; reconcileLadder(); }
  },
  getState() {
    return {
      modeId: kind,
      friendlyMarkers: visibleMarkers,
      tags: tags.map((tag) => ({
        id: tag.id, team: tag.team, victimId: tag.victimId, age: Math.round(tag.age * 10) / 10,
        position: [tag.mesh.position.x, tag.baseY - 16, tag.mesh.position.z].map(Math.round),
      })),
      confirms,
      denies,
      ladderIndex,
      ladderWeapon: ladderIndex === null ? null : ladderWeapon(),
    };
  },
};

export default system;
