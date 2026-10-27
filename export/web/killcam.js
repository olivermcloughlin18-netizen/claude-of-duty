// Killcam system (PLAN.md section 4, lane F).
//
// Records an 8 s ring buffer of the match at 20 Hz (the player's eye plus every
// bot's pose) and replays the last 4 s from the killer's eye when a bot kills
// the player, and the last feed kill once the match ends. Real bots are hidden
// and recorded puppets are redrawn; nothing here advances bots or the clock.
// Offline only.

export const HZ = 20;
export const KEEP_SECONDS = 8;
export const REPLAY_SECONDS = 4; // real time, including the slow-motion hold
export const HOLD_SECONDS = 0.4; // content time shown after the kill, in slow motion
export const HOLD_RATE = 0.4;
export const MIN_CONTENT = 0.8;
export const SKIP_AFTER = 1;
const BOT_EYE = 58;
const FADE = 0.25;

// ---------- pure helpers (importable from Node) ----------

/** Bracket `t` between two samples. Beyond the ends it clamps (k = 0). */
export function bracket(samples, t) {
  const last = samples.length - 1;
  if (last < 0) return null;
  if (t <= samples[0].t) return { a: samples[0], b: samples[0], k: 0 };
  if (t >= samples[last].t) return { a: samples[last], b: samples[last], k: 0 };
  let i = last - 1;
  while (i > 0 && samples[i].t > t) i -= 1;
  const a = samples[i];
  const b = samples[i + 1];
  return { a, b, k: (t - a.t) / Math.max(1e-6, b.t - a.t) };
}

export function angleDiff(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function lerpAngle(from, to, k) {
  return from + angleDiff(from, to) * k;
}

/**
 * Real-time -> content-time map. Plays `killT - start` seconds at normal speed,
 * then HOLD_SECONDS of death in slow motion. Returns the total real length.
 */
export function timeline(start, killT, hold = HOLD_SECONDS, holdRate = HOLD_RATE) {
  const lead = Math.max(0, killT - start);
  return {
    total: lead + hold / holdRate,
    contentAt(real) {
      if (real <= lead) return start + real;
      return killT + Math.min(hold, (real - lead) * holdRate);
    },
  };
}

/** Where a replay starts so the whole thing lasts REPLAY_SECONDS of real time. */
export function replayStart(firstT, killT) {
  return Math.max(firstT, killT - (REPLAY_SECONDS - HOLD_SECONDS / HOLD_RATE));
}

/** Drop samples older than KEEP_SECONDS before `now`. */
export function trim(list, now, keep = KEEP_SECONDS) {
  let drop = 0;
  while (drop < list.length && list[drop].t < now - keep) drop += 1;
  if (drop) list.splice(0, drop);
}

// ---------- system ----------

let ctx = null;
let THREE = null;
let rec = null; // {clock, acc, samples, shots}
let lastKill = null; // snapshot of the most recent kill
let pending = null; // snapshot waiting to start
let play = null;
let ui = null;
let finalHandled = false;
let eulerObj = null;

const STYLE = `
.kc-root{position:absolute;inset:0;pointer-events:none;display:none;font-family:var(--fe-ui,system-ui,sans-serif);color:#eef6ff}
.kc-root.on{display:block}
.kc-vignette{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 52%,rgba(0,0,0,.55) 100%),linear-gradient(rgba(20,40,60,.10),rgba(20,40,60,.10))}
.kc-bar{position:absolute;left:0;right:0;height:12vh;background:#02060a;transition:transform .45s cubic-bezier(.2,.8,.2,1)}
.kc-bar.top{top:0;transform:translateY(-100%)}.kc-bar.bot{bottom:0;transform:translateY(100%)}
.kc-root.shown .kc-bar{transform:none}
.kc-banner{position:absolute;left:5vw;bottom:calc(12vh + 22px);display:flex;align-items:center;gap:14px;opacity:0;transform:translateX(-26px);transition:opacity .4s .25s,transform .5s .25s cubic-bezier(.2,.8,.2,1)}
.kc-root.shown .kc-banner{opacity:1;transform:none}
.kc-rec{width:12px;height:12px;border-radius:50%;background:#ff4d3f;box-shadow:0 0 12px #ff4d3f;animation:kc-blink 1s steps(2,jump-none) infinite}
@keyframes kc-blink{50%{opacity:.25}}
.kc-label{font-weight:700;font-size:clamp(20px,3.2vw,38px);letter-spacing:.2em;text-transform:uppercase;text-shadow:0 2px 16px rgba(0,0,0,.9)}
.kc-label b{color:var(--fe-accent,#7fffc4);font-weight:700}
.kc-sub{font-size:12px;letter-spacing:.34em;text-transform:uppercase;color:rgba(206,224,240,.7);margin-top:4px;text-shadow:0 1px 8px #000}
.kc-skip{position:absolute;right:5vw;bottom:calc(12vh + 22px);font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:rgba(238,246,255,.85);opacity:0;transition:opacity .3s;text-shadow:0 1px 8px #000}
.kc-skip.on{opacity:1}
.kc-skip kbd{font:inherit;padding:2px 8px;margin-right:8px;border:1px solid rgba(238,246,255,.55);border-radius:3px}
.kc-prog{position:absolute;left:0;bottom:calc(12vh - 3px);height:3px;width:100%;background:rgba(255,255,255,.1);transform-origin:left}
.kc-prog i{display:block;height:100%;width:100%;background:var(--fe-accent,#7fffc4);box-shadow:0 0 10px var(--fe-accent,#7fffc4);transform-origin:left;transform:scaleX(0)}
.kc-fade{position:absolute;inset:0;background:#000;opacity:1}
body.kc-on #hud,body.kc-on #hud-minimap,body.kc-on #hud-compass,body.kc-on #hud-ammo,body.kc-on #crosshair,
body.kc-on #damage,body.kc-on #death-card,body.kc-on #match-status,body.kc-on #medals,body.kc-on #killfeed{opacity:0!important;visibility:hidden!important}
`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildUi() {
  const style = el('style');
  style.textContent = STYLE;
  const root = el('div', 'kc-root');
  const vignette = el('div', 'kc-vignette');
  const top = el('div', 'kc-bar top');
  const bottom = el('div', 'kc-bar bot');
  const prog = el('div', 'kc-prog');
  const progFill = el('i');
  prog.append(progFill);
  const banner = el('div', 'kc-banner');
  const text = el('div');
  const label = el('div', 'kc-label');
  const sub = el('div', 'kc-sub');
  text.append(label, sub);
  banner.append(el('span', 'kc-rec'), text);
  const skip = el('div', 'kc-skip');
  const kbd = el('kbd', null, 'Space');
  skip.append(kbd, document.createTextNode('Skip'));
  const fade = el('div', 'kc-fade');
  root.append(vignette, top, bottom, prog, banner, skip, fade);
  ctx.overlay.append(style, root);
  return { root, label, sub, skip, progFill, fade };
}

function online() {
  if (ctx.config?.room) return true;
  return ctx.combatants.all().some((entry) => entry.kind === 'remote');
}

function capture(t) {
  const cam = ctx.camera;
  const player = ctx.player;
  eulerObj.setFromQuaternion(cam.quaternion, 'YXZ');
  const bots = [];
  for (const entry of ctx.combatants.all()) {
    if (entry.kind !== 'bot') continue;
    const enemy = entry.actor;
    bots.push({
      id: entry.id,
      p: [enemy.root.position.x, enemy.root.position.y, enemy.root.position.z],
      yaw: enemy.root.rotation.y,
      pose: enemy.dead ? 'death' : (enemy.visualState ?? 'idle'),
      ps: enemy.visualTime ?? 0,
    });
  }
  return {
    t,
    eye: [cam.position.x, cam.position.y, cam.position.z],
    yaw: eulerObj.y,
    pitch: eulerObj.x,
    feetY: cam.position.y - (player.eyeHeight ?? 60),
    speed: Math.hypot(player.velocity.x, player.velocity.z),
    c: bots,
  };
}

function recordShot(shot) {
  rec.shots.push({ t: rec.clock, ...shot });
  trim(rec.shots, rec.clock);
}

function snapshot(event) {
  const sample = capture(rec.clock);
  // The victim is dying right now: start its death animation from frame zero.
  const bot = sample.c.find((entry) => entry.id === event.victimId);
  if (bot) { bot.pose = 'death'; bot.ps = 0; }
  rec.samples.push(sample);
  trim(rec.samples, rec.clock);
  return {
    killT: sample.t,
    killerId: event.killerId,
    victimId: event.victimId,
    samples: rec.samples.slice(),
    shots: rec.shots.slice(),
  };
}

function onKill(event) {
  if (!ctx || !rec || online() || !event.killerId) return;
  lastKill = snapshot(event);
  if (event.victimId === 'player' && event.killerId.startsWith('bot-')) {
    pending = { ...lastKill, kind: 'death' };
  }
}

function nameOf(id) {
  if (id === 'player') return 'YOU';
  return ctx.combatants.get(id)?.name ?? id;
}

function begin(snap, kind) {
  const first = snap.samples[0]?.t ?? snap.killT;
  const start = replayStart(first, snap.killT);
  if (snap.killT - start < MIN_CONTENT) return false;
  const killerSeen = snap.killerId === 'player' || snap.samples.some((s) => s.c.some((c) => c.id === snap.killerId));
  if (!killerSeen) return false;
  const line = timeline(start, snap.killT);
  const puppets = new Map();
  const ids = new Set(['player']);
  for (const sample of snap.samples) for (const c of sample.c) ids.add(c.id);
  for (const id of ids) {
    const puppet = ctx.enemies.createPuppet(`kc-${id}`);
    puppet.setVisible(false);
    puppets.set(id, puppet);
  }
  const camera = new THREE.PerspectiveCamera(ctx.camera.fov, ctx.camera.aspect, ctx.camera.near, ctx.camera.far);
  play = {
    kind, snap, start, line, puppets, camera,
    real: 0, frames: 0, shotIndex: 0, lastContent: start,
    baseFov: ctx.camera.fov, scoreboardWas: null,
  };
  killcam.camera = camera;
  return true;
}

function show() {
  play.frames = 1;
  ctx.enemies.setVisible(false);
  document.body.classList.add('kc-on');
  const board = document.getElementById('scoreboard');
  if (board && play.kind === 'final') { play.scoreboardWas = board.style.visibility; board.style.visibility = 'hidden'; }
  ui.root.classList.add('on');
  ui.label.replaceChildren(
    document.createTextNode(play.kind === 'final' ? 'Final killcam · ' : 'Killcam · '),
    Object.assign(el('b'), { textContent: nameOf(play.snap.killerId) }),
  );
  ui.sub.textContent = play.kind === 'final'
    ? `${nameOf(play.snap.killerId)} ${play.snap.killerId === 'player' ? 'eliminate' : 'eliminates'} ${nameOf(play.snap.victimId)}`
    : 'Replay from the shooter';
  ui.skip.classList.remove('on');
  requestAnimationFrame(() => ui.root.classList.add('shown'));
}

function end() {
  if (!play) return;
  const { puppets, kind, scoreboardWas } = play;
  for (const puppet of puppets.values()) puppet.dispose();
  ctx.enemies.setVisible(true);
  document.body.classList.remove('kc-on');
  const board = document.getElementById('scoreboard');
  if (board && scoreboardWas !== null) board.style.visibility = scoreboardWas;
  ui.root.classList.remove('on', 'shown');
  killcam.camera = null;
  play = null;
  if (kind === 'death' && ctx.playerHealth?.dead) {
    ctx.playerHealth.respawnTimer = Math.min(ctx.playerHealth.respawnTimer, 0.2);
  }
}

function playFrame(dt) {
  play.real += dt;
  const { snap, line, camera, puppets } = play;
  const t = line.contentAt(play.real);
  const hit = bracket(snap.samples, t);
  if (!hit) return end();
  const { a, b, k } = hit;
  const mix = (x, y) => x + (y - x) * k;
  const eye = [mix(a.eye[0], b.eye[0]), mix(a.eye[1], b.eye[1]), mix(a.eye[2], b.eye[2])];
  const playerYaw = lerpAngle(a.yaw, b.yaw, k);
  const playerPitch = mix(a.pitch, b.pitch);
  const bots = new Map();

  // Bots.
  for (const entry of a.c) {
    const next = b.c.find((c) => c.id === entry.id) ?? entry;
    const p = [mix(entry.p[0], next.p[0]), mix(entry.p[1], next.p[1]), mix(entry.p[2], next.p[2])];
    const yaw = lerpAngle(entry.yaw, next.yaw, k);
    bots.set(entry.id, { p, yaw });
    const puppet = puppets.get(entry.id);
    puppet.root.position.set(p[0], p[1], p[2]);
    puppet.root.rotation.y = yaw;
    puppet.setPose(entry.pose, entry.ps + (t - a.t));
    puppet.setVisible(true);
  }

  // The player's own body.
  const body = puppets.get('player');
  const dyingPlayer = snap.victimId === 'player' && t >= snap.killT;
  const feetY = mix(a.feetY, b.feetY);
  body.root.position.set(eye[0], feetY, eye[2]);
  body.root.rotation.y = playerYaw;
  const speed = mix(a.speed, b.speed);
  body.setPose(dyingPlayer ? 'death' : speed > 60 ? 'run' : 'idle', dyingPlayer ? t - snap.killT : t);
  body.setVisible(true);

  // Camera: the killer's eye, aimed at the victim.
  const sway = Math.sin(play.real * 1.7) * 0.004;
  let pos;
  let yaw;
  let pitch;
  if (snap.killerId === 'player') {
    body.setVisible(false);
    pos = eye;
    yaw = playerYaw;
    pitch = playerPitch;
  } else {
    const killer = bots.get(snap.killerId);
    if (!killer) return end();
    puppets.get(snap.killerId).setVisible(false);
    pos = [killer.p[0], killer.p[1] + BOT_EYE, killer.p[2]];
    const aim = snap.victimId === 'player'
      ? [eye[0], eye[1] - 8, eye[2]]
      : (() => { const v = bots.get(snap.victimId); return v ? [v.p[0], v.p[1] + 48, v.p[2]] : null; })();
    yaw = killer.yaw;
    pitch = 0;
    if (aim) {
      const dx = aim[0] - pos[0];
      const dy = aim[1] - pos[1];
      const dz = aim[2] - pos[2];
      const flat = Math.hypot(dx, dz);
      if (flat > 1) {
        const aimYaw = Math.atan2(-dx, -dz);
        yaw = killer.yaw + Math.max(-0.7, Math.min(0.7, angleDiff(killer.yaw, aimYaw))) * 0.9;
        pitch = Math.max(-0.6, Math.min(0.6, Math.atan2(dy, flat)));
      }
    }
  }
  camera.position.set(pos[0], pos[1], pos[2]);
  eulerObj.set(pitch + sway, yaw + sway * 0.6, 0, 'YXZ');
  camera.quaternion.setFromEuler(eulerObj);
  // Slow push-in over the replay.
  const progress = Math.min(1, play.real / line.total);
  const fov = play.baseFov - 12 * progress * progress;
  if (Math.abs(camera.fov - fov) > 0.01 || camera.aspect !== ctx.camera.aspect) {
    camera.fov = fov;
    camera.aspect = ctx.camera.aspect;
    camera.updateProjectionMatrix();
  }

  // Shots recorded in (lastContent, t].
  for (const shot of snap.shots) {
    if (shot.t <= play.lastContent || shot.t > t) continue;
    const from = new THREE.Vector3(...shot.o);
    const to = new THREE.Vector3(...shot.e);
    ctx.weaponEffects.addTracer(from, to);
    const trail = ctx.weaponEffects.transients?.[ctx.weaponEffects.transients.length - 1];
    if (trail) { trail.life = 0.16; trail.maxLife = 0.16; }
    ctx.weaponEffects.addMuzzleFlash(from, to.clone().sub(from).normalize());
  }
  play.lastContent = t;

  // UI.
  ui.progFill.style.transform = `scaleX(${progress})`;
  ui.fade.style.opacity = String(Math.max(
    Math.max(0, 1 - play.real / FADE),
    Math.max(0, 1 - (line.total - play.real) / FADE),
  ));
  ui.skip.classList.toggle('on', play.real >= SKIP_AFTER);
  if (play.real >= line.total) end();
}

export const killcam = {
  name: 'killcam',
  debug: {},
  init(context) {
    ctx = context;
    THREE = ctx.THREE;
    eulerObj = new THREE.Euler(0, 0, 0, 'YXZ');
    ui = buildUi();
    rec = { clock: 0, acc: 0, samples: [], shots: [] };
    lastKill = null;
    pending = null;
    play = null;
    finalHandled = false;
    ctx.bus.on('shot', (shot) => {
      // Bot shots are caught below; this is the player's (and later, remote) fire.
      if (!rec || play || String(shot.shooterId).startsWith('bot-')) return;
      recordShot({ id: shot.shooterId, o: shot.origin, e: shot.end });
    });
    ctx.bus.on('kill', onKill);
    // Bots report their fire only through EnemyManager.onShot.
    const manager = ctx.enemies;
    if (manager && typeof manager.onShot === 'function') {
      const original = manager.onShot;
      manager.onShot = (info) => {
        original(info);
        if (!rec || play) return;
        const id = ctx.combatants.idOf(info.shooter);
        if (id) recordShot({ id, o: info.origin.toArray(), e: info.end.toArray() });
      };
    }
    const skip = () => {
      if (play && play.real >= SKIP_AFTER) end();
    };
    document.addEventListener('keydown', (event) => {
      if (play && (event.code === 'Space' || event.code === 'Enter')) {
        event.preventDefault();
        skip();
      }
    }, true);
    document.addEventListener('pointerdown', skip, true);
    document.addEventListener('touchstart', skip, { capture: true, passive: true });
  },
  update(dt, frame) {
    if (!ctx) return;
    if (play) {
      if (play.kind === 'death' && !ctx.playerHealth.dead) return end();
      if (!play.frames) show();
      return playFrame(dt);
    }
    if (pending) {
      const snap = pending;
      pending = null;
      begin(snap, 'death');
      return;
    }
    if (ctx.match.phase === 'ended') {
      if (!finalHandled) {
        finalHandled = true;
        if (lastKill && !online()) begin({ ...lastKill }, 'final');
      }
      return;
    }
    finalHandled = false;
    if (!frame.simulationActive || ctx.playerHealth?.dead) return;
    rec.acc += dt;
    while (rec.acc >= 1 / HZ) {
      rec.acc -= 1 / HZ;
      rec.clock += 1 / HZ;
      rec.samples.push(capture(rec.clock));
    }
    trim(rec.samples, rec.clock);
  },
  onKey() { return false; },
  onTouchAction() { return false; },
  reset() {
    if (play) end();
    pending = null;
    lastKill = null;
    finalHandled = false;
    if (rec) { rec.samples.length = 0; rec.shots.length = 0; rec.acc = 0; }
  },
  getState() {
    return {
      playing: Boolean(play),
      kind: play?.kind ?? null,
      killerId: play?.snap.killerId ?? null,
      seconds: play ? Math.round(play.real * 100) / 100 : 0,
      buffered: rec ? rec.samples.length : 0,
      camera: play ? play.camera.position.toArray().map((v) => Math.round(v * 10) / 10) : null,
      puppets: play ? play.puppets.size : 0,
    };
  },
  isPlaying() { return Boolean(play); },
  /** True once the end-of-match decision (final killcam or none) has finished. */
  get settled() { return finalHandled && !play; },
  camera: null,
};

export const system = killcam;
export default system;
