// Claude of Duty multiplayer server. Free-for-all rooms, server-authoritative hits.
// Contract: see PROTOCOL.md. World units are the game's own (T6 inches, player 72 tall).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

// Per-weapon max claim damage (damage x pellets) and rpm (fastest mode x 1.25 slack), generated from
// export/web/weapons.js by .tools/sync_server_weapons.mjs. Lives beside server.js so `railway up` ships it.
export const WEAPONS = Object.freeze(JSON.parse(readFileSync(new URL('./weapons.json', import.meta.url), 'utf8')));

const HEADSHOT_MULT = 2; // enemy-system.js head hitbox multiplier
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COORD_LIMIT = 1e5;
const MAP_ID = /^[a-z0-9_-]{1,24}$/;

const envInt = (name, fallback) => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const DEFAULTS = {
  port: envInt('PORT', 8080),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY ? process.env.TRUST_PROXY === '1' : Boolean(process.env.RAILWAY_ENVIRONMENT),
  maxRooms: envInt('MAX_ROOMS', 200),
  maxRoomsPerIp: envInt('MAX_ROOMS_PER_IP', 3),
  maxConnPerIp: envInt('MAX_CONN_PER_IP', 16),
  maxPlayers: 8,
  maxPayload: 2048,
  killLimit: 30,
  matchMs: 300_000,
  respawnMs: 2500,
  intermissionMs: 10_000,
  maxHealth: 100,
  tickMs: 50, // 20 Hz snapshots
  heartbeatMs: 5000,
  timeoutMs: 15_000,
  joinTimeoutMs: 10_000,
  bucketCapacity: 100,
  bucketRefillPerSec: 70, // state 22 + shot 10 + hit claims (up to ~20) per second, with headroom
  abuseDrops: 30, // dropped messages per 5 s window before kick
  maxBadMessages: 20,
  fireRateSlack: 0.8, // accept shots down to 80% of the weapon's interval (jitter)
  posTolerance: 300, // world units claimed vs last server position (sprint 450/s + latency)
  maxRange: 8000,
  regenDelayMs: 4000, // hp regenerates (as the offline game does) this long after the last damage taken
  regenPerSec: 25,
  shotMinMs: 40, // relayed `shot` messages faster than this are dropped
};

// ---------- validation helpers ----------
const isNum = (v, lim = COORD_LIMIT) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => isNum(n));
const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(v);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function sanitizeName(raw, fallback = 'Player') {
  const s = typeof raw === 'string' ? raw : '';
  const clean = s
    .normalize('NFKC')
    .replace(/\p{C}+/gu, '') // control + format (bidi) chars
    .replace(/\p{Z}+/gu, ' ')
    .replace(/[<>&"'`\\]/g, '')
    .trim();
  return [...clean].slice(0, 16).join('').trim() || fallback;
}

export function sanitizeRoomCode(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return false;
  const c = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,6}$/.test(c) ? c : false;
}

export function createServer(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const rooms = new Map();
  const ipConns = new Map();
  const conns = new Set();
  let tickCount = 0;

  const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url?.split('?')[0] === '/health') {
      let players = 0;
      for (const r of rooms.values()) players += r.players.size;
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, players, uptime: Math.round(process.uptime()) }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: cfg.maxPayload, perMessageDeflate: false });

  const clientIp = (req) => {
    if (cfg.trustProxy) {
      // Rightmost entry is the one appended by our own proxy; earlier ones are client-controlled.
      const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  httpServer.on('upgrade', (req, socket, head) => {
    const reject = (code, text) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (cfg.allowedOrigins.length && !cfg.allowedOrigins.includes(req.headers.origin ?? '')) return reject(403, 'Forbidden');
    const ip = clientIp(req);
    if ((ipConns.get(ip) ?? 0) >= cfg.maxConnPerIp) return reject(429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip));
  });

  // ---------- sending ----------
  const send = (ws, msg) => {
    if (ws.readyState !== 1) return;
    if (ws.bufferedAmount > 1_000_000) return ws.terminate(); // slow consumer
    ws.send(JSON.stringify(msg));
  };
  const broadcast = (room, msg, except = null) => {
    const data = JSON.stringify(msg);
    for (const p of room.players.values()) {
      if (p === except || p.ws.readyState !== 1) continue;
      if (p.ws.bufferedAmount > 1_000_000) p.ws.terminate();
      else p.ws.send(data);
    }
  };
  const kick = (ws, code, reason, errCode) => {
    if (errCode) send(ws, { t: 'error', code: errCode, message: reason });
    ws.close(code, reason.slice(0, 100));
  };

  // ---------- rooms ----------
  const scores = (room) => ({
    t: 'scores',
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths })),
  });
  const matchInfo = (room, now = Date.now()) => ({
    phase: room.phase,
    killLimit: cfg.killLimit,
    timeLeftMs: room.phase === 'playing' ? Math.max(0, room.endsAt - now) : 0,
  });
  const publicPlayer = (p) => ({
    id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, hp: p.hp, alive: p.alive,
    pos: p.pos, yaw: p.yaw, pitch: p.pitch, weaponId: p.weaponId, crouch: p.crouch,
  });

  const startMatch = (room, now) => {
    room.phase = 'playing';
    room.endsAt = now + cfg.matchMs;
    room.winnerId = null;
    for (const p of room.players.values()) {
      p.kills = 0; p.deaths = 0; p.hp = cfg.maxHealth; p.alive = true; p.respawnAt = 0;
    }
    broadcast(room, { t: 'match_start', killLimit: cfg.killLimit, timeLeftMs: cfg.matchMs });
    broadcast(room, scores(room));
  };

  const endMatch = (room, now) => {
    if (room.phase !== 'playing') return;
    room.phase = 'ended';
    room.nextMatchAt = now + cfg.intermissionMs;
    const ranked = [...room.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    room.winnerId = ranked[0]?.id ?? null;
    broadcast(room, { t: 'match_end', winnerId: room.winnerId, intermissionMs: cfg.intermissionMs, players: scores(room).players });
  };

  const removePlayer = (conn) => {
    const room = conn.room;
    if (!room) return;
    conn.room = null;
    room.players.delete(conn.player.id);
    if (!room.players.size) {
      rooms.delete(room.code);
      return;
    }
    broadcast(room, { t: 'peer_left', id: conn.player.id });
    broadcast(room, scores(room));
  };

  function onJoin(conn, msg) {
    if (conn.room) return send(conn.ws, { t: 'error', code: 'already_joined', message: 'already in a room' });
    const code = sanitizeRoomCode(msg.room);
    if (code === false) return send(conn.ws, { t: 'error', code: 'bad_message', message: 'invalid room code' });
    let room;
    if (code === null) {
      let mine = 0;
      for (const r of rooms.values()) if (r.creatorIp === conn.ip) mine++;
      if (rooms.size >= cfg.maxRooms || mine >= cfg.maxRoomsPerIp) {
        return kick(conn.ws, 1013, 'too many rooms', 'too_many_rooms');
      }
      let c;
      do c = Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      while (rooms.has(c));
      room = { code: c, players: new Map(), phase: 'waiting', endsAt: 0, nextMatchAt: 0, winnerId: null, creatorIp: conn.ip, dirty: false,
        map: typeof msg.map === 'string' && MAP_ID.test(msg.map) ? msg.map : null };
      rooms.set(c, room);
    } else {
      room = rooms.get(code);
      if (!room) return kick(conn.ws, 1008, 'room not found', 'room_not_found');
      if (room.players.size >= cfg.maxPlayers) return kick(conn.ws, 1008, 'room full', 'room_full');
    }
    const id = randomUUID().slice(0, 8);
    const player = {
      id, ws: conn.ws, name: sanitizeName(msg.name, `Player${room.players.size + 1}`),
      kills: 0, deaths: 0, hp: cfg.maxHealth, alive: true, respawnAt: 0,
      pos: null, yaw: 0, pitch: 0, vel: [0, 0, 0], weaponId: 'm27', crouch: false, lastShotAt: 0, lastShotRelayAt: 0, lastDamageAt: 0,
    };
    conn.room = room;
    conn.player = player;
    room.players.set(id, player);
    send(conn.ws, {
      t: 'joined', id, room: room.code, maxPlayers: cfg.maxPlayers,
      players: [...room.players.values()].map(publicPlayer), match: matchInfo(room), map: room.map,
    });
    broadcast(room, { t: 'peer_joined', player: publicPlayer(player) }, player);
    broadcast(room, scores(room));
  }

  function onState(conn, msg) {
    const p = conn.player;
    if (!p) return;
    const vel = msg.vel === undefined ? [0, 0, 0] : msg.vel;
    if (!isVec3(msg.pos) || !isNum(msg.yaw, 1e4) || !isNum(msg.pitch, 1e4) || !isVec3(vel) ||
        (msg.weaponId !== undefined && !(typeof msg.weaponId === 'string' && /^[a-z0-9_]{1,16}$/.test(msg.weaponId))) ||
        (msg.crouch !== undefined && typeof msg.crouch !== 'boolean')) return bad(conn, 'bad state');
    // ponytail: no speed/teleport check on state; add a max-delta clamp if cheaters matter.
    p.pos = msg.pos; p.yaw = msg.yaw; p.pitch = msg.pitch; p.vel = vel;
    if (msg.weaponId !== undefined) p.weaponId = msg.weaponId;
    p.crouch = msg.crouch === true;
    conn.room.dirty = true;
  }

  // Cosmetic relay so peers can draw tracers and fire pings. No damage rides on it.
  function onShot(conn, msg) {
    const room = conn.room, p = conn.player;
    if (!isVec3(msg.o) || !isVec3(msg.e) || typeof msg.weaponId !== 'string' || !/^[a-z0-9_]{1,16}$/.test(msg.weaponId)) return bad(conn, 'bad shot');
    const now = Date.now();
    if (!p.alive || room.phase !== 'playing' || now - p.lastShotRelayAt < cfg.shotMinMs) return;
    p.lastShotRelayAt = now;
    broadcast(room, { t: 'shot', id: p.id, o: msg.o, e: msg.e, weaponId: msg.weaponId }, p);
  }

  function reject(conn, msg, reason) {
    send(conn.ws, { t: 'hit_rejected', targetId: typeof msg.targetId === 'string' ? msg.targetId.slice(0, 16) : null, reason });
  }

  function onHit(conn, msg) {
    const room = conn.room, shooter = conn.player;
    if (!room) return;
    if (!isId(msg.targetId) || typeof msg.weaponId !== 'string' || !isNum(msg.damage, 1e4) ||
        typeof msg.headshot !== 'boolean' || !isVec3(msg.shooterPos) || !isVec3(msg.targetPos)) return bad(conn, 'bad hit');
    const now = Date.now();
    if (room.phase !== 'playing') return reject(conn, msg, 'not_playing');
    if (!shooter.alive) return reject(conn, msg, 'shooter_dead');
    const target = room.players.get(msg.targetId);
    if (!target) return reject(conn, msg, 'unknown_target');
    if (target === shooter) return reject(conn, msg, 'self_hit');
    if (!target.alive) return reject(conn, msg, 'target_dead');
    const weapon = Object.hasOwn(WEAPONS, msg.weaponId) ? WEAPONS[msg.weaponId] : null;
    if (!weapon) return reject(conn, msg, 'unknown_weapon');
    const maxDamage = weapon.damage * (msg.headshot ? HEADSHOT_MULT : 1);
    if (msg.damage <= 0 || msg.damage > maxDamage + 1e-6) return reject(conn, msg, 'bad_damage');
    if (now - shooter.lastShotAt < (60000 / weapon.rpm) * cfg.fireRateSlack) return reject(conn, msg, 'fire_rate');
    if (!shooter.pos || !target.pos) return reject(conn, msg, 'no_position');
    if (dist(msg.shooterPos, shooter.pos) > cfg.posTolerance || dist(msg.targetPos, target.pos) > cfg.posTolerance) {
      return reject(conn, msg, 'position_mismatch');
    }
    if (dist(msg.shooterPos, msg.targetPos) > cfg.maxRange) return reject(conn, msg, 'range');

    shooter.lastShotAt = now;
    const amount = Math.min(msg.damage, target.hp);
    target.hp -= amount;
    target.lastDamageAt = now;
    broadcast(room, {
      t: 'damage', targetId: target.id, attackerId: shooter.id, weaponId: msg.weaponId,
      amount, hp: target.hp, headshot: msg.headshot,
    });
    if (target.hp > 0) return;
    target.alive = false;
    target.respawnAt = now + cfg.respawnMs;
    target.deaths++;
    shooter.kills++;
    broadcast(room, { t: 'kill', killerId: shooter.id, victimId: target.id, weaponId: msg.weaponId, headshot: msg.headshot, respawnMs: cfg.respawnMs });
    broadcast(room, scores(room));
    if (shooter.kills >= cfg.killLimit) endMatch(room, now);
  }

  const bad = (conn, why) => {
    send(conn.ws, { t: 'error', code: 'bad_message', message: why });
    if (++conn.bad > cfg.maxBadMessages) kick(conn.ws, 1008, 'too many invalid messages');
  };

  // ---------- connections ----------
  function onConnection(ws, ip) {
    ipConns.set(ip, (ipConns.get(ip) ?? 0) + 1);
    const conn = {
      ws, ip, room: null, player: null, bad: 0, lastSeen: Date.now(),
      tokens: cfg.bucketCapacity, refillAt: Date.now(), drops: 0, dropWindowAt: Date.now(),
    };
    const joinTimer = setTimeout(() => { if (!conn.room) kick(ws, 1008, 'join timeout'); }, cfg.joinTimeoutMs);
    ws.on('pong', () => { conn.lastSeen = Date.now(); });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(joinTimer);
      removePlayer(conn);
      const n = (ipConns.get(ip) ?? 1) - 1;
      if (n <= 0) ipConns.delete(ip); else ipConns.set(ip, n);
      conns.delete(conn);
    });
    conns.add(conn);

    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      conn.lastSeen = now;
      // token bucket
      conn.tokens = Math.min(cfg.bucketCapacity, conn.tokens + ((now - conn.refillAt) / 1000) * cfg.bucketRefillPerSec);
      conn.refillAt = now;
      if (conn.tokens < 1) {
        if (now - conn.dropWindowAt > 5000) { conn.dropWindowAt = now; conn.drops = 0; }
        if (++conn.drops >= cfg.abuseDrops) kick(ws, 1008, 'rate limit exceeded', 'rate_limited');
        return;
      }
      conn.tokens -= 1;

      if (isBinary) return bad(conn, 'binary frames not allowed');
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return bad(conn, 'invalid json'); }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return bad(conn, 'invalid message');
      switch (msg.t) {
        case 'join': return onJoin(conn, msg);
        case 'ping': return send(ws, { t: 'pong', c: isNum(msg.c, 1e15) ? msg.c : 0 });
        case 'state': return conn.room ? onState(conn, msg) : send(ws, { t: 'error', code: 'not_joined', message: 'join first' });
        case 'hit': return conn.room ? onHit(conn, msg) : send(ws, { t: 'error', code: 'not_joined', message: 'join first' });
        case 'shot': return conn.room ? onShot(conn, msg) : send(ws, { t: 'error', code: 'not_joined', message: 'join first' });
        case 'leave': return ws.close(1000, 'leave');
        default: return bad(conn, 'unknown type');
      }
    });
  }

  // ---------- timers ----------
  const tick = () => {
    const now = Date.now();
    tickCount++;
    for (const room of rooms.values()) {
      if (room.phase === 'waiting' && room.players.size >= 2) startMatch(room, now);
      else if (room.phase === 'playing') {
        if (room.players.size < 2) room.phase = 'waiting';
        else if (now >= room.endsAt) endMatch(room, now);
      } else if (room.phase === 'ended' && now >= room.nextMatchAt) {
        if (room.players.size >= 2) startMatch(room, now); else room.phase = 'waiting';
      }
      for (const p of room.players.values()) {
        if (p.alive && p.hp < cfg.maxHealth && room.phase === 'playing' && now - p.lastDamageAt > cfg.regenDelayMs) {
          p.hp = Math.min(cfg.maxHealth, p.hp + cfg.regenPerSec * (cfg.tickMs / 1000));
          room.dirty = true;
        }
        if (!p.alive && room.phase === 'playing' && now >= p.respawnAt) {
          p.alive = true; p.hp = cfg.maxHealth;
          broadcast(room, { t: 'respawn', id: p.id, hp: p.hp });
        }
      }
      if (room.dirty) {
        room.dirty = false;
        broadcast(room, {
          t: 'snapshot', tick: tickCount, timeLeftMs: matchInfo(room, now).timeLeftMs,
          players: [...room.players.values()].filter((p) => p.pos).map((p) => ({
            id: p.id, pos: p.pos, yaw: p.yaw, pitch: p.pitch, vel: p.vel,
            weaponId: p.weaponId, crouch: p.crouch, hp: p.hp, alive: p.alive,
          })),
        });
      }
    }
  };
  const tickTimer = setInterval(tick, cfg.tickMs);
  const beatTimer = setInterval(() => {
    const now = Date.now();
    for (const c of conns) {
      if (now - c.lastSeen > cfg.timeoutMs) c.ws.terminate();
      else if (c.ws.readyState === 1) c.ws.ping();
    }
  }, cfg.heartbeatMs);
  tickTimer.unref(); beatTimer.unref();

  return {
    rooms,
    cfg,
    listen: (port = cfg.port) => new Promise((resolve) => {
      httpServer.listen(port, () => resolve(httpServer.address().port));
    }),
    close: () => new Promise((resolve) => {
      clearInterval(tickTimer); clearInterval(beatTimer);
      for (const c of conns) c.ws.terminate();
      httpServer.close(() => resolve());
      httpServer.closeAllConnections?.();
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  const port = await server.listen();
  console.log(`cod-mp-server listening on :${port}`);
  const stop = () => server.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
