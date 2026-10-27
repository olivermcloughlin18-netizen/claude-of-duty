export const FIRE_MODES = Object.freeze(['auto', 'semi', 'burst', 'bolt', 'pump']);
const BURST_SHOTS = 3;
// A trigger pull that lands while the gun is still cycling is honoured if the
// cycle ends within this window, so semi, bolt and pump never drop a click.
const PULL_BUFFER = 0.2;

export class WeaponController {
  /** Build a controller from a weapons.js definition. */
  static fromDefinition(definition, hooks = {}) {
    return new WeaponController({ ...WeaponController.optionsFor(definition), ...hooks });
  }

  static optionsFor(def) {
    return {
      magazineSize: def.magazineSize,
      reserveAmmo: def.reserveAmmo,
      roundsPerMinute: def.roundsPerMinute,
      initialRoundsPerMinute: def.initialRoundsPerMinute,
      initialShotCount: def.initialShotCount,
      fireMode: def.fireMode,
    };
  }

  constructor({
    fireMode = 'auto',
    magazineSize = 30,
    reserveAmmo = 120,
    roundsPerMinute = 750,
    initialRoundsPerMinute = null,
    initialShotCount = 0,
    onFire = null,
    onEmpty = null,
  } = {}) {
    if (!FIRE_MODES.includes(fireMode)) throw new Error(`unknown fireMode: ${fireMode}`);
    if (!(magazineSize > 0)) throw new Error('magazineSize must be positive');
    if (!(roundsPerMinute > 0)) throw new Error('roundsPerMinute must be positive');
    if (initialShotCount > 0 && !(initialRoundsPerMinute > 0)) {
      throw new Error('initialRoundsPerMinute must be positive when initialShotCount is set');
    }

    this.fireMode = fireMode;
    this.apply({ magazineSize, reserveAmmo, roundsPerMinute, initialRoundsPerMinute, initialShotCount });
    this.magazine = this.magazineSize;
    this.reserveAmmo = this.startingReserveAmmo;
    this.onFire = onFire;
    this.onEmpty = onEmpty;

    this.triggerHeld = false;
    this.reloading = false;
    this.cooldown = 0;
    this.fireCount = 0;
    this.emptyNotified = false;
    this.immediateShot = false;
    this.triggerShotCount = 0;
    this.pullBuffer = 0;
  }

  apply({ magazineSize, reserveAmmo, roundsPerMinute, initialRoundsPerMinute = null, initialShotCount = 0 }) {
    this.magazineSize = Math.floor(magazineSize);
    this.startingReserveAmmo = Math.max(0, Math.floor(reserveAmmo));
    this.shotInterval = 60 / roundsPerMinute;
    this.initialShotInterval = initialShotCount > 0 ? 60 / initialRoundsPerMinute : null;
    this.initialShotCount = Math.max(0, Math.floor(initialShotCount));
  }

  /** Re-tune for a new definition (class change, attachments) and refill. */
  configure(definition) {
    const options = WeaponController.optionsFor(definition);
    if (!FIRE_MODES.includes(options.fireMode)) throw new Error(`unknown fireMode: ${options.fireMode}`);
    this.fireMode = options.fireMode;
    this.apply(options);
    return this.resetLoadout();
  }

  resetLoadout({ reserveAmmo = this.startingReserveAmmo } = {}) {
    this.magazine = this.magazineSize;
    this.reserveAmmo = Math.max(0, Math.floor(Number(reserveAmmo) || 0));
    this.triggerHeld = false;
    this.reloading = false;
    this.cooldown = 0;
    this.emptyNotified = false;
    this.immediateShot = false;
    this.triggerShotCount = 0;
    this.pullBuffer = 0;
    return { magazine: this.magazine, reserveAmmo: this.reserveAmmo };
  }

  get canReload() {
    return !this.reloading && this.magazine < this.magazineSize && this.reserveAmmo > 0;
  }

  setTrigger(held) {
    const next = Boolean(held);
    if (next && !this.triggerHeld) {
      // Only full auto may beat its own cadence by tapping; every other mode
      // waits out the cycle (and, for burst, the whole burst).
      if (this.fireMode === 'auto') this.immediateShot = true;
      else this.pullBuffer = PULL_BUFFER;
      this.triggerShotCount = 0;
    }
    if (!next) this.emptyNotified = false;
    this.triggerHeld = next;
  }

  startReload() {
    if (!this.canReload) return false;
    this.reloading = true;
    this.cooldown = 0;
    this.immediateShot = false;
    this.triggerShotCount = 0;
    this.pullBuffer = 0;
    return true;
  }

  finishReload() {
    if (!this.reloading) return 0;
    const loaded = Math.min(this.magazineSize - this.magazine, this.reserveAmmo);
    this.magazine += loaded;
    this.reserveAmmo -= loaded;
    this.reloading = false;
    this.emptyNotified = false;
    return loaded;
  }

  cancelReload() {
    this.reloading = false;
  }

  update(deltaSeconds, options) {
    const shots = this.step(deltaSeconds, options);
    // Decayed after the shot test, so a long frame cannot eat a fresh pull.
    this.pullBuffer = Math.max(0, this.pullBuffer - Math.max(0, Math.min(Number(deltaSeconds) || 0, 0.25)));
    return shots;
  }

  step(deltaSeconds, { canFire = true } = {}) {
    const dt = Math.max(0, Math.min(Number(deltaSeconds) || 0, 0.25));
    const shortestInterval = Math.min(this.shotInterval, this.initialShotInterval ?? this.shotInterval);
    this.cooldown = Math.max(-shortestInterval * 4, this.cooldown - dt);

    // A started burst finishes even if the trigger is let go.
    const burstRunning = this.fireMode === 'burst' && this.triggerShotCount > 0 && this.triggerShotCount < BURST_SHOTS;
    if (!(this.triggerHeld || burstRunning) || !canFire || this.reloading) return 0;
    if (this.fireMode !== 'auto') return this.updateSingle();
    if (this.immediateShot) {
      this.cooldown = 0;
      this.immediateShot = false;
    }

    let shots = 0;
    while (this.cooldown <= 0 && shots < 4) {
      if (this.magazine <= 0) {
        if (!this.emptyNotified) {
          this.emptyNotified = true;
          this.onEmpty?.();
        }
        break;
      }

      this.magazine -= 1;
      this.fireCount += 1;
      shots += 1;
      this.triggerShotCount += 1;
      const interval = this.initialShotInterval && this.triggerShotCount < this.initialShotCount
        ? this.initialShotInterval
        : this.shotInterval;
      this.cooldown += interval;
      this.onFire?.({
        fireCount: this.fireCount,
        triggerShotCount: this.triggerShotCount,
        magazine: this.magazine,
        reserveAmmo: this.reserveAmmo,
      });
    }
    return shots;
  }

  // semi / bolt / pump: one round per pull. burst: BURST_SHOTS rounds per pull.
  // A pull is consumed once the previous cycle has finished, so the cooldown
  // (a bolt or pump has a long one) is never skipped.
  updateSingle() {
    const perPull = this.fireMode === 'burst' ? BURST_SHOTS : 1;
    let shots = 0;
    while (this.triggerShotCount < perPull && shots < perPull) {
      const wantsShot = this.triggerShotCount > 0 || this.pullBuffer > 0;
      if (!wantsShot || this.cooldown > 0) break;
      if (this.magazine <= 0) {
        if (!this.emptyNotified) {
          this.emptyNotified = true;
          this.onEmpty?.();
        }
        break;
      }
      this.magazine -= 1;
      this.fireCount += 1;
      shots += 1;
      this.triggerShotCount += 1;
      this.pullBuffer = 0;
      this.cooldown += this.shotInterval;
      this.onFire?.({
        fireCount: this.fireCount,
        triggerShotCount: this.triggerShotCount,
        magazine: this.magazine,
        reserveAmmo: this.reserveAmmo,
      });
    }
    return shots;
  }
}
