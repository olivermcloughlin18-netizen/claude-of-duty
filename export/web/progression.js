// XP / rank / prestige system (PLAN.md section 4, lane F).
// 55 levels, 10 prestiges, persisted in localStorage['cod.progression.v1'].
// The maths and storage helpers are pure so Node can test them; the DOM lives
// in init().

import { system as killcam } from './killcam.js';

export const MAX_LEVEL = 55;
export const MAX_PRESTIGE = 10;
export const STORAGE_KEY = 'cod.progression.v1';
export const XP = Object.freeze({ kill: 100, headshot: 50, streak: 50, matchComplete: 150, matchWin: 250 });
export const RANKS = Object.freeze([
  'Recruit', 'Private', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Lieutenant',
  'Captain', 'Major', 'Colonel', 'General', 'Commander',
]);

/** XP needed to climb from `level` to `level + 1`. */
export const levelCost = (level) => 600 + 50 * level;

/** Total XP at which `level` is reached. */
export function xpForLevel(level) {
  const n = Math.max(1, Math.min(MAX_LEVEL, Math.trunc(level))) - 1;
  return 600 * n + 25 * n * (n + 1);
}

export const MAX_XP = xpForLevel(MAX_LEVEL);

export function levelForXp(xp) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

export function rankName(level) {
  return RANKS[Math.min(RANKS.length - 1, Math.floor((Math.max(1, level) - 1) / 5))];
}

export function progressOf(xp) {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return { level, into: 0, needed: 0, fraction: 1 };
  const into = xp - xpForLevel(level);
  const needed = levelCost(level);
  return { level, into, needed, fraction: into / needed };
}

function clampProgress(value) {
  const xp = Number(value?.xp);
  const prestige = Number(value?.prestige);
  return {
    xp: Number.isFinite(xp) ? Math.max(0, Math.min(MAX_XP, Math.trunc(xp))) : 0,
    prestige: Number.isFinite(prestige) ? Math.max(0, Math.min(MAX_PRESTIGE, Math.trunc(prestige))) : 0,
  };
}

export function loadProgress(storage) {
  try {
    return clampProgress(JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return clampProgress(null);
  }
}

export function saveProgress(storage, progress) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(clampProgress(progress)));
    return true;
  } catch {
    return false;
  }
}

export function addXp(progress, amount) {
  return clampProgress({ ...progress, xp: progress.xp + Math.max(0, amount) });
}

export const canPrestige = (progress) => progress.xp >= MAX_XP && progress.prestige < MAX_PRESTIGE;

/** Reset to level 1 with one more prestige. A no-op until level 55. */
export function prestigeUp(progress) {
  return canPrestige(progress) ? { xp: 0, prestige: progress.prestige + 1 } : progress;
}

// ---------- system ----------

const STYLE = `
.pg-ticker{position:absolute;left:calc(50% + 64px);top:calc(50% + 18px);display:flex;flex-direction:column;gap:3px;font-family:var(--fe-ui,system-ui,sans-serif);pointer-events:none}
.pg-tick{display:flex;align-items:baseline;gap:8px;white-space:nowrap;animation:pg-pop 1.7s cubic-bezier(.2,.8,.2,1) forwards;text-shadow:0 1px 6px #000,0 0 12px rgba(0,0,0,.7)}
.pg-tick b{font-size:22px;font-weight:700;letter-spacing:.04em;color:var(--fe-accent,#7fffc4);font-variant-numeric:tabular-nums}
.pg-tick small{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:rgba(238,246,255,.82)}
.pg-tick.gold b{color:#ffcf5a}
@keyframes pg-pop{0%{opacity:0;transform:translateY(10px) scale(.85)}10%{opacity:1;transform:translateY(0) scale(1.12)}18%{transform:scale(1)}72%{opacity:1}100%{opacity:0;transform:translateY(-30px)}}
.pg-rank{display:flex;align-items:center;gap:14px;padding:10px 16px 10px 12px;min-width:310px;font-family:var(--fe-ui,system-ui,sans-serif);color:#eef6ff;background:linear-gradient(90deg,rgba(9,19,27,.78),rgba(9,19,27,.42));border-left:2px solid var(--fe-accent,#7fffc4)}
.pg-hex{position:relative;flex:none;width:54px;height:60px;display:grid;place-items:center;background:var(--fe-accent,#7fffc4);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);filter:drop-shadow(0 0 8px rgba(127,255,196,.5))}
.pg-hex::before{content:'';position:absolute;inset:3px;background:#07141c;clip-path:inherit}
.pg-hex span{position:relative;font-size:23px;font-weight:700;color:var(--fe-accent,#7fffc4);font-variant-numeric:tabular-nums}
.pg-hex.max span{color:#ffcf5a}
.pg-meta{flex:1;min-width:0}
.pg-name{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:15px;font-weight:700;letter-spacing:.2em;text-transform:uppercase}
.pg-name i{font-style:normal;font-size:11px;letter-spacing:.18em;color:#ffcf5a}
.pg-bar{height:6px;margin:7px 0 5px;background:rgba(160,200,220,.18);overflow:hidden}
.pg-bar i{display:block;height:100%;width:100%;transform-origin:left;background:var(--fe-accent,#7fffc4);box-shadow:0 0 10px var(--fe-accent,#7fffc4);transition:transform .9s cubic-bezier(.2,.8,.2,1)}
.pg-xp{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:rgba(206,224,240,.68);font-variant-numeric:tabular-nums}
.pg-pips{display:flex;gap:3px;margin-top:6px}
.pg-pips u{display:block;width:14px;height:3px;background:rgba(160,200,220,.2)}
.pg-pips u.on{background:#ffcf5a;box-shadow:0 0 6px #ffcf5a}
.pg-prestige{width:100%!important;margin-top:6px}
.pg-prestige[hidden]{display:none}
.pg-summary{margin-top:16px;padding-top:14px;border-top:1px solid rgba(160,200,220,.2);font-family:var(--fe-ui,system-ui,sans-serif)}
.pg-summary[hidden]{display:none}
.pg-sum-head{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:rgba(220,235,245,.62)}
.pg-sum-head b{font-size:26px;letter-spacing:.04em;color:var(--fe-accent,#7fffc4);font-variant-numeric:tabular-nums}
.pg-sum-rows{display:grid;grid-template-columns:1fr auto;gap:3px 18px;margin:10px 0;font-size:13px;letter-spacing:.08em}
.pg-sum-rows span:nth-child(even){text-align:right;color:var(--fe-accent,#7fffc4);font-variant-numeric:tabular-nums}
.pg-sum-level{display:flex;align-items:center;gap:12px;font-size:12px;letter-spacing:.18em;text-transform:uppercase}
.pg-sum-level .pg-bar{flex:1;margin:0}
.pg-sum-up{color:#ffcf5a;font-weight:700}
`;

const ctxHolder = { ctx: null };
let storage = null;
let progress = { xp: 0, prestige: 0 };
let lastGain = null;
let session = null;
let ui = null;
let confirmTimer = 0;
let countTarget = 0;
let countShown = 0;

const newSession = () => ({
  kills: 0, headshots: 0, medalXp: 0, streaks: 0, completion: 0, win: 0, total: 0,
  startXp: progress.xp, startPrestige: progress.prestige,
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');

function buildUi(ctx) {
  const style = el('style');
  style.textContent = STYLE;
  const ticker = el('div', 'pg-ticker');
  ctx.overlay.append(style, ticker);

  // Title-screen rank badge. The frontend shell is host DOM; this is injected at runtime.
  const rank = el('div', 'pg-rank');
  const hex = el('div', 'pg-hex');
  const hexNumber = el('span');
  hex.append(hexNumber);
  const meta = el('div', 'pg-meta');
  const nameLine = el('div', 'pg-name');
  const name = el('b');
  const prestigeTag = el('i');
  nameLine.append(name, prestigeTag);
  const bar = el('div', 'pg-bar');
  const fill = el('i');
  bar.append(fill);
  const xpLine = el('div', 'pg-xp');
  const pips = el('div', 'pg-pips');
  for (let i = 0; i < MAX_PRESTIGE; i += 1) pips.append(el('u'));
  const button = el('button', 'fe-btn pg-prestige', 'Prestige');
  button.type = 'button';
  button.hidden = true;
  meta.append(nameLine, bar, xpLine, pips, button);
  rank.append(hex, meta);
  const foot = document.querySelector('#blocker .fe-start-foot');
  foot?.insertBefore(rank, foot.firstChild);

  // End-of-match summary lives inside the scoreboard panel.
  const summary = el('div', 'pg-summary');
  summary.hidden = true;
  const sumHead = el('div', 'pg-sum-head');
  const sumLabel = el('span', null, 'Match XP');
  const sumTotal = el('b', null, '+0');
  sumHead.append(sumLabel, sumTotal);
  const sumRows = el('div', 'pg-sum-rows');
  const sumLevel = el('div', 'pg-sum-level');
  const sumLevelText = el('span');
  const sumBar = el('div', 'pg-bar');
  const sumFill = el('i');
  sumBar.append(sumFill);
  const sumUp = el('span', 'pg-sum-up');
  sumLevel.append(sumLevelText, sumBar, sumUp);
  summary.append(sumHead, sumRows, sumLevel);
  document.querySelector('#scoreboard .scoreboard-panel')?.append(summary);

  return {
    ticker, rank, hex, hexNumber, name, prestigeTag, fill, xpLine, pips, button,
    summary, sumTotal, sumRows, sumLevelText, sumFill, sumUp,
  };
}

function refreshBadge() {
  if (!ui) return;
  const { level, into, needed, fraction } = progressOf(progress.xp);
  const maxed = level >= MAX_LEVEL;
  ui.hexNumber.textContent = String(level);
  ui.hex.classList.toggle('max', maxed);
  ui.name.textContent = rankName(level);
  ui.prestigeTag.textContent = progress.prestige ? `Prestige ${progress.prestige}` : '';
  ui.fill.style.transform = `scaleX(${fraction})`;
  ui.xpLine.textContent = maxed ? `Max level · ${fmt(progress.xp)} XP` : `${fmt(into)} / ${fmt(needed)} XP`;
  [...ui.pips.children].forEach((pip, i) => pip.classList.toggle('on', i < progress.prestige));
  ui.button.hidden = !canPrestige(progress);
  ui.button.textContent = 'Prestige';
}

function popTick(amount, label, gold = false) {
  if (!ui) return;
  const tick = el('div', `pg-tick${gold ? ' gold' : ''}`);
  tick.append(el('b', null, `+${amount}`), el('small', null, label));
  tick.addEventListener('animationend', () => tick.remove());
  ui.ticker.append(tick);
  while (ui.ticker.children.length > 5) ui.ticker.firstChild.remove();
}

function gain(amount, reason, bucket, { gold = false, silent = false } = {}) {
  if (!(amount > 0)) return;
  const before = levelForXp(progress.xp);
  progress = addXp(progress, amount);
  saveProgress(storage, progress);
  lastGain = { amount, reason };
  if (session) {
    session.total += amount;
    if (bucket) session[bucket] += bucket === 'kills' || bucket === 'headshots' || bucket === 'streaks' ? 1 : amount;
  }
  if (!silent) popTick(amount, reason, gold);
  const after = levelForXp(progress.xp);
  if (after > before) {
    ctxHolder.ctx?.notify(`Rank up · Level ${after} · ${rankName(after)}`, { seconds: 3.2 });
  }
  refreshBadge();
}

function renderSummary() {
  if (!ui || !session) return;
  const rows = [
    [`Kills × ${session.kills}`, session.kills * XP.kill],
    [`Headshots × ${session.headshots}`, session.headshots * XP.headshot],
    ['Medals', session.medalXp],
    [`Killstreaks × ${session.streaks}`, session.streaks * XP.streak],
    ['Match completed', session.completion],
    ['Victory', session.win],
  ].filter(([, value]) => value > 0);
  ui.sumRows.replaceChildren(...rows.flatMap(([label, value]) => [el('span', null, label), el('span', null, `+${fmt(value)}`)]));
  const before = progressOf(Math.min(MAX_XP, session.startXp));
  const after = progressOf(progress.xp);
  const leveled = session.startPrestige === progress.prestige && after.level > before.level;
  ui.sumLevelText.textContent = `Level ${after.level}`;
  ui.sumUp.textContent = leveled ? `Level up ×${after.level - before.level}` : '';
  // Animate from where the match began to where it ended.
  ui.sumFill.style.transition = 'none';
  ui.sumFill.style.transform = `scaleX(${leveled ? 0 : before.fraction})`;
  void ui.sumFill.offsetWidth;
  ui.sumFill.style.transition = '';
  ui.sumFill.style.transform = `scaleX(${after.fraction})`;
  countTarget = session.total;
  countShown = 0;
  ui.summary.hidden = false;
}

function onMatch(event) {
  if (event.phase === 'playing') {
    session = newSession();
    if (ui) ui.summary.hidden = true;
    return;
  }
  if (event.phase !== 'ended' || !session || session.finished) return;
  session.finished = true;
  const ctx = ctxHolder.ctx;
  const won = event.winnerId === 'player' ||
    (event.winnerTeam && ctx.combatants.teamOf('player') === event.winnerTeam);
  session.completion = XP.matchComplete;
  gain(XP.matchComplete, 'Match completed', null, { silent: true });
  if (won) {
    session.win = XP.matchWin;
    gain(XP.matchWin, 'Victory', null, { silent: true });
  }
}

export const progressionSystem = {
  name: 'progression',
  debug: {
    /** Set total XP (clamped to 0..max) and persist it. */
    setXp(n) {
      progress = clampProgress({ ...progress, xp: Number(n) });
      saveProgress(storage, progress);
      refreshBadge();
      return { ...progress, level: levelForXp(progress.xp) };
    },
    prestige() {
      progress = prestigeUp(progress);
      saveProgress(storage, progress);
      refreshBadge();
      return { ...progress };
    },
  },
  init(ctx) {
    ctxHolder.ctx = ctx;
    try { storage = globalThis.localStorage; } catch { storage = null; }
    progress = loadProgress(storage);
    session = newSession();
    lastGain = null;
    ui = buildUi(ctx);
    ui.button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!canPrestige(progress)) return;
      if (!confirmTimer) {
        // Prestige wipes the level, so ask once.
        ui.button.textContent = 'Confirm prestige?';
        confirmTimer = setTimeout(() => { confirmTimer = 0; ui.button.textContent = 'Prestige'; }, 3500);
        return;
      }
      clearTimeout(confirmTimer);
      confirmTimer = 0;
      progress = prestigeUp(progress);
      saveProgress(storage, progress);
      lastGain = { amount: 0, reason: 'Prestige' };
      refreshBadge();
    });
    refreshBadge();

    ctx.bus.on('kill', (event) => {
      if (event.killerId !== 'player' || event.victimId === 'player') return;
      gain(XP.kill, 'Kill', 'kills');
      if (event.region === 'head') gain(XP.headshot, 'Headshot', 'headshots', { gold: true });
    });
    ctx.bus.on('medal', (event) => gain(Number(event.xp) || 0, event.name ?? 'Medal', 'medalXp', { gold: true }));
    ctx.bus.on('streak', (event) => {
      if (event.ownerId === 'player' && event.phase === 'activated') gain(XP.streak, 'Killstreak', 'streaks');
    });
    ctx.bus.on('match', onMatch);
  },
  update(dt) {
    if (!ui) return;
    // Show the summary once the final killcam has finished, then count it up.
    const ctx = ctxHolder.ctx;
    if (session?.finished && ui.summary.hidden && killcam.settled && ctx.match.phase === 'ended') renderSummary();
    if (!ui.summary.hidden && countShown < countTarget) {
      countShown = Math.min(countTarget, countShown + Math.max(40, countTarget) * dt * 1.4);
      ui.sumTotal.textContent = `+${fmt(countShown)}`;
    }
  },
  onKey() { return false; },
  onTouchAction() { return false; },
  reset() {
    session = newSession();
    if (ui) ui.summary.hidden = true;
  },
  getState() {
    const { level } = progressOf(progress.xp);
    return {
      xp: progress.xp, level, prestige: progress.prestige, rank: rankName(level), lastGain,
      sessionXp: session?.total ?? 0,
    };
  },
};

export const system = progressionSystem;
export default system;
