import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CLASSES, STORAGE_KEY, readClasses, sanitizeClass, writeClasses } from '../export/web/loadout.js';
import { resolveWeapon } from '../export/web/weapons.js';

const memory = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, data };
};

test('defaults: class 1 stays m27/an94 and all five resolve', () => {
  assert.equal(DEFAULT_CLASSES.length, 5);
  assert.equal(DEFAULT_CLASSES[0].primary, 'm27');
  assert.equal(DEFAULT_CLASSES[0].secondary, 'an94');
  for (const cls of DEFAULT_CLASSES) {
    resolveWeapon(cls.primary, cls.primaryAttachments);
    resolveWeapon(cls.secondary, cls.secondaryAttachments);
    assert.deepEqual(sanitizeClass(cls, DEFAULT_CLASSES[0]), cls);
  }
});

test('sanitizeClass caps attachments and repairs invalid choices', () => {
  const cls = sanitizeClass({ name: '  x'.repeat(20), primary: 'tar_smg', primaryAttachments: ['grip', 'rapid', 'extmag', 'nope', 'grip'],
    secondary: 'smr_bolt', secondaryAttachments: ['suppressor', 'grip'] }, DEFAULT_CLASSES[1]);
  assert.equal(cls.name.length <= 14, true);
  assert.deepEqual(cls.primaryAttachments, ['grip', 'rapid']);
  assert.equal(cls.secondary, 'scar_pump', 'sniper is not a legal secondary; falls back');
  assert.deepEqual(cls.secondaryAttachments, ['suppressor']);
  assert.equal(sanitizeClass({ primary: 'bogus' }, DEFAULT_CLASSES[2]).primary, 'smr_bolt');
  assert.notEqual(sanitizeClass({ primary: 'scar_pump', secondary: 'scar_pump' }, DEFAULT_CLASSES[1]).secondary, 'scar_pump');
  assert.equal(sanitizeClass(null).primary, 'm27');
});

test('classes round-trip through storage and survive corruption', () => {
  const storage = memory();
  assert.equal(readClasses(storage).selected, 0);
  const data = readClasses(storage);
  data.classes[3] = sanitizeClass({ name: 'Mine', primary: 'fal_marksman', primaryAttachments: ['grip'], secondary: 't25_smg' }, DEFAULT_CLASSES[3]);
  data.selected = 3;
  assert.ok(writeClasses(storage, data));
  assert.ok(storage.data[STORAGE_KEY]);
  const again = readClasses(storage);
  assert.equal(again.selected, 3);
  assert.equal(again.classes[3].name, 'Mine');
  assert.equal(again.classes[3].secondary, 't25_smg');
  assert.equal(readClasses(memory({ [STORAGE_KEY]: '{bad json' })).classes.length, 5);
  assert.equal(readClasses(memory({ [STORAGE_KEY]: JSON.stringify({ selected: 99, classes: [] }) })).selected, 0);
});
