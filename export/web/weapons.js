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
// Optional / derived: attachments (ids applied by resolveWeapon), suppressed,
//   reloadSpeed, scopeFov, reload clips. `pellets` x `damage` is the true max
//   per shot (before falloff and the head multiplier).
// fireMode: 'auto' | 'semi' | 'burst' (3 rounds) | 'bolt' | 'pump'. For bolt and
//   pump `roundsPerMinute` is the cycle rate (48 rpm = a 1.25 s cycle).

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
  attachments: [],
  suppressed: false,
  reloadSpeed: 1,
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
    fireMode: 'semi',
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
    fireMode: 'semi',
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
    fireMode: 'burst',
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
    fireMode: 'burst',
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

// New classes reuse an existing rifle's viewmodel, clips and art; only stats,
// audio and fire mode change. Names derive from the base gun.
function derive(baseId, overrides) {
  const { initialRoundsPerMinute, initialShotCount, ...base } = RAW[baseId];
  return { ...structuredClone(base), ...overrides };
}

RAW.tar_smg = derive('tar21', {
  id: 'tar_smg', name: 'MTAR SMG', class: 'smg', slot: 10,
  magazineSize: 32, reserveAmmo: 224, roundsPerMinute: 900, damage: 26,
  falloff: [[0, 1], [400, 1], [1200, 0.62], [2200, 0.4]],
  spread: { hip: 0.012, ads: 0.003 },
  recoil: { pitch: [0.0035, 0.006], yaw: 0.0025 },
  alertRadius: 1300, fireTypeIcon: 'hud_mp_firerate_auto',
  audio: { shot: 'tar21', rate: 1.18, gain: 0.9 },
});
RAW.t25_smg = derive('type95', {
  id: 't25_smg', name: 'Type 25 SMG', class: 'smg', slot: 11,
  magazineSize: 40, reserveAmmo: 240, roundsPerMinute: 1000, damage: 22,
  falloff: [[0, 1], [300, 1], [900, 0.6], [1800, 0.35]],
  spread: { hip: 0.015, ads: 0.004 },
  recoil: { pitch: [0.003, 0.0055], yaw: 0.003 },
  alertRadius: 1200, fireTypeIcon: 'hud_mp_firerate_auto',
  audio: { shot: 'type95', rate: 1.12, gain: 0.85 },
});
RAW.smr_bolt = derive('saritch', {
  id: 'smr_bolt', name: 'SMR Bolt', class: 'sniper', slot: 12,
  magazineSize: 5, reserveAmmo: 30, roundsPerMinute: 48, damage: 120,
  falloff: [[0, 1], [1e9, 1]],
  spread: { hip: 0.05, ads: 0 },
  recoil: { pitch: [0.03, 0.04], yaw: 0.006 },
  alertRadius: 2200, fireMode: 'bolt', scope: true, scopeFov: 12,
  fireTypeIcon: 'hud_mp_firerate_bolt',
  audio: { shot: 'saritch', rate: 0.78, gain: 1.25 },
});
RAW.fal_marksman = derive('sa58', {
  id: 'fal_marksman', name: 'FAL Marksman', class: 'sniper', slot: 13,
  magazineSize: 10, reserveAmmo: 50, roundsPerMinute: 200, damage: 80,
  falloff: [[0, 1], [3000, 1], [8000, 0.8]],
  spread: { hip: 0.035, ads: 0 },
  recoil: { pitch: [0.014, 0.02], yaw: 0.004 },
  alertRadius: 2000, fireMode: 'semi', scope: true, scopeFov: 20,
  fireTypeIcon: 'hud_mp_firerate_single',
  audio: { shot: 'sa58', rate: 0.9, gain: 1.1 },
});
RAW.scar_pump = derive('scar', {
  id: 'scar_pump', name: 'SCAR-H Shotgun', class: 'shotgun', slot: 14,
  magazineSize: 6, reserveAmmo: 36, roundsPerMinute: 70, damage: 20, pellets: 8,
  falloff: [[0, 1], [250, 1], [700, 0.3], [1100, 0.12]],
  spread: { hip: 0.045, ads: 0.028 },
  recoil: { pitch: [0.03, 0.045], yaw: 0.01 },
  alertRadius: 1800, fireMode: 'pump',
  fireTypeIcon: 'hud_mp_firerate_pump',
  audio: { shot: 'scar', rate: 0.62, gain: 1.4 },
});

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

const scaleDistances = (falloff, k) => falloff.map(([d, f]) => [d < 1e8 ? d * k : d, f]);

/** id -> { name, apply(def) -> def }. `apply` receives a mutable clone. */
export const ATTACHMENTS = {
  suppressor: {
    name: 'Suppressor',
    apply(def) {
      def.suppressed = true;
      def.alertRadius = 400;
      def.audio.gain *= 0.45;
      return def;
    },
  },
  extmag: {
    name: 'Extended Mag',
    apply(def) { def.magazineSize = Math.round(def.magazineSize * 1.5); return def; },
  },
  fastmag: {
    name: 'Fast Mag',
    apply(def) { def.reloadSpeed *= 1.4; return def; },
  },
  grip: {
    name: 'Grip',
    apply(def) {
      def.recoil.pitch = def.recoil.pitch.map((v) => v * 0.7);
      def.recoil.yaw *= 0.7;
      return def;
    },
  },
  longbarrel: {
    name: 'Long Barrel',
    apply(def) { def.falloff = scaleDistances(def.falloff, 1.4); return def; },
  },
  rapid: {
    name: 'Rapid Fire',
    apply(def) {
      def.roundsPerMinute *= 1.25;
      if (def.initialRoundsPerMinute) def.initialRoundsPerMinute *= 1.25;
      return def;
    },
  },
};

const ALIASES = Object.freeze({ hk416: 'm27' });

export function getWeapon(id) {
  const key = String(id ?? '').toLowerCase();
  return WEAPONS[ALIASES[key] ?? key] ?? null;
}

export function resolveWeapon(id, attachmentIds = []) {
  const base = getWeapon(id);
  if (!base) throw new Error(`unknown weapon: ${id}`);
  if (attachmentIds.length > 2) throw new Error('at most 2 attachments per weapon');
  if (new Set(attachmentIds).size !== attachmentIds.length) throw new Error('duplicate attachment');
  let def = base;
  for (const attachmentId of attachmentIds) {
    const attachment = ATTACHMENTS[attachmentId];
    if (!attachment) throw new Error(`unknown attachment: ${attachmentId}`);
    def = attachment.apply(structuredClone(def));
  }
  if (def === base) return def;
  def.attachments = [...attachmentIds];
  return deepFreeze(structuredClone(def));
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
