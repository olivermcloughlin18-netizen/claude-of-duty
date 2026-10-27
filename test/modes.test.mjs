import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODES, getMode } from '../export/web/modes.js';
import { GUN_GAME_LADDER } from '../export/web/gun-game-match.js';
import { getWeapon } from '../export/web/weapons.js';

const team = (match) => {
  for (let i = 0; i < 4; i += 1) {
    match.register(`a${i}`, `A${i}`, { team: 'allies', human: i === 0 });
    match.register(`x${i}`, `X${i}`, { team: 'axis' });
  }
  return match;
};

test('new modes are registered, offline-only, and satisfy the contract shape', () => {
  for (const id of ['tdm', 'kc', 'gun']) {
    assert.equal(getMode(id).id, id);
    assert.equal(MODES[id].online, false);
    const state = MODES[id].createMatch().getState();
    for (const key of ['modeId', 'phase', 'scoreLimit', 'teams', 'scoreLabel', 'standings', 'feed', 'winnerTeam']) {
      assert.notEqual(state[key], undefined, `${id}.${key}`);
    }
  }
  assert.deepEqual([MODES.tdm.createMatch().scoreLimit, MODES.tdm.createMatch().timeLimitSeconds], [50, 480]);
  assert.equal(MODES.kc.createMatch().scoreLimit, 40);
  assert.equal(MODES.tdm.botCount, 7);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(MODES.tdm.teamFor), ['allies', 'allies', 'allies', 'axis', 'axis', 'axis', 'axis']);
});

test('TDM scores hostile kills per team and ends at the limit', () => {
  const match = team(MODES.tdm.createMatch());
  match.recordKill('a1', 'x0', {});
  match.recordKill('x1', 'a2', {});
  match.recordKill('a1', 'x2', {});
  assert.deepEqual(match.getState().teams.map((t) => t.score), [2, 1]);
  for (let i = 0; i < 48; i += 1) match.recordKill('a1', 'x0', {});
  const state = match.getState();
  assert.equal(state.phase, 'ended');
  assert.equal(state.winnerTeam, 'allies');
  assert.equal(state.winnerId, 'a1');
});

test('Kill Confirmed scores only through confirm()', () => {
  const match = team(MODES.kc.createMatch());
  match.recordKill('a0', 'x0', {});
  assert.deepEqual(match.getState().teams.map((t) => t.score), [0, 0]);
  assert.equal(match.confirm('a0'), true);
  assert.deepEqual(match.getState().teams.map((t) => t.score), [1, 0]);
  assert.equal(match.getState().standings.find((e) => e.id === 'a0').score, 1);
  for (let i = 0; i < 40; i += 1) match.confirm('x1');
  assert.equal(match.getState().winnerTeam, 'axis');
});

test('Gun Game ladder is 15 real weapons and the 15th kill wins', () => {
  assert.equal(GUN_GAME_LADDER.length, 15);
  for (const id of GUN_GAME_LADDER) assert.ok(getWeapon(id), id);
  const match = MODES.gun.createMatch();
  match.register('player', 'YOU', { human: true });
  match.register('bot-0', 'B');
  match.recordKill('player', 'bot-0', {});
  assert.equal(match.tierOf('player'), 1);
  assert.equal(match.getState().standings[0].score, 2);
  for (let i = 0; i < 14; i += 1) match.recordKill('player', 'bot-0', {});
  assert.equal(match.getState().phase, 'ended');
  assert.equal(match.getState().winnerId, 'player');
});
