// Boot-time configuration: URL > localStorage['cod.setup.v1'] > defaults.
// Map and mode are fixed for a page load; changing them reloads the page.
import { MAP_IDS } from './maps.js';
import { MODES } from './modes.js';

export const DEFAULT_SERVER_URL = 'wss://mp-production-613e.up.railway.app';
export const SETUP_KEY = 'cod.setup.v1';

const DEFAULTS = { mapId: 'hijacked', modeId: 'ffa', name: '' };

function readSaved(storage) {
  try {
    const saved = JSON.parse(storage?.getItem?.(SETUP_KEY) ?? 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch { return {}; }
}

const cleanName = (value) => String(value ?? '').replace(/[^\w .-]/g, '').trim().slice(0, 16);

export function readGameConfig(search = '', storage = null) {
  const params = new URLSearchParams(search);
  const saved = readSaved(storage);
  const mapId = [params.get('map'), saved.mapId].find((id) => MAP_IDS.includes(id)) ?? DEFAULTS.mapId;
  let modeId = [params.get('mode'), saved.modeId].find((id) => Object.hasOwn(MODES, id)) ?? DEFAULTS.modeId;

  const rawRoom = String(params.get('room') ?? '').toUpperCase();
  const room = rawRoom === 'NEW' || /^[A-Z0-9]{4,8}$/.test(rawRoom) ? rawRoom : null;
  if (room) modeId = 'ffa';

  const server = params.get('server') ?? '';
  const serverUrl = /^wss?:\/\/[^\s/]+/i.test(server) ? server : DEFAULT_SERVER_URL;
  const name = cleanName(params.get('name') ?? saved.name ?? DEFAULTS.name);
  return Object.freeze({ mapId, modeId, room, serverUrl, name });
}

export function setupUrl(href, { mapId, modeId, room } = {}) {
  const url = new URL(href);
  url.searchParams.set('autostart', '1');
  for (const [key, value] of [['map', mapId], ['mode', modeId], ['room', room]]) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return String(url);
}

export function saveSetup(storage, { mapId, modeId, name } = {}) {
  try {
    storage?.setItem?.(SETUP_KEY, JSON.stringify({
      mapId: MAP_IDS.includes(mapId) ? mapId : DEFAULTS.mapId,
      modeId: Object.hasOwn(MODES, modeId) ? modeId : DEFAULTS.modeId,
      name: cleanName(name),
    }));
    return true;
  } catch { return false; }
}
