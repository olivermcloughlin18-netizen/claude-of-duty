// Online play (PLAN.md section 4 lane M, section 7). Wraps net-client.js; no transport here.
//
// Clients own their movement and claim their own hits; the server owns hp, kills, scores, respawn and the
// clock. Remote players are interpolated puppets registered in `combatants` as kind 'remote'. Pure ESM with
// no `three` import (the host passes ctx.THREE), so Node tests can load it.
import { createNetClient } from './net-client.js';
import { MAP_IDS } from './maps.js';
import { EVENTS } from './game-events.js';

export const INTERP_MS = 100; // remote players are drawn this far in the past
export const CONNECT_TIMEOUT_MS = 4500; // the host caps the whole connect at 5 s
const SHOT_RELAY_MS = 100;
const RUN_SPEED = 30; // horizontal u/s above which a puppet plays 'run'
const MAX_SAMPLES = 12;

const key = (serverId) => `net-${serverId}`;
const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const array3 = (v) => [round(v.x), round(v.y), round(v.z)];
const lerp = (a, b, f) => a + (b - a) * f;
const lerpAngle = (a, b, f) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * f;
// Claims stay at or under what the server will accept (damage * pellets, x2 headshot).
const floorMilli = (n) => Math.floor(n * 1000 + 1e-6) / 1000;

/** Samples are {t, pos, yaw, vel, ...} sorted by t. Returns the pose at time `at` (no extrapolation). */
export function sampleAt(samples, at) {
  if (!samples.length) return null;
  if (at <= samples[0].t) return { ...samples[0] };
  const last = samples[samples.length - 1];
  if (at >= last.t) return { ...last };
  let i = 1;
  while (samples[i].t < at) i += 1;
  const a = samples[i - 1];
  const b = samples[i];
  const f = (at - a.t) / (b.t - a.t || 1);
  return {
    ...a,
    t: at,
    pos: a.pos.map((v, k) => lerp(v, b.pos[k], f)),
    yaw: lerpAngle(a.yaw, b.yaw, f),
    pitch: lerp(a.pitch ?? 0, b.pitch ?? 0, f),
  };
}

const MAX_QUEUED_CLAIMS = 8;

/** Server weapon id -> event cause: the knife is melee, everything else a bullet. */
const causeOf = (weaponId) => (weaponId === 'knife' ? 'melee' : 'bullet');

/** The most one `hit` message may claim: damage x pellets, doubled for a headshot (what the server allows). */
export const claimCap = (def, headshot) => (def ? def.damage * (def.pellets ?? 1) * (headshot ? 2 : 1) : Infinity);

/**
 * Folds one hit into the per-target claim queue. Pellets of one shot share a claim; a hit that would push the
 * last claim past `cap(headshot)` (a second bullet landing in the same frame) starts a new claim instead,
 * because the server rejects a claim worth more than one shot.
 */
export function addClaim(claims, targetId, { amount, region, weaponId }, cap = () => Infinity) {
  const queue = claims.get(targetId) ?? [];
  let claim = queue.at(-1);
  const head = region === 'head';
  if (!claim || claim.weaponId !== weaponId || claim.damage + amount > cap(claim.headshot || head)) {
    if (queue.length >= MAX_QUEUED_CLAIMS) return queue.at(-1);
    claim = { damage: 0, headshot: false, weaponId };
    queue.push(claim);
  }
  claim.damage += amount;
  claim.headshot ||= head;
  claims.set(targetId, queue);
  return claim;
}

export function createNetPlay({ createClient = createNetClient } = {}) {
  let client = null;
  let ctx = null;
  let joined = null;
  let selfId = null;
  let online = false;
  let notice = null;
  let inbox = [];
  const offs = [];
  const peers = new Map(); // server id -> peer
  const claims = new Map(); // server id -> queued claims (usually one)
  const sentAt = new Map(); // server id -> ms of the last claim sent
  const stats = { log: [], claims: [], deaths: 0, respawns: 0, sent: 0, received: 0, rejected: 0, lastReject: null, rttMs: null, snapshotAt: 0 };
  const match = { phase: 'waiting', killLimit: 30, timeLeftMs: 0, at: 0 };
  let respawnAt = 0;
  let lastShotRelay = 0;
  let euler = null;
  let chip = null;

  const trace = (type, detail) => { stats.log.push([Math.round(performance.now()), type, detail]); if (stats.log.length > 40) stats.log.shift(); };
  const toKey = (serverId) => (serverId === selfId ? 'player' : key(serverId));
  const peerOf = (serverId) => peers.get(serverId) ?? null;
  const say = (text) => (ctx ? ctx.notify(text) : (notice = text));

  // ---------- peers ----------
  function addPeer(info) {
    if (!info?.id || info.id === selfId || peers.has(info.id)) return peers.get(info.id) ?? null;
    const peer = {
      id: info.id, key: key(info.id), name: info.name ?? info.id, alive: info.alive !== false, hp: info.hp ?? 100,
      weaponId: info.weaponId ?? null, samples: [], puppet: null, poseState: 'idle', poseTime: 0, deathAt: 0,
    };
    peers.set(peer.id, peer);
    if (info.pos) pushSample(peer, info);
    if (ctx) attachPuppet(peer);
    return peer;
  }

  function attachPuppet(peer) {
    if (peer.puppet || !ctx.enemies?.createPuppet) return;
    peer.puppet = ctx.enemies.createPuppet(peer.key);
    peer.puppet.setVisible(peer.samples.length > 0);
    const { root, hitboxes } = peer.puppet;
    ctx.combatants.add({
      id: peer.key, name: peer.name, kind: 'remote', team: null, actor: peer.puppet,
      position: () => root.position,
      feet: () => root.position,
      dead: () => !peer.alive || peer.samples.length === 0, // unplaced (just respawned) peers cannot be shot
      hitboxes: () => hitboxes,
      // Only our own bullets are claimed; the server is the one that applies them.
      applyDamage: (amount, info) => {
        if (info.attackerId !== 'player') return 0;
        addClaim(claims, peer.id, { amount, region: info.region, weaponId: info.weaponId },
          (head) => claimCap(ctx.weapons.definition(info.weaponId), head));
        return Math.min(amount, peer.hp);
      },
    });
    ctx.match.register(peer.key, peer.name);
  }

  function removePeer(serverId) {
    const peer = peers.get(serverId);
    if (!peer) return;
    peers.delete(serverId);
    claims.delete(serverId);
    sentAt.delete(serverId);
    if (peer.puppet) {
      ctx?.combatants.remove(peer.key);
      peer.puppet.dispose();
    }
    ctx?.match.combatants?.delete(peer.key);
  }

  function pushSample(peer, p) {
    if (!Array.isArray(p.pos)) return;
    peer.samples.push({ t: performance.now(), pos: p.pos, yaw: p.yaw ?? 0, pitch: p.pitch ?? 0, vel: p.vel ?? [0, 0, 0], crouch: p.crouch });
    if (peer.samples.length > MAX_SAMPLES) peer.samples.shift();
    if (p.weaponId) peer.weaponId = p.weaponId;
  }

  const positionOf = (serverId) => {
    if (serverId === selfId) return ctx ? array3(ctx.player.feetPosition) : null;
    const sample = peerOf(serverId)?.samples.at(-1);
    return sample ? sample.pos.map((v) => round(v)) : null;
  };

  // ---------- server messages ----------
  function onSnapshot(msg) {
    stats.snapshotAt = performance.now();
    match.timeLeftMs = msg.timeLeftMs ?? match.timeLeftMs;
    match.at = stats.snapshotAt;
    for (const p of msg.players) {
      if (p.id === selfId) {
        const health = ctx?.playerHealth;
        if (health && !health.dead && p.alive) health.health = Math.min(health.maxHealth, Math.max(0, p.hp));
        continue;
      }
      const peer = peerOf(p.id) ?? addPeer(p);
      if (!peer) continue;
      if (p.alive && !peer.alive) reviveOnServer(peer);
      pushSample(peer, p);
      peer.hp = p.hp;
      peer.puppet?.setVisible(true);
    }
  }

  function reviveOnServer(peer) {
    peer.alive = true;
    peer.hp = 100;
    peer.samples.length = 0; // no glide from the corpse, and nothing to shoot until the new spawn arrives
    peer.puppet?.setVisible(false);
  }

  function onDamage(msg) {
    if (!ctx) return;
    const peer = peerOf(msg.targetId);
    if (peer) peer.hp = msg.hp;
    if (msg.targetId === selfId) {
      const health = ctx.playerHealth;
      if (health && !health.dead) {
        health.health = Math.max(0, msg.hp);
        health.hitFlash = 1;
        health.regenTimer = health.regenDelay;
      }
    }
    // Our own claims already emitted a predicted `damage`; surface everyone else's.
    if (msg.attackerId !== selfId) {
      ctx.bus.emit(EVENTS.DAMAGE, {
        attackerId: toKey(msg.attackerId), victimId: toKey(msg.targetId), amount: msg.amount,
        weaponId: msg.weaponId, cause: causeOf(msg.weaponId), region: msg.headshot ? 'head' : 'torso',
      });
    }
  }

  function onKill(msg) {
    trace('kill', msg.victimId === selfId ? 'self' : 'peer');
    if (!ctx) return;
    const killerId = toKey(msg.killerId);
    const victimId = toKey(msg.victimId);
    const victimPosition = positionOf(msg.victimId) ?? [0, 0, 0];
    const event = ctx.recordKillEvent({
      killerId, victimId, weaponId: msg.weaponId, cause: causeOf(msg.weaponId), region: msg.headshot ? 'head' : 'torso',
      victimPosition, killerPosition: positionOf(msg.killerId), at: performance.now() / 1000,
    });
    const victim = peerOf(msg.victimId);
    if (victim) {
      victim.alive = false;
      victim.hp = 0;
      victim.deathAt = performance.now();
    }
    if (msg.killerId === selfId) ctx.showHitmarker('kill');
    if (msg.victimId === selfId) {
      const health = ctx.playerHealth;
      if (!health.dead) {
        health.protectionTimer = 0;
        health.takeDamage(Math.max(health.health, 1), peerOf(msg.killerId)?.puppet ?? { type: 'bullet' });
      }
      respawnAt = performance.now() + (msg.respawnMs ?? 2500);
      stats.deaths += 1;
    }
    return event;
  }

  function onRespawn(msg) {
    trace('respawn', msg.id === selfId ? 'self' : 'peer');
    if (!ctx) return;
    if (msg.id === selfId) {
      respawnAt = 0;
      if (ctx.playerHealth.dead) { stats.respawns += 1; ctx.playerHealth.respawn(); }
      return;
    }
    const peer = peerOf(msg.id);
    if (peer) reviveOnServer(peer);
  }

  function setStandings(players) {
    if (!ctx) return;
    ctx.match.setStandings(players.map((p) => ({
      id: toKey(p.id), name: p.id === selfId ? undefined : p.name, kills: p.kills, deaths: p.deaths,
    })));
    // setStandings never forgets a player; drop anyone the server no longer lists.
    const listed = new Set(players.map((p) => toKey(p.id)));
    for (const id of [...(ctx.match.combatants?.keys() ?? [])]) {
      if (id.startsWith('net-') && !listed.has(id)) ctx.match.combatants.delete(id);
    }
  }

  function onMatchStart(msg) {
    match.phase = 'playing';
    match.killLimit = msg.killLimit ?? match.killLimit;
    match.timeLeftMs = msg.timeLeftMs ?? match.timeLeftMs;
    match.at = performance.now();
    if (!ctx) return;
    ctx.match.scoreLimit = match.killLimit;
    ctx.match.reset();
    for (const peer of peers.values()) reviveOnServer(peer);
    respawnAt = 0;
    ctx.playerHealth.respawn(); // picks a fresh spawn away from peers via threats()
  }

  function onMatchEnd(msg) {
    match.phase = 'ended';
    if (!ctx) return;
    setStandings(msg.players ?? []);
    ctx.match.finish(msg.winnerId ? toKey(msg.winnerId) : null);
  }

  function onShot(msg) {
    const peer = peerOf(msg.id);
    if (!ctx || !peer?.puppet) return;
    const origin = new ctx.THREE.Vector3(...msg.o);
    ctx.weaponEffects.addTracer(origin, new ctx.THREE.Vector3(...msg.e));
    ctx.weaponEffects.playEnemyShot(origin, peer.key);
    ctx.hud.markFire(peer.key);
    ctx.bus.emit(EVENTS.SHOT, { shooterId: peer.key, weaponId: msg.weaponId, origin: msg.o, end: msg.e, hitId: null });
  }

  function handle(msg) {
    stats.received += 1;
    switch (msg.t) {
      case 'peer_joined': { const p = addPeer(msg.player); if (p) say(`${p.name} joined`); break; }
      case 'peer_left': { const p = peerOf(msg.id); if (p) say(`${p.name} left`); removePeer(msg.id); break; }
      case 'snapshot': onSnapshot(msg); break;
      case 'damage': onDamage(msg); break;
      case 'kill': onKill(msg); break;
      case 'respawn': onRespawn(msg); break;
      case 'scores': setStandings(msg.players); break;
      case 'match_start': onMatchStart(msg); break;
      case 'match_end': onMatchEnd(msg); break;
      case 'shot': onShot(msg); break;
      case 'hit_rejected': stats.rejected += 1; stats.lastReject = msg.reason; stats.lastRejectedClaim = stats.claims.at(-1) ?? null; trace('reject', msg.reason); break;
      case 'pong': stats.rttMs = Math.max(0, Date.now() - msg.c); break;
      case 'error': console.warn(`[net] ${msg.code}: ${msg.message}`); break;
      default: break;
    }
  }

  const receive = (msg) => (ctx ? handle(msg) : inbox.push(msg));

  // ---------- connect ----------
  async function connect(config) {
    if (!config?.serverUrl || !config.room) return false;
    const target = createClient({ url: config.serverUrl, reconnect: false });
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(reject, CONNECT_TIMEOUT_MS, new Error('timeout')); });
    try {
      const create = config.room === 'NEW';
      joined = await Promise.race([target.connect(create ? null : config.room, config.name || '', create ? config.mapId : null), timeout]);
    } catch (error) {
      target.disconnect();
      notice = 'Server unreachable, playing offline vs bots';
      return false;
    } finally {
      clearTimeout(timer);
    }
    client = target;
    selfId = joined.id;
    online = true;
    for (const type of ['peer_joined', 'peer_left', 'snapshot', 'damage', 'kill', 'respawn', 'scores', 'match_start',
      'match_end', 'shot', 'hit_rejected', 'pong', 'error']) {
      offs.push(client.on(type, receive));
    }
    offs.push(client.on('disconnected', () => say('Disconnected from server')));
    match.phase = joined.match?.phase ?? 'waiting';
    match.killLimit = joined.match?.killLimit ?? 30;
    match.timeLeftMs = joined.match?.timeLeftMs ?? 0;
    match.at = performance.now();
    for (const p of joined.players ?? []) addPeer(p);
    return true;
  }

  // ---------- host hooks ----------
  function init(context) {
    ctx = context;
    euler = new ctx.THREE.Euler(0, 0, 0, 'YXZ');
    if (notice && !online) ctx.notify(notice);
    notice = null;
    if (!online) return;
    ctx.playerHealth.regenPerSecond = 0; // hp comes from the server (it regenerates)
    ctx.match.scoreLimit = match.killLimit;
    for (const peer of peers.values()) attachPuppet(peer);
    ctx.bus.on(EVENTS.SHOT, (shot) => {
      const now = performance.now();
      if (shot.shooterId !== 'player' || now - lastShotRelay < SHOT_RELAY_MS) return;
      lastShotRelay = now;
      client.sendShot({ o: shot.origin.map((v) => round(v)), e: shot.end.map((v) => round(v)), weaponId: shot.weaponId });
    });
    for (const msg of inbox) handle(msg);
    inbox = [];
    // Everyone boots on the map's one start marker; re-pick away from any peer already placed there.
    if ([...peers.values()].some((p) => p.samples.length)) ctx.playerHealth.respawn();
    setStandings([{ id: selfId, kills: 0, deaths: 0 }, ...[...peers.values()].map((p) => ({ id: p.id, name: p.name, kills: 0, deaths: 0 }))]);
    mountUi();
    say(`Online: room ${client.roomCode}`);
  }

  function inviteUrl() {
    const url = new URL(globalThis.location.href);
    for (const name of ['mode', 'map']) url.searchParams.delete(name);
    url.searchParams.set('room', client?.roomCode ?? '');
    url.searchParams.set('autostart', '1');
    url.searchParams.delete('name');
    return String(url);
  }

  function mountUi() {
    if (typeof document === 'undefined') return; // Node tests
    const room = client.roomCode;
    // The reload that follows "Create room" carries room=NEW; pin the real code so a refresh rejoins it.
    const here = new URL(globalThis.location.href);
    if (here.searchParams.get('room') !== room) {
      here.searchParams.set('room', room);
      globalThis.history?.replaceState(null, '', here);
    }
    const link = document.getElementById('fe-online-link');
    const row = document.getElementById('fe-online-invite');
    if (link && row) {
      link.value = inviteUrl();
      row.hidden = false;
      document.getElementById('fe-online-copy')?.addEventListener('click', async (event) => {
        event.stopPropagation();
        try { await navigator.clipboard.writeText(link.value); say('Invite link copied'); } catch { link.select(); }
      });
    }
    chip = document.createElement('div');
    chip.id = 'net-room';
    chip.style.cssText = 'position:fixed;left:12px;bottom:12px;padding:3px 8px;font:600 11px system-ui,sans-serif;' +
      'letter-spacing:.14em;color:#edf9f5;background:rgba(7,18,26,.6);border-radius:3px;pointer-events:none';
    chip.textContent = `ROOM ${room}`;
    ctx.overlay.append(chip);
  }

  function update(dt) {
    if (!online || !ctx) return;
    // Local state out. The client throttles to ~22 Hz.
    const { player, camera, playerHealth } = ctx;
    const feet = player.feetPosition;
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    const v = player.velocity;
    const weaponId = ctx.weapons.activeId();
    if (client.sendState({
      pos: array3(feet), yaw: round(euler.y, 3), pitch: round(euler.x, 3), vel: array3(v), crouch: Boolean(player.crouched),
      ...(weaponId ? { weaponId } : {}),
    })) stats.sent += 1;

    // One hit claim per target per frame, paced to the weapon's fire rate (the server rejects faster claims).
    if (claims.size) {
      const shooterPos = array3(feet);
      const now = performance.now();
      for (const [targetId, queue] of claims) {
        const claim = queue[0];
        const def = ctx.weapons.definition(claim.weaponId);
        const pace = def ? (60000 / Math.max(def.roundsPerMinute, def.initialRoundsPerMinute ?? 0)) * 0.7 : 0;
        if (now - (sentAt.get(targetId) ?? 0) < pace) continue;
        const targetPos = positionOf(targetId);
        queue.shift();
        if (!queue.length) claims.delete(targetId);
        if (!targetPos) continue;
        sentAt.set(targetId, now);
        const damage = Math.min(claim.damage, claimCap(def, claim.headshot));
        const sent = { targetId, weaponId: claim.weaponId, damage: floorMilli(damage), headshot: claim.headshot, shooterPos, targetPos };
        if (client.sendHit(sent)) { trace('claim', targetPos); stats.sent += 1; stats.claims.push(sent); if (stats.claims.length > 6) stats.claims.shift(); }
      }
    }

    // Server clock and a death that waits for the server's respawn.
    const left = match.timeLeftMs - (performance.now() - match.at);
    ctx.match.elapsedSeconds = match.phase === 'playing' ? Math.max(0, ctx.match.timeLimitSeconds - left / 1000) : 0;
    if (playerHealth.dead) playerHealth.respawnTimer = Math.max(0.5, (respawnAt - performance.now()) / 1000);

    // Puppets, 100 ms in the past.
    const at = performance.now() - INTERP_MS;
    for (const peer of peers.values()) {
      const puppet = peer.puppet;
      if (!puppet) continue;
      const pose = sampleAt(peer.samples, at);
      if (!pose) continue;
      puppet.root.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
      puppet.root.rotation.y = pose.yaw;
      let state = 'idle';
      if (!peer.alive) state = 'death';
      else if (Math.hypot(pose.vel[0], pose.vel[2]) > RUN_SPEED) state = 'run';
      if (state !== peer.poseState) { peer.poseState = state; peer.poseTime = 0; }
      peer.poseTime += dt;
      puppet.setPose(state, state === 'death' ? (performance.now() - peer.deathAt) / 1000 : peer.poseTime);
      while (peer.samples.length > 2 && peer.samples[1].t < at) peer.samples.shift();
    }
  }

  function reset() {} // the server restarts matches; the host's restart is disabled online

  function getState() {
    return {
      online, room: client?.roomCode ?? null, id: selfId, map: joined?.map ?? null,
      peers: [...peers.values()].map((p) => ({
        id: p.key, name: p.name, alive: p.alive, hp: p.hp, pose: p.poseState, hasPuppet: Boolean(p.puppet),
        position: p.puppet ? array3(p.puppet.root.position) : null,
      })),
      phase: match.phase, rttMs: stats.rttMs, snapshotAgeMs: stats.snapshotAt ? Math.round(performance.now() - stats.snapshotAt) : null,
      deaths: stats.deaths, respawns: stats.respawns, sent: stats.sent, received: stats.received, rejected: stats.rejected, lastReject: stats.lastReject, lastRejectedClaim: stats.lastRejectedClaim ?? null, recentClaims: stats.claims, log: stats.log,
    };
  }

  return {
    name: 'net',
    debug: {},
    init,
    update,
    onKey() { return false; },
    onTouchAction() { return false; },
    reset,
    getState,
    connect,
    get online() { return online; },
    get roomMapId() { return MAP_IDS.includes(joined?.map) ? joined.map : null; },
    // Last reported feet, not the puppet: an unplaced (just respawned) puppet still stands on its corpse.
    threats() { return [...peers.values()].filter((p) => p.alive && p.puppet && p.samples.length).map((p) => new ctx.THREE.Vector3(...p.samples.at(-1).pos)); },
    disconnect() { for (const off of offs) off(); client?.disconnect(); online = false; },
  };
}

export const system = createNetPlay();
export default system;
