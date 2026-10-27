// Map registry. Pure ESM (no `three`). Hijacked is a literal entry whose files
// are untouched; every other map arrives as `maps/<id>/manifest.json` and goes
// through fromManifest(), which returns an entry of the SAME shape.

export const MAP_IDS = ['hijacked']; // integrator appends the new-map id at the gate

export const HIJACKED = Object.freeze({
  id: 'hijacked',
  name: 'Hijacked',
  card: 'ui/menu_mp_map_select_hijacked_final.png',
  render: 'hijacked_optimized.glb',
  collision: 'hijacked_collision_bvh.json',
  navmesh: 'hijacked.navmesh.bin',
  hints: 'hijacked_nav_hints.json',
  ladders: 'hijacked_ladders.json',
  probes: Object.freeze({ json: 'hijacked_probes.json', bin: 'hijacked_probes.bin' }),
  lighting: Object.freeze({
    env: 'textures/env/',
    probe: 'textures/probe/',
    vision: 'vision.json',
    lut: 'textures/mp_hijacked_lut.png',
  }),
  minimap: Object.freeze({
    image: 'ui/hud/compass_map_mp_hijacked.png',
    centerX: -316,
    centerZ: 12,
    size: 7176,
    flipU: 1,
    flipV: -1,
    span: 1250,
  }),
  spawns: null,
  playerStart: null,
  fallbackSpawn: Object.freeze([2102, 57, 133]),
  fallResetY: -700,
  bounds: Object.freeze({ min: Object.freeze([-3516, -500, -1000]), max: Object.freeze([2838, 742, 965]) }),
  background: 0x87a8c8,
});

const pick = (value) => (typeof value === 'string' && value ? value : null);

function parseColor(value) {
  if (typeof value === 'number') return value;
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? ''));
  return match ? parseInt(match[1], 16) : null;
}

/**
 * manifest.json -> registry entry. File keys follow the new-map lane's
 * manifest: files {glb, collisionBvh, navmesh, navHints, ladders, probes,
 * vision, lut, env, probe, minimap, card}. Absent optional files become null.
 */
export function fromManifest(manifest, baseUrl = `maps/${manifest?.id}/`) {
  if (!manifest || typeof manifest !== 'object' || !pick(manifest.id)) throw new Error('map manifest needs an id');
  const files = manifest.files ?? {};
  const url = (name) => (pick(name) ? `${baseUrl}${name}` : null);
  const spawns = Array.isArray(manifest.spawns) && manifest.spawns.length
    ? manifest.spawns.map((spawn) => ({ position: [...spawn.position], yaw: Number(spawn.yaw) || 0 }))
    : null;
  const playerStart = manifest.playerStart?.position
    ? { position: [...manifest.playerStart.position], yaw: Number(manifest.playerStart.yaw) || 0 }
    : null;
  const bounds = manifest.bounds?.min && manifest.bounds?.max
    ? { min: [...manifest.bounds.min], max: [...manifest.bounds.max] }
    : HIJACKED.bounds;

  const probesJson = url(files.probes);
  const paths = { ...(manifest.lighting?.paths ?? {}), ...Object.fromEntries(
    ['env', 'probe', 'vision', 'lut'].filter((key) => pick(files[key])).map((key) => [key, files[key]])) };
  const lighting = {
    env: url(paths.env) ?? HIJACKED.lighting.env,
    probe: url(paths.probe) ?? HIJACKED.lighting.probe,
    vision: url(paths.vision) ?? HIJACKED.lighting.vision,
    lut: url(paths.lut) ?? HIJACKED.lighting.lut,
  };

  const minimapImage = pick(manifest.minimap?.image) ?? pick(files.minimap);
  const minimap = minimapImage ? {
    image: url(minimapImage),
    centerX: Number(manifest.minimap?.centerX) || 0,
    centerZ: Number(manifest.minimap?.centerZ) || 0,
    size: Number(manifest.minimap?.size) || 4000,
    flipU: Number(manifest.minimap?.flipU) || 1,
    flipV: Number(manifest.minimap?.flipV) || -1,
    span: Number(manifest.minimap?.span ?? manifest.minimap?.minimapSpan) || 1250,
  } : null;

  return {
    id: manifest.id,
    name: pick(manifest.name) ?? manifest.id,
    card: url(files.card),
    render: url(files.glb ?? files.render),
    collision: url(files.collisionBvh ?? files.collision),
    navmesh: url(files.navmesh),
    hints: url(files.navHints ?? files.hints),
    ladders: url(files.ladders),
    probes: probesJson ? { json: probesJson, bin: probesJson.replace(/\.json$/, '.bin') } : null,
    lighting,
    minimap,
    spawns,
    playerStart,
    fallbackSpawn: playerStart?.position ?? spawns?.[0]?.position ?? null,
    fallResetY: bounds.min[1] - 300,
    bounds,
    background: parseColor(manifest.lighting?.fog?.color),
  };
}

/** Nav hints for a map that ships none: spawns become DM spawns and patrol nodes. */
export function synthesiseHints(map) {
  const spawns = map?.spawns ?? [];
  return {
    spawns: spawns.map((spawn) => ({ classname: 'mp_dm_spawn', position: [...spawn.position], yaw: spawn.yaw })),
    pathnodes: spawns.map((spawn) => ({ position: [...spawn.position] })),
  };
}

export async function loadMap(id, fetchFn = globalThis.fetch) {
  if (!id || id === HIJACKED.id) return HIJACKED;
  try {
    const response = await fetchFn(`maps/${id}/manifest.json`);
    if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
    return fromManifest(await response.json(), `maps/${id}/`);
  } catch (error) {
    console.warn(`map "${id}" unavailable, using ${HIJACKED.id}:`, error?.message ?? error);
    return HIJACKED;
  }
}

export async function listMaps(fetchFn = globalThis.fetch) {
  const maps = await Promise.all(MAP_IDS.map(async (id) => {
    if (id === HIJACKED.id) return { id, name: HIJACKED.name, card: HIJACKED.card };
    try {
      const entry = await loadMap(id, fetchFn);
      return entry.id === id ? { id, name: entry.name, card: entry.card ?? null } : null;
    } catch { return null; }
  }));
  return maps.filter(Boolean);
}
