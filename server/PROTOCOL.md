# Claude of Duty multiplayer protocol (v1)

Transport: WebSocket, text frames only, one JSON object per frame, max 2048 bytes.
Every message has a string `t` (type). Unknown fields are ignored; unknown `t` is an `error`.
Binary frames are rejected. Endpoint: `ws(s)://<host>/` (any path). `GET /health` returns `{"ok":true,"rooms":n,"players":n,"uptime":s}`.

**Units:** the game's world units (T6 inches; player is 72 tall, sprint 450/s). Angles are radians.
Positions are `[x, y, z]` of the player's feet/capsule origin; use the same convention in `state`, `shooterPos` and `targetPos`.
All numbers must be finite; coordinates `|v| <= 100000`, `yaw`/`pitch` `|v| <= 10000`.

Lifecycle: connect, send `join` within 10 s, then `state`/`hit`. The server relays at 20 Hz.
The server pings every 5 s (WebSocket ping frames; browsers answer automatically) and drops connections silent for 15 s.
Clients should also send app-level `ping` every 5 s (net-client does) so they can detect a dead server.

Rooms are server-authoritative: no host. A room starts a match when it has 2+ players and returns to `waiting` if it drops below 2.
Health is 100. Kill limit 30, match 300 s, respawn 2500 ms, intermission 10 s then auto-restart (kills/deaths reset).
The server does NOT know the map: clients choose their own spawn point on `match_start` and `respawn`.

## Client -> server

| `t` | Fields | Notes |
|---|---|---|
| `join` | `room`: string 4-6 chars `[A-Za-z0-9]` or `null`; `name`: string | `null` creates a room (reply code in `joined.room`). Case-insensitive code. Name is sanitized (control chars, `<>&"'` backtick, backslash stripped, max 16 chars; empty becomes `PlayerN`). One join per connection. |
| `state` | `pos`: `[n,n,n]`; `yaw`: n; `pitch`: n; `vel`: `[n,n,n]` (optional, default zeros); `weaponId`: string `[a-z0-9_]{1,16}` (optional); `crouch`: boolean (optional) | Send ~20 Hz. Accepted while dead too. Invalid state returns `error bad_message`. |
| `hit` | `targetId`: string (player id); `weaponId`: string; `damage`: n; `headshot`: boolean; `shooterPos`: `[n,n,n]`; `targetPos`: `[n,n,n]` | One claim per bullet that struck. Replies only on rejection (`hit_rejected`); acceptance shows up as `damage`. |
| `ping` | `c`: n (optional, echoed) | Replied with `pong`. |
| `leave` | none | Server closes with 1000. |

### Hit validation (server order)
1. Schema valid, else `error bad_message`.
2. `reason` returned in `hit_rejected` for any of: `not_playing` (match phase not `playing`), `shooter_dead`, `unknown_target` (not in this room), `self_hit`, `target_dead`, `unknown_weapon`, `bad_damage` (`damage <= 0` or `> weapon.damage * (headshot ? 2 : 1)`), `fire_rate` (faster than 80% of the weapon's rpm interval), `no_position` (no `state` received yet for shooter or target), `position_mismatch` (`shooterPos`/`targetPos` more than 300 units from the last server-known position), `range` (shooter-target distance > 8000).
3. Accepted: `damage` is applied as claimed (min'd to remaining hp).

Weapon table (damage, rpm): m27 33/750, an94 40/625, sa58 55/625, saritch 50/536, scar 40/625, sig556 40/938, tar21 40/750, type95 33/938, xm8 35/1250. Headshot x2 max. Legs (x0.75) are legal: send the lower damage.

## Server -> client

| `t` | Fields | Notes |
|---|---|---|
| `joined` | `id`: string; `room`: string; `maxPlayers`: 8; `players`: `[Player]`; `match`: `Match` | Reply to `join`. `id` is your player id. `players` includes you. |
| `peer_joined` | `player`: `Player` | Another player joined. |
| `peer_left` | `id`: string | Player disconnected. |
| `snapshot` | `tick`: int; `timeLeftMs`: int; `players`: `[{id, pos, yaw, pitch, vel, weaponId, crouch, hp, alive}]` | ~20 Hz, only when some player sent a `state` since last one. Includes yourself (use `hp`/`alive` as the authoritative values). Players with no `state` yet are omitted. |
| `damage` | `targetId`; `attackerId`; `weaponId`; `amount`: n; `hp`: n (remaining); `headshot`: boolean | Broadcast to the room. |
| `kill` | `killerId`; `victimId`; `weaponId`; `headshot`: boolean; `respawnMs`: int | Broadcast. Victim is dead (`alive:false`) until `respawn`. |
| `respawn` | `id`; `hp`: 100 | Broadcast. Respawning client picks a spawn point and resumes `state`. |
| `scores` | `players`: `[{id, name, kills, deaths}]` | Sent on join, leave, kill, match start. |
| `match_start` | `killLimit`: int; `timeLeftMs`: int | Everyone reset to hp 100, alive, 0 kills. Clients respawn locally. |
| `match_end` | `winnerId`: string or null; `intermissionMs`: int; `players`: `[{id,name,kills,deaths}]` | Kill limit reached or time up. Hits rejected until next `match_start`. |
| `hit_rejected` | `targetId`: string or null; `reason`: string (see above) | Only to the shooter. |
| `pong` | `c`: n | Reply to `ping`. |
| `error` | `code`: string; `message`: string | Codes: `bad_message`, `not_joined`, `already_joined`, `room_not_found`*, `room_full`*, `too_many_rooms`*, `rate_limited`*. (* = server then closes the socket.) |

Types: `Player = {id, name, kills, deaths, hp, alive, pos: [n,n,n]|null, yaw, pitch, weaponId, crouch}`; `Match = {phase: "waiting"|"playing"|"ended", killLimit, timeLeftMs}`.

## Abuse limits and close codes
- Token bucket per connection: burst 40, refill 30 msg/s. Excess messages are dropped; 30 drops inside 5 s sends `error rate_limited` and closes with **1008**.
- 20 invalid messages on one connection closes with 1008.
- Max 16 connections per IP (HTTP 429 on upgrade), max 3 rooms created per IP, max 200 rooms (close 1013 `too_many_rooms`).
- `ALLOWED_ORIGINS` set: upgrade without a listed `Origin` header is refused with HTTP 403.
- No `join` within 10 s closes with 1008.
- Reconnecting yields a NEW player id and zeroed score (no session resume in v1).
