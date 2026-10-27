// Wave 0 smoke: boots the default match, kills a bot through the real damage
// path and checks the event bus, then screenshots the Map & mode setup screen.
export const query = '';

export async function run({ page, screenshot }) {
  const debug = (fn, arg) => page.evaluate(([body, value]) => {
    const api = globalThis.hijacked.debug;
    return new Function('api', 'value', `return (${body})(api, value)`)(api, value);
  }, [fn.toString(), arg]);

  await debug((api) => { api.setActive(true); api.resume(); });
  const state = await debug((api) => api.getState());
  const kill = await debug((api) => api.killCombatant('bot-0'));
  const events = await debug((api) => api.recentEvents());
  const killEvent = events.find((entry) => entry.type === 'kill')?.payload;
  const damageEvent = events.find((entry) => entry.type === 'damage')?.payload;

  await debug((api) => { api.pause(); api.showMenu(true); });
  await page.evaluate(() => globalThis.hijacked.frontend.openSetup());
  await page.waitForTimeout(300);
  await screenshot('setup');
  const setup = await debug((api) => api.getState().menu);

  return {
    checks: {
      ready: state.ready === true,
      sixBots: state.enemies.length === 6 && state.combatants.length === 7,
      mapIsHijacked: state.config.mapId === 'hijacked' && state.config.modeId === 'ffa' && state.config.online === false,
      defaultLoadout: state.weapon.id === 'm27' && state.weapon.loadout.secondary === 'an94',
      botKilled: kill.killed === true,
      damageEventOnBus: damageEvent?.victimId === 'bot-0' && damageEvent?.cause === 'bullet',
      killEventOnBus: killEvent?.victimId === 'bot-0' && killEvent?.killerId === 'player' && killEvent?.cause === 'bullet',
      matchCountedKill: (await debug((api) => api.getState().match.standings.find((e) => e.id === 'player').score)) === 1,
      setupScreenOpen: setup.screen === 'setup',
    },
    probe: { kill, killEvent, damageEvent, menu: setup },
  };
}
