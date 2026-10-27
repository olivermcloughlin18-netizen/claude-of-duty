import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetClient } from '../../export/web/net-client.js';
import { startServer, sleep } from './helpers.mjs';

test('net-client round trip: connect, state, hit, kill, reconnect', async () => {
  const s = await startServer({ killLimit: 5 });
  const A = createNetClient({ url: s.url, backoffMs: 20 });
  const B = createNetClient({ url: s.url, backoffMs: 20 });
  const ja = await A.connect(null, 'Ann');
  assert.equal(A.connected, true);
  assert.equal(A.roomCode, ja.room);
  assert.equal(A.id, ja.id);
  await B.connect(ja.room, 'Ben');
  const snaps = [];
  A.on('snapshot', (m) => snaps.push(m));
  const damage = new Promise((r) => B.on('damage', r));
  const kill = new Promise((r) => A.on('kill', r));
  await sleep(60);
  A.sendState({ pos: [0, 0, 0], yaw: 0, pitch: 0, vel: [0, 0, 0], weaponId: 'sa58', crouch: false });
  assert.equal(A.sendState({ pos: [1, 0, 0], yaw: 0, pitch: 0 }), false, 'throttled');
  B.sendState({ pos: [400, 0, 0], yaw: 0, pitch: 0, vel: [0, 0, 0], weaponId: 'm27', crouch: false });
  await sleep(150);
  assert.ok(snaps.some((m) => m.players.find((p) => p.id === B.id)?.pos[0] === 400));
  const claim = { targetId: B.id, weaponId: 'sa58', damage: 55, headshot: false, shooterPos: [0, 0, 0], targetPos: [400, 0, 0] };
  assert.equal(A.sendHit(claim), true);
  assert.equal((await damage).hp, 45);
  await sleep(120);
  A.sendHit(claim);
  assert.equal((await kill).victimId, B.id);

  // drop B's socket server-side; client reconnects into the same room with a new id
  const oldId = B.id;
  const rejoined = new Promise((r) => B.on('joined', r));
  for (const room of s.server.rooms.values()) room.players.get(oldId).ws.terminate();
  const j2 = await rejoined;
  assert.equal(j2.room, ja.room);
  assert.notEqual(j2.id, oldId);
  assert.equal(B.connected, true);

  B.disconnect();
  assert.equal(B.connected, false);
  await assert.rejects(createNetClient({ url: s.url }).connect('ZZZZZ', 'x'), { code: 'room_not_found' });
  A.disconnect();
  await sleep(50);
  await s.server.close();
});
