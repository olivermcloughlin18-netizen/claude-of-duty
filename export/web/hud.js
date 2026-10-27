// In-game HUD drawn with the game's own art from `export/web/ui/hud/`
// (see .tools/export_hud.py). The layout is rebuilt in the browser -- T6
// menudefs do not dump -- so placement here approximates the shipped HUD:
// square minimap top left, compass tape under it, ammo bottom right, and the
// low-health vignette over the screen. T6 draws health through screen effects
// alone, so there is deliberately no health bar.

const ART = 'ui/hud/';

// World-to-radar calibration for `compass_map_mp_hijacked`. The two authored
// `minimap_corner` entities bound a 7176-unit square from (-3904, -3600) to
// (3272, 3576). Entity Y is negated when imported as Three.js world Z, giving
// the centre below. The yacht's long world-X axis runs vertically in the art.
export const MAP_CAL = {
  centerX: -316,
  centerZ: 12,
  size: 7176,
  flipU: 1,
  flipV: -1,
  minimapSpan: 1250,
};

export function worldToMinimapUv(x, z, cal = MAP_CAL) {
  return {
    u: 0.5 + ((z - cal.centerZ) * cal.flipU) / cal.size,
    v: 0.5 + ((x - cal.centerX) * cal.flipV) / cal.size,
  };
}

// Calibration for the Hud: the map's minimap entry when it ships an image,
// otherwise a plain panel spanning the map bounds.
export function minimapCalibration(map) {
  const m = map?.minimap;
  if (m) {
    return { centerX: m.centerX, centerZ: m.centerZ, size: m.size, flipU: m.flipU, flipV: m.flipV, minimapSpan: m.span, image: m.image };
  }
  const { min, max } = map?.bounds ?? { min: [-1000, 0, -1000], max: [1000, 0, 1000] };
  return {
    centerX: (min[0] + max[0]) / 2,
    centerZ: (min[2] + max[2]) / 2,
    size: Math.max(max[0] - min[0], max[2] - min[2], 1),
    flipU: 1,
    flipV: -1,
    minimapSpan: MAP_CAL.minimapSpan,
    image: null,
  };
}

// `compass_mp_hud` is a 512x64 strip: one tick per 10 degrees and the
// cardinals a quarter turn apart, wrapping at the full texture width.
// Letter centres were measured from the art (N 9.5, E 136, S 265, W 392).
const TAPE = { width: 512, height: 64, period: 512, northCenter: 9.5 };

const VIEW = { minimap: 176, compassWidth: 264, compassHeight: 40 };
const FIRE_PING_SECONDS = 1.2;
export const MINIMAP_PING_SIZE = 80;
const MINIMAP_DOT_SIZE = 26;

const RAD2DEG = 180 / Math.PI;

function div(className, parent) {
  const element = document.createElement('div');
  element.className = className;
  parent.appendChild(element);
  return element;
}

export class Hud {
  constructor({
    minimap, compass, ammoRow, weaponName, damage, map = null,
  }) {
    this.cal = minimapCalibration(map);
    this.minimap = minimap;
    this.damage = damage;
    this.weaponName = weaponName;

    this.rot = div('hud-minimap-rot', minimap);
    this.mapLayer = div('hud-minimap-map', this.rot);
    if (this.cal.image) this.mapLayer.style.backgroundImage = `url('${this.cal.image}')`;
    else this.mapLayer.style.background = 'linear-gradient(135deg, #1a2833, #101a22)';
    this.arrow = div('hud-minimap-arrow', minimap);
    this.arrow.style.backgroundImage = `url('${ART}compassping_player.png')`;

    // One tape copy per wrap period keeps a cardinal in view for any heading.
    // Each copy clips itself to one period so neighbours never overpaint it.
    const tapeScale = VIEW.compassHeight / TAPE.height;
    this.tapePeriod = TAPE.period * tapeScale;
    this.tape = [];
    for (let i = 0; i < 3; i += 1) {
      const copy = div('hud-compass-tape', compass);
      copy.style.backgroundImage = `url('${ART}compass_mp_hud.png')`;
      copy.style.width = `${this.tapePeriod}px`;
      copy.style.backgroundSize = `${TAPE.width * tapeScale}px ${VIEW.compassHeight}px`;
      this.tape.push(copy);
    }

    this.ammoRow = ammoRow;
    this.magDigits = [];
    this.reserveDigits = [];
    for (let i = 0; i < 3; i += 1) this.magDigits.push(this.buildDigit());
    const divider = div('hud-digit hud-digit-divider', ammoRow);
    divider.style.backgroundImage = `url('${ART}hud_mp_num_big_line.png')`;
    for (let i = 0; i < 3; i += 1) {
      this.reserveDigits.push(this.buildDigit('hud-digit-reserve'));
    }

    // Pooled firing pings; a contact lights at most one at a time.
    this.pings = [];
    this.dots = [];
    this.firedAt = new Map();
    this.counts = { contacts: 0, revealed: 0, friendly: 0 };

    this.lastMag = null;
    this.lastReserve = null;
  }

  buildDigit(extraClass) {
    return div(extraClass ? `hud-digit ${extraClass}` : 'hud-digit', this.ammoRow);
  }

  // Called when a combatant (by id) fires so its map ping lights for a moment.
  markFire(id) {
    this.firedAt.set(id, performance.now());
  }

  getState() {
    return { ...this.counts };
  }

  setDigit(element, value) {
    const image = value === null ? 'none' : `url('${ART}hud_mp_num_big_${value}.png')`;
    if (element.dataset.image !== image) {
      element.style.backgroundImage = image;
      element.dataset.image = image;
    }
  }

  // Renders a number right-to-left into a digit pool; leading slots hide.
  renderNumber(pool, value) {
    const text = value === null ? '' : String(Math.max(0, Math.trunc(value)));
    for (let i = 0; i < pool.length; i += 1) {
      const fromRight = pool.length - 1 - i;
      const digit = fromRight < text.length ? Number(text[text.length - 1 - fromRight]) : null;
      this.setDigit(pool[i], digit);
      pool[i].style.visibility = fromRight < text.length ? '' : 'hidden';
    }
  }

  update({
    x, z, yaw, contacts = [], weapon, health, hitFlash, dead,
  }) {
    const cal = this.cal;
    const heading = ((-yaw * RAD2DEG) % 360 + 360) % 360;

    // Compass tape: N centers at heading 0 and the strip advances one period
    // per revolution, so turning right scrolls the letters left.
    const tapeScale = this.tapePeriod / TAPE.period;
    const periodPx = this.tapePeriod;
    const base = VIEW.compassWidth / 2
      - (TAPE.northCenter + (heading / 360) * TAPE.period) * tapeScale;
    const wrapped = ((base % periodPx) + periodPx) % periodPx - periodPx;
    for (let i = 0; i < this.tape.length; i += 1) {
      this.tape[i].style.transform = `translateX(${(wrapped + i * periodPx).toFixed(1)}px)`;
    }

    // Minimap: the art spins about the player, who stays centred under a
    // fixed up-pointing arrow. `spin` is the clockwise rotation that brings
    // the facing direction to screen-up given the art's axis mapping.
    const mmScale = VIEW.minimap / cal.minimapSpan;
    const mmSize = cal.size * mmScale;
    // World facing is (-sin yaw, -cos yaw); art X runs along world Z and art
    // Y along world X, flipped per MAP_CAL.
    const artU = -Math.cos(yaw) * cal.flipU;
    const artV = -Math.sin(yaw) * cal.flipV;
    const spin = -Math.atan2(artU, -artV);
    this.rot.style.transform = `rotate(${spin.toFixed(4)}rad)`;
    this.mapLayer.style.width = `${mmSize}px`;
    this.mapLayer.style.height = `${mmSize}px`;
    this.mapLayer.style.backgroundSize = `${mmSize}px ${mmSize}px`;
    const mapUv = worldToMinimapUv(x, z, cal);
    const px = mapUv.u * mmSize;
    const py = mapUv.v * mmSize;
    this.mapLayer.style.left = `${VIEW.minimap / 2 - px}px`;
    this.mapLayer.style.top = `${VIEW.minimap / 2 - py}px`;

    const now = performance.now();
    let pingIndex = 0;
    let dotIndex = 0;
    let revealed = 0;
    let friendly = 0;
    const place = (element, size, cx, cz) => {
      element.style.left = `${px + (cz - z) * cal.flipU * mmScale - size / 2}px`;
      element.style.top = `${py + (cx - x) * cal.flipV * mmScale - size / 2}px`;
    };
    for (const contact of contacts) {
      if (contact.dead) continue;
      // Friendlies are always shown; hostiles only while a radar sweep reveals them.
      const dot = contact.friendly ? 'compassping_green_mp' : contact.revealed ? 'compassping_enemysatellite' : null;
      if (dot) {
        let element = this.dots[dotIndex];
        if (!element) {
          element = div('hud-minimap-dot', this.mapLayer);
          this.dots[dotIndex] = element;
        }
        if (element.dataset.dot !== dot) {
          element.style.backgroundImage = `url('${ART}${dot}.png')`;
          element.dataset.dot = dot;
        }
        element.style.display = '';
        place(element, MINIMAP_DOT_SIZE, contact.x, contact.z);
        dotIndex += 1;
        if (contact.friendly) friendly += 1; else revealed += 1;
      }
      const firedAt = this.firedAt.get(contact.id);
      if (contact.friendly || firedAt === undefined) continue;
      const age = (now - firedAt) / 1000;
      if (age > FIRE_PING_SECONDS) continue;
      let ping = this.pings[pingIndex];
      if (!ping) {
        ping = div('hud-minimap-ping', this.mapLayer);
        ping.style.setProperty('--ping-size', `${MINIMAP_PING_SIZE}px`);
        this.pings[pingIndex] = ping;
      }
      ping.style.display = '';
      ping.style.opacity = (1 - age / FIRE_PING_SECONDS).toFixed(3);
      place(ping, MINIMAP_PING_SIZE, contact.x, contact.z);
      pingIndex += 1;
    }
    for (; pingIndex < this.pings.length; pingIndex += 1) this.pings[pingIndex].style.display = 'none';
    for (; dotIndex < this.dots.length; dotIndex += 1) this.dots[dotIndex].style.display = 'none';
    this.counts = { contacts: contacts.length, revealed, friendly };

    if (weapon.magazine !== this.lastMag) {
      this.renderNumber(this.magDigits, weapon.magazine);
      this.lastMag = weapon.magazine;
    }
    if (weapon.reserveAmmo !== this.lastReserve) {
      this.renderNumber(this.reserveDigits, weapon.reserveAmmo);
      this.lastReserve = weapon.reserveAmmo;
    }
    this.weaponName.textContent = weapon.ready ? (weapon.name ?? 'M27') : '';

    // Damage: the hit flash rides the same vignette art the game fades in as
    // health drops, so a hard hit reads as a pulse of the low-health state.
    const lowHealth = health < 40 && !dead ? (1 - health / 40) * 0.9 : 0;
    const opacity = Math.max(hitFlash * 0.55, lowHealth);
    if (this.damage.dataset.opacity !== opacity.toFixed(3)) {
      this.damage.style.opacity = opacity.toFixed(3);
      this.damage.dataset.opacity = opacity.toFixed(3);
    }
  }
}
