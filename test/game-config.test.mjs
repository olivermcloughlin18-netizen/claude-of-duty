import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SERVER_URL, readGameConfig, saveSetup, setupUrl } from '../export/web/game-config.js';

const memory = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, data };
};

test('defaults, frozen result', () => {
  const config = readGameConfig('', memory());
  assert.deepEqual({ ...config }, { mapId: 'hijacked', modeId: 'ffa', room: null, serverUrl: DEFAULT_SERVER_URL, name: '' });
  assert.ok(Object.isFrozen(config));
});

test('URL beats storage beats defaults, and invalid values fall back', () => {
  const storage = memory();
  saveSetup(storage, { mapId: 'hijacked', modeId: 'ffa', name: 'Ada' });
  assert.equal(readGameConfig('', storage).name, 'Ada');
  assert.equal(readGameConfig('?name=Bob', storage).name, 'Bob');
  assert.equal(readGameConfig('?map=nowhere&mode=nope', storage).mapId, 'hijacked');
  assert.equal(readGameConfig('?mode=nope', memory({ 'cod.setup.v1': '{not json' })).modeId, 'ffa');
});

test('room codes and server urls are validated; a room forces ffa', () => {
  assert.equal(readGameConfig('?room=new').room, 'NEW');
  assert.equal(readGameConfig('?room=ab12').room, 'AB12');
  assert.equal(readGameConfig('?room=abc').room, null);
  assert.equal(readGameConfig('?room=ABCDEFGHI').room, null);
  assert.equal(readGameConfig('?room=<b>').room, null);
  assert.equal(readGameConfig('?server=ws://127.0.0.1:9').serverUrl, 'ws://127.0.0.1:9');
  assert.equal(readGameConfig('?server=https://x.test').serverUrl, DEFAULT_SERVER_URL);
  assert.equal(readGameConfig('?server=javascript:alert(1)').serverUrl, DEFAULT_SERVER_URL);
});

test('setupUrl adds autostart and replaces the setup params only', () => {
  const url = new URL(setupUrl('https://x.test/play/?room=OLD&keep=1', { mapId: 'hijacked', modeId: 'ffa', room: null }));
  assert.equal(url.searchParams.get('autostart'), '1');
  assert.equal(url.searchParams.get('map'), 'hijacked');
  assert.equal(url.searchParams.get('room'), null);
  assert.equal(url.searchParams.get('keep'), '1');
  assert.equal(new URL(setupUrl('https://x.test/', { mapId: 'hijacked', modeId: 'ffa', room: 'NEW' })).searchParams.get('room'), 'NEW');
});

test('saveSetup stores a sanitised name and survives a throwing storage', () => {
  const storage = memory();
  assert.equal(saveSetup(storage, { mapId: 'x', modeId: 'y', name: '<script>alert(1)</script>very long name here' }), true);
  const saved = JSON.parse(storage.data['cod.setup.v1']);
  assert.equal(saved.mapId, 'hijacked');
  assert.equal(saved.modeId, 'ffa');
  assert.ok(!/[<>()]/.test(saved.name) && saved.name.length <= 16);
  assert.equal(saveSetup({ setItem() { throw new Error('quota'); } }, {}), false);
});
