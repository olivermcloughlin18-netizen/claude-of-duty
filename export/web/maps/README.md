# Map packages

One directory per map: `export/web/maps/<id>/`. Everything is addressed relative to that directory.
Staged for deploy automatically (`.tools/stage_cloudflare.mjs` copies all of `export/web` except its omit list).

Rebuild a package: `node .tools/build_map_<id>.mjs && node .tools/bake_map_package.mjs <id>`.
Units are inches, y-up, same as Hijacked (player radius 16, height 72).

## `manifest.json`

```
{
  "format": "claude-of-duty-map-v1",
  "id": "kestrel", "name": "Kestrel Heights", "description": "...", "players": "6-8",
  "files": {                       // all paths relative to the package dir
    "glb": "<id>_optimized.glb",           // render scene (meshopt, WebP textures; GLTFLoader + MeshoptDecoder)
    "collisionBvh": "<id>_collision_bvh.json", // hijacked-collision-bvh-v1; loadCollisionWorld({ metadataUrl })
    "navmesh": "<id>.navmesh.bin",          // loadNavigation(url)
    "navHints": "<id>_nav_hints.json",      // same shape as hijacked_nav_hints.json: spawns[] (mp_dm_spawn) + pathnodes[]
    "ladders": "<id>_ladders.json",         // hijacked-ladders-v1, volumes: [] (none on this map)
    "probes": "<id>_probes.json",           // + .bin beside it (SH light-probe volume)
    "vision": "vision.json", "lut": "textures/lut.png",
    "env": "textures/env/", "probe": "textures/probe/",   // cube faces px nx py ny pz nz .png
    "minimap": "minimap.png"
  },
  "spawns": [{ "position": [x, y, z], "yaw": radians }],  // feet position on the floor; yaw = Object3D rotation.y
  "playerStart": { "position": [x, y, z], "yaw": radians },
  "bounds": { "min": [x,y,z], "max": [x,y,z] },           // collision AABB
  "playArea": { "min": [...], "max": [...] },
  "minimap": { "image", "centerX", "centerZ", "size", "flipU", "flipV", "minimapSpan" }, // same fields/semantics as hud.js MAP_CAL
  "lighting": {
    "sun": { "color": "#rrggbb", "intensity": n, "position": [x,y,z] },
    "hemi": { "sky", "ground", "intensity" },   // fallback only
    "fog": { "color", "near", "far" },
    "probeIntensity": n, "environmentIntensity": n, "exposure": n, "saturation": n,
    "paths": { "env", "probe", "vision", "lut" }
  }
}
```

Integration: prefix every `files` entry with `maps/<id>/`, pass `envPath/probePath/visionUrl` to
`applyEnvironmentLighting`, the lut to `loadGradeLut`, and apply `lighting.*` instead of the hard-coded Hijacked values.
Proof: `node --test test/map-<id>.test.mjs` (spawns on walkable ground, headroom, all-pairs navmesh reachability).
