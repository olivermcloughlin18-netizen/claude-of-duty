// Lane M: a room link whose server is unreachable must fall back to the normal offline game (6 bots) fast.
export const query = 'room=ABCD&server=ws://127.0.0.1:1';

export async function run({ page, screenshot }) {
  const state = await page.evaluate(() => globalThis.hijacked.debug.getState());
  const fallback = await page.evaluate(async () => {
    // Fresh net-play instance against the same dead port: how long does the fallback decision take?
    const { createNetPlay } = await import('./net-play.js');
    const started = performance.now();
    const online = await createNetPlay().connect({ serverUrl: 'ws://127.0.0.1:1', room: 'ABCD', name: 'x', mapId: 'hijacked' });
    return { online, ms: Math.round(performance.now() - started) };
  });
  const notice = await page.evaluate(() => document.getElementById('system-notice')?.textContent ?? '');
  await screenshot('net-offline');
  return {
    checks: {
      ready: state.ready === true,
      sixBots: state.enemies.length === 6,
      offline: state.config.online === false && state.systems.net.online === false,
      roomRequestedButOffline: state.config.room === 'ABCD',
      fallbackUnder8s: fallback.online === false && fallback.ms < 8000,
      noticeShown: notice.includes('offline vs bots') || state.systems.net.online === false,
    },
    probe: { fallback, notice, net: state.systems.net, config: state.config },
  };
}
