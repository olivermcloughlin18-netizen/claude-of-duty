import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from '../server/server.js';
import { buildTable } from '../.tools/sync_server_weapons.mjs';
import { createNetPlay, sampleAt, addClaim } from '../export/web/net-play.js';
import { createEventBus } from '../export/web/game-events.js';
import { Combatants } from '../export/web/combatants.js';
import { FreeForAllMatch } from '../export/web/free-for-all-match.js';
import { PlayerHealth } from '../export/web/player-health.js';
import { MAP_IDS } from '../export/web/maps.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, ms = 3000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(10)) { const value = fn(); if (value) return value; }
  throw new Error('timed out');
};

test('server/weapons.json matches weapons.js (run .tools/sync_server_weapons.mjs after weapon changes)', () => {
  const file = JSON.parse(fs.readFileSync(new URL('../server/weapons.json', import.meta.url), 'utf8'));
  assert.deepEqual(file, buildTable());
});

test('sync table: damage x pellets, rpm from the fastest mode with 25% slack', () => {
  const table = buildTable({
    shotty: { damage: 40, pellets: 8, roundsPerMinute: 70 },
    burst: { damage: 30, roundsPerMinute: 600, initialRoundsPerMinute: 900 },
  });
  assert.deepEqual(table, { burst: { damage: 30, rpm: 1125 }, shotty: { damage: 320, rpm: 88 } });
});

test('sampleAt interpolates position and takes the short way round for yaw', () => {
  const samples = [
    { t: 0, pos: [0, 0, 0], yaw: 3.0, vel: [0, 0, 0] },
    { t: 100, pos: [100, 0, 0], yaw: -3.0, vel: [0, 0, 0] },
  ];
  assert.equal(sampleAt(samples, 50).pos[0], 50);
  assert.ok(Math.abs(Math.abs(sampleAt(samples, 50).yaw) - Math.PI) < 0.2);
  assert.equal(sampleAt(samples, 500).pos[0], 100, 'no extrapolation');
  assert.equal(sampleAt(samples, -5).pos[0], 0);
  assert.equal(sampleAt([], 5), null);
});

test('addClaim sums pellets and flags any head', () => {
  const claims = new Map();
  addClaim(claims, 'x', { amount: 40, region: 'torso', weaponId: 's' });
  addClaim(claims, 'x', { amount: 80, region: 'head', weaponId: 's' });
  assert.deepEqual(claims.get('x'), { damage: 120, headshot: true, weaponId: 's' });
});

test('unreachable server, no room, or no url means offline (false) with a notice', async () => {
  assert.equal(await createNetPlay().connect({ serverUrl: '', room: 'NEW' }), false);
  assert.equal(await createNetPlay().connect({ serverUrl: 'ws://127.0.0.1:9', room: null }), false);
  const net = createNetPlay();
  assert.equal(await net.connect({ serverUrl: 'ws://127.0.0.1:1', room: 'ABCD', name: 'x', mapId: 'hijacked' }), false);
  assert.equal(net.online, false);
  const notes = [];
  net.init(fakeCtx('p', notes));
  assert.deepEqual(notes, ['Server unreachable, playing offline vs bots']);
});

// ---- two net-play instances against a real local server, fake host ctx ----
class Vector3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } set(x, y, z) { Object.assign(this, { x, y, z }); return this; } }
class Euler { constructor() { this.x = this.y = this.z = 0; } setFromQuaternion() { return this; } }

function fakeCtx(name, notes = [], feet = [0, 0, 0]) {
  const bus = createEventBus();
  const combatants = new Combatants({ bus });
  const match = new FreeForAllMatch({ scoreLimit: 30 });
  match.register('player', 'YOU', { human: true });
  const deaths = [];
  const respawns = [];
  const playerHealth = new PlayerHealth({
    spawnProtection: 0,
    onDeath: ({ source }) => deaths.push(source),
    onRespawn: () => respawns.push(Date.now()),
  });
  const kills = [];
  const markers = [];
  const shots = [];
  const ctx = {
    name, THREE: { Vector3, Euler }, bus, combatants, match, playerHealth, notes, deaths, respawns, kills, markers, shots,
    camera: { quaternion: {} },
    player: { feetPosition: new Vector3(...feet), velocity: new Vector3(), crouched: false },
    enemies: {
      createPuppet: (id) => ({
        id, root: { position: new Vector3(), rotation: { y: 0 } }, hitboxes: [], disposed: false,
        setPose() {}, setVisible() {}, dispose() { this.disposed = true; },
      }),
    },
    weapons: { activeId: () => 'm27' },
    weaponEffects: { addTracer: (a, b) => shots.push([a, b]), playEnemyShot() {} },
    hud: { markFire() {} },
    overlay: { append() {} },
    notify: (text) => notes.push(text),
    showHitmarker: (kind) => markers.push(kind),
    recordKillEvent(event) { kills.push(event); match.recordKill(event.killerId, event.victimId, event); bus.emit('kill', event); return event; },
  };
  combatants.add({
    id: 'player', name: 'YOU', kind: 'player', team: null, actor: ctx.player, position: () => ctx.player.feetPosition,
    feet: () => ctx.player.feetPosition, dead: () => playerHealth.dead, hitboxes: () => [], applyDamage: () => 0,
  });
  return ctx;
}

test('two clients: map echo, puppets, one aggregated claim, server-authoritative kill, respawn, scores', async () => {
  const server = createServer({ tickMs: 20, respawnMs: 200 });
  const port = await server.listen(0);
  const url = `ws://127.0.0.1:${port}`;
  const a = createNetPlay();
  const b = createNetPlay();
  const mapId = MAP_IDS.at(-1);
  let pump;
  try {
    assert.equal(await a.connect({ serverUrl: url, room: 'NEW', name: 'Alpha', mapId }), true);
    const room = a.getState().room;
    assert.match(room, /^[A-Z0-9]{5}$/);
    assert.equal(await b.connect({ serverUrl: url, room, name: 'Bravo', mapId: MAP_IDS[0] }), true);
    assert.equal(b.roomMapId, mapId, 'joiner loads the creator map');
    const ca = fakeCtx('a', [], [0, 0, 0]);
    const cb = fakeCtx('b', [], [200, 0, 0]);
    a.init(ca);
    b.init(cb);
    pump = setInterval(() => { a.update(0.016, {}); b.update(0.016, {}); }, 16);

    const aId = a.getState().id;
    const bId = b.getState().id;
    await until(() => a.getState().peers.length === 1 && b.getState().peers.length === 1);
    await until(() => a.getState().peers[0].position?.[0] === 200 && b.getState().peers[0].position?.[0] === 0);
    assert.ok(ca.combatants.get(`net-${bId}`), 'remote combatant registered');
    assert.equal(ca.combatants.get(`net-${bId}`).kind, 'remote');
    assert.deepEqual(a.threats().length, 1);
    await until(() => ca.match.getState().standings.length === 2);
    await until(() => a.getState().phase === 'playing');

    const respawnsBefore = cb.respawns.length;
    // Four pellets of one frame become ONE claim; the headshot doubles the cap, so 2 x 66 = a kill in two frames.
    const info = { attackerId: 'player', weaponId: 'm27', cause: 'bullet', region: 'head' };
    assert.equal(ca.combatants.applyDamage(`net-${bId}`, 66, info), 66, 'predicted amount for the hitmarker');
    await until(() => cb.playerHealth.health === 34);
    assert.equal(a.getState().rejected, 0);
    await sleep(120);
    ca.combatants.applyDamage(`net-${bId}`, 66, info);
    await until(() => cb.deaths.length === 1);
    assert.equal(cb.deaths[0], cb.combatants.get(`net-${aId}`).actor, 'killer puppet is the death source');
    await until(() => ca.kills.length === 1 && cb.kills.length === 1);
    assert.deepEqual([ca.kills[0].killerId, ca.kills[0].victimId], ['player', `net-${bId}`]);
    assert.deepEqual([cb.kills[0].killerId, cb.kills[0].victimId], [`net-${aId}`, 'player']);
    assert.equal(ca.kills[0].region, 'head');
    assert.ok(ca.markers.includes('kill'));
    assert.equal(cb.markers.includes('kill'), false);
    const standing = (ctx, id) => ctx.match.getState().standings.find((s) => s.id === id);
    await until(() => standing(ca, 'player').kills === 1 && standing(cb, `net-${aId}`)?.kills === 1);
    assert.equal(standing(ca, `net-${bId}`).deaths, 1);
    assert.equal(standing(cb, 'player').deaths, 1);
    await until(() => cb.respawns.length === respawnsBefore + 1 && cb.playerHealth.dead === false);
    await until(() => ca.combatants.get(`net-${bId}`).dead() === false);

    // remote shot relay -> tracer on the peer
    ca.bus.emit('shot', { shooterId: 'player', weaponId: 'm27', origin: [0, 60, 0], end: [200, 60, 0], hitId: null });
    await until(() => cb.shots.length === 1);

    // leaving removes the puppet and the standing
    b.disconnect();
    await until(() => a.getState().peers.length === 0);
    assert.equal(ca.combatants.get(`net-${bId}`), null);
    assert.equal(standing(ca, `net-${bId}`), undefined);
  } finally {
    clearInterval(pump);
    a.disconnect();
    b.disconnect();
    await server.close();
  }
});
