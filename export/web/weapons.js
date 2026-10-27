// Weapon registry. Pure ESM with no `three` import so Node (tests, the server
// weapon-table sync tool) can load it. Every definition carries every field
// below; lanes add weapons by extending RAW and attachments by filling
// ATTACHMENTS, never by reading fields that are not listed here.
//
// Required fields on every definition:
//   id, name, class ('ar'|'smg'|'sniper'|'shotgun'), magazineSize, reserveAmmo,
//   roundsPerMinute, damage, falloff [[distance, factor], ...], pellets,
//   spread {hip, ads} (radians), recoil {pitch:[min,max], yaw}, alertRadius,
//   maxRange, fireMode, fireTypeIcon, scope, art, audio {shot, rate, gain},
//   viewmodelUrl, magazineUrl, magazineOffset, clips.

export const REGION_MULTIPLIERS = Object.freeze({ head: 2, torso: 1, legs: 0.75 });

const DEFAULTS = Object.freeze({
  class: 'ar',
  falloff: [[0, 1], [1e9, 1]],
  pellets: 1,
  spread: { hip: 0, ads: 0 },
  recoil: { pitch: [0.0065, 0.0105], yaw: 0.0035 },
  alertRadius: 1500,
  maxRange: 10000,
  fireMode: 'auto',
  scope: false,
});

const RAW = {
  m27: {
    id: 'm27',
    name: 'M27',
    slot: 1,
    magazineSize: 30,
    reserveAmmo: 240,
    roundsPerMinute: 750,
    damage: 33,
    fireTypeIcon: 'hud_mp_firerate_auto',
    viewmodelUrl: 'viewmodel/t6_wpn_ar_hk416_view_lod0.glb',
    magazineUrl: 'viewmodel/t6_attach_mag_hk416_view_lod0.glb',
    magazineOffset: [3.389, 0, -0.383],
    clips: {
      idle: 'viewmodel/anims/viewmodel_hk416_idle.json',
      fire: 'viewmodel/anims/viewmodel_hk416_fire.json',
      adsFire: 'viewmodel/anims/viewmodel_hk416_ads_fire.json',
      reload: 'viewmodel/anims/viewmodel_hk416_reload.json',
      reloadEmpty: 'viewmodel/anims/viewmodel_hk416_reload_empty.json',
    },
    art: 'hk416',
  },
  an94: {
    id: 'an94',
    name: 'AN-94',
    slot: 2,
    magazineSize: 30,
    reserveAmmo: 240,
    roundsPerMinute: 625,
    initialRoundsPerMinute: 937.5,
    initialShotCount: 2,
    damage: 40,
    fireTypeIcon: 'hud_mp_firerate_auto',
    adsFov: 50,
    viewmodelUrl: 'viewmodel/t6_wpn_ar_an94_view_lod0.glb',
    magazineUrl: 'viewmodel/t6_attach_mag_an94_view_lod0.glb',
    magazineOffset: [4.473, -1.085, -1.5],
    magazineRotation: [-0.2617993877991494, 0, 0],
    clips: {
      idle: 'viewmodel/anims/viewmodel_an94_idle.json',
      introFire: 'viewmodel/anims/viewmodel_an94_intro_fire.json',
      fire: 'viewmodel/anims/viewmodel_an94_fire.json',
      introAdsFire: 'viewmodel/anims/viewmodel_an94_intro_ads_fire.json',
      adsFire: 'viewmodel/anims/viewmodel_an94_ads_fire.json',
      reload: 'viewmodel/anims/viewmodel_an94_reload.json',
      reloadEmpty: 'viewmodel/anims/viewmodel_an94_reload_empty.json',
    },
    art: 'an94',
  },
  sa58: {
    id: 'sa58',
    name: 'FAL OSW',
    slot: 3,
    magazineSize: 25,
    reserveAmmo: 240,
    roundsPerMinute: 625,
    damage: 55,
    fireTypeIcon: 'hud_mp_firerate_single',
    viewmodelUrl: 'viewmodel/t6_wpn_ar_sa58_view_lod0.glb',
    magazineUrl: 'viewmodel/t6_attach_mag_sa58_view_lod0.glb',
    magazineOffset: [4.006, 0.015, 1.821],
    magazineRotation: [0, 0, 0],
    clips: {
      idle: 'viewmodel/anims/viewmodel_sa58_idle.json',
      fire: 'viewmodel/anims/viewmodel_sa58_fire.json',
      adsFire: 'viewmodel/anims/viewmodel_sa58_ads_fire.json',
      reload: 'viewmodel/anims/viewmodel_sa58_reload.json',
      reloadEmpty: 'viewmodel/anims/viewmodel_sa58_reload_empty.json',
    },
    art: 'sa58',
  },
  saritch: {
    id: 'saritch',
    name: 'SMR',
    slot: 4,
    magazineSize: 20,
    reserveAmmo: 240,
    roundsPerMinute: 536,
    damage: 50,
    fireTypeIcon: 'hud_mp_firerate_single',
    viewmodelUrl: 'viewmodel/t6_wpn_ar_saritch_view_lod0.glb',
    magazineUrl: 'viewmodel/t6_attach_mag_saritch_view_lod0.glb',
    magazineOffset: [-8.907, 0, -2.646],
    magazineRotation: [0, 0, 0],
    adsSightAnchors: {front: [12.672, 0, 3.643], rear: [-2.547, 0, 3.958]},
    clips: {
      idle: 'viewmodel/anims/viewmodel_saritch_idle.json',
      fire: 'viewmodel/anims/viewmodel_saritch_fire.json',
      adsFire: 'viewmodel/anims/viewmodel_saritch_ads_fire.json',
      reload: 'viewmodel/anims/viewmodel_saritch_reload.json',
      reloadEmpty: 'viewmodel/anims/viewmodel_saritch_reload_empty.json',
    },
    art: 'saritch',
  },
  scar: {
    id: 'scar',
    name: 'SCAR-H',
    slot: 5,
    magazineSize: 30,
    reserveAmmo: 240,
    roundsPerMinute: 625,
    damage: 40,
    fireTypeIcon: 'hud_mp_firerate_auto',
    viewmodelUrl: 'viewmodel/t6_wpn_ar_scarh_view_lod0.glb',
    magazineUrl: 'viewmodel/t6_attach_mag_scar_view_lod0.glb',
    magazineOffset: [3.716, 0, -0.345],
    magazineRotation: [0, 0, 0],
    adsSightAnchors: {front: [13.515, 0, 4.846], rear: [-2.237, 0, 4.894]},
    clips: {
      idle: 'viewmodel/anims/viewmodel_scar_h_idle.json',
      fire: 'viewmodel/anims/viewmodel_scar_h_fire.json',
      adsFire: 'viewmodel/anims/viewmodel_scar_h_ads_fire.json',
      reload: 'viewmodel/anims/viewmodel_scar_h_reload.json',
      reloadEmpty: 'viewmodel/anims/viewmodel_scar_h_reload_empty.json',
    },
    art: 'scar',
  },
  sig556: {
    id: 'sig556',
    name: 'SWAT-556',
    slot: 6,
    magazineSize: 30,
    reserveAmmo: 240,
    roundsPerMinute: 938,
    damage: 40,
    fireTypeIcon: 'hud_mp_firerate_burst',
    viewmodelUrl: 'viewmodel/t6_wpn_ar_sig556_view_lod0.glb',
    magazineUrl: 'viewmodel/t6_attach_mag_sig556_view_lod0.glb',
    magazineOffset: [5.663, -0.008, -0.815],
    magazineRotation: [0, 0, 0],
    adsSightAnchors: {front: [19.739, 0, 4.921], rear: [1.044, 0, 5.239]},
    clips: {
      idle: 'viewmodel/anims/viewmodel_sig556_idle.json',
      fire: 'viewmodel/anims/viewmodel_sig556_fire.json',
      adsFire: 'viewmodel/anims/viewmodel_sig556_ads_fire.json',
      introFire: 'viewmodel/anims/viewmodel_sig556_fire.json',
      reload: 'viewmodel/anims/viewmodel_sig556_reload.json',
      reloadEmpty: 'viewmodel/anims/viewmodel_sig556_reload_empty.json',
    },
    art: 'sig556',
  },
  tar21: {
    id: 'tar21',
    name: 'MTAR',
    slot: 7,
    magazineSize: 30,
    reserveAmmo: 240,
    roundsPerMinute: 750,
    damage: 40,
    fireTypeIcon: 'hud_mp_firerate_auto',
    viewmodelUrl: 'viewmodel/t6_wpn_ar_x95l_view_lod0.glb',
    magazineUrl: 'viewmodel/t6_attach_mag_x95l_view_lod0.glb',
    magazineOffset: [-9.754, 0, -0.04],
    magazineRotation: [0, 0, 0],
    clips: {
      idle: 'viewmodel/anims/viewmodel_tavor_idle.json',
      fire: 'viewmodel/anims/viewmodel_tavor_fire.json',
      adsFire: 'viewmodel/anims/viewmodel_tavor_ads_fire.json',
      reload: 'viewmodel/anims/viewmodel_tavor_reload.json',
      reloadEmpty: 'viewmodel/anims/viewmodel_tavor_reload_empty.json',
    },
    art: 'tar21',
  },
  type95: {
    id: 'type95',
    name: 'Type 25',
    slot: 8,
    magazineSize: 30,
    reserveAmmo: 240,
    roundsPerMinute: 938,
    damage: 33,
    fireTypeIcon: 'hud_mp_firerate_auto',
    viewmodelUrl: 'viewmodel/t6_wpn_ar_type95_view_lod0.glb',
    magazineUrl: 'viewmodel/t6_attach_mag_type95_view_lod0.glb',
    magazineOffset: [-8.38, 0, -0.678],
    magazineRotation: [0, 0, 0],
    clips: {
      idle: 'viewmodel/anims/viewmodel_type95_ar_idle.json',
      fire: 'viewmodel/anims/viewmodel_type95_ar_fire.json',
      adsFire: 'viewmodel/anims/viewmodel_type95_ar_ads_fire.json',
      introFire: 'viewmodel/anims/viewmodel_type95_ar_fire.json',
      reload: 'viewmodel/anims/viewmodel_type95_ar_reload.json',
      reloadEmpty: 'viewmodel/anims/viewmodel_type95_ar_reload_empty.json',
    },
    art: 'type95',
  },
  xm8: {
    id: 'xm8',
    name: 'M8A1',
    slot: 9,
    magazineSize: 36,
    reserveAmmo: 240,
    roundsPerMinute: 1250,
    damage: 35,
    fireTypeIcon: 'hud_mp_firerate_burst',
    viewmodelUrl: 'viewmodel/t6_wpn_ar_xm8_view_lod0.glb',
    magazineUrl: 'viewmodel/t6_attach_mag_xm8_view_lod0.glb',
    magazineOffset: [4.212, 0, 0.279],
    magazineRotation: [0, 0, 0],
    clips: {
      idle: 'viewmodel/anims/viewmodel_xm8_idle.json',
      fire: 'viewmodel/anims/viewmodel_xm8_fire.json',
      adsFire: 'viewmodel/anims/viewmodel_xm8_ads_fire.json',
      introFire: 'viewmodel/anims/viewmodel_xm8_fire.json',
      reload: 'viewmodel/anims/viewmodel_xm8_reload.json',
      reloadEmpty: 'viewmodel/anims/viewmodel_xm8_reload_empty.json',
    },
    art: 'xm8',
  },
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function define(raw) {
  const def = structuredClone({ ...DEFAULTS, ...raw });
  def.audio = { shot: def.id, rate: 1, gain: 1, ...(raw.audio ?? {}) };
  return deepFreeze(def);
}

export const WEAPONS = Object.freeze(Object.fromEntries(
  Object.entries(RAW).map(([id, raw]) => [id, define(raw)]),
));

/** Lane A fills this: id -> { name, apply(def) -> def }. */
export const ATTACHMENTS = {};

const ALIASES = Object.freeze({ hk416: 'm27' });

export function getWeapon(id) {
  const key = String(id ?? '').toLowerCase();
  return WEAPONS[ALIASES[key] ?? key] ?? null;
}

export function resolveWeapon(id, attachmentIds = []) {
  const base = getWeapon(id);
  if (!base) throw new Error(`unknown weapon: ${id}`);
  if (attachmentIds.length > 2) throw new Error('at most 2 attachments per weapon');
  let def = base;
  for (const attachmentId of attachmentIds) {
    const attachment = ATTACHMENTS[attachmentId];
    if (!attachment) throw new Error(`unknown attachment: ${attachmentId}`);
    def = attachment.apply(structuredClone(def));
  }
  return deepFreeze(def === base ? def : structuredClone(def));
}

/** Piecewise-linear lookup over [[x, y], ...] sorted by x; clamps at both ends. */
function interpolate(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
  }
  return points[points.length - 1][1];
}

export function damageFor(def, { distance = 0, region = 'torso' } = {}) {
  return def.damage * interpolate(def.falloff, distance) * (REGION_MULTIPLIERS[region] ?? 1);
}
