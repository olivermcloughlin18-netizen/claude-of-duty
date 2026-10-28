// Class pick before spawning, through real clicks: title click -> pick screen (nothing spawned yet),
// Escape keeps the class, picking an SMG class + Spawn equips it, pause-menu change waits for respawn, Gun Game skips it.
import { makeDebug } from './_ks-common.mjs';

export const query = 'pick=1';

export async function run({ page, screenshot, openGame }) {
  const debug = makeDebug(page);
  const checks = {};
  const probe = {};
  const st = () => debug((api) => api.getState());
  const loadoutOf = (s) => s.weapon.loadout;
  await openGame('pick=1'); // fresh page: the harness already entered the first one
  await page.evaluate(() => localStorage.removeItem('cod.classes.v1'));
  await debug((api) => api.setGraphicsPreset('performance'));

  // 1. title click opens the pick, nothing spawned
  const before = await st();
  probe.before = { screen: before.menu.screen, active: before.active, loadout: loadoutOf(before) };
  await page.click('.fe-prompt');
  const picking = await st();
  checks.pickBeforeSpawn = picking.menu.screen === 'class' && picking.menu.picking === true && !picking.active;
  checks.spawnButton = (await page.textContent('[data-action="class-confirm"]')).trim() === 'Spawn';
  await page.waitForFunction(() => document.querySelector('.fe-class-card[data-weapon-id="tar_smg"]')?.dataset.ready === 'true', null, { timeout: 120000 });
  await page.waitForTimeout(500);
  await screenshot('pick-desktop');
  const grid = await page.$eval('.fe-class-grid', (g) => ({ scroll: g.scrollHeight, client: g.clientHeight }));
  const panel = await page.$eval('.fe-class', (g) => ({ scroll: g.scrollHeight, client: g.clientHeight }));
  probe.fit = { grid, panel };
  checks.fitsWithoutScroll = grid.scroll <= grid.client + 1 && panel.scroll <= panel.client + 1;

  const size = page.viewportSize();
  for (const [name, w, h] of [['portrait', 390, 844], ['landscape', 844, 390]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    await screenshot(`pick-${name}`);
    probe[name] = await page.$eval('[data-action="class-confirm"]', (b) => { const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight }; });
  }
  await page.setViewportSize(size);

  // 2. Escape keeps the current class
  await page.keyboard.press('Escape');
  const esc = await st();
  checks.escapeKeepsClass = esc.menu.screen === 'title' && !esc.active && loadoutOf(esc).primary === before.weapon.loadout.primary;

  // 3. pick the Rusher (SMG) class and Spawn
  await page.click('.fe-prompt');
  await page.click('.fe-class-tab[data-class-index="1"]');
  await page.waitForFunction(() => document.querySelector('.fe-class-card[data-weapon-id="tar_smg"]')?.dataset.selected === 'true', null, { timeout: 30000 });
  await page.click('[data-action="class-confirm"]');
  await page.waitForFunction(() => globalThis.hijacked.debug.getState().weapon.loadout.primary === 'tar_smg', null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const spawned = await st();
  probe.spawned = { menu: spawned.menu, active: spawned.active, loadout: loadoutOf(spawned), cls: spawned.systems.loadout.classIndex };
  checks.smgClassSpawns = loadoutOf(spawned).primary === 'tar_smg' && spawned.systems.loadout.classIndex === 1 && spawned.active && !spawned.menu.visible;
  await screenshot('spawned');

  // 4. pause-menu change applies on the next respawn
  await page.evaluate(() => document.exitPointerLock()); // like a player pressing Escape
  await page.waitForFunction(() => globalThis.hijacked.debug.getState().menu.screen === 'pause', null, { timeout: 10000 });
  await debug((api) => api.pause());
  await screenshot('pause-menu');
  await page.click('button[data-action="class"]:visible');
  await page.click('.fe-class-tab[data-class-index="2"]');
  await page.waitForFunction(() => document.querySelector('.fe-class-card[data-weapon-id="smr_bolt"]')?.dataset.ready === 'true', null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('.fe-class-card[data-weapon-id="smr_bolt"]')?.dataset.selected === 'true', null, { timeout: 30000 });
  await page.click('[data-action="class-confirm"]');
  const queued = await st();
  checks.pauseChangeWaits = queued.systems.loadout.pending === 2 && loadoutOf(queued).primary === 'tar_smg';
  await debug((api) => { api.resume(); api.respawnPlayer(); });
  await page.waitForFunction(() => globalThis.hijacked.debug.getState().weapon.loadout.primary === 'smr_bolt', null, { timeout: 60000 });
  checks.appliesOnRespawn = (await st()).systems.loadout.pending == null;

  // 5. Gun Game skips the pick
  await page.evaluate(() => localStorage.removeItem('cod.classes.v1'));
  await openGame('mode=gun&pick=1');
  await page.click('.fe-prompt');
  await page.waitForFunction(() => globalThis.hijacked.debug.getState().active, null, { timeout: 30000 });
  const gun = await st();
  checks.gunGameSkipsPick = gun.menu.screen !== 'class' && gun.active && !gun.menu.picking;
  probe.gun = { menu: gun.menu.screen, loadout: loadoutOf(gun) };
  await page.evaluate(() => localStorage.removeItem('cod.classes.v1'));
  return { checks, probe };
}
