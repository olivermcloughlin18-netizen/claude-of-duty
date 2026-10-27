# PLAN: Vibe Slops II feature push

Lead-architect plan for parallel Sonnet builders. Read this whole file before touching code, then `AGENTS.md`.
Names in `code` are exact. Change a contract name only through the integrator.

## Given inputs (already running; their internals are not re-planned here)

| Lane | Worktree | Delivers | Consumed by |
|---|---|---|---|
| `lane/mp-server` | `../cod-wt/mp-server` | `server/` (Node + `ws`, own `package.json`, `server.js`, `test/`, Railway-ready), `server/PROTOCOL.md`, and an unwired `export/web/net-client.js`: `createNetClient({url})` → `connect(code\|null, name)` → Promise<joined>, `sendState`, `sendHit`, `on/off`, `disconnect`, `id`, `roomCode`, `connected` | Lane **M** |
| `lane/new-map` | `../cod-wt/new-map` | `.tools/build_map_<id>.mjs`; `.tools/bake_*.mjs` parameterised by CLI args (defaults unchanged); `export/web/maps/<id>/` with `manifest.json` `{id, name, files, spawns[{position,yaw}], playerStart, bounds, lighting}`; `export/web/maps/README.md`; stage allowlist | **W0** (map registry and map select) |

**Two issues the coordinator must forward now** (both observed in the worktrees on 2026-10-27):
1. The root `.gitignore` is a whitelist (`*` first), and `server/` is **fully ignored**: `git check-ignore server/server.js` matches `.gitignore:1:*`, and `git status` shows only `net-client.js`. Unless `lane/mp-server` adds `!/server/` + `!/server/**` (keeping `server/.gitignore` for `node_modules`), its commit silently drops the server. `lane/new-map` must whitelist `.tools/build_map_*.mjs` the same way.
2. `server.js` hand-copies a 9-rifle `WEAPONS` table and rejects unknown ids, any damage above `damage × headshot`, and any hit faster than its RPM. New weapons (and shotgun pellets) are rejected online until lane M generates that table from `weapons.js` (§4-M).

## 0. Ground rules for every lane

- Work in your own worktree on branch `lane/<x>`, created from the branch named in §6. **Never from `origin/HEAD`** (stale main).
- Edit only the files your lane **owns**, plus the listed **may-touch regions**. If you need a hook in someone else's file, do not add it; write `HOOK REQUEST: <file> <function> <what/why>` in your final report.
- Every runtime change needs evidence: `npm run test:unit`, your scenario (`npm run ai:scenario -- <name>`), the listed regression `ai:*` runs, and a look at your screenshots. A console error or failed request counts as a failure (AGENTS.md).
- No `git stash`, no pushes to `main` (that deploys Pages), and no new root npm deps. Do not edit `AGENTS.md`; list your debug methods in your report.
- Systems must not advance timers while `frame.simulationActive` is false (pause, menus, killcam).
- Final report: commits, `git diff --stat <base>`, every command you ran with its `passed` result, artifact paths, getState excerpts, hook requests, known gaps.

## 1. Architecture findings

**Main loop.** All glue lives in the inline module in `export/web/index.html` (lines ~641-2548); there is no framework.
- `start()` (~2140) loads in parallel the map GLB, collision BVH, nav hints, ladders, medals, navmesh, the equipped viewmodel, audio and environment. It then builds `PlayerController`, `PlayerHealth` and `EnemyManager(count: 6)`, registers bots in `FreeForAllMatch`, warms shaders, publishes `globalThis.hijacked` and sets `ready`.
- `tick()` (~2354) runs player, navigation, enemies, playerHealth, match, weaponEffects, viewmodel/viewBob, HUD, death card, medals, then `renderFrame()` (HDR target → `viewmodel.render` → grade/LUT pass).
- Boot is gated on the first gesture (`hijackedStartup`); `?autostart=1` skips it and the harness uses it. Map and mode are therefore **boot-time config**, and changing them reloads the page.

**Weapons.** `WEAPON_DEFINITIONS` (9 ARs) is inline in index.html.
- Each definition gets its own `Viewmodel` plus a `WeaponController` in the `weaponSlots` Map; only the equipped slot loads at boot.
- `fireShot()` makes one centre ray via `weaponEffects.fire()` against `[collisionRoot, ...enemies.hitTargets]`, then calls `enemies.handlePlayerHit(hit, def.damage)` (head 2 / torso 1 / legs 0.75), hardcoded recoil and `enemies.alert(1500)`.
- The controller is always automatic; "single" and "burst" exist only as HUD icons.

**Enemies** (`enemy-system.js`): six bots on a recast crowd with baked pose frames (idle/run/death).
- Every target, damage and spawn loop uses `[this.player, ...this.enemies]`, so there is **no team concept**.
- Bots hit the player via `playerHealth.takeDamage(24, enemy)` and other bots via `enemy.takeDamage`.
- Spawns use a hardcoded classname priority (`mp_dm_spawn`, ...), patrol uses `hints.pathnodes`, and `alert()` force-targets the player.

**Match/HUD/menus.** `free-for-all-match.js` is pure, but `renderMatchUi()` hardcodes FFA. `hud.js` holds the Hijacked minimap calibration `MAP_CAL` and pings bots by numeric index only when they fire. `frontend.js` is a DOM-free state machine (`welcome|loading|title|pause|class|error`) with hand-written class cards per rifle. `touch-controls.js` dispatches only `reload` as an action.

**Kill attribution** happens in two places (`playerHealth.onDeath`, `EnemyManager.onDeath`), both calling `match.recordKill(killerId, victimId)`. Nothing records *how* a kill happened.

**Hardcoded Hijacked assumptions.** W0 routes all of these through the map registry, and the Hijacked values become its registry entry.
- **index.html:** title card `ui/menu_mp_map_select_hijacked_final.png`; `hijacked.navmesh.bin`, `hijacked_optimized.glb`, `hijacked_nav_hints.json`, `hijacked_ladders.json`; `chooseSpawn` fallback `[2102,57,133]`; `fallResetY -700`; background `0x87a8c8`.
- **Runtime modules:** the default metadata URL in `collision-world.js`, `DEFAULT_NAVMESH_URL` in `navigation.js`, env/probe/vision/LUT defaults in `lighting.js` (already options), `hijacked_probes.*` in `light-probes.js`, `MAP_CAL` + `compass_map_mp_hijacked.png` in `hud.js`, and `spawnClassPriority` in `enemy-system.js`.

The bakers and `stage_cloudflare.mjs` belong to `lane/new-map`. The `globalThis.hijacked` name and the `hijacked.*` storage keys **stay**.

**Repo traps.** Besides the `.gitignore` whitelist above, `test:unit` lists files explicitly, and `ai-game.mjs` hardcodes its command list and knows only Windows Chrome paths. Pages deploys on push to `main` (origin = `olivermcloughlin18-netizen/claude-of-duty`), and CI runs `npm run test:unit` only.

## 2. Asset inventory: what really exists

| Area | On disk | Decision |
|---|---|---|
| Viewmodels | 9 AR GLBs + mags + 1 viewhands: an94, hk416(M27), sa58(FAL), saritch(SMR), scarh, sig556, type95, x95l(MTAR), xm8 | No SMG, sniper, shotgun, pistol or knife models. **New weapons reuse these 9 viewmodels** with new stats, fire modes and camo, plus *procedural* attachments (scope tube, suppressor can) and a CSS scope overlay. Names derive from the base gun ("MTAR SMG"). |
| Viewmodel anims | idle/fire/ads_fire/reload/reload_empty per AR | Reused per base gun; pump/bolt cycling uses `fire`. No melee or inspect. |
| Bot/remote body | `c_chn_mp_pla_assault_fb` lod0-2, `t6_wpn_ar_hk416_world`, anims stand_alert / combatrun / death_faceplant | Remote players and killcam ghosts reuse the baked poses, so they glide (no crouch, strafe or slide anim). Teams are shown with markers, not models. |
| Weapon audio | 9 AR shots, decays, 2 LFE samples, foley | New classes reuse a base shot with `playbackRate`/gain. Explosions and jets are **synthesised** (noise + filter + LFE). **No announcer VO.** |
| Vehicles/props (`export/model_export`, untracked) | `veh_iw_mh6_littlebird_noblurblade` lod0-3 (texture `textures/~-gmh6_littlebird_body_civ_c.png` present), `veh_iw_zodiac`, `com_wine_crate_*` | The care package arrives on the **real Little Bird** (copy the lod1 GLB to `export/web/props/`, with a `.dds→png` URL modifier as `enemy-system.js` uses). No jet model exists, so the jet is procedural. |
| Projectiles, dogtags, flags | xmodel JSON metadata only, no mesh | The HK drone, bombs and dog tags are procedural. |
| HUD art (`ui/hud`) | supply-drop compass icons, `hud_icon_air_airstrike`, `hud_obit_{airstrike,crate,hk_drone}`, `hud_mp_vis_ks_*`, `compassping_enemysatellite`, `compassping_green_mp`, `waypoint_dogtags`, firerate `bolt`/`pump`/`burst`, `hud_xpticker480` | Used for streaks, obits, UAV dots, friendlies, tags, class cards and the XP ticker. |
| Medals (`ui/medals/medals.json`, 171 with xp) | `headshot`, `revenge_kill`, `capture_enemy_crate`, `kill_enemy_with_care_package_crush`, `missile_drone_kill`, `strafe_run_kill`, `retrieve_own_tags`, `kill_confirmed_multi`, `won_match`... | XP comes from the def's `xp`; streak and mode medals reuse these refs. |
| BO2 source | None on the machine | No new extraction; the new map is original (`lane/new-map`). |

## 3. Wave 0: contracts, map registry and map select (one agent)

W0 is a **behaviour-preserving refactor plus empty seams**. After W0, FFA on Hijacked must play exactly as before, and every later lane works in its own files. W0 runs **concurrently** with the two given lanes because it touches none of their files.

### 3.1 `export/web/game-events.js` (new, pure)
```js
export const EVENTS = Object.freeze({ KILL:'kill', DAMAGE:'damage', SHOT:'shot', MATCH:'match', MEDAL:'medal', STREAK:'streak' });
export function createEventBus({ historyLimit = 50 } = {}) // -> { on(type, fn) -> off(), emit(type, payload), history() }
```
`emit` throws on an unknown type. When a required field is `undefined` it calls `console.error('[bus] <type> missing <field>')` (`null` is allowed), so seam bugs fail the harness. Handler errors are caught and logged.

Ids are `'player'`, `'bot-<n>'` and `'net-<serverId>'`. `Team = 'allies'|'axis'`. `Cause = 'bullet'|'airstrike'|'hunter'|'crate'|'environment'`.

Payloads (all fields required):
- `kill {killerId|null, victimId, weaponId, cause, region:'head'|'torso'|'legs'|null, victimPosition:[x,y,z], killerPosition|null, at}`
- `damage {attackerId|null, victimId, amount, weaponId, cause, region}`
- `shot {shooterId, weaponId, origin, end, hitId|null}`
- `match {phase:'playing'|'ended', winnerId|null, winnerTeam|null}`
- `medal {ref, name, xp}`
- `streak {id, ownerId, phase:'earned'|'activated'|'ended'}`

### 3.2 `export/web/combatants.js` (new, pure)
```js
export class Combatants {
  constructor({ bus })
  add(entry); remove(id); get(id); all(); idOf(actor); setTeam(id, team|null); teamOf(id)
  hostile(aId, bId)   // false if same id; true if aId===null (world) or either team null; else teams differ
  hitTargets()        // Object3D[] of live entries' hitboxes()
  resolveHit(hit)     // -> {id, region, multiplier}|null from userData.enemyHit (bots) or userData.combatantHit (puppets)
  applyDamage(victimId, amount, { attackerId, weaponId, cause, region }) // -> applied
  lastHit(id)         // -> {attackerId, weaponId, cause, region, at}|null
  radiusDamage(center, radius, maxDamage, info, isExposed = () => true) // linear falloff -> [{id, applied, killed}]
  getState()          // -> [{id, team, dead}]
}
// entry, all required: { id, name, kind:'player'|'bot'|'remote', team, actor, position(), feet(), dead(), hitboxes(), applyDamage(amount, info) }
```
`applyDamage` returns 0 in four cases: amount ≤ 0, victim dead, self-damage (unless `cause==='environment'`), or `attackerId && !hostile` (friendly fire off). Otherwise it **sets `lastHit` before** calling `entry.applyDamage`, and emits `damage` when the applied amount is > 0. **All damage goes through here.**

### 3.3 Registries (pure ESM, no `three`, importable in Node)
**`weapons.js`** holds the 9 definitions moved out of index.html, with `degToRad` replaced by plain math.
```js
export const REGION_MULTIPLIERS = { head: 2, torso: 1, legs: 0.75 };
export const WEAPONS;  export const ATTACHMENTS = {};   // lane A fills: id -> { name, apply(def) -> def }
export function getWeapon(id)                           // alias hk416->m27; unknown -> null
export function resolveWeapon(id, attachmentIds = [])   // frozen; throws on unknown or > 2 attachments
export function damageFor(def, { distance, region })    // def.damage * interp(def.falloff, distance) * REGION_MULTIPLIERS[region]
```
Required fields on every def. W0 back-fills the 9 ARs so today's behaviour is unchanged:
- `id, name, class:'ar'|'smg'|'sniper'|'shotgun', magazineSize, reserveAmmo, roundsPerMinute, damage`
- `falloff:[[0,1],[1e9,1]]`, `pellets:1`, `spread:{hip:0,ads:0}`, `recoil:{pitch:[0.0065,0.0105], yaw:0.0035}`
- `alertRadius:1500`, `maxRange:10000`, `fireMode:'auto'`, `fireTypeIcon`, `scope:false`, `art`, `audio:{shot, rate:1, gain:1}`
- `viewmodelUrl, magazineUrl, magazineOffset, clips`

**`maps.js`** consumes the given manifests:
```js
export const MAP_IDS = ['hijacked'];                    // integrator appends the new-map id at the gate
export const HIJACKED = { id:'hijacked', name:'Hijacked', card:'ui/menu_mp_map_select_hijacked_final.png',
  render:'hijacked_optimized.glb', collision:'hijacked_collision_bvh.json', navmesh:'hijacked.navmesh.bin',
  hints:'hijacked_nav_hints.json', ladders:'hijacked_ladders.json', probes:{ json:'hijacked_probes.json', bin:'hijacked_probes.bin' },
  lighting:{ env:'textures/env/', probe:'textures/probe/', vision:'vision.json', lut:'textures/mp_hijacked_lut.png' },
  minimap:{ image:'ui/hud/compass_map_mp_hijacked.png', centerX:-316, centerZ:12, size:7176, flipU:1, flipV:-1, span:1250 },
  spawns:null, playerStart:null, fallbackSpawn:[2102,57,133], fallResetY:-700, bounds:{ min:[-3516,-500,-1000], max:[2838,742,965] }, background:0x87a8c8 };
export function fromManifest(manifest, baseUrl)  // pure: manifest.json -> entry of the SAME shape (every key present; absent ones null)
export async function loadMap(id, fetchFn = fetch) // 'hijacked' -> HIJACKED; else fetch `maps/${id}/manifest.json` -> fromManifest; any failure -> HIJACKED + console.warn
export async function listMaps(fetchFn = fetch)    // -> [{id, name, card|null}] for the setup screen
```
`fromManifest` rules:
- File URLs get the prefix `maps/<id>/`.
- `minimap: null` when no image ships; the HUD then draws contacts on a plain panel calibrated from `bounds`.
- `fallResetY = bounds.min[1] - 300`.
- `lighting` reuses Hijacked's env/LUT unless the manifest overrides it.
- If the manifest has no nav-hints file, the host **synthesises hints** (spawns → `{classname:'mp_dm_spawn', position, yaw}`, pathnodes = spawn positions), so `EnemyManager` and patrol work unchanged.

The key mapping for `files` is written against `export/web/maps/README.md` once it exists. Until then W0 tests against `test/fixtures/map-manifest.json`, built from the field list above, and the integrator reconciles the two at the gate.

**`modes.js`:**
```js
export const PLAYER_RULES = { maxHealth:100, respawnDelay:1.5, spawnProtection:3, regenDelay:4, regenPerSecond:25 };
export const MODES = { ffa: { id:'ffa', name:'Free for all', teams:false, botCount:6, killstreaks:true, online:true,
  spawnClasses:['mp_dm_spawn','mp_tdm_spawn_team2_start','mp_tdm_spawn_allies_start','mp_tdm_spawn','mp_dm_spawn'],
  teamFor:(botIndex) => null, createMatch:() => new FreeForAllMatch({ scoreLimit:30, timeLimitSeconds:300 }) } };
export function getMode(id) // unknown -> ffa
```
**`game-config.js`:**
```js
export const DEFAULT_SERVER_URL = ''; // integrator sets the wss://… Railway URL; '' = online hidden
export function readGameConfig(search, storage) // -> frozen { mapId, modeId, room, serverUrl, name }
export function setupUrl(href, { mapId, modeId, room }) // -> url with autostart=1
export function saveSetup(storage, { mapId, modeId, name })
```
Precedence is URL > `localStorage['cod.setup.v1']` > defaults. `room` must be `'NEW'` or match `/^[A-Z0-9]{4,8}$/`, otherwise null. `?server=` must be a ws(s) URL. A set `room` forces `modeId='ffa'`.

**MatchContract.** Every `createMatch()` result implements `phase`, `scoreLimit`, `timeLimitSeconds`, `register(id, name, {human=false, team=null})`, `reset()`, `update(dt)`, `recordKill(killerId, victimId, event)`, `finish(winnerId?)` and `getState()`:
```
{ modeId, modeName, phase, scoreLimit, timeLimitSeconds, elapsedSeconds, remainingSeconds, winnerId, winnerTeam,
  teams:[{id,name,score}]|null, scoreLabel, standings:[{id,name,human,team,kills,deaths,streak,score,place}],
  feed:[{killerId,killer,victimId,victim,weaponId,cause,at}] }
```
W0 extends `FreeForAllMatch` to this shape (`score = kills`) and adds `setStandings(players)` for server-driven scores.

### 3.4 System stubs (W0 creates no-op files; each lane fills its own)
```js
export const system = { name, debug: {}, init(ctx) {}, update(dt, frame) {}, onKey(code) { return false },
  onTouchAction(action) { return false }, reset() {}, getState() { return {} } }; // every member required
```
| File | Lane | `name` | Extra required members |
|---|---|---|---|
| `loadout.js` | A | `loadout` | (none) |
| `killstreaks.js` | C | `killstreaks` | `get radarActive()` |
| `net-play.js` | M | `net` | `async connect(config)` → bool, `get online()`, `get roomMapId()` (null = use config), `threats()` → Vector3[] |
| `killcam.js` | F | `killcam` | `isPlaying()`, `camera` |
| `progression.js` | F | `progression` | (none) |
| `mode-rules.js` | B | `modeRules` | (none) |

Update order is `[net, modeRules, loadout, killstreaks, progression, killcam]`, with `frame = {simulationActive, controlsActive}`. Each system's `debug` is `Object.assign`ed onto `hijacked.debug`, and a duplicate key is `console.error`ed. `getState().systems[name] = system.getState()`. Systems inject their own `<style>` and DOM under `ctx.overlay`.

**GameContext** (`ctx`, all required, live references):
```
THREE, scene, camera, renderer, config, map, mode, bus, combatants, match, player, playerHealth, enemies, navigation,
collisionWorld, weaponEffects, hud, overlay, canControl(), captureInput(owner|null),
weapons: { activeId(), definition(id), load(ids) -> Promise, setLoadout({primary, secondary|null}) -> Promise<bool>, loadout() },
recordKillEvent(event), showHitmarker('torso'|'head'|'kill'), notify(text, {icon=null, seconds=2.5}), showMedal(def)
```

### 3.5 index.html host changes (W0)
1. **Boot order in `start()`.** Read the config. Then `online = await net.connect(config)` with a 5 s cap (the stub returns false). Then `map = await loadMap(net.roomMapId ?? config.mapId)`, with bots = `online ? 0 : mode.botCount`. Every URL comes from `map`: render, collision `metadataUrl`, navmesh, hints (or synthesised), ladders and probes when non-null, and lighting. So do the spawn (`playerStart` → spawn classes → `fallbackSpawn`), `fallResetY`, the background, the title card and `new Hud({..., map})`.
2. **Weapons** come from `weapons.js`, and class cards are generated from the registry with the same DOM classes. `loadout = {primary:'m27', secondary:'an94'}`, and Digit1/Digit2 equip them. **The default stays m27/an94** because the harness relies on it.
3. **`fireShot()`** loops `def.pellets` times over `weaponEffects.fire(..., {targets: combatants.hitTargets(), weapon, spread, silent: i>0})`. Each hit goes `resolveHit` → `damageFor` → `combatants.applyDamage(id, amount, {attackerId:'player', weaponId, cause:'bullet', region})`. Then it emits `shot`, applies `def.recoil` and calls `enemies.alert(..., def.alertRadius)`. `handlePlayerHit` is no longer used.
4. **Combatants.** The player entry calls `playerHealth.takeDamage`; bot entries call `enemy.takeDamage(amount, null, actorOf(attackerId))`. Teams come from `mode.teams`/`mode.teamFor(i)` and also go to `match.register`.
5. **Kill funnel.** `reportKill(victimId, fallbackKillerId)` builds the `kill` event from `combatants.lastHit`, calls `match.recordKill`, then `bus.emit('kill')`, and keeps the medal logic. When `net.online`, the local death path **does not record**; kills arrive via `ctx.recordKillEvent`. `Enter` restart and `B` respawn are disabled online.
6. **`tick()`.** When `killcam.isPlaying()`, skip the player, nav, enemies, playerHealth and match updates. Call every system's `update`. `renderFrame(cam, drawViewmodel)` renders `killcam.camera` with no viewmodel. HUD `contacts` come from `combatants` (`{id,x,z,dead,friendly,revealed: killstreaks.radarActive}`), and fire pings go through `hud.markFire(id)`. Emit `bus 'match'` at match end.
7. **Input.** `keydown` goes to `system.onKey` when controllable. The touch `streak`/`swap` actions go to systems (W0 handles `swap` itself). `restartMatch()` calls every `system.reset()`, and `canControlPlayer()` also requires `!inputCapture`.
8. **`renderMatchUi()`** becomes generic: a `modeName` header, `ALLIES a – b AXIS` for team modes, rows grouped by team, a `scoreLabel` column, and obit icons per `cause`.
9. **Setup screen** (the map-select work, folded into W0). A new frontend screen `setup`, opened from title and pause, shows:
   - map cards from `listMaps()`;
   - mode cards from `MODES`;
   - an online box (`.fe-online`: name, room code, Create, Join; hidden when `serverUrl` is empty).
   Apply calls `saveSetup`, then `location.assign(setupUrl(...))`, which is a full reload.
10. **Markup:** add `#system-layer`, `#system-notice`, and the touch buttons `data-touch="streak"` / `"swap"`.
11. **Debug API.** `killCombatant(id, {attackerId='player', weaponId='debug', cause='bullet', region='torso'}={})` returns `{killed, event}` via the real damage path. Also add `setLoadout(l)` and `recentEvents()`. `getState()` gains `config {mapId, modeId, room, online}`, `combatants`, `hud {contacts, revealed, friendly}`, `systems`, `player.sliding`, and `weapon.class/fireMode/loadout`.

### 3.6 Other W0 edits
- **`enemy-system.js`** gains these ctor params, all required:
  - `isHostile(a, b)`, used in `selectTarget`, `alert` and `safeSpawnFor`;
  - `applyDamage(targetActor, amount, shooter)`, so `enemyFire` never calls `takeDamage` directly;
  - `onShot({shooter, origin, end, target})`;
  - `extraThreats()`, counted in `safeSpawnFor`;
  - `spawnClasses`.
  It also gains `setVisible(bool)` and `createPuppet(id)` → `{root, hitboxes, setPose(state, seconds), setVisible, dispose}`, which uses the baked templates, sets `userData.combatantHit`, and adds `root` to the scene.
- **`hud.js`:** `Hud({..., map})`, `worldToMinimapUv(x, z, cal)`, `update({..., contacts})`, `markFire(id)`. Friendlies show as `compassping_green_mp` and revealed hostiles as `compassping_enemysatellite`. When `map.minimap` is null, draw a plain panel calibrated from bounds. Add `getState()`.
- **Small module edits:**
  - `touch-controls.js`: `ACTION_KINDS = new Set(['reload','streak','swap'])`.
  - `frontend.js`: `openSetup/closeSetup/applySetup` and `getState().setup`.
  - `weapon-effects.js`: `fire(..., {spread=0, silent=false})`.
  - `light-probes.js`: `loadProbeVolume({json, bin})`.
- **`.tools/ai-game.mjs`:** add the Mac Chrome path and a `scenario <name>` command. The command imports `.tools/scenarios/<name>.mjs`, which exports `query` and `async run({page, openGame(query), screenshot, writeJson, artifactRoot})` → `{checks, probe}`. The harness adds `noBrowserErrors` itself and writes artifacts to `artifacts/ai-<name>`. Include an example `smoke.mjs`.
- **`package.json`:** set `"test:unit": "node --test test/*.test.mjs tests/*.test.mjs"` and add `ai:scenario`. W0 does **not** add `ws`; the server has its own `server/package.json`.
- **`.gitignore`:** add `!/PLAN.md`, `!/.tools/scenarios/`, `!/.tools/scenarios/**`, `!/test/fixtures/**`.
- **CI** (`.github/workflows/*`): add `npm ci --prefix server && npm test --prefix server` so the given server tests run.

### 3.7 W0 acceptance (the gate before fan-out)
**New tests:**
- `test/game-events.test.mjs`.
- `test/combatants.test.mjs`: hostile matrix, friendly fire 0, lastHit before death, radius falloff.
- `test/registries.test.mjs`: every weapon/mode has all fields, `damageFor` matches old damage×multiplier, plain-Node import works.
- `test/maps.test.mjs`: `fromManifest(fixture)` has every HIJACKED key, hints are synthesised, a failed fetch gives HIJACKED.
- `test/game-config.test.mjs`, plus updates to `hud.test.mjs` and `frontend.test.mjs`.

**These must pass unchanged:** `npm run test:unit`, `ai:test`, `ai:enemy`, `ai:life`, `ai:mobile`, `ai:graphics` + `fallback`, and `ai:scenario -- smoke`. `ai:state` must be identical before and after: same spawn, 6 bots, m27, and `config.mapId:'hijacked'`. `recentEvents()` after `killCombatant('bot-0')` must show `damage` + `kill` with `cause:'bullet'`. Capture a `setup.png` screenshot.

**Gate-only check** (integrator, after merging `lane/new-map`): `ai:scenario -- map-<id>` with query `map=<id>` must show all of these:
- ready with no failed requests;
- 6 bots within `bounds`;
- the player grounded, and holding W for 2 s moves > 300u;
- after `alertEnemies`, ≥3 bots fire within 8 s;
- p95 ≤ Hijacked's;
- 4 viewpoint screenshots.

## 4. Lanes

| Lane | Wave | Owns (exclusive) | May touch (region only) | Size |
|---|---|---|---|---|
| **W0 Contracts + map registry/select** | 0 | everything in §3 | (none) | L |
| **A Arsenal** | 1 | `weapons.js`, `loadout.js`, `weapon-controller.js`, `weapon-effects.js`, `viewmodel.js`, `export/web/props/scope*`, `test/{weapons,loadout,weapon-controller}*`, `.tools/scenarios/arsenal.mjs` | index.html `<section class="fe-class">` markup + `.fe-class*` CSS + card-fill block; `frontend.js` class methods | L |
| **C Killstreaks** | 1 | `killstreaks.js`, `killstreak-fx.js`, `export/web/props/littlebird*`, `test/killstreaks*`, `.tools/scenarios/killstreaks.mjs` | (none) | L |
| **M MP integration** | 1 | `net-play.js`, `net-client.js` and `server/**` (both after `lane/mp-server` merges), `.tools/sync_server_weapons.mjs`, `test/net-play*`, `.tools/scenarios/net-duel.mjs` | index.html `.fe-online` markup only | L |
| **F Feel** | 1 | `killcam.js`, `progression.js`, `player-controller.js`, `view-bob.js`, `test/{killcam,progression,player-controller}*`, `.tools/scenarios/{killcam,feel}.mjs` | (none) | L |
| **B Modes** | 2 | `modes.js`, `mode-rules.js`, `team-match.js`, `gun-game-match.js`, `enemy-system.js`, `free-for-all-match.js`, `test/modes*`, `.tools/scenarios/mode-*.mjs` | (none) | L |

After W0, everything else is **integrator-only**: index.html outside the listed regions, `combatants.js`, `game-events.js`, `maps.js`, `game-config.js`, `hud.js`, the rest of `frontend.js`, `touch-controls.*`, `package.json`, `.gitignore`, and CI.

### Lane A: Arsenal
**Deliverables:**
- **Weapons:** ≥2 SMG, ≥2 sniper and ≥1 shotgun on reused viewmodels. Suggested bases: SMG on MTAR/Type 25/M8A1; sniper on SMR (bolt) and FAL (semi); shotgun on SCAR-H (pump, 8 pellets).
- **Fire modes** in `WeaponController`: `semi`, `burst` (3 shots, then release), and `bolt`/`pump` (semi with a long cycle). Fix sa58/saritch/sig556/xm8 to match their icons.
- **Tuning:** per-class falloff/spread/recoil, plus per-def `audio.rate/gain`.
- **Sniper scope:** a CSS overlay at aimBlend > 0.85 with the viewmodel hidden, plus a procedural scope tube.
- **Attachments (6, max 2 per weapon):** suppressor (procedural can, alertRadius 400, quieter low-passed shot, no fire ping), extended mag, fast mag (reload ×1.4), grip (recoil ×0.7), long barrel (falloff ×1.4), rapid fire (RPM ×1.25).
- **Class editor:** 5 classes `{name, primary, primaryAttachments≤2, secondary∈smg|shotgun, secondaryAttachments≤1}` in `localStorage['cod.classes.v1']`. They are validated by `resolveWeapon` (falling back to default) and applied via `ctx.weapons.setLoadout`. Primary and secondary preload at boot. Cards reuse the base gun's art plus the fire-mode icon.

**getState:** `weapon.class/fireMode/attachments/pellets`; `systems.loadout {classIndex, classes, primary, secondary, scoped}`.

**Acceptance:** `ai:scenario -- arsenal` must show all of these:
- every weapon id equips and fires;
- the shotgun one-shots a teleported bot at 150u but not at 900u;
- the sniper torso-kills at 1500u;
- SMG damage at 1200u is lower than at 200u;
- holding a semi trigger for 1 s fires +1, burst fires +3;
- the scope overlay shows with the viewmodel hidden;
- a saved class persists across reload.

Regressions: `ai:test`, `ai:life` (reserve 240 on the default class), `ai:mobile`. Screenshots: `class-editor.png`, `sniper-ads.png`, `shotgun-hip.png`, `suppressor.png`.

### Lane C: Killstreaks (UAV 3, Hunter Killer 4, Care Package 5, Air Strike 7)
**Deliverables:**
- **Streak counting** from `bus kill`. The count resets on player death; held streaks survive it (one of each). Keys `Digit3..6`; the touch `streak` button fires the most recent. Disabled when `!mode.killstreaks || net.online`.
- **UAV:** 30 s of `radarActive` plus a sweep effect.
- **Hunter Killer:** a procedural drone rises 600u, homes on the nearest hostile at 900u/s and explodes (radius 180, 150 dmg, `cause:'hunter'`). It times out after 12 s.
- **Care Package:**
  - A crosshair marker (≤1500u) that needs clear sky (raycast up), otherwise refund + `notify`.
  - The **Little Bird** flies in and drops a procedural crate; landing on a combatant does `radiusDamage(cause:'crate')`.
  - Capture by standing within 60u for 1.5 s (progress ring). Reward: UAV 40%, HK 30%, Air Strike 15%, ammo 15%. The crate is visual only.
- **Air Strike:**
  - Full-screen targeting on the minimap image, or the bounds panel when `map.minimap` is null. Uses `ctx.captureInput('killstreaks')`; click confirms, Esc refunds.
  - After 2 s a procedural jet drops 5 bombs 150u apart (radius 250, max 300). `isExposed` means no ceiling within 800u above the victim.
  - Flash, smoke, camera shake, synthesised boom and whoosh.
- **Medals:** `capture_enemy_crate`, `kill_enemy_with_care_package_crush`, `missile_drone_kill`, `strafe_run_kill`.
- **HUD:** a streak column using `hud_mp_vis_ks_*`.
- **Debug:** `grantStreak(id)`, `useStreak(id, [x,y,z]?)`.

**getState:** `systems.killstreaks {streak, ready, active:[{id,seconds}], radarActive, crates, drones}`.

**Acceptance:** `ai:scenario -- killstreaks` must show all of these:
- 3 kills make `uav` ready, and the real `Digit3` key gives `hud.revealed` = live hostiles;
- an air strike on 3 bots within 200u kills ≥2, with `cause:'airstrike'` in the feed;
- the crate lands in < 6 s, and capturing it grants a reward;
- the HK kills a bot in < 15 s;
- no player self-kills.

Regression: `ai:mobile`. Capture a recording of the air strike, plus `uav.png`, `targeting.png`, `explosion.png`, `littlebird.png` and `crate.png`.

### Lane M: Multiplayer integration (consumes `lane/mp-server`)
Branch from `integration` once both given lanes are merged (§6). `net-play.js` wraps `createNetClient`; do not reimplement transport.

**Deliverables:**
- **Connect.** `connect(config)` creates a client on `config.serverUrl` and calls `connect(room==='NEW' ? null : room, name)`. On a 5 s timeout, an error or an empty URL it returns false and shows `notify('Server unreachable, playing offline vs bots')`.
- **State and snapshots.**
  - `update` calls `sendState({pos, yaw, pitch, vel, weaponId, crouch})` every frame (the client throttles to 22 Hz).
  - Each peer in a `snapshot` gets a puppet (`enemies.createPuppet('net-'+id)`) with 100 ms interpolation and run/idle/death poses, registered in `combatants` as `kind:'remote'`.
  - `peer_joined`/`peer_left` add and remove puppets.
  - `respawn` re-shows a puppet, or for self calls `playerHealth.respawn` at a local spawn using `threats()` = peer positions.
- **Hit claims.** A remote entry's `applyDamage` accumulates claims per target. `update` then flushes **one** `sendHit` per target per frame: `damage` = summed pellets, `headshot` = any head region, plus `shooterPos/targetPos`. `applyDamage` returns the predicted amount for the hitmarker. `hit_rejected` increments `rejected`.
- **Server authority.**
  - A `damage` message targeting self sets `playerHealth.health = hp` and plays the hit flash.
  - `kill` calls `ctx.recordKillEvent({killerId:'net-'+k, victimId, weaponId, cause:'bullet', region: headshot?'head':'torso', ...})`, mapping our own id to `'player'`, and shows `showHitmarker('kill')` on our kills.
  - `scores`/`match_end` call `match.setStandings` and then `finish`; `match_start` resets.
- **Server weapon table.** `.tools/sync_server_weapons.mjs` writes `server/weapons.json` from `weapons.js` as `{id: {damage: damage*pellets, rpm: ceil(maxRpm*1.25)}}`, and `server.js` reads it instead of the hand-copied table. Add a drift test in `test/net-play.test.mjs`.
- **Remote shot effects.** The current protocol has **no shot relay**, so remote tracers and fire pings need one. Add a `shot` C2S/S2C pair (`{t:'shot', o, e, weaponId}`, rate-limited like `state`) and document it in `PROTOCOL.md`.
- **Online map.** `join` carries no map. Add `map` to `join` (from the room creator) and echo it in `joined`; `roomMapId` returns it. If this slips, online forces `hijacked`.
- **UI:** `.fe-online` behaviour plus an invite link (`?room=CODE`).

**getState:** `systems.net {online, room, id, peers, rttMs, snapshotAgeMs, sent, received, rejected}`.

**Acceptance:**
- `npm test --prefix server` passes, including new cases for `shot`, `map` and `weapons.json` (shotgun aggregate accepted, unknown id rejected).
- `ai:scenario -- net-duel` spawns the server on a random port and kills it in `finally`. Page A creates a room, B joins by code, and both show `peers===1`. A's puppet of B is within 60u of B. A fires at B with the real mouse, and B ends up dead or below 100 hp. Both standings show the kill, B respawns, and both pages are screenshotted.
- Fallback: `?room=ABCD&server=ws://127.0.0.1:1` is ready with 6 bots in < 8 s and `online:false`.

### Lane F: Feel (killcam + final killcam, slide, XP/prestige)
**Deliverables:**
- **Killcam.** An 8 s ring buffer at 20 Hz records the player's eye/yaw/pitch, every combatant's position/yaw/pose/dead, and `shot` events. When a bot kills the player, a 4 s replay plays from the killer's eye: real bots are hidden via `enemies.setVisible(false)`, recorded combatants are drawn as puppets, tracers are re-drawn, and a "KILLCAM · <name>" banner shows. Space/click/tap skips after 1 s. Respawn is deferred via `playerHealth.respawnTimer`.
- **Final killcam.** On `match ended`, replay the last feed kill, then show the scoreboard. Offline only.
- **Slide** in `PlayerController`: a crouch rising edge while sprinting and grounded gives 0.65 s at speed ×1.35 (decaying), crouch eye height, 0.8 s cooldown, firing allowed. Works with the touch crouch toggle.
- **XP/prestige.** `localStorage['cod.progression.v1']` stores `{xp, prestige}` (55 levels, 10 prestiges). XP sources: kill 100, headshot +50, medal `xp`, streak use 50, match completed/won. UI: a "+N" ticker, a level-up `notify`, a title-screen rank badge + XP bar (runtime DOM), an end-of-match summary, and a Prestige button. Debug: `setXp(n)`.

**getState:** `systems.killcam {playing, kind, killerId, seconds}`; `player.sliding`; `systems.progression {xp, level, prestige, lastGain}`.

**Acceptance:**
- **killcam:** after `killCombatant('player', {attackerId:'bot-0'})`, `playing` is true within 0.5 s and the camera ≠ the player's eye. Respawn ≤ 6 s, and Space skips. `finishMatch()` after 1 kill plays the final killcam, then the scoreboard. Capture a recording.
- **feel:** Shift+W then C gives `sliding` with speed > 450 within 0.2 s, ending within 0.8 s. A kill gives ≥ +100 XP, which persists across reload. Capture a `setXp(max)` screenshot.

Regressions: `ai:life`, `ai:mobile`.

### Lane B: Modes (TDM, Kill Confirmed, Gun Game), wave 2
**Deliverables:**
- **TDM:** 4v4 (player + 3 ally bots vs 4 axis), score 50, 8 min.
  - Initial spawns from `*_allies_start`/`*_axis_start`; for manifest maps, split `spawns` into halves along the longest `bounds` axis.
  - Respawns scored near teammates and away from hostiles.
  - Overhead friendly markers (green arrow + name).
- **Kill Confirmed:** same teams, score 40.
  - Procedural team-coloured tags plus a `waypoint_dogtags` sprite; pickup within 48u.
  - A hostile tag confirms (+1); an own tag denies (`retrieve_own_tags`). Tags expire after 30 s.
  - Bots detour to tags within 800u.
- **Gun Game:** FFA with a 15-tier ladder of lane A's weapons. A kill advances the tier via `setLoadout({primary, secondary:null})`, and the ladder preloads in `init`. Score = tier. No streaks and no setback.
- All three have `online:false`.

**getState:** `match.teams`; `combatants[].team`; `systems.modeRules {tags, ladderIndex, friendlyMarkers}`.

**Acceptance:**
- **mode-tdm:** 4 vs 4. Over 5 s after `alertEnemies`, no bot targets a teammate. Friendly fire leaves the target alive, and a hostile kill gives allies 1. The UAV reveals hostiles only, and an air strike on mixed bots kills no allies. Must also pass on the new map.
- **mode-kc:** a hostile tag gives +1; a friendly tag is denied.
- **mode-gun:** a kill moves to `ladder[1]`; finishing the ladder ends the match with winner `player`.

Regressions: FFA `ai:enemy`/`ai:life`. Screenshots: `tdm-markers.png`, `kc-tag.png`, `gun-tier.png`, `team-scoreboard.png`.

## 5. Sizes and agent budget
Every lane is size L (W0, A, C, M, F, B).

Agents: the 2 given lanes + W0 + 4 (A, C, M, F) + B + 1 Opus integrator (kept alive via SendMessage) = **9**, one over ~8. If 8 is a hard cap, the integrator does W0 itself. At most **4 new builders run at once** (wave 1); W0 overlaps only the 2 given lanes.

## 6. Wave order and ops
1. **Now.** W0 starts (Sonnet, branch `wave0` from local `main`) in parallel with `lane/mp-server` and `lane/new-map`. Forward the `.gitignore` warning to both given lanes.
2. **Gate (integrator).**
   - Merge `lane/new-map` → `lane/mp-server` → `wave0` into `integration`.
   - Verify `git ls-files server .tools/build_map_*` is non-empty.
   - Append the new map id to `MAP_IDS` and reconcile `fromManifest` with `maps/README.md`.
   - Run §3.7 plus the gate-only map scenario, then push the **branch**. No fan-out until this passes.
3. **Wave 1 (4 parallel): A, C, M, F.** Create each with `git worktree add ../cod-wt/<x> -b lane/<x> origin/integration`, then run `npm ci`.
4. **Integration 1.** Merge **A → C → F → M** (M last so `sync_server_weapons` sees the final arsenal). Run the full suite, every scenario and the §9 checklist, and re-run `node .tools/sync_server_weapons.mjs`.
5. **Wave 2:** B from `origin/integration`.
6. **Integration 2 + ship.**
   - Merge B and run everything.
   - Run `railway up` from `server/` with env `ALLOWED_ORIGINS=https://olivermcloughlin18-netizen.github.io`.
   - Set `DEFAULT_SERVER_URL` to the `wss://…` URL and run `net-duel` against the deployed server.
   - Update `AGENTS.md`, merge to `main` (this deploys Pages), wait 90 s, then check once.
7. **Ops.** Run `caffeinate -dimsu` for the duration. At most 6 Chromes total (4 builders + 2 given lanes). Set `BROWSER_PATH` if the default fails. No `git stash`; push branches only.

## 7. Online multiplayer v1
**Scope.** Room codes, 2-8 players, FFA only, played on the room creator's map once `map` is added (otherwise Hijacked). Rooms have no bots. Clients own their movement and claim their own hits; the server is authoritative for hp, kills, scores, respawn and the match clock. An unreachable server falls back to offline bots. Transport is JSON over `wss://` (Pages is https).

**Protocol** as built by `lane/mp-server`. `server/PROTOCOL.md` is authoritative; `+` marks additions by lane M.
- **Client to server:**
  - `join {room|null, name, +map}`
  - `state {pos, yaw, pitch, vel, weaponId, crouch}` (≤22 Hz)
  - `hit {targetId, weaponId, damage, headshot, shooterPos, targetPos}`
  - `+shot {o, e, weaponId}`
  - `ping {c}`, `leave`
- **Server to client:**
  - `joined {id, room, maxPlayers, players, match, +map}`
  - `peer_joined {player}`, `peer_left {id}`
  - `snapshot {tick, timeLeftMs, players:[{id, pos, yaw, pitch, weaponId, crouch, hp, alive}]}`
  - `damage {targetId, attackerId, weaponId, amount, hp, headshot}`
  - `kill {killerId, victimId, weaponId, headshot, respawnMs}`
  - `respawn {id, hp}`
  - `hit_rejected {targetId, reason}`
  - `scores {players}`, `match_start {killLimit, timeLeftMs}`, `match_end {winnerId, intermissionMs, players}`
  - `+shot {id, o, e, weaponId}`
  - `pong`, `error {code, message}`

**Server checks (given):**
- Hit claims: known weapon, damage ≤ weapon max × headshot, fire rate (0.8 slack), max range, shooter alive and in the room.
- Input and access: schema validation, an `ALLOWED_ORIGINS` env allowlist, per-IP connection and room caps, rate limits, `maxRooms`.
- No secrets anywhere.

**Deliberately left out of v1:**
- Bots, team modes, killstreaks and killcam online.
- Server line of sight, lag compensation, and falloff/region validation (wall-shots and headshot claims within the caps are accepted).
- Reconnect to the same life, host migration, matchmaking, a server browser, chat/voice, accounts and persistent online stats.
- Map voting, spectators, and anti-cheat beyond the checks above.

## 8. New-map pipeline
`lane/new-map` builds this (see `export/web/maps/README.md` when it lands):
1. `node .tools/build_map_<id>.mjs` authors original geometry and writes the render GLB, the collision source and the manifest into `export/web/maps/<id>/`.
2. The parameterised bakers produce the collision BVH, navmesh, ladders and (optionally) probes into that folder. Hijacked defaults are unchanged.
3. The `stage_cloudflare.mjs` allowlist ships the runtime files and omits the sources.

W0 consumes the result through `maps.js` (`fromManifest`, synthesised hints, bounds-based minimap fallback), the setup screen and `?map=<id>`. **Hijacked keeps working unchanged** because its entry is the literal `HIJACKED` object and its files are untouched. Lane B adds team spawn splitting for manifest maps.

## 9. Integrator seam checklist (check each explicitly with evidence)
1. **Tracked files.** `git ls-files` includes `server/**`, `.tools/build_map_*`, `.tools/scenarios/**`, `test/fixtures/**` and `PLAN.md`. The staged site includes the `maps/<id>/` runtime files and `props/*`, and excludes sources, `server/` and `model_export`.
2. **Manifest seam.** The `fromManifest` keys match the real README. A missing optional file (probes, ladders, minimap) gives no 404 and no crash. Synthesised hints let all 6 bots patrol.
3. **Kill funnel.** Exactly one `kill` per death. Offline, check `recentEvents()` after player, bot, streak and crate kills. Online, the local `onDeath` records nothing, and the server `kill` maps ids correctly (own id → `'player'`).
4. **Attribution.** Streak, crate and HK kills carry the right `cause`. Own streaks cause no self-kills.
5. **Friendly fire.** In TDM/KC, bullets, bot fire, air strike, HK and crate all do 0 to teammates, and bots never target teammates (including via `alert`).
6. **Server weapon drift.** `server/weapons.json` matches `weapons.js`. An online shotgun shot sends one aggregated hit and is accepted. The rapid-fire attachment does not trip `fire_rate`.
7. **HUD contacts.** No numeric-index `markFire` calls remain. The UAV reveals hostiles only, friendlies show green, and remote players ping on `shot`.
8. **Loadout.** The default stays m27/an94 (`ai:life` checks reserve 240). Gun Game overrides the class and then restores it. Digit1/2 and touch `swap` work everywhere.
9. **Keys and touch.** 1/2 weapons, 3-6 streaks, C crouch/slide, R, Tab, Esc, with nothing double-bound. The touch buttons fit the `ai:mobile` portrait and landscape screenshots.
10. **Input capture.** Air-strike targeting blocks fire and look only. Esc and the pause menu always release it.
11. **Killcam.** Bots and the clock stay frozen. `enemies.setVisible(true)` is restored and puppets are disposed. The scoreboard waits for the final killcam. Killcam never runs online.
12. **Restart.** `restartMatch()` resets streaks, crates, drones, tags, the ladder and buffers. `renderer.info.memory.geometries` stays stable over 3 restarts.
13. **Performance (p95).** TDM with 7 bots plus streak FX stays ≤ 1.25× the FFA baseline. Hijacked FFA stays ≤ 1.05× its pre-W0 baseline. The new map stays ≤ Hijacked.
14. **Debug API.** No duplicate keys. `getState()` stays < 30 KB with no Three objects. AGENTS.md is updated.
15. **Setup flow.** Apply reloads with the right config. Invalid params fall back to defaults, and a dead server falls back to bots. The first-gesture boot gate and `?autostart` still work.
16. **Tests and CI.** The glob collects every new test, CI runs the server tests, and the integration PR is green on ubuntu with Node 22.

## 10. Not doing (explicitly out of scope)
- Real new weapon models or animations, pistols, launchers, lethals/tacticals, melee/knife (so Gun Game has no setback), or Pick-10.
- Level-gated unlocks (progression is cosmetic rank/prestige only), ragdolls, prone or dolphin dive, announcer VO, or bots using killstreaks.
- Domination, CTF or S&D; online team modes, bots or killstreaks (§7).
- Switching map or mode at runtime without a reload, or per-team bot models.
- Re-planning or editing the given lanes' internals beyond the lane-M hooks listed above.
- Any change to the `globalThis.hijacked` name or the `hijacked.*` storage keys.
