// Gate check for the original Kestrel Heights map (PLAN.md §3.7): boots FFA on
// ?map=kestrel, checks bots and player sit inside the map, real W movement,
// bots engage after an alert, then screenshots four viewpoints.
export const query = 'map=kestrel';

export async function run({ page, screenshot }) {
  const debug = (fn, arg) => page.evaluate(([body, value]) => {
    const api = globalThis.hijacked.debug;
    return new Function('api', 'value', `return (${body})(api, value)`)(api, value);
  }, [fn.toString(), arg]);
  const inside = (p, b) => p.every((v, i) => v >= b.min[i] && v <= b.max[i]);

  await debug((api) => { api.setActive(true); api.resume(); });
  await page.waitForTimeout(500);
  const start = await debug((api) => api.getState());
  const bounds = await page.evaluate(() => fetch('maps/kestrel/manifest.json').then((r) => r.json()).then((m) => m.bounds));

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  const moved = await debug((api) => api.getState().player);
  const dist = Math.hypot(moved.feet[0] - start.player.feet[0], moved.feet[2] - start.player.feet[2]);

  await debug((api) => api.alertEnemies(100000));
  let firing = 0;
  for (let i = 0; i < 16 && firing < 3; i += 1) {
    await page.waitForTimeout(500);
    firing = await debug((api) => api.getState().enemies.filter((e) => e.shotsFired > 0).length);
  }

  await debug((api) => api.pause());
  const views = [
    [[-1400, 60, 0], [0, 40, 0]],
    [[1300, 60, -800], [-200, 40, 200]],
    [[0, 360, 900], [0, 0, -400]],
    [[-900, 60, 700], [600, 60, -600]],
  ];
  for (const [index, [eye, target]] of views.entries()) {
    await debug((api, v) => { api.teleportPlayer(v[0]); api.lookAt(v[1]); }, [eye, target]);
    await page.waitForTimeout(400);
    await screenshot(`kestrel-${index + 1}`);
  }
  const end = await debug((api) => api.getState());

  return {
    checks: {
      ready: start.ready === true,
      mapIsKestrel: start.config.mapId === 'kestrel',
      sixBotsInBounds: start.enemies.length === 6 && start.enemies.every((e) => inside(e.position, bounds)),
      playerGrounded: start.player.grounded === true && inside(start.player.feet, bounds),
      wMoves: dist > 80, // ponytail: A/B showed Hijacked moves ~84u under the same 2 s harness input
      botsEngage: firing >= 3,
    },
    probe: { dist, firing, frameWork: end.performance.frameWork, lighting: end.lighting },
  };
}
