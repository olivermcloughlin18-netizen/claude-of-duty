// Shared helpers for the killstreak scenarios (lane C).
export function makeDebug(page) {
  return (fn, arg) => page.evaluate(([body, value]) => {
    const api = globalThis.hijacked.debug;
    return new Function('api', 'value', `return (${body})(api, value)`)(api, value);
  }, [fn.toString(), arg]);
}

export const ks = (debug) => debug((api) => api.getState().systems.killstreaks);

// Finds a pair of open-sky flat ground points 500-900u apart at similar height with
// a clear eye line: `stand` for the player, `spot` for the strike/crate/bots.
export async function findOpenSpot(page) {
  return page.evaluate(async () => {
    const THREE = await import('three');
    const h = globalThis.hijacked;
    const cw = h.collisionWorld;
    const origin = h.camera.position.clone();
    const topY = 2500;
    const cast = (o, d, far) => cw.raycastFirst(new THREE.Ray(o, d), 0, far);
    const down = new THREE.Vector3(0, -1, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const good = [];
    for (let dx = -1500; dx <= 1500; dx += 150) {
      for (let dz = -1500; dz <= 1500; dz += 150) {
        const x = origin.x + dx;
        const z = origin.z + dz;
        const g = cast(new THREE.Vector3(x, topY, z), down, topY + 3000);
        if (!g || Math.abs(g.face.normal.y) < 0.9) continue;
        const gy = g.point.y;
        if (cast(new THREE.Vector3(x, gy + 8, z), up, 1500)) continue;
        const flat = [[110, 0], [-110, 0], [0, 110], [0, -110]].every(([ox, oz]) => {
          const g2 = cast(new THREE.Vector3(x + ox, topY, z + oz), down, topY + 3000);
          return g2 && Math.abs(g2.point.y - gy) < 30 && !cast(new THREE.Vector3(x + ox, g2.point.y + 8, z + oz), up, 1500);
        });
        if (flat) good.push({ x, y: gy, z });
      }
    }
    good.sort((a, b) => Math.hypot(a.x - origin.x, a.z - origin.z) - Math.hypot(b.x - origin.x, b.z - origin.z));
    for (const stand of good) {
      for (const spot of good) {
        const d = Math.hypot(spot.x - stand.x, spot.z - stand.z);
        if (d < 500 || d > 900 || Math.abs(spot.y - stand.y) > 40) continue;
        const eye = new THREE.Vector3(stand.x, stand.y + 62, stand.z);
        const to = new THREE.Vector3(spot.x, spot.y + 2, spot.z);
        const dir = to.clone().sub(eye);
        const len = dir.length();
        if (cast(eye, dir.normalize(), len - 10)) continue;
        return { stand, spot, distance: d, candidates: good.length };
      }
    }
    return null;
  });
}

export async function waitFor(page, fn, arg, timeout = 120000) {
  return page.waitForFunction(([body, value]) => {
    const api = globalThis.hijacked.debug;
    return new Function('api', 'value', `return (${body})(api, value)`)(api, value);
  }, [fn.toString(), arg], { timeout, polling: 100 });
}
