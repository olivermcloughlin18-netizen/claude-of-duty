import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_LEVEL, MAX_PRESTIGE, MAX_XP, STORAGE_KEY, addXp, canPrestige, levelCost, levelForXp, loadProgress,
  prestigeUp, progressOf, rankName, saveProgress, xpForLevel,
} from '../export/web/progression.js';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
};

test('55 levels with consistent thresholds', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(xpForLevel(1), 0);
  for (let level = 1; level < MAX_LEVEL; level += 1) {
    assert.equal(xpForLevel(level + 1) - xpForLevel(level), levelCost(level));
    assert.equal(levelForXp(xpForLevel(level + 1) - 1), level);
    assert.equal(levelForXp(xpForLevel(level + 1)), level + 1);
  }
  assert.equal(levelForXp(MAX_XP), MAX_LEVEL);
  assert.equal(levelForXp(MAX_XP * 5), MAX_LEVEL);
  assert.equal(rankName(1), 'Recruit');
  assert.equal(rankName(55), 'Commander');
  assert.equal(progressOf(MAX_XP).fraction, 1);
});

test('xp clamps, persists and survives garbage storage', () => {
  const store = memory();
  assert.deepEqual(loadProgress(store), { xp: 0, prestige: 0 });
  saveProgress(store, addXp({ xp: 0, prestige: 2 }, 100));
  assert.deepEqual(loadProgress(store), { xp: 100, prestige: 2 });
  assert.deepEqual(addXp({ xp: MAX_XP - 5, prestige: 0 }, 1000), { xp: MAX_XP, prestige: 0 });
  store.setItem(STORAGE_KEY, '{"xp":"bad","prestige":99}');
  assert.deepEqual(loadProgress(store), { xp: 0, prestige: MAX_PRESTIGE });
  store.setItem(STORAGE_KEY, 'not json');
  assert.deepEqual(loadProgress(store), { xp: 0, prestige: 0 });
});

test('prestige needs level 55 and caps at 10', () => {
  assert.equal(canPrestige({ xp: MAX_XP - 1, prestige: 0 }), false);
  assert.deepEqual(prestigeUp({ xp: MAX_XP - 1, prestige: 0 }), { xp: MAX_XP - 1, prestige: 0 });
  assert.deepEqual(prestigeUp({ xp: MAX_XP, prestige: 3 }), { xp: 0, prestige: 4 });
  assert.equal(canPrestige({ xp: MAX_XP, prestige: MAX_PRESTIGE }), false);
});
