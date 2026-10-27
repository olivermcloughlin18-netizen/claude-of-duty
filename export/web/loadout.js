// Loadout system (PLAN.md 3.4 / lane A): five editable classes saved in
// localStorage, applied through ctx.weapons, plus the sniper scope overlay.
// The pure half (class validation, storage) imports no DOM and runs in Node.
import { ATTACHMENTS, WEAPONS, getWeapon, resolveWeapon } from './weapons.js';

export const STORAGE_KEY = 'cod.classes.v1';
export const CLASS_COUNT = 5;
export const MAX_PRIMARY_ATTACHMENTS = 2;
export const MAX_SECONDARY_ATTACHMENTS = 1;
// The shipped default class pairs the M27 with the AN-94 (the harness depends
// on it), so the AN-94 is the one non-SMG/shotgun secondary that validates.
const LEGACY_SECONDARY = 'an94';
const SECONDARY_FALLBACKS = ['an94', 'scar_pump', 't25_smg', 'tar_smg'];

export const DEFAULT_CLASSES = Object.freeze([
  { name: 'Assault', primary: 'm27', primaryAttachments: [], secondary: 'an94', secondaryAttachments: [] },
  { name: 'Rusher', primary: 'tar_smg', primaryAttachments: ['rapid', 'grip'], secondary: 'scar_pump', secondaryAttachments: [] },
  { name: 'Sniper', primary: 'smr_bolt', primaryAttachments: ['fastmag', 'extmag'], secondary: 't25_smg', secondaryAttachments: ['suppressor'] },
  { name: 'Marksman', primary: 'fal_marksman', primaryAttachments: ['longbarrel', 'grip'], secondary: 'tar_smg', secondaryAttachments: [] },
  { name: 'Ghost', primary: 't25_smg', primaryAttachments: ['suppressor', 'grip'], secondary: 'scar_pump', secondaryAttachments: [] },
].map((entry) => Object.freeze(entry)));

const knownAttachments = (list, max) => [...new Set(Array.isArray(list) ? list : [])]
  .filter((id) => typeof id === 'string' && Object.hasOwn(ATTACHMENTS, id)).slice(0, max);

const isSecondaryOk = (id, primaryId) => {
  const def = getWeapon(id);
  return Boolean(def) && def.id !== primaryId && (def.class === 'smg' || def.class === 'shotgun' || def.id === LEGACY_SECONDARY);
};

/** Coerce anything into a valid class, borrowing from `fallback` per field. */
export function sanitizeClass(raw, fallback = DEFAULT_CLASSES[0]) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const name = typeof value.name === 'string' && value.name.trim()
    ? value.name.trim().slice(0, 14) : fallback.name;
  const primary = getWeapon(value.primary)?.id ?? getWeapon(fallback.primary).id;
  let secondary = value.secondary == null ? null : getWeapon(value.secondary)?.id ?? null;
  if (!secondary || !isSecondaryOk(secondary, primary)) {
    secondary = [fallback.secondary, ...SECONDARY_FALLBACKS].find((id) => isSecondaryOk(id, primary)) ?? null;
  }
  const result = {
    name,
    primary,
    primaryAttachments: knownAttachments(value.primaryAttachments, MAX_PRIMARY_ATTACHMENTS),
    secondary,
    secondaryAttachments: knownAttachments(value.secondaryAttachments, MAX_SECONDARY_ATTACHMENTS),
  };
  try {
    resolveWeapon(result.primary, result.primaryAttachments);
    if (secondary) resolveWeapon(secondary, result.secondaryAttachments);
  } catch {
    return { ...fallback, primaryAttachments: [...fallback.primaryAttachments], secondaryAttachments: [...fallback.secondaryAttachments] };
  }
  return result;
}

/** -> { selected, classes[5] }; corrupt or missing storage falls back to defaults. */
export function readClasses(storage) {
  let parsed = null;
  try { parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null'); } catch { parsed = null; }
  const list = Array.isArray(parsed?.classes) ? parsed.classes : [];
  const classes = DEFAULT_CLASSES.map((fallback, index) => sanitizeClass(list[index], fallback));
  const selected = Number.isInteger(parsed?.selected) && parsed.selected >= 0 && parsed.selected < CLASS_COUNT ? parsed.selected : 0;
  return { selected, classes };
}

export function writeClasses(storage, { selected, classes }) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify({ selected, classes })); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// System (browser)
// ---------------------------------------------------------------------------

const SCOPE_ENTER = 0.85;
const ATTACHMENT_IDS = Object.keys(ATTACHMENTS);

const STYLE = `
#scope-overlay { position: fixed; inset: 0; opacity: 0; pointer-events: none; transition: opacity .06s linear;
  background: radial-gradient(circle at 50% 50%, transparent 0, transparent calc(var(--scope-r) - 2px), rgba(0,0,0,.55) calc(var(--scope-r) - 1px), #000 calc(var(--scope-r) + 8px)); --scope-r: 44vmin; }
#scope-overlay[data-on="true"] { opacity: 1; }
#scope-overlay i { position: absolute; background: #050607; }
#scope-overlay .h { left: calc(50% - var(--scope-r)); width: calc(var(--scope-r) * 2); top: calc(50% - .5px); height: 1px; }
#scope-overlay .v { top: calc(50% - var(--scope-r)); height: calc(var(--scope-r) * 2); left: calc(50% - .5px); width: 1px; }
#scope-overlay .dot { left: calc(50% - 2px); top: calc(50% - 2px); width: 4px; height: 4px; border-radius: 50%; background: #050607; }
.fe-class-editor { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 6px 8px; background: rgba(7, 18, 26, .72); }
.fe-class-tabs { display: flex; gap: 4px; }
.fe-class-tab, .fe-class-chip { appearance: none; border: 1px solid rgba(139, 173, 198, .3); background: rgba(139, 173, 198, .1);
  color: #e6f2ff; font: inherit; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; padding: 5px 9px; cursor: pointer; }
.fe-class-tab[data-selected="true"], .fe-class-chip[data-on="true"] { border-color: var(--fe-accent); color: var(--fe-accent); background: rgba(127, 255, 196, .12); }
.fe-class-chip:disabled { opacity: .35; cursor: default; }
.fe-class-field { display: flex; align-items: center; gap: 6px; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: rgba(206, 224, 240, .6); }
.fe-class-field b { color: #f1f7ff; font-weight: 600; }
.fe-class-field input, .fe-class-field select { font: inherit; font-size: 11px; color: #e6f2ff; background: rgba(2, 8, 12, .8);
  border: 1px solid rgba(139, 173, 198, .3); padding: 4px 6px; max-width: 150px; }
.fe-class-chips { display: flex; flex-wrap: wrap; gap: 3px; }
`;

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const [key, value] of Object.entries(props.dataset ?? {})) node.dataset[key] = value;
  node.append(...children);
  return node;
};

const state = {
  ctx: null,
  storage: null,
  data: null,
  draft: null,
  ready: false,
  scoped: false,
  applied: new Map(),
  current: { primary: null, secondary: null },
  scopeEl: null,
  hidden: null,
  baseFov: 75,
  fovTarget: null,
  editor: null,
  wasOpen: false,
  syncPending: false,
};

const cloneClass = (cls) => ({
  ...cls, primaryAttachments: [...cls.primaryAttachments], secondaryAttachments: [...cls.secondaryAttachments],
});

async function applyClass(index = state.data.selected) {
  const { ctx } = state;
  const cls = sanitizeClass(state.data.classes[index], DEFAULT_CLASSES[index]);
  const wanted = new Map([[cls.primary, cls.primaryAttachments]]);
  if (cls.secondary) wanted.set(cls.secondary, cls.secondaryAttachments);
  // Weapons that left the loadout go back to their stock definition.
  for (const id of state.applied.keys()) {
    if (!wanted.has(id)) { ctx.weapons.applyDefinition(id, WEAPONS[id]); state.applied.delete(id); }
  }
  for (const [id, attachments] of wanted) {
    const key = attachments.join(',');
    if (state.applied.get(id) !== key) {
      ctx.weapons.applyDefinition(id, resolveWeapon(id, attachments));
      state.applied.set(id, key);
    }
  }
  await ctx.weapons.load([...wanted.keys()]);
  const ok = await ctx.weapons.setLoadout({ primary: cls.primary, secondary: cls.secondary });
  if (ok) {
    state.data.selected = index;
    state.current = { primary: { id: cls.primary, attachments: cls.primaryAttachments },
      secondary: cls.secondary ? { id: cls.secondary, attachments: cls.secondaryAttachments } : null };
    state.ready = true;
  }
  return ok;
}

function saveClass(index, raw) {
  const cls = sanitizeClass(raw, DEFAULT_CLASSES[index]);
  state.data.classes[index] = cls;
  state.data.selected = index;
  writeClasses(state.storage, state.data);
  return cls;
}

// -- scope --------------------------------------------------------------------

function updateScope() {
  const { ctx } = state;
  const hijacked = globalThis.hijacked;
  const viewmodel = hijacked?.viewmodel;
  const def = ctx.weapons.definition(ctx.weapons.activeId());
  const scopeFov = def?.scope ? (def.scopeFov ?? 14) : null;
  const blend = viewmodel && scopeFov ? viewmodel.aimBlend : 0;
  const scoped = blend > SCOPE_ENTER && !ctx.playerHealth?.dead;
  if (scoped !== state.scoped) {
    state.scoped = scoped;
    state.scopeEl.dataset.on = String(scoped);
    if (scoped) { viewmodel.scene.visible = false; state.hidden = viewmodel; }
    else if (state.hidden) { state.hidden.scene.visible = !ctx.playerHealth?.dead; state.hidden = null; }
  }
  // Zoom the world camera with the sight picture; otherwise leave the fov alone.
  const t = scopeFov ? Math.max(0, (blend - 0.2) / 0.8) : 0;
  const fov = state.baseFov + ((scopeFov ?? state.baseFov) - state.baseFov) * t;
  if (Math.abs(ctx.camera.fov - fov) > 0.01) {
    ctx.camera.fov = fov;
    ctx.camera.updateProjectionMatrix();
  }
}

// -- editor -------------------------------------------------------------------

function buildEditor() {
  const host = document.getElementById('fe-class-editor');
  if (!host) return null;
  const tabs = el('div', { className: 'fe-class-tabs' });
  const name = el('input', { type: 'text', maxLength: 14, ariaLabel: 'Class name' });
  const primary = el('b');
  const secondary = el('select', { ariaLabel: 'Secondary weapon' });
  for (const def of Object.values(WEAPONS)) {
    if (def.class === 'smg' || def.class === 'shotgun' || def.id === LEGACY_SECONDARY) secondary.append(el('option', { value: def.id, textContent: def.name }));
  }
  const primaryChips = el('div', { className: 'fe-class-chips' });
  const secondaryChips = el('div', { className: 'fe-class-chips' });
  const chip = (id, which) => el('button', { type: 'button', className: 'fe-class-chip', textContent: ATTACHMENTS[id].name, dataset: { attachment: id, which } });
  for (const id of ATTACHMENT_IDS) { primaryChips.append(chip(id, 'primary')); secondaryChips.append(chip(id, 'secondary')); }
  const field = (label, ...nodes) => el('label', { className: 'fe-class-field' }, label, ...nodes);
  host.append(
    tabs,
    field('Name', name),
    field('Primary', primary),
    field('Attach', primaryChips),
    field('Secondary', secondary),
    field('Attach', secondaryChips),
  );
  for (let i = 0; i < CLASS_COUNT; i += 1) {
    tabs.append(el('button', { type: 'button', className: 'fe-class-tab', textContent: String(i + 1), dataset: { classIndex: i } }));
  }
  const editor = { host, tabs, name, primary, secondary, primaryChips, secondaryChips, index: state.data.selected };

  const stop = (event) => event.stopPropagation();
  host.addEventListener('click', stop);
  tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-class-index]');
    if (tab) selectTab(Number(tab.dataset.classIndex));
  });
  name.addEventListener('input', () => { state.draft.name = name.value; });
  secondary.addEventListener('change', () => { state.draft.secondary = secondary.value; renderEditor(); });
  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-attachment]');
    if (!button) return;
    const key = button.dataset.which === 'primary' ? 'primaryAttachments' : 'secondaryAttachments';
    const max = key === 'primaryAttachments' ? MAX_PRIMARY_ATTACHMENTS : MAX_SECONDARY_ATTACHMENTS;
    const list = state.draft[key];
    const at = list.indexOf(button.dataset.attachment);
    if (at >= 0) list.splice(at, 1);
    else if (list.length < max) list.push(button.dataset.attachment);
    renderEditor();
  });
  // Weapon cards pick the primary. Capture so it runs before Frontend's own
  // handler (which stops propagation) and still sees disabled-card clicks as no-ops.
  const grid = document.querySelector('.fe-class-grid');
  grid?.addEventListener('click', (event) => {
    const card = event.target.closest('.fe-class-card');
    if (card && !card.disabled) { state.draft.primary = card.dataset.weaponId; renderEditor(); }
  }, true);
  // Save & equip: Frontend equips the highlighted card; this persists the class.
  document.querySelector('[data-action="class-confirm"]')?.addEventListener('click', () => {
    saveClass(editor.index, state.draft);
    void applyClass(editor.index);
  });
  return editor;
}

function selectTab(index) {
  state.editor.index = index;
  state.draft = cloneClass(state.data.classes[index]);
  state.syncPending = true;
  renderEditor();
}

function renderEditor() {
  const editor = state.editor;
  if (!editor) return;
  const draft = state.draft;
  if (!isSecondaryOk(draft.secondary, draft.primary)) {
    draft.secondary = sanitizeClass(draft, DEFAULT_CLASSES[editor.index]).secondary;
  }
  for (const tab of editor.tabs.children) tab.dataset.selected = String(Number(tab.dataset.classIndex) === editor.index);
  if (document.activeElement !== editor.name) editor.name.value = draft.name;
  editor.primary.textContent = getWeapon(draft.primary)?.name ?? draft.primary;
  for (const option of editor.secondary.options) option.disabled = option.value === draft.primary;
  editor.secondary.value = draft.secondary ?? '';
  for (const [chips, list, max] of [[editor.primaryChips, draft.primaryAttachments, MAX_PRIMARY_ATTACHMENTS],
    [editor.secondaryChips, draft.secondaryAttachments, MAX_SECONDARY_ATTACHMENTS]]) {
    for (const button of chips.children) {
      const on = list.includes(button.dataset.attachment);
      button.dataset.on = String(on);
      button.disabled = !on && list.length >= max;
    }
  }
  const selection = document.getElementById('fe-class-selection');
  if (selection) selection.textContent = `Class ${editor.index + 1}: ${draft.name}`;
}

function syncEditorWithScreen() {
  const open = document.getElementById('blocker')?.dataset.screen === 'class';
  if (open && !state.wasOpen) selectTab(state.data.selected);
  state.wasOpen = open;
  if (open && state.syncPending) {
    // Highlight the class's primary card once its viewmodel has loaded.
    const frontend = globalThis.hijacked?.frontend;
    if (frontend?.chooseWeapon(state.draft.primary)) state.syncPending = false;
  }
}

// -- system -------------------------------------------------------------------

export const system = {
  name: 'loadout',
  debug: {
    /** Apply (and select) saved class `index`; resolves true when equipped. */
    applyClass: (index = state.data.selected) => applyClass(index),
    /** Validate, persist and return class `index`; does not equip it. */
    saveClass: (index, cls) => saveClass(index, cls),
    getClasses: () => structuredClone(state.data),
  },
  init(ctx) {
    state.ctx = ctx;
    state.storage = globalThis.localStorage ?? null;
    state.data = readClasses(state.storage);
    state.baseFov = ctx.camera.fov;
    document.head.append(el('style', { textContent: STYLE }));
    state.scopeEl = el('div', { id: 'scope-overlay', dataset: { on: 'false' } },
      el('i', { className: 'h' }), el('i', { className: 'v' }), el('i', { className: 'dot' }));
    ctx.overlay.append(state.scopeEl);
    state.editor = buildEditor();
    state.draft = cloneClass(state.data.classes[state.data.selected]);
    // Primary and secondary preload here, so the first swap never waits.
    void applyClass(state.data.selected);
  },
  update(dt, frame) {
    if (!state.ctx) return;
    updateScope();
    syncEditorWithScreen();
  },
  onKey(code) { return false; },
  onTouchAction(action) { return false; },
  reset() {},
  getState() {
    if (!state.data) return {};
    return {
      classIndex: state.data.selected,
      classes: state.data.classes,
      primary: state.current.primary,
      secondary: state.current.secondary,
      scoped: state.scoped,
      ready: state.ready,
    };
  },
};

export default system;
