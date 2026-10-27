// Lane F killcam gate: death killcam (banner, hidden bots, skip rules, respawn
// timing), final killcam before the scoreboard, and a recorded run.
import fs from 'node:fs';
import path from 'node:path';

export const query = '';

export async function run({ page, screenshot, artifactRoot, writeJson }) {
  const debug = (fn, arg) => page.evaluate(([body, value]) => {
    const api = globalThis.hijacked.debug;
    return new Function('api', 'value', `return (${body})(api, value)`)(api, value);
  }, [fn.toString(), arg]);
  const state = () => debug((api) => api.getState());
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const waitFor = async (predicate, ms, step = 50) => {
    const t0 = Date.now();
    for (;;) {
      const s = await state();
      if (predicate(s)) return { s, ms: Date.now() - t0 };
      if (Date.now() - t0 > ms) return { s, ms: Date.now() - t0, timeout: true };
      await page.waitForTimeout(step);
    }
  };

  // The headless harness renders at ~1 fps, so the game's dt cap (0.1 s) makes
  // sim time run ~10x slower than the wall clock. Measure in sim seconds and frames.
  await page.evaluate(() => {
    window.__sim = 0; window.__frames = 0;
    let last = performance.now();
    const tick = (now) => { window.__sim += Math.min(0.1, (now - last) / 1000); window.__frames += 1; last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const sim = () => page.evaluate(() => window.__sim);
  const frames = () => page.evaluate(() => window.__frames);
  await debug((api) => { api.setActive(true); api.resume(); });
  await waitFor((s) => s.systems.killcam.buffered >= 40, 120000, 250); // 2+ s of sim time buffered
  const before = await state();

  // ---- death killcam, skipped ----
  const f0 = await frames();
  const kill = await debug((api) => api.killCombatant('player', { attackerId: 'bot-0', weaponId: 'm27' }));
  const started = await waitFor((s) => s.systems.killcam.playing, 60000, 100);
  const startFrames = (await frames()) - f0;
  const during = started.s;
  const camDistance = dist(during.systems.killcam.camera ?? [0, 0, 0], during.player.eye);
  await waitFor((s) => s.systems.killcam.seconds >= 0.4, 60000, 100);
  await page.waitForTimeout(700); // let the letterbox and banner transitions finish
  await screenshot('killcam-early');
  const earlySeconds = (await state()).systems.killcam.seconds;
  await page.keyboard.press('Space'); // before 1 s: must be ignored
  await page.waitForTimeout(1500);
  const afterEarly = (await state()).systems.killcam;
  const stillPlaying = afterEarly.playing && earlySeconds < 1;
  const shots = [];
  for (let i = 0; i < 3; i += 1) {
    await waitFor((st) => st.systems.killcam.seconds >= 1.2 + i * 0.9, 120000, 100);
    await page.waitForTimeout(500);
    const name = `killcam-mid-${i + 1}`;
    await screenshot(name);
    shots.push(name);
  }
  const hudHidden = await page.evaluate(() => getComputedStyle(document.getElementById('crosshair')).visibility);
  const bannerText = await page.evaluate(() => document.querySelector('.kc-label')?.textContent ?? null);
  const botVisibility = await page.evaluate(() => globalThis.hijacked.enemies.enemies.map((e) => e.root.visible));
  const botsHidden = botVisibility.every((v) => v === false);
  const skipShown = await page.evaluate(() => document.querySelector('.kc-skip')?.classList.contains('on'));
  await page.keyboard.press('Space');
  const skipped = await waitFor((s) => !s.systems.killcam.playing, 20000, 100);
  const botsBack = await page.evaluate(() => globalThis.hijacked.enemies.enemies.every((e) => e.root.visible === true));
  const puppetsLeft = await page.evaluate(() => globalThis.hijacked.scene.children.filter((o) => o.name.startsWith('puppet_')).length);
  const respawned1 = await waitFor((s) => !s.player.dead, 60000, 100);

  // ---- death killcam, played to the end: respawn within 6 s (sim) of the death ----
  await waitFor((s) => s.systems.killcam.buffered >= 40 && !s.player.protected, 120000, 250);
  const t0 = await sim();
  await debug((api) => api.killCombatant('player', { attackerId: 'bot-1', weaponId: 'm27' }));
  const full = await waitFor((s) => s.systems.killcam.playing, 60000, 100);
  const ended = await waitFor((s) => !s.systems.killcam.playing, 180000, 250);
  const respawned2 = await waitFor((s) => !s.player.dead, 60000, 100);
  const respawnSeconds = (await sim()) - t0;

  // ---- final killcam ----
  await waitFor((s) => s.systems.killcam.buffered >= 40, 120000, 250);
  await debug((api) => api.killCombatant('bot-2', { attackerId: 'player' }));
  await page.waitForTimeout(1000);
  await debug((api) => api.finishMatch());
  const final = await waitFor((s) => s.systems.killcam.playing && s.systems.killcam.kind === 'final', 60000, 100);
  await waitFor((s) => s.systems.killcam.seconds >= 1.5, 120000, 100);
  const boardWhileFinal = await page.evaluate(() => getComputedStyle(document.getElementById('scoreboard')).visibility);
  await page.waitForTimeout(500);
  await screenshot('final-killcam');
  const finalEnded = await waitFor((s) => !s.systems.killcam.playing, 180000, 250);
  await waitFor((s) => s.systems.progression.sessionXp > 0, 20000, 100);
  await page.waitForTimeout(3500); // summary count-up
  await screenshot('scoreboard-after');
  const board = await page.evaluate(() => ({
    visibility: getComputedStyle(document.getElementById('scoreboard')).visibility,
    shown: document.getElementById('scoreboard').classList.contains('visible'),
    summary: !document.querySelector('.pg-summary')?.hidden,
    summaryText: document.querySelector('.pg-summary')?.innerText ?? '',
  }));
  const after = await state();

  // ---- recording (separate context so the main run keeps its trace) ----
  let video = null;
  try {
    const browser = page.context().browser();
    const videoDir = path.join(artifactRoot, 'video');
    await fs.promises.mkdir(videoDir, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } } });
    const rp = await context.newPage();
    await rp.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 600000 });
    await rp.waitForFunction(() => globalThis.hijacked?.debug?.getState().ready === true, null, { timeout: 600000 });
    await rp.evaluate(() => { globalThis.hijacked.debug.setActive(true); globalThis.hijacked.debug.resume(); });
    await rp.waitForFunction(() => globalThis.hijacked.debug.getState().systems.killcam.buffered >= 40, null, { timeout: 600000 });
    await rp.evaluate(() => globalThis.hijacked.debug.killCombatant('player', { attackerId: 'bot-3', weaponId: 'm27' }));
    await rp.waitForFunction(() => globalThis.hijacked.debug.getState().systems.killcam.playing, null, { timeout: 60000 });
    await rp.waitForFunction(() => !globalThis.hijacked.debug.getState().systems.killcam.playing, null, { timeout: 240000 });
    await rp.waitForTimeout(3000);
    const file = await rp.video().path();
    await context.close();
    video = file;
  } catch (error) {
    video = `recording failed: ${error.message}`;
  }

  await writeJson('killcam-probe.json', { before: before.systems, during: during.systems, after: after.systems });
  return {
    checks: {
      killLanded: kill.killed === true,
      playingWithin3Frames: started.timeout !== true && startFrames <= 3,
      cameraIsNotPlayersEye: camDistance > 5,
      killerNamed: bannerText === 'Killcam · ADMIRAL' || /^Killcam · /.test(bannerText ?? ''),
      hudHidden: hudHidden === 'hidden',
      realBotsHiddenDuringReplay: botsHidden === true,
      puppetsDrawn: during.systems.killcam.puppets >= 7,
      skipIgnoredBefore1s: stillPlaying === true,
      skipHintShown: skipShown === true,
      spaceSkipsAfter1s: skipped.timeout !== true,
      botsRestored: botsBack === true,
      puppetsDisposed: puppetsLeft === 0,
      respawnedAfterSkip: respawned1.timeout !== true,
      fullReplayEnds: full.timeout !== true && ended.timeout !== true,
      respawnWithin6s: respawned2.timeout !== true && respawnSeconds <= 6,
      finalKillcamPlays: final.timeout !== true,
      scoreboardHiddenDuringFinal: boardWhileFinal === 'hidden',
      scoreboardAfterFinal: finalEnded.timeout !== true && board.shown && board.visibility === 'visible',
      summaryOnScoreboard: board.summary === true && /MATCH XP|Match XP/i.test(board.summaryText),
      notPlayingAfter: after.systems.killcam.playing === false,
      videoRecorded: typeof video === 'string' && video.endsWith('.webm'),
    },
    probe: { botVisibility, startedMs: started.ms, startFrames, respawnSeconds, camDistance, bannerText, shots, video, board, finalKind: final.s.systems.killcam },
  };
}
