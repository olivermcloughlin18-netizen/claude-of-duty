import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, state, sleep } from './helpers.mjs';
import { sanitizeName } from '../server.js';

async function duel(opts) {
  const s = await startServer(opts);
  const a = client(s.url); const b = client(s.url);
  const ja = await a.join(null, 'Alice');
  await b.join(ja.room, 'Bob');
  await a.wait('match_start');
  a.send(state([0, 0, 0])); b.send(state([500, 0, 0]));
  await a.wait('snapshot', (m) => m.players.length === 2);
  const claim = (over = {}) => ({ t: 'hit', targetId: b.id, weaponId: 'sa58', damage: 110, headshot: true,
    shooterPos: [0, 0, 0], targetPos: [500, 0, 0], ...over });
  const done = async () => { a.ws.close(); b.ws.close(); await s.server.close(); };
  return { s, a, b, ja, claim, done };
}

test('health endpoint and create/join room', async () => {
  const s = await startServer();
  const res = await fetch(`http://127.0.0.1:${s.port}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  const a = client(s.url); const b = client(s.url);
  const ja = await a.join(null, '<b>Al\u0000ice</b>');
  assert.match(ja.room, /^[A-Z0-9]{5}$/);
  assert.equal(ja.players[0].name, 'bAlice/b');
  const jb = await b.join(ja.room.toLowerCase(), 'Bob');
  assert.equal(jb.room, ja.room);
  assert.equal(jb.players.length, 2);
  assert.equal((await a.wait('peer_joined')).player.name, 'Bob');
  const c = client(s.url);
  await c.open; c.send({ t: 'join', room: 'ZZZZZ', name: 'x' });
  assert.equal((await c.wait('error')).code, 'room_not_found');
  a.ws.close(); b.ws.close(); await s.server.close();
});

test('sanitizeName strips control chars, html and clamps', () => {
  assert.equal(sanitizeName('  <script>x</script>‮\n'), 'scriptx/script');
  assert.equal(sanitizeName('a'.repeat(100)).length, 16);
  assert.equal(sanitizeName(42), 'Player');
});

test('snapshot relay between players', async () => {
  const { a, b, done } = await duel();
  b.send(state([123, 4, 5], { yaw: 1.5 }));
  const snap = await a.wait('snapshot', (m) => m.players.some((p) => p.id === b.id && p.pos[0] === 123));
  const p = snap.players.find((x) => x.id === b.id);
  assert.deepEqual(p.pos, [123, 4, 5]);
  assert.equal(p.yaw, 1.5);
  assert.equal(p.hp, 100);
  await done();
});

test('valid hit -> damage -> kill -> respawn, scoreboard + match end', async () => {
  const { a, b, claim, done } = await duel();
  a.send(claim({ damage: 55, headshot: false }));
  const d = await b.wait('damage');
  assert.equal(d.amount, 55); assert.equal(d.hp, 45); assert.equal(d.attackerId, a.id);
  await sleep(120);
  a.send(claim({ damage: 55, headshot: false }));
  const k = await a.wait('kill');
  assert.equal(k.killerId, a.id); assert.equal(k.victimId, b.id);
  const sc = await a.wait('scores', (m) => m.players.find((p) => p.id === a.id)?.kills === 1);
  assert.equal(sc.players.find((p) => p.id === b.id).deaths, 1);
  const r = await a.wait('respawn');
  assert.equal(r.id, b.id); assert.equal(r.hp, 100);
  // second kill hits killLimit=2 -> match_end
  await sleep(120);
  a.send(claim());
  const end = await a.wait('match_end');
  assert.equal(end.winnerId, a.id);
  await done();
});

test('bogus hits are rejected', async () => {
  const { s, a, b, claim, done } = await duel();
  const expectReject = async (over, reason) => {
    a.log.length = 0;
    a.send(claim(over));
    const r = await a.wait('hit_rejected');
    assert.equal(r.reason, reason);
    await sleep(100);
  };
  await expectReject({ damage: 500 }, 'bad_damage');
  await expectReject({ damage: 60, headshot: false }, 'bad_damage');
  await expectReject({ weaponId: 'railgun' }, 'unknown_weapon');
  await expectReject({ shooterPos: [900, 0, 0] }, 'position_mismatch');
  await expectReject({ targetId: 'nobody' }, 'unknown_target');
  await expectReject({ targetId: a.id }, 'self_hit');
  // out of range: move both truthfully 10000 apart
  b.send(state([10000, 0, 0])); await sleep(60);
  await expectReject({ targetPos: [10000, 0, 0] }, 'range');
  b.send(state([500, 0, 0])); await sleep(60);
  // bad schema
  a.log.length = 0;
  a.send({ t: 'hit', targetId: b.id, weaponId: 'sa58', damage: 'lots', headshot: true, shooterPos: [0, 0, 0], targetPos: [500, 0, 0] });
  assert.equal((await a.wait('error')).code, 'bad_message');
  a.send({ t: 'hit', targetId: b.id, weaponId: 'sa58', damage: 55, headshot: false, shooterPos: [0, 0, null], targetPos: [500, 0, 0] });
  a.send('{not json');
  await sleep(50);
  assert.equal(a.log.filter((m) => m.t === 'error').length, 3);
  assert.equal(b.count('damage'), 0);
  // too fast: first valid, immediate second rejected
  a.log.length = 0;
  a.send(claim({ damage: 55, headshot: false }));
  a.send(claim({ damage: 55, headshot: false }));
  assert.equal((await a.wait('hit_rejected')).reason, 'fire_rate');
  await sleep(50);
  assert.equal(b.count('damage'), 1);
  // dead shooter: kill a with b
  await sleep(100);
  const hitA = { t: 'hit', targetId: a.id, weaponId: 'sa58', damage: 110, headshot: true, shooterPos: [500, 0, 0], targetPos: [0, 0, 0] };
  b.send(hitA);
  await a.wait('kill');
  a.log.length = 0;
  await sleep(100);
  a.send(claim());
  assert.equal((await a.wait('hit_rejected')).reason, 'shooter_dead');
  await done();
});

test('room full', async () => {
  const s = await startServer({ maxConnPerIp: 20 });
  const cs = [client(s.url)];
  const j = await cs[0].join(null, 'p0');
  for (let i = 1; i < 8; i++) { cs.push(client(s.url)); await cs[i].join(j.room, `p${i}`); }
  const extra = client(s.url);
  await extra.open; extra.send({ t: 'join', room: j.room, name: 'late' });
  assert.equal((await extra.wait('error')).code, 'room_full');
  await extra.closedP;
  cs.forEach((c) => c.ws.close());
  await s.server.close();
});

test('mid-match join gets match info; empty room is deleted', async () => {
  const { s, a, b, ja, done } = await duel();
  const c = client(s.url);
  const jc = await c.join(ja.room, 'Late');
  assert.equal(jc.match.phase, 'playing');
  assert.ok(jc.match.timeLeftMs > 0);
  assert.equal(jc.players.length, 3);
  c.ws.close(); a.ws.close(); b.ws.close();
  await sleep(100);
  assert.equal(s.server.rooms.size, 0);
  await s.server.close();
});

test('rate limit kicks sustained flooding', async () => {
  const s = await startServer();
  const a = client(s.url);
  await a.join(null, 'spam');
  for (let i = 0; i < 400; i++) a.send({ t: 'ping', c: i });
  await a.closedP;
  assert.equal(a.closed, 1008);
  assert.ok(a.log.some((m) => m.t === 'error' && m.code === 'rate_limited'));
  await s.server.close();
});

test('origin allowlist and per-IP connection cap', async () => {
  const s = await startServer({ allowedOrigins: ['https://ok.example'], maxConnPerIp: 2 });
  const bad = client(s.url, { Origin: 'https://evil.example' });
  await assert.rejects(bad.open);
  const g1 = client(s.url, { Origin: 'https://ok.example' }); await g1.join();
  const g2 = client(s.url, { Origin: 'https://ok.example' }); await g2.open;
  const g3 = client(s.url, { Origin: 'https://ok.example' });
  await assert.rejects(g3.open);
  g1.ws.close(); g2.ws.close(); await s.server.close();
});

test('heartbeat timeout drops silent connection', async () => {
  const s = await startServer({ timeoutMs: 150, heartbeatMs: 60 });
  const a = client(s.url); await a.join();
  a.ws.pong = () => {}; // never answer server pings
  a.ws._receiver.removeAllListeners('ping');
  a.ws._receiver.on('ping', () => {});
  await a.closedP;
  await sleep(50);
  assert.equal(s.server.rooms.size, 0);
  await s.server.close();
});
