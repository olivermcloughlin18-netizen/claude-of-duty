// Live leaderboard HUD: visible in play, rows == match standings, place updates on kills,
// hidden in the pause menu, team totals in TDM. Polls state rather than sleeping: frames are slow under load.
import { makeDebug, waitFor } from './_ks-common.mjs';

export const query = '';

export async function run({ page, openGame, screenshot }) {
  const debug = makeDebug(page);
  const checks = {};
  const probe = {};
  const lb = () => debug((api) => { const s = api.getState(); return { lb: s.hud.leaderboard, match: s.match }; });
  const matches = ({ lb: l, match: m }) => l.rows.length > 0 && l.rows.some((r) => r.me) && l.rows.every((r) => {
    const e = m.standings.find((x) => x.id === r.id);
    return e && e.score === r.score && e.place === r.place;
  }) && l.place === m.standings.find((x) => x.id === 'player').place;
  // the HUD repaints on the next frame, so poll until it agrees with the match
  const settle = async (ok, ms = 20000) => {
    const end = Date.now() + ms;
    let s = await lb();
    while (!ok(s) && Date.now() < end) { await page.waitForTimeout(250); s = await lb(); }
    return s;
  };

  await debug((api) => { api.setActive(true); api.resume(); api.restartMatch(); });
  let s = await settle((x) => matches(x) && x.lb.visible);
  checks.visibleInPlay = s.lb.visible === true;
  checks.rowsMatchStandings = matches(s);
  await screenshot('leaderboard-start');

  await debug((api) => { api.killCombatant('bot-3', { attackerId: 'bot-1' }); api.killCombatant('bot-5', { attackerId: 'bot-2' }); });
  s = await settle((x) => matches(x) && x.lb.place === 3);
  const before = s.lb.place;
  await debug((api) => { api.respawnEnemies(); for (const id of ['bot-0', 'bot-1', 'bot-2']) api.killCombatant(id); });
  s = await settle((x) => matches(x) && x.lb.place === 1);
  probe.places = { before, after: s.lb.place, rows: s.lb.rows.map((r) => `${r.place}:${r.name}:${r.score}`) };
  checks.placeImproves = before > 1 && s.lb.place === 1;
  checks.rowsStillMatch = matches(s);
  await page.waitForTimeout(800); // let the slide settle for the screenshot
  await screenshot('leaderboard-after-kills');

  await debug((api) => api.setActive(false));
  const end = Date.now() + 20000;
  s = await lb();
  while (s.lb.visible && Date.now() < end) { await page.waitForTimeout(300); s = await lb(); }
  probe.pause = s.lb.visible;
  checks.hiddenInPause = s.lb.visible === false;

  await openGame('mode=tdm');
  await debug((api) => { api.setActive(true); api.resume(); api.restartMatch(); });
  await debug((api) => { api.killCombatant('bot-3'); });
  const teamOk = (x) => x.lb.visible && x.lb.teams?.length === 2 && x.lb.teams.every((t) => t.score === x.match.teams.find((m) => m.id === t.id).score) &&
    x.lb.teams.find((t) => t.id === 'allies').score === 1;
  s = await settle(teamOk);
  probe.teams = s.lb.teams;
  checks.teamTotalsInTdm = teamOk(s);
  await page.waitForTimeout(600);
  await screenshot('leaderboard-tdm');
  // phone layouts: no overlap with the minimap (checked by box), screenshots for eyeballing
  await page.evaluate(() => document.body.classList.add("touch-mode"));
  for (const [name, size] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(1500);
    const boxes = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const [a, b] = [r('leaderboard'), r('hud-minimap')];
      return { overlapMinimap: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top, bottom: Math.round(a.bottom), right: Math.round(a.right) };
    });
    probe[name] = boxes;
    checks[`${name}NoMinimapOverlap`] = !boxes.overlapMinimap && boxes.right <= size.width && boxes.bottom <= size.height;
    await screenshot(`leaderboard-${name}`);
  }
  return { checks, probe };
}
