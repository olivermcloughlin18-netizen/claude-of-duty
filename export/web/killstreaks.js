// Lane C: killstreaks. UAV (3), Hunter Killer (4), Care Package by Little Bird (5),
// Air Strike (7). System contract: PLAN.md 3.4. The pure helpers below import in
// plain Node (tests); all three.js work is delegated to killstreak-fx.js through
// ctx.THREE, and that module is loaded lazily in init().
import { EVENTS } from './game-events.js';
import { minimapCalibration, worldToMinimapUv } from './hud.js';

export const STREAKS = Object.freeze({
  uav: { id: 'uav', name: 'UAV', kills: 3, key: 'Digit3', label: '3', icon: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' fill='none' stroke='white' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M6 24 14 16'/%3E%3Cpath d='M9 8l7 7-4 4-7-7z' fill='white' fill-opacity='.35'/%3E%3Cpath d='M16 6a10 10 0 0 1 10 10M16 11a5 5 0 0 1 5 5'/%3E%3Ccircle cx='15' cy='17' r='1.6' fill='white'/%3E%3C/svg%3E" },
  hunter: { id: 'hunter', name: 'Hunter Killer', kills: 4, key: 'Digit4', label: '4', icon: 'ui/hud/compass_hk.png' },
  carepackage: { id: 'carepackage', name: 'Care Package', kills: 5, key: 'Digit5', label: '5', icon: 'ui/hud/compass_supply_drop_white.png' },
  airstrike: { id: 'airstrike', name: 'Air Strike', kills: 7, key: 'Digit6', label: '6', icon: 'ui/hud/hud_icon_air_airstrike.png' },
});
export const ORDER = Object.freeze(['uav', 'hunter', 'carepackage', 'airstrike']);
const ALIASES = { hk: 'hunter', drone: 'hunter', care: 'carepackage', crate: 'carepackage', air: 'airstrike', strike: 'airstrike' };
export const normalizeId = (id) => (STREAKS[id] ? id : ALIASES[id] ?? null);

export const TUNING = Object.freeze({
  uavSeconds: 30,
  hunter: { rise: 600, riseSpeed: 1100, speed: 900, radius: 180, damage: 150, timeout: 12, hit: 70 },
  care: { range: 1500, skyClear: 640, birdSpeed: 1300, birdStart: 2400, fall: 380, captureRadius: 60, captureSeconds: 1.5, life: 60, crushRadius: 90, crushDamage: 200 },
  air: { delay: 2, bombs: 5, spacing: 150, radius: 250, damage: 300, ceiling: 800, speed: 1500, gravity: 1900, approach: 4200 },
});

// ---------------------------------------------------------------- pure logic
export function streakForKills(count) {
  return ORDER.find((id) => STREAKS[id].kills === count) ?? null;
}

// UAV 40%, Hunter Killer 30%, Air Strike 15%, ammo 15%.
export function rollCrateReward(r) {
  if (r < 0.4) return 'uav';
  if (r < 0.7) return 'hunter';
  if (r < 0.85) return 'airstrike';
  return 'ammo';
}

// Impact centres of a bomb run: `count` points `spacing` apart centred on the target along `dir` (unit, xz).
export function stripPlan(target, dir, count = TUNING.air.bombs, spacing = TUNING.air.spacing) {
  return Array.from({ length: count }, (_, i) => {
    const offset = (i - (count - 1) / 2) * spacing;
    return { offset, x: target.x + dir.x * offset, z: target.z + dir.z * offset };
  });
}

// Inverse of worldToMinimapUv.
export function minimapUvToWorld(u, v, cal) {
  return { x: cal.centerX + ((v - 0.5) * cal.size) / cal.flipV, z: cal.centerZ + ((u - 0.5) * cal.size) / cal.flipU };
}

export class StreakTracker {
  constructor() { this.count = 0; this.held = []; }
  onKill() { this.count += 1; const id = streakForKills(this.count); if (id && !this.has(id)) { this.held.push(id); return id; } return null; }
  onDeath() { this.count = 0; } // held streaks survive death
  has(id) { return this.held.includes(id); }
  grant(id) { if (!STREAKS[id] || this.has(id)) return false; this.held.push(id); return true; }
  take(id) { const i = this.held.indexOf(id); if (i < 0) return false; this.held.splice(i, 1); return true; }
  latest() { return this.held[this.held.length - 1] ?? null; }
  reset() { this.count = 0; this.held = []; }
}

// ----------------------------------------------------------------- the system
const MEDAL_FALLBACK = {
  capture_enemy_crate: { ref: 'capture_enemy_crate', name: 'Hijacker', xp: 250, icon: 'hud_medals_hijacker.png' },
  kill_enemy_with_care_package_crush: { ref: 'kill_enemy_with_care_package_crush', name: 'Pancake', xp: 500, icon: 'hud_medals_pancake.png' },
  missile_drone_kill: { ref: 'missile_drone_kill', name: 'Bullseye', xp: 100, icon: 'hud_medals_drone.png' },
  strafe_run_kill: { ref: 'strafe_run_kill', name: 'Cropduster', xp: 100, icon: 'hud_medals_warthog.png' },
};
const CAUSE_MEDAL = { hunter: 'missile_drone_kill', airstrike: 'strafe_run_kill', crate: 'kill_enemy_with_care_package_crush' };

const CSS = `
#ks-column { position: fixed; right: 22px; bottom: 112px; z-index: 2; display: flex; flex-direction: column; gap: 5px; align-items: flex-end; pointer-events: none; opacity: 0; transition: opacity .2s ease-out; filter: drop-shadow(0 1px 3px rgba(0,0,0,.9)); }
body.locked #ks-column { opacity: 1; }
.ks-slot { position: relative; width: 168px; height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 8px; color: #8fa0a4; font: 600 12px/1.1 var(--fe-ui, system-ui); letter-spacing: .12em; text-transform: uppercase; background: url('ui/hud/hud_mp_vis_ks_dpad_box_back.png') center/100% 100% no-repeat; opacity: .55; transition: opacity .15s, transform .15s; }
.ks-slot::after { content: ''; position: absolute; inset: 0; background: url('ui/hud/hud_mp_vis_ks_dpad_box.png') center/100% 100% no-repeat; opacity: .7; }
.ks-slot.ready { opacity: 1; color: #fff; background-image: url('ui/hud/hud_mp_vis_ks_dpad_box_back_lit.png'); animation: ks-pulse 1.1s ease-in-out infinite; }
.ks-slot.active { opacity: 1; color: #7ff3ff; background-image: url('ui/hud/hud_mp_vis_ks_dpad_box_back_lit.png'); filter: hue-rotate(150deg); }
.ks-slot img { width: 26px; height: 26px; object-fit: contain; z-index: 1; }
.ks-slot .ks-key { position: absolute; left: -22px; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; border: 1px solid currentColor; border-radius: 3px; text-align: center; line-height: 17px; font-size: 11px; background: rgba(0,0,0,.45); }
.ks-slot .ks-text { z-index: 1; display: flex; flex-direction: column; gap: 3px; }
.ks-slot .ks-text small { font-size: 10px; opacity: .75; letter-spacing: .1em; }
#ks-progress { width: 168px; height: 4px; background: rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.25); }
#ks-progress i { display: block; height: 100%; width: 100%; transform-origin: left; transform: scaleX(0); background: linear-gradient(90deg, #7ff3ff, #fff); transition: transform .2s; }
@media (pointer: coarse) { #ks-column { right: auto; left: 14px; bottom: auto; top: 134px; flex-direction: row; align-items: center; } .ks-slot { width: 46px; padding: 0; justify-content: center; } .ks-slot:not(.ready):not(.active) { display: none; } .ks-text, .ks-key, #ks-progress { display: none; } #ks-uav-label { left: 136px; } }
@keyframes ks-pulse { 50% { transform: translateX(-4px); filter: brightness(1.25); } }
#ks-sweep { position: absolute; inset: -40%; pointer-events: none; background: conic-gradient(from 0deg, rgba(90,255,255,0) 0deg, rgba(90,255,255,.5) 38deg, rgba(90,255,255,0) 40deg); animation: ks-spin 1.6s linear infinite; mix-blend-mode: screen; }
@keyframes ks-spin { to { transform: rotate(360deg); } }
#ks-uav-label { position: fixed; top: 20px; left: 198px; z-index: 2; color: #7ff3ff; font: 700 11px/1 var(--fe-ui, system-ui); letter-spacing: .24em; text-shadow: 0 0 6px #0cc; pointer-events: none; }
#ks-target { position: fixed; inset: 0; z-index: 4; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 10px; background: radial-gradient(circle at 50% 45%, rgba(4,16,22,.88), rgba(0,4,6,.97)); pointer-events: auto; cursor: none; user-select: none; touch-action: none; }
#ks-target.open { display: flex; }
#ks-target .ks-title { color: #ff9b6a; font: 700 20px/1 var(--fe-ui, system-ui); letter-spacing: .4em; text-shadow: 0 0 12px rgba(255,120,60,.7); }
#ks-target .ks-sub { color: #9fb4b8; font: 600 12px/1 var(--fe-ui, system-ui); letter-spacing: .24em; }
#ks-panel { position: relative; border: 1px solid rgba(255,140,90,.7); box-shadow: 0 0 40px rgba(255,100,40,.25), inset 0 0 60px rgba(0,0,0,.6); background: #07161b center/100% 100% no-repeat; }
#ks-panel canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#ks-target .ks-buttons { display: flex; gap: 14px; }
#ks-target button { cursor: pointer; pointer-events: auto; padding: 8px 22px; color: #eaf6f8; background: rgba(10,30,36,.85); border: 1px solid rgba(160,220,230,.5); font: 700 12px/1 var(--fe-ui, system-ui); letter-spacing: .24em; }
#ks-target button.go { border-color: #ff9b6a; color: #ffd2bd; }
#ks-capture { position: fixed; left: 50%; top: 58%; transform: translateX(-50%); z-index: 3; display: none; flex-direction: column; align-items: center; gap: 8px; color: #fff; font: 700 13px/1 var(--fe-ui, system-ui); letter-spacing: .22em; text-shadow: 0 1px 4px #000; pointer-events: none; }
#ks-capture .ring { width: 74px; height: 74px; border-radius: 50%; background: conic-gradient(#ffd54a calc(var(--p, 0) * 1%), rgba(0,0,0,.45) 0); -webkit-mask: radial-gradient(circle, transparent 26px, #000 27px); mask: radial-gradient(circle, transparent 26px, #000 27px); }
`;

export const system = (() => {
  let ctx = null;
  let fx = null;
  let enabled = false;
  let loadError = null;
  const tracker = new StreakTracker();
  let medalDefs = {};
  const awarded = [];
  const state = {
    uav: 0, hunters: [], crates: [], birds: [], strike: null, markers: [], waves: [], targeting: null, lastUse: null, uavFx: null,
    nextId: 1, hunterKills: 0, strikeKills: 0, crateKills: 0, captured: 0, selfKills: 0, bombsFallen: 0,
  };
  let ui = null;
  let refusal = 'refused';

  const V3 = () => ctx.THREE.Vector3;
  const vec = (x = 0, y = 0, z = 0) => new (V3())(x, y, z);
  const isHostile = (id) => ctx.combatants.hostile('player', id);
  const player = () => ctx.camera.position;

  function ray(origin, dir, far) {
    const hit = ctx.collisionWorld.raycastFirst(new ctx.THREE.Ray(origin, dir), 0, far);
    return hit || null;
  }
  const worldTop = () => (ctx.map?.bounds?.max?.[1] ?? 900) + 200;
  function groundBelow(x, z, fromY = worldTop()) {
    const hit = ray(vec(x, fromY, z), vec(0, -1, 0), fromY + 3000);
    return hit ? hit.point : null;
  }

  // ---------------------------------------------------------------- HUD DOM
  function buildUi() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const column = document.createElement('div');
    column.id = 'ks-column';
    const slots = {};
    for (const id of ORDER) {
      const def = STREAKS[id];
      const slot = document.createElement('div');
      slot.className = 'ks-slot';
      slot.innerHTML = `<span class="ks-key">${def.label}</span><img alt="" src="${def.icon}"><span class="ks-text"><b>${def.name}</b><small></small></span>`;
      column.appendChild(slot);
      slots[id] = slot;
    }
    const bar = document.createElement('div');
    bar.id = 'ks-progress';
    bar.innerHTML = '<i></i>';
    column.appendChild(bar);
    ctx.overlay.appendChild(column);

    const target = document.createElement('div');
    target.id = 'ks-target';
    target.innerHTML = '<div class="ks-title">AIR STRIKE</div><div id="ks-panel"><canvas width="1024" height="1024"></canvas></div>' +
      '<div class="ks-sub">CLICK TO CALL IN THE STRIKE &middot; ESC TO CANCEL</div>' +
      '<div class="ks-buttons"><button class="go" type="button">CONFIRM</button><button class="no" type="button">CANCEL</button></div>';
    ctx.overlay.appendChild(target);

    const capture = document.createElement('div');
    capture.id = 'ks-capture';
    capture.innerHTML = '<div class="ring"></div><span>CAPTURING CARE PACKAGE</span>';
    ctx.overlay.appendChild(capture);

    const uavLabel = document.createElement('div');
    uavLabel.id = 'ks-uav-label';
    uavLabel.style.display = 'none';
    ctx.overlay.appendChild(uavLabel);

    ui = { column, slots, bar: bar.firstChild, target, panel: target.querySelector('#ks-panel'), canvas: target.querySelector('canvas'), capture, uavLabel, last: {} };
    target.querySelector('.go').addEventListener('click', () => confirmTarget());
    target.querySelector('.no').addEventListener('click', () => cancelTargeting('cancelled'));
    ui.canvas.addEventListener('pointerdown', (event) => {
      if (!state.targeting) return;
      if (!document.pointerLockElement) {
        const r = ui.canvas.getBoundingClientRect();
        state.targeting.cursor = { u: (event.clientX - r.left) / r.width, v: (event.clientY - r.top) / r.height };
      }
      if (event.pointerType === 'mouse') confirmTarget();
    });
  }

  function refreshHud() {
    const set = (key, apply, value) => { if (ui.last[key] !== value) { ui.last[key] = value; apply(value); } };
    set('touch', (v) => { const b = document.querySelector('[data-touch="streak"]'); if (b) b.hidden = !v; }, Boolean(tracker.latest()));
    const activeSecs = { uav: state.uav };
    for (const id of ORDER) {
      const slot = ui.slots[id];
      const held = tracker.has(id);
      const seconds = activeSecs[id] ?? 0;
      const need = Math.max(0, STREAKS[id].kills - tracker.count);
      const text = seconds > 0 ? `${Math.ceil(seconds)}s` : held ? 'Ready' : `${need} kill${need === 1 ? '' : 's'}`;
      set(`${id}.cls`, (v) => { slot.className = `ks-slot${v === 'ready' ? ' ready' : v === 'active' ? ' active' : ''}`; }, seconds > 0 ? 'active' : held ? 'ready' : '');
      set(`${id}.txt`, (v) => { slot.querySelector('small').textContent = v; }, text);
    }
    const next = ORDER.map((id) => STREAKS[id].kills).find((k) => k > tracker.count);
    const prev = [0, ...ORDER.map((id) => STREAKS[id].kills)].filter((k) => k <= tracker.count).pop();
    set('bar', (v) => { ui.bar.style.transform = `scaleX(${v / 100})`; }, next ? Math.round(((tracker.count - prev) / (next - prev)) * 100) : 100);
    set('uav', (v) => { ui.uavLabel.style.display = v ? 'block' : 'none'; if (v) ui.uavLabel.textContent = `UAV ONLINE  ${v}s`; }, state.uav > 0 ? Math.ceil(state.uav) : 0);
  }

  function setUavSweep(on) {
    const mm = document.getElementById('hud-minimap');
    if (!mm) return;
    const existing = mm.querySelector('#ks-sweep');
    if (on && !existing) { const s = document.createElement('div'); s.id = 'ks-sweep'; mm.appendChild(s); } else if (!on && existing) existing.remove();
  }

  // --------------------------------------------------------------- medals
  function award(ref) {
    const def = medalDefs[ref] ?? MEDAL_FALLBACK[ref];
    if (!def) return;
    awarded.push(ref);
    ctx.showMedal({ ...MEDAL_FALLBACK[ref], ...def, icon: def.icon ?? MEDAL_FALLBACK[ref]?.icon });
  }

  // ---------------------------------------------------------------- earning
  function earned(id) {
    ctx.bus.emit(EVENTS.STREAK, { id, ownerId: 'player', phase: 'earned' });
    ctx.notify(`${STREAKS[id].name.toUpperCase()} READY  [${STREAKS[id].label}]`, { icon: STREAKS[id].icon, seconds: 3 });
    fx?.audio.ping();
  }
  function onKill(event) {
    if (!enabled) return;
    if (event.victimId === 'player') { tracker.onDeath(); return; }
    if (event.killerId !== 'player') return;
    const medal = CAUSE_MEDAL[event.cause];
    if (medal) {
      award(medal);
      if (event.cause === 'hunter') state.hunterKills += 1;
      if (event.cause === 'airstrike') state.strikeKills += 1;
      if (event.cause === 'crate') state.crateKills += 1;
      return;
    }
    if ((event.cause !== 'bullet' && event.cause !== 'melee') || !isHostile(event.victimId)) return;
    const id = tracker.onKill();
    if (id) earned(id);
  }

  // ----------------------------------------------------------------- use
  function use(rawId, at = null) {
    const id = normalizeId(rawId);
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (!id) return { ok: false, reason: 'unknown streak' };
    if (!tracker.has(id)) return { ok: false, reason: 'not held' };
    if (state.targeting || !fx) return { ok: false, reason: 'busy' };
    fx.audio.resume();
    refusal = 'refused';
    let ok = false;
    if (id === 'uav') ok = useUav();
    else if (id === 'hunter') ok = useHunter();
    else if (id === 'carepackage') ok = useCare(at);
    else ok = at ? startStrike(vec(at[0], at[1] ?? 0, at[2]), null) !== null : openTargeting();
    if (!ok) return { ok: false, reason: refusal };
    tracker.take(id);
    state.lastUse = id;
    ctx.bus.emit(EVENTS.STREAK, { id, ownerId: 'player', phase: 'activated' });
    return { ok: true, id };
  }

  function useUav() {
    state.uav = TUNING.uavSeconds;
    setUavSweep(true);
    state.waves.push(fx.scanWave(player().clone()));
    ctx.notify('UAV ONLINE', { icon: STREAKS.uav.icon });
    return true;
  }
  function endUav() { setUavSweep(false); ctx.bus.emit(EVENTS.STREAK, { id: 'uav', ownerId: 'player', phase: 'ended' }); }

  // ---------------------------------------------------------- hunter killer
  function nearestHostile(from) {
    let best = null;
    let bestD = Infinity;
    for (const entry of ctx.combatants.all()) {
      if (entry.id === 'player' || entry.dead() || !isHostile(entry.id)) continue;
      const p = entry.position();
      const d = Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z);
      if (d < bestD) { bestD = d; best = entry; }
    }
    return best;
  }
  function useHunter() {
    const forward = vec(0, 0, -1).applyQuaternion(ctx.camera.quaternion);
    const start = player().clone().addScaledVector(forward, 70);
    start.y -= 15;
    const model = fx.buildHunter();
    model.scale.setScalar(1.6);
    model.position.copy(start);
    fx.root.add(model);
    state.hunters.push({
      id: state.nextId++, model, pos: start, dir: vec(0, 1, 0), phase: 'rise', startY: start.y, age: 0, targetId: null, trail: 0,
      audio: fx.audio.whine(),
    });
    ctx.notify('HUNTER KILLER LAUNCHED', { icon: STREAKS.hunter.icon });
    fx.audio.radioBeep();
    return true;
  }
  function explodeHunter(h, why) {
    const c = TUNING.hunter;
    fx.explosion(h.pos.clone(), { scale: 0.85, detail: 0.7, power: 0.8 });
    ctx.combatants.radiusDamage(h.pos, c.radius, c.damage, { attackerId: 'player', weaponId: 'hunter', cause: 'hunter', region: null });
    h.audio?.stop();
    fx.root.remove(h.model);
    h.done = why;
  }
  function stepHunters(dt) {
    const c = TUNING.hunter;
    for (const h of state.hunters) {
      h.age += dt;
      if (h.age > c.timeout) { explodeHunter(h, 'timeout'); continue; }
      let next;
      if (h.phase === 'rise') {
        next = h.pos.clone().addScaledVector(h.dir, c.riseSpeed * dt);
        if (next.y - h.startY >= c.rise) h.phase = 'hunt';
      } else {
        let target = h.targetId ? ctx.combatants.get(h.targetId) : null;
        if (!target || target.dead()) { target = nearestHostile(h.pos); h.targetId = target?.id ?? null; }
        if (!target) { explodeHunter(h, 'no target'); continue; }
        const tp = target.position();
        const desired = vec(tp.x, tp.y, tp.z).sub(h.pos);
        const dist = desired.length();
        h.dir.lerp(desired.normalize(), 1 - Math.exp(-7 * dt)).normalize();
        if (dist < c.hit) { explodeHunter(h, 'hit'); continue; }
        next = h.pos.clone().addScaledVector(h.dir, Math.min(dist, c.speed * dt));
      }
      const step = next.clone().sub(h.pos);
      const stepLen = step.length();
      const wall = stepLen > 1e-3 ? ray(h.pos, step.clone().normalize(), stepLen + 20) : null;
      if (wall) { h.pos.copy(wall.point); explodeHunter(h, 'wall'); continue; }
      h.pos.copy(next);
      h.model.position.copy(h.pos);
      h.model.lookAt(h.pos.clone().add(h.dir));
      h.model.userData.flame.scale.set(1, 0.7 + Math.random() * 0.6, 1);
      h.model.userData.light.material.opacity = 0.6 + 0.4 * Math.sin(h.age * 18);
      h.trail += dt;
      while (h.trail > 0.02) {
        h.trail -= 0.02;
        const back = h.pos.clone().addScaledVector(h.dir, -90);
        fx.emit({ pos: back, vel: h.dir.clone().multiplyScalar(-60), life: 0.35, size0: 38, size1: 12, c0: 0xffc060, c1: 0xff4010, a0: 0.9, additive: true, drag: 3 });
        fx.emit({ pos: back, vel: vec(Math.random() * 20 - 10, 8, Math.random() * 20 - 10), life: 1.6, size0: 22, size1: 90, c0: 0xdddddd, c1: 0x888888, a0: 0.45, drag: 1 });
      }
      h.audio?.update(h.pos.distanceTo(player()), h.phase === 'hunt' ? 1 : 0.4);
    }
    state.hunters = state.hunters.filter((h) => !h.done);
  }

  // ------------------------------------------------------------ care package
  function useCare(at) {
    const c = TUNING.care;
    let point;
    if (at) point = vec(at[0], at[1], at[2]);
    else {
      const dir = vec(0, 0, -1).applyQuaternion(ctx.camera.quaternion);
      const hit = ray(player().clone(), dir, c.range);
      if (!hit) { refusal = 'no target in range'; ctx.notify('CARE PACKAGE: NO TARGET IN RANGE', { seconds: 2 }); return false; }
      if (Math.abs(hit.face?.normal?.y ?? 1) < 0.5) { // |y|: collision triangles may wind either way
         refusal = 'needs flat ground'; ctx.notify('CARE PACKAGE: NEEDS FLAT GROUND', { seconds: 2 }); return false; }
      point = hit.point.clone();
    }
    if (ray(point.clone().add(vec(0, 8, 0)), vec(0, 1, 0), c.skyClear)) {
      refusal = 'needs clear sky';
      ctx.notify('CARE PACKAGE NEEDS CLEAR SKY', { seconds: 2.2 });
      return false;
    }
    const marker = fx.smokeMarker(point, { color: 0xff3b30, seconds: 9 });
    state.markers.push(marker);
    const f = vec(0, 0, -1).applyQuaternion(ctx.camera.quaternion).setY(0).normalize();
    // starts ahead-left of the drop and crosses the view
    const heading = vec(-f.z, 0, f.x).addScaledVector(f, -0.35).normalize();
    const alt = point.y + c.skyClear;
    const bird = { id: state.nextId++, target: point, heading, alt, pos: point.clone().addScaledVector(heading, -c.birdStart), age: 0, dropped: false, model: null, audio: fx.audio.rotor() };
    bird.pos.y = alt;
    state.birds.push(bird);
    fx.loadBird().then((make) => {
      bird.model = make ? make() : fallbackBird();
      fx.root.add(bird.model);
    });
    fx.audio.radioBeep();
    ctx.notify('CARE PACKAGE INBOUND', { icon: STREAKS.carepackage.icon });
    return true;
  }
  function fallbackBird() {
    const g = new ctx.THREE.Group();
    const m = new ctx.THREE.Mesh(new ctx.THREE.CapsuleGeometry(30, 160, 4, 10), new ctx.THREE.MeshStandardMaterial({ color: 0x222831 }));
    m.rotation.z = Math.PI / 2;
    g.add(m);
    g.userData.rotors = [];
    return g;
  }
  function dropCrate(bird) {
    const model = fx.buildCrate();
    const pos = bird.pos.clone();
    pos.y -= 40;
    model.position.copy(pos);
    fx.root.add(model);
    const crate = {
      id: state.nextId++, model, pos, vy: 0, state: 'falling', age: 0, landedAt: 0, progress: 0, ground: bird.target.clone(),
      marker: null, reward: null, dropBirdAge: bird.age, startX: pos.x, startY: pos.y, startZ: pos.z,
    };
    state.crates.push(crate);
    fx.audio.whistle(pos, 1.2);
    return crate;
  }
  function landCrate(crate) {
    const c = TUNING.care;
    crate.state = 'landed';
    crate.landedAt = crate.age;
    crate.landedAfter = Math.round((crate.dropBirdAge + crate.age) * 100) / 100;
    crate.pos.copy(crate.ground);
    crate.model.position.copy(crate.ground);
    fx.audio.thud(crate.pos);
    fx.shake(0.25);
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * Math.PI * 2;
      fx.emit({ pos: crate.pos.clone().add(vec(0, 10, 0)), vel: vec(Math.cos(a) * 260, 40, Math.sin(a) * 260), life: 1.3, size0: 60, size1: 190, c0: 0x9a8f7c, c1: 0x6e665a, a0: 0.55, drag: 2.5 });
    }
    ctx.combatants.radiusDamage(crate.pos, c.crushRadius, c.crushDamage, { attackerId: 'player', weaponId: 'crate', cause: 'crate', region: null });
    crate.marker = fx.smokeMarker(crate.pos, { color: 0x5dff7a, seconds: c.life });
    crate.chuteLife = 1.2;
    crate.model.userData.chute.visible = true;
  }
  function removeCrate(crate) {
    fx.root.remove(crate.model);
    crate.marker?.dispose();
    crate.done = true;
  }
  function giveReward(reward) {
    if (reward === 'ammo') {
      if (ctx.refillAmmo) ctx.refillAmmo();
      else { const w = globalThis.hijacked?.weapon; w?.resetLoadout?.({ reserveAmmo: w.startingReserveAmmo }); }
      ctx.notify('AMMO RESUPPLIED', { icon: 'ui/hud/hud_mp_ks_arrow.png' });
    } else if (tracker.grant(reward)) earned(reward);
    else { giveReward('ammo'); }
  }
  function stepCare(dt) {
    const c = TUNING.care;
    for (const b of state.birds) {
      b.age += dt;
      b.pos.addScaledVector(b.heading, c.birdSpeed * dt);
      const toTarget = b.target.clone().sub(b.pos);
      if (!b.dropped && toTarget.x * b.heading.x + toTarget.z * b.heading.z <= 0) { b.dropped = true; dropCrate(b); }
      if (b.model) {
        b.model.position.copy(b.pos);
        b.model.rotation.set(0, Math.atan2(-b.heading.z, b.heading.x), -0.09 + Math.sin(b.age * 2) * 0.02, 'YXZ');
        for (const rotor of b.model.userData.rotors) rotor.rotation.y += 70 * dt;
      }
      b.audio?.update(b.pos.distanceTo(player()));
      if (b.dropped && b.age > 9) { b.audio?.stop(); if (b.model) fx.root.remove(b.model); b.done = true; }
    }
    state.birds = state.birds.filter((b) => !b.done);

    const near = { crate: null };
    for (const crate of state.crates) {
      crate.age += dt;
      if (crate.state === 'falling') {
        crate.vy = Math.min(c.fall, crate.vy + 900 * dt);
        crate.pos.y -= crate.vy * dt;
        const f = Math.min(1, Math.max(0, (crate.startY - crate.pos.y) / Math.max(1, crate.startY - crate.ground.y)));
        crate.pos.x = crate.startX + (crate.ground.x - crate.startX) * f;
        crate.pos.z = crate.startZ + (crate.ground.z - crate.startZ) * f;
        crate.model.position.copy(crate.pos);
        crate.model.rotation.z = Math.sin(crate.age * 2.4) * 0.07;
        crate.model.rotation.x = Math.cos(crate.age * 1.9) * 0.05;
        if (crate.pos.y <= crate.ground.y + 2) { crate.model.rotation.set(0, 0, 0); landCrate(crate); }
      } else {
        const chute = crate.model.userData.chute;
        if (crate.chuteLife > 0) {
          crate.chuteLife -= dt;
          chute.position.y -= 40 * dt;
          chute.scale.y = Math.max(0.05, crate.chuteLife / 1.2);
          if (crate.chuteLife <= 0) chute.visible = false;
        }
        crate.marker?.update(dt);
        const p = player();
        const d = Math.hypot(p.x - crate.pos.x, p.z - crate.pos.z);
        const reach = d < c.captureRadius && Math.abs(p.y - crate.pos.y) < 140 && !ctx.playerHealth?.dead;
        crate.progress = reach ? crate.progress + dt / c.captureSeconds : Math.max(0, crate.progress - dt * 2);
        if (reach) near.crate = crate;
        if (crate.progress >= 1) {
          crate.reward = rollCrateReward(Math.random());
          state.captured += 1;
          fx.audio.capture();
          award('capture_enemy_crate');
          giveReward(crate.reward);
          removeCrate(crate);
        } else if (crate.age - crate.landedAt > c.life) removeCrate(crate);
      }
    }
    state.crates = state.crates.filter((c2) => !c2.done);
    if (near.crate) {
      ui.capture.style.display = 'flex';
      ui.capture.querySelector('.ring').style.setProperty('--p', String(Math.round(Math.min(1, near.crate.progress) * 100)));
    } else ui.capture.style.display = 'none';
  }

  // --------------------------------------------------------------- air strike
  function targetingCal() { return minimapCalibration(ctx.map); }
  function openTargeting() {
    if (!ctx.captureInput('killstreaks')) return false;
    const cal = targetingCal();
    const size = Math.floor(Math.min(innerWidth - 40, innerHeight - 150));
    ui.panel.style.width = ui.panel.style.height = `${Math.max(240, size)}px`;
    ui.panel.style.backgroundImage = cal.image ? `url('${cal.image}')` : 'none';
    const p = player();
    const uv = worldToMinimapUv(p.x, p.z, cal);
    state.targeting = { cal, cursor: { u: Math.min(0.95, Math.max(0.05, uv.u)), v: Math.min(0.95, Math.max(0.05, uv.v)) }, openedAt: performance.now() };
    ui.target.classList.add('open');
    document.getElementById('system-notice')?.classList.remove('show'); // the READY toast would sit on the map
    document.addEventListener('mousemove', onTargetMove, true);
    document.addEventListener('keydown', onTargetKey, true);
    fx.audio.radioBeep();
    drawTargeting();
    return true;
  }
  function closeTargeting() {
    state.targeting = null;
    ui.target.classList.remove('open');
    document.removeEventListener('mousemove', onTargetMove, true);
    document.removeEventListener('keydown', onTargetKey, true);
    ctx.captureInput(null);
  }
  function cancelTargeting(reason) {
    if (!state.targeting) return;
    closeTargeting();
    tracker.grant('airstrike'); // refund
    ctx.notify(reason === 'cancelled' ? 'AIR STRIKE CANCELLED' : 'AIR STRIKE REFUNDED', { seconds: 1.5 });
  }
  function onTargetMove(event) {
    const t = state.targeting;
    if (!t) return;
    const r = ui.canvas.getBoundingClientRect();
    if (document.pointerLockElement) {
      t.cursor.u = Math.min(1, Math.max(0, t.cursor.u + event.movementX / r.width));
      t.cursor.v = Math.min(1, Math.max(0, t.cursor.v + event.movementY / r.height));
    } else {
      t.cursor.u = Math.min(1, Math.max(0, (event.clientX - r.left) / r.width));
      t.cursor.v = Math.min(1, Math.max(0, (event.clientY - r.top) / r.height));
    }
  }
  function onTargetKey(event) {
    if (event.code === 'Escape') { event.stopPropagation(); cancelTargeting('cancelled'); } else if (event.code === 'Enter') { event.stopPropagation(); confirmTarget(); }
  }
  function strikeGeometry(cursor, cal) {
    const world = minimapUvToWorld(cursor.u, cursor.v, cal);
    const p = player();
    const dir = vec(world.x - p.x, 0, world.z - p.z);
    if (dir.length() < 200) dir.copy(vec(0, 0, -1).applyQuaternion(ctx.camera.quaternion)).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    return { world, dir: dir.normalize() };
  }
  function confirmTarget() {
    const t = state.targeting;
    if (!t) return;
    const { world, dir } = strikeGeometry(t.cursor, t.cal);
    closeTargeting();
    const ground = groundBelow(world.x, world.z);
    startStrike(vec(world.x, ground?.y ?? p0().y, world.z), dir);
    state.lastUse = 'airstrike';
  }
  const p0 = () => player();

  function drawTargeting() {
    const t = state.targeting;
    if (!t) return;
    const canvas = ui.canvas;
    const g = canvas.getContext('2d');
    const W = canvas.width;
    g.clearRect(0, 0, W, W);
    const toPx = (x, z) => { const uv = worldToMinimapUv(x, z, t.cal); return [uv.u * W, uv.v * W]; };
    const scale = W / t.cal.size;
    if (!t.cal.image) { // bounds-panel fallback: dark chart with grid and bounds box
      g.fillStyle = '#0b1a20'; g.fillRect(0, 0, W, W);
    }
    g.strokeStyle = 'rgba(120,230,255,.13)'; g.lineWidth = 1;
    for (let i = 1; i < 16; i += 1) { g.beginPath(); g.moveTo((i / 16) * W, 0); g.lineTo((i / 16) * W, W); g.moveTo(0, (i / 16) * W); g.lineTo(W, (i / 16) * W); g.stroke(); }
    const b = ctx.map?.bounds;
    if (b) {
      const [x0, y0] = toPx(b.min[0], b.min[2]);
      const [x1, y1] = toPx(b.max[0], b.max[2]);
      g.strokeStyle = 'rgba(255,170,110,.55)'; g.setLineDash([14, 10]); g.lineWidth = 2;
      g.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      g.setLineDash([]);
    }
    if (system.radarActive) {
      for (const entry of ctx.combatants.all()) {
        if (entry.id === 'player' || entry.dead() || !isHostile(entry.id)) continue;
        const q = entry.position();
        const [x, y] = toPx(q.x, q.z);
        g.fillStyle = '#ff4a3a'; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill();
        g.strokeStyle = 'rgba(255,74,58,.5)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 18, 0, 7); g.stroke();
      }
    }
    const p = player();
    const [px, py] = toPx(p.x, p.z);
    g.save(); g.translate(px, py);
    const fwd = vec(0, 0, -1).applyQuaternion(ctx.camera.quaternion);
    const a = Math.atan2(worldToMinimapUv(p.x + fwd.x * 100, p.z + fwd.z * 100, t.cal).v - worldToMinimapUv(p.x, p.z, t.cal).v,
      worldToMinimapUv(p.x + fwd.x * 100, p.z + fwd.z * 100, t.cal).u - worldToMinimapUv(p.x, p.z, t.cal).u);
    g.rotate(a);
    g.fillStyle = '#9fffd0'; g.beginPath(); g.moveTo(22, 0); g.lineTo(-14, -13); g.lineTo(-7, 0); g.lineTo(-14, 13); g.closePath(); g.fill();
    g.restore();
    // strike preview
    const { world, dir } = strikeGeometry(t.cursor, t.cal);
    const plan = stripPlan(world, dir);
    const pulse = 0.5 + 0.5 * Math.sin((performance.now() - t.openedAt) / 160);
    const [ax, ay] = toPx(plan[0].x - dir.x * 420, plan[0].z - dir.z * 420);
    const [bx, by] = toPx(plan[plan.length - 1].x + dir.x * 420, plan[plan.length - 1].z + dir.z * 420);
    g.strokeStyle = 'rgba(255,120,70,.7)'; g.lineWidth = 3; g.setLineDash([18, 10]);
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
    const ang = Math.atan2(by - ay, bx - ax);
    g.fillStyle = 'rgba(255,120,70,.9)'; g.save(); g.translate(bx, by); g.rotate(ang);
    g.beginPath(); g.moveTo(16, 0); g.lineTo(-10, -12); g.lineTo(-10, 12); g.closePath(); g.fill(); g.restore();
    for (const pt of plan) {
      const [x, y] = toPx(pt.x, pt.z);
      const r = TUNING.air.radius * scale;
      g.fillStyle = `rgba(255,70,40,${0.1 + pulse * 0.08})`; g.strokeStyle = 'rgba(255,100,60,.85)'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
    }
    const [cx, cy] = toPx(world.x, world.z);
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, 20 + pulse * 4, 0, 7); g.moveTo(cx - 40, cy); g.lineTo(cx - 10, cy); g.moveTo(cx + 10, cy); g.lineTo(cx + 40, cy);
    g.moveTo(cx, cy - 40); g.lineTo(cx, cy - 10); g.moveTo(cx, cy + 10); g.lineTo(cx, cy + 40); g.stroke();
  }

  function startStrike(target, dirIn) {
    const a = TUNING.air;
    const dir = dirIn ?? (() => { const d = vec(0, 0, -1).applyQuaternion(ctx.camera.quaternion).setY(0); return d.lengthSq() ? d.normalize() : vec(1, 0, 0); })();
    const alt = target.y + 620; // visual only: it may pass through decks, bombs fall by raycast
    const plan = stripPlan(target, dir).map((point) => {
      const g = groundBelow(point.x, point.z);
      const gy = g ? g.y : target.y;
      const fall = Math.sqrt((2 * Math.max(60, alt - gy)) / a.gravity);
      return { ...point, gy, fall, releaseAt: point.offset - a.speed * fall, released: false };
    });
    const jet = fx.buildJet();
    jet.scale.setScalar(1.5);
    jet.visible = false;
    fx.root.add(jet);
    state.strike = {
      target, dir, alt, plan, jet, phase: 'inbound', timer: a.delay, s: -a.approach, bombs: [], exploded: 0, dropped: 0, trail: 0,
      audio: null, kills: 0,
    };
    ctx.notify('AIR STRIKE INBOUND', { icon: STREAKS.airstrike.icon, seconds: a.delay + 1 });
    fx.audio.radioBeep();
    return state.strike;
  }
  function exposed(entry) {
    const q = entry.position();
    return !ray(vec(q.x, q.y + 10, q.z), vec(0, 1, 0), TUNING.air.ceiling);
  }
  function detonate(pos, index) {
    const a = TUNING.air;
    fx.explosion(pos.clone(), { scale: 1.15, detail: 0.75, power: 1.1, sound: true });
    ctx.combatants.radiusDamage(pos, a.radius, a.damage, { attackerId: 'player', weaponId: 'airstrike', cause: 'airstrike', region: null }, exposed);
    state.strike.exploded += 1;
  }
  function stepStrike(dt) {
    const a = TUNING.air;
    const s = state.strike;
    if (!s) return;
    const jet = s.jet;
    if (s.phase === 'inbound') {
      s.timer -= dt;
      if (s.timer <= 0) {
        s.phase = 'run';
        jet.visible = true;
        s.audio = fx.audio.jet();
      }
    }
    if (s.phase === 'run') {
      s.s += a.speed * dt;
      const pos = vec(s.target.x + s.dir.x * s.s, s.alt + Math.sin(s.s * 0.004) * 12, s.target.z + s.dir.z * s.s);
      jet.position.copy(pos);
      jet.lookAt(pos.clone().add(vec(s.dir.x, 0, s.dir.z)));
      jet.rotation.z += Math.sin(s.s * 0.003) * 0.06;
      for (const f of jet.userData.flames) f.scale.set(1, 0.8 + Math.random() * 0.5, 1);
      jet.userData.nav.forEach((n, i) => { n.material.opacity = Math.sin(performance.now() / (200 + i * 90)) > 0 ? 1 : 0.15; });
      s.trail += dt;
      while (s.trail > 0.018) {
        s.trail -= 0.018;
        for (const side of [-1, 1]) {
          const tailPos = pos.clone().addScaledVector(s.dir, -250).add(vec(-s.dir.z * side * 15, 0, s.dir.x * side * 15));
          fx.emit({ pos: tailPos, vel: s.dir.clone().multiplyScalar(-120), life: 0.22, size0: 55, size1: 18, c0: 0xffd08a, c1: 0xff5a14, a0: 0.95, additive: true, drag: 4 });
          fx.emit({ pos: tailPos, vel: vec(0, 4, 0), life: 3.2, size0: 40, size1: 180, c0: 0xffffff, c1: 0xcfd8e0, a0: 0.22, drag: 0.6 });
          const wing = pos.clone().add(vec(-s.dir.z * side * 205, -6, s.dir.x * side * 205)).addScaledVector(s.dir, -105);
          fx.emit({ pos: wing, vel: vec(0, 0, 0), life: 2.6, size0: 16, size1: 90, c0: 0xffffff, c1: 0xe8eef2, a0: 0.2, drag: 0.5 });
        }
      }
      const cam = player();
      s.audio?.update(pos.distanceTo(cam), (pos.clone().sub(cam).dot(s.dir) < 0 ? 1 : -1) * a.speed);
      if (pos.distanceTo(cam) < 1400) fx.shake(dt * 1.2);
      for (const b of s.plan) {
        if (b.released || s.s < b.releaseAt) continue;
        b.released = true;
        s.dropped += 1;
        const bomb = fx.buildHunter();
        bomb.scale.setScalar(0.8);
        fx.root.add(bomb);
        const start = pos.clone().add(vec(0, -25, 0));
        s.bombs.push({ pos: start, vel: s.dir.clone().multiplyScalar(a.speed).setY(0), model: bomb, plan: b });
        fx.audio.whistle(vec(b.x, b.gy, b.z), b.fall);
      }
      if (s.s > a.approach + 600) { jet.visible = false; fx.root.remove(jet); s.audio?.stop(); s.phase = 'bombs'; }
    }
    for (const bomb of s.bombs) {
      bomb.vel.y -= a.gravity * dt;
      const step = bomb.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const hit = ray(bomb.pos, step.clone().normalize(), len + 2);
      if (hit || bomb.pos.y + step.y <= bomb.plan.gy - 50) {
        const at = hit ? hit.point.clone() : vec(bomb.pos.x + step.x, bomb.plan.gy, bomb.pos.z + step.z);
        fx.root.remove(bomb.model);
        bomb.done = true;
        state.bombsFallen += 1;
        detonate(at, s.exploded);
        continue;
      }
      bomb.pos.add(step);
      bomb.model.position.copy(bomb.pos);
      bomb.model.lookAt(bomb.pos.clone().add(bomb.vel));
      bomb.model.userData.flame.visible = false;
      bomb.model.userData.light.visible = false;
    }
    s.bombs = s.bombs.filter((bomb) => !bomb.done);
    if (s.phase !== 'inbound' && s.plan.every((b) => b.released) && !s.bombs.length) {
      if (!s.endedAt) s.endedAt = 0;
      s.endedAt += dt;
      if (s.endedAt > 1.2) { state.strike = null; ctx.bus.emit(EVENTS.STREAK, { id: 'airstrike', ownerId: 'player', phase: 'ended' }); }
    }
  }

  // ------------------------------------------------------------------ system
  const debug = {
    grantStreak(rawId) {
      const id = normalizeId(rawId);
      if (!enabled || !id) return { ok: false, reason: enabled ? 'unknown streak' : 'disabled' };
      const added = tracker.grant(id);
      if (added) earned(id);
      return { ok: true, id, added, held: [...tracker.held] };
    },
    useStreak(rawId, at = null) { return use(rawId, at); },
  };

  return {
    name: 'killstreaks',
    debug,
    get radarActive() { return state.uav > 0; },
    init(context) {
      ctx = context;
      enabled = Boolean(ctx.mode?.killstreaks) && !ctx.config?.online;
      if (!enabled) return;
      buildUi();
      ctx.bus.on(EVENTS.KILL, onKill);
      fetch('ui/medals/medals.json').then((r) => r.json()).then((list) => { medalDefs = Object.fromEntries(list.map((m) => [m.ref, m])); }).catch(() => {});
      import('./killstreak-fx.js').then((mod) => { fx = mod.createFx(ctx); }).catch((error) => { loadError = String(error); console.error('[killstreaks] fx failed', error); });
    },
    update(dt, frame) {
      if (!enabled || !fx) return;
      fx.beginCamera();
      if (!frame.simulationActive) { if (state.targeting) cancelTargeting('refunded'); return; }
      if (state.targeting) {
        if (ctx.playerHealth?.dead) cancelTargeting('refunded'); else drawTargeting();
      }
      if (state.uav > 0) { state.uav -= dt; if (state.uav <= 0) { state.uav = 0; endUav(); } }
      for (const w of state.waves) { if (!w.update(dt)) { w.dispose(); w.done = true; } }
      state.waves = state.waves.filter((w) => !w.done);
      state.markers = state.markers.filter((m) => { if (m.update(dt)) return true; m.dispose(); return false; });
      stepHunters(dt);
      stepCare(dt);
      stepStrike(dt);
      fx.update(dt);
      refreshHud();
      fx.endCamera(dt);
    },
    onKey(code) {
      if (!enabled) return false;
      const id = ORDER.find((k) => STREAKS[k].key === code);
      if (!id || !tracker.has(id)) return false;
      return use(id).ok;
    },
    onTouchAction(action) {
      if (!enabled || action !== 'streak') return false;
      const id = tracker.latest();
      return id ? use(id).ok : false;
    },
    reset() {
      if (!enabled) return;
      if (state.targeting) closeTargeting();
      tracker.reset();
      if (state.uav > 0) endUav();
      state.uav = 0;
      for (const h of state.hunters) { h.audio?.stop(); fx?.root.remove(h.model); }
      for (const b of state.birds) { b.audio?.stop(); if (b.model) fx?.root.remove(b.model); }
      for (const c of state.crates) removeCrate(c);
      if (state.strike) { state.strike.audio?.stop(); fx?.root.remove(state.strike.jet); for (const b of state.strike.bombs) fx?.root.remove(b.model); }
      for (const m of state.markers) m.dispose();
      for (const w of state.waves) w.dispose();
      Object.assign(state, { hunters: [], crates: [], birds: [], strike: null, markers: [], waves: [], hunterKills: 0, strikeKills: 0, crateKills: 0, captured: 0, bombsFallen: 0 });
      if (ui) ui.capture.style.display = 'none';
      refreshHud();
    },
    getState() {
      const r = (n) => Math.round(n);
      return {
        enabled,
        fxReady: Boolean(fx),
        loadError,
        streak: tracker.count,
        ready: [...tracker.held],
        active: [
          ...(state.uav > 0 ? [{ id: 'uav', seconds: Math.round(state.uav * 10) / 10 }] : []),
          ...state.hunters.map((h) => ({ id: 'hunter', seconds: Math.round((TUNING.hunter.timeout - h.age) * 10) / 10 })),
          ...(state.strike ? [{ id: 'airstrike', seconds: 0 }] : []),
        ],
        radarActive: state.uav > 0,
        targeting: Boolean(state.targeting),
        crates: state.crates.map((c) => ({ id: c.id, state: c.state, landedAfter: c.landedAfter ?? null, age: Math.round(c.age * 100) / 100, x: r(c.pos.x), y: r(c.pos.y), z: r(c.pos.z), progress: Math.round(c.progress * 100) / 100 })),
        birds: state.birds.map((b) => ({ id: b.id, x: r(b.pos.x), y: r(b.pos.y), z: r(b.pos.z), model: Boolean(b.model), dropped: b.dropped })),
        drones: state.hunters.map((h) => ({ id: h.id, phase: h.phase, x: r(h.pos.x), y: r(h.pos.y), z: r(h.pos.z), target: h.targetId })),
        strike: state.strike ? { jet: state.strike.jet.visible ? [r(state.strike.jet.position.x), r(state.strike.jet.position.y), r(state.strike.jet.position.z)] : null, phase: state.strike.phase, dropped: state.strike.dropped, exploded: state.strike.exploded, bombs: state.strike.bombs.length, target: [r(state.strike.target.x), r(state.strike.target.z)] } : null,
        counters: { hunterKills: state.hunterKills, strikeKills: state.strikeKills, crateKills: state.crateKills, captured: state.captured, bombsFallen: state.bombsFallen },
        medals: [...awarded],
        lastUse: state.lastUse,
        fx: fx?.stats() ?? null,
      };
    },
  };
})();

export default system;
