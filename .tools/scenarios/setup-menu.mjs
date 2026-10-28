// Map & mode screen through real clicks: picking Kestrel + TDM selects them, and Apply reloads into that map and mode.
import { makeDebug } from './_ks-common.mjs';

export async function run({ page, screenshot }) {
  const debug = makeDebug(page);
  const checks = {};
  const selected = (grid) => page.$$eval(`${grid} [data-selected="true"]`, (cards) => cards.map((c) => c.dataset.mapId ?? c.dataset.modeId));
  await debug((api) => { api.pause(); api.showMenu(true); });
  await page.click('button[data-action="setup"]');
  await page.waitForSelector('#fe-setup-maps [data-map-id="kestrel"]', { state: 'visible', timeout: 60000 });
  await page.click('#fe-setup-maps [data-map-id="kestrel"]');
  await page.click('#fe-setup-modes [data-mode-id="tdm"]');
  checks.mapCardSelects = (await selected('#fe-setup-maps')).join() === 'kestrel';
  checks.modeCardSelects = (await selected('#fe-setup-modes')).join() === 'tdm';
  await screenshot('setup-picked');
  await Promise.all([page.waitForURL(/map=kestrel/, { timeout: 30000 }), page.click('button[data-action="setup-apply"]')]);
  checks.applyUrl = /map=kestrel/.test(page.url()) && /mode=tdm/.test(page.url());
  await page.waitForFunction(() => globalThis.hijacked?.debug?.getState().ready === true, null, { timeout: 240000 }); // fresh page
  const state = await debug((api) => api.getState());
  checks.reloadedIntoChoice = state.config.mapId === 'kestrel' && state.config.modeId === 'tdm';
  return { checks, probe: { url: page.url(), config: state.config } };
}
