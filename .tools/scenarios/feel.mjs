// Lane F feel gate: slide (Shift+W then C), XP from a kill that survives a
// reload, and the rank screen at max XP (plus Prestige).
export const query = '';

export async function run({ page, screenshot, openGame }) {
  const debug = (fn, arg) => page.evaluate(([body, value]) => {
    const api = globalThis.hijacked.debug;
    return new Function('api', 'value', `return (${body})(api, value)`)(api, value);
  }, [fn.toString(), arg]);
  const state = () => debug((api) => api.getState());
  const waitFor = async (predicate, ms, step = 100) => {
    const t0 = Date.now();
    for (;;) {
      const s = await state();
      if (predicate(s)) return { s, ms: Date.now() - t0 };
      if (Date.now() - t0 > ms) return { s, ms: Date.now() - t0, timeout: true };
      await page.waitForTimeout(step);
    }
  };
  const speedOf = (s) => Math.hypot(s.player.velocity[0], s.player.velocity[2]);
  const xp = async () => (await state()).systems.progression;

  await page.evaluate(() => localStorage.removeItem('cod.progression.v1'));
  await openGame();

  // ---- XP: a kill, a headshot, persistence across reload ----
  await debug((api) => { api.setActive(true); api.resume(); });
  const x0 = await xp();
  await debug((api) => api.killCombatant('bot-0'));
  const x1 = await xp();
  await page.waitForTimeout(250);
  const ticker = await page.evaluate(() => [...document.querySelectorAll('.pg-tick')].map((n) => n.textContent));
  await screenshot('xp-ticker');
  await debug((api) => api.killCombatant('bot-1', { region: 'head' }));
  const x2 = await xp();
  await openGame();
  const x3 = await xp();

  // ---- slide: sprint first, then crouch ----
  await debug((api) => { api.setActive(true); api.resume(); });
  await page.evaluate(() => {
    window.__rec = [];
    let last = performance.now();
    const tick = (now) => {
      const s = globalThis.hijacked.debug.getState();
      window.__rec.push({
        dt: Math.min(0.1, (now - last) / 1000, 0.0667), sliding: s.player.sliding, crouched: s.player.crouched,
        speed: Math.hypot(s.player.velocity[0], s.player.velocity[2]), grounded: s.player.grounded,
      });
      last = now;
      window.__recId = requestAnimationFrame(tick);
    };
    window.__recId = requestAnimationFrame(tick);
  });
  await debug((api) => { api.teleportPlayer([2102, 57, 133]); });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const sprint = await waitFor((s) => Math.hypot(s.player.velocity[0], s.player.velocity[2]) >= 400, 60000);
  await page.waitForTimeout(800);
  const sprintSpeed = speedOf(await state());
  await page.evaluate(() => { window.__mark = window.__rec.length; });
  await page.keyboard.down('KeyC');
  await waitFor((s) => s.player.sliding, 30000, 50);
  await screenshot('slide');
  const ended = await waitFor((s) => !s.player.sliding, 60000, 100);
  await page.keyboard.up('KeyC');
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const rec = await page.evaluate(() => window.__rec.slice(window.__mark));
  const slideFrames = rec.filter((f) => f.sliding);
  const slideSeconds = slideFrames.reduce((a, f) => a + f.dt, 0);
  const first200 = []; let acc = 0;
  for (const f of slideFrames) { if (acc >= 0.2) break; first200.push(f.speed); acc += f.dt; }
  const slidePeak = Math.max(0, ...slideFrames.map((f) => f.speed));
  const wasCrouched = slideFrames.every((f) => f.crouched);
  await page.waitForTimeout(500);
  const afterSlide = await state();

  // ---- rank screen at max XP, then Prestige ----
  await debug((api) => api.setXp(1e9));
  await openGame(); // back to the title screen with the stored rank
  await page.waitForTimeout(900);
  await screenshot('rank-max');
  const max = await xp();
  const prestigeVisible = await page.evaluate(() => !document.querySelector('.pg-prestige').hidden);
  await page.evaluate(() => document.querySelector('.pg-prestige').click());
  await page.evaluate(() => document.querySelector('.pg-prestige').click());
  await page.waitForTimeout(900);
  await screenshot('rank-prestige');
  const pres = await xp();
  await debug((api) => api.setXp(3000));
  await page.waitForTimeout(900);
  await screenshot('rank-mid');
  const mid = await xp();

  return {
    checks: {
      sprintEngaged: sprint.timeout !== true && sprintSpeed >= 400,
      slideStarts: slideFrames.length > 0,
      slideSpeedAbove450: first200.length > 0 && Math.max(...first200) > 450,
      slideEndsWithin0_8s: ended.timeout !== true && slideSeconds <= 0.8 + 0.07 && slideSeconds >= 0.4,
      slideCrouched: wasCrouched,
      notSlidingAfter: afterSlide.player.sliding === false,
      killGivesAtLeast100: x1.xp - x0.xp >= 100,
      tickerShown: ticker.some((t) => t.includes('+100')),
      headshotBonus: x2.xp - x1.xp >= 150,
      xpPersistsAcrossReload: x3.xp === x2.xp && x3.xp >= 250,
      maxLevel55: max.level === 55 && max.xp > 0,
      prestigeButtonAtMax: prestigeVisible === true,
      prestigeResets: pres.prestige === 1 && pres.level === 1 && pres.xp === 0,
      midLevel: mid.level > 1 && mid.level < 55,
    },
    probe: { x0, x1, x2, x3, max, pres, mid, sprintSpeed, slideSeconds, slidePeak, first200, slideFrameCount: slideFrames.length, ticker },
  };
}
