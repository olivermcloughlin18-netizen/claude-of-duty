// Browser/Node WebSocket client for the Claude of Duty multiplayer server.
// Protocol: server/PROTOCOL.md. No dependencies; uses globalThis.WebSocket (browsers, Node 22+).

const STATE_MIN_INTERVAL_MS = 45; // keep under the server's rate limit (~22 Hz max)
const SHOT_MIN_INTERVAL_MS = 90; // cosmetic tracer relay, ~11 Hz max
const PING_MS = 5000;
const SILENCE_MS = 15000;
const FATAL = new Set(['room_not_found', 'room_full', 'too_many_rooms', 'rate_limited']);

export function createNetClient({
  url,
  reconnect = true,
  backoffMs = 500,
  maxBackoffMs = 8000,
  maxRetries = 8,
  WebSocketImpl = globalThis.WebSocket,
} = {}) {
  if (!url) throw new Error('createNetClient: url required');
  if (!WebSocketImpl) throw new Error('createNetClient: no WebSocket available');

  const handlers = new Map();
  let ws = null;
  let id = null;
  let roomCode = null;
  let name = 'Player';
  let wantRoom = null;
  let wantMap = null; // sent on join; only the room creator's map is kept by the server
  let connected = false; // socket open AND joined
  let wantOpen = false;
  let retries = 0;
  let retryTimer = null;
  let pingTimer = null;
  let lastRx = 0;
  let lastStateAt = 0;
  let lastShotAt = 0;
  let pending = null; // { resolve, reject } for the current connect() call

  const emit = (type, payload) => {
    for (const fn of [...(handlers.get(type) ?? [])]) {
      try { fn(payload); } catch (err) { console.error('net-client handler error', err); }
    }
  };
  const rawSend = (obj) => {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(obj));
    return true;
  };

  const clearTimers = () => {
    clearInterval(pingTimer);
    clearTimeout(retryTimer);
    pingTimer = retryTimer = null;
  };

  function open() {
    const sock = new WebSocketImpl(url);
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      lastRx = Date.now();
      rawSend({ t: 'join', room: wantRoom, name, ...(wantMap ? { map: wantMap } : {}) });
      pingTimer = setInterval(() => {
        if (Date.now() - lastRx > SILENCE_MS) return sock.close();
        rawSend({ t: 'ping', c: Date.now() });
      }, PING_MS);
      emit('open', undefined);
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      lastRx = Date.now();
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'joined') {
        id = msg.id;
        roomCode = msg.room;
        wantRoom = msg.room; // reconnects rejoin the same room
        connected = true;
        retries = 0;
        pending?.resolve(msg);
        pending = null;
      } else if (msg.t === 'error' && FATAL.has(msg.code)) {
        wantOpen = false; // do not retry rejected joins
        pending?.reject(Object.assign(new Error(msg.message || msg.code), { code: msg.code }));
        pending = null;
      }
      emit(msg.t, msg);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      clearInterval(pingTimer);
      const wasConnected = connected;
      connected = false;
      if (wasConnected) emit('close', undefined);
      if (wantOpen && reconnect && retries < maxRetries) {
        const delay = Math.min(maxBackoffMs, backoffMs * 2 ** retries) * (0.75 + Math.random() * 0.5);
        retries++;
        emit('reconnecting', { attempt: retries, delayMs: Math.round(delay) });
        retryTimer = setTimeout(open, delay);
      } else {
        wantOpen = false;
        pending?.reject(new Error('connection closed'));
        pending = null;
        emit('disconnected', undefined);
      }
    };
    // Browsers fire onclose after onerror; Node's WebSocket does not when the connection is refused.
    sock.onerror = () => { if (sock.readyState !== 1) sock.onclose?.(); };
  }

  return {
    /** Resolves with the `joined` message. roomCode null = create a new room. */
    connect(code = null, playerName = 'Player', map = null) {
      this.disconnect();
      wantRoom = code ? String(code).toUpperCase() : null;
      name = String(playerName ?? 'Player');
      wantMap = map ? String(map) : null;
      wantOpen = true;
      retries = 0;
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        open();
      });
    },
    /** Returns false if dropped (not connected, or throttled to ~22 Hz). */
    sendState(s) {
      const now = Date.now();
      if (!connected || now - lastStateAt < STATE_MIN_INTERVAL_MS) return false;
      lastStateAt = now;
      return rawSend({ t: 'state', pos: s.pos, yaw: s.yaw, pitch: s.pitch, vel: s.vel, weaponId: s.weaponId, crouch: s.crouch });
    },
    /** Cosmetic shot relay {o, e, weaponId}; dropped when throttled (~11 Hz). */
    sendShot(s) {
      const now = Date.now();
      if (!connected || now - lastShotAt < SHOT_MIN_INTERVAL_MS) return false;
      lastShotAt = now;
      return rawSend({ t: 'shot', o: s.o, e: s.e, weaponId: s.weaponId });
    },
    sendHit(c) {
      if (!connected) return false;
      return rawSend({
        t: 'hit', targetId: c.targetId, weaponId: c.weaponId, damage: c.damage,
        headshot: Boolean(c.headshot), shooterPos: c.shooterPos, targetPos: c.targetPos,
      });
    },
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
      return () => this.off(event, fn);
    },
    off(event, fn) { handlers.get(event)?.delete(fn); },
    disconnect() {
      wantOpen = false;
      clearTimers();
      const sock = ws;
      ws = null;
      connected = false;
      id = null;
      roomCode = null;
      pending?.reject(new Error('disconnected'));
      pending = null;
      if (sock) {
        try { sock.send(JSON.stringify({ t: 'leave' })); } catch {}
        try { sock.close(); } catch {}
      }
    },
    get id() { return id; },
    get roomCode() { return roomCode; },
    get connected() { return connected; },
  };
}

export default createNetClient;
