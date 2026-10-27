// Killstreak visuals + synthesised audio. Owned by lane C. No static three import:
// everything comes from ctx.THREE so this file (like killstreaks.js) loads in Node.
// Sprites/Points/Meshes only; no point lights, so no shader recompiles mid-fight.

const BIRD_URL = 'props/littlebird_lod1.glb';
const BIRD_NORMAL_STUB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function createFx(ctx) {
  const { THREE, scene, camera } = ctx;
  const root = new THREE.Group();
  root.name = 'killstreak-fx';
  scene.add(root);

  // ---------------------------------------------------------------- textures
  const canvasTexture = (size, draw) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    draw(canvas.getContext('2d'), size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const puff = (blobs, hard) => canvasTexture(128, (g, s) => {
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < blobs; i += 1) {
      const a = rand(0, Math.PI * 2);
      const r = rand(0, s * 0.2);
      const cx = s / 2 + Math.cos(a) * r;
      const cy = s / 2 + Math.sin(a) * r;
      const br = rand(s * 0.14, s * 0.28);
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, br);
      grad.addColorStop(0, `rgba(255,255,255,${rand(0.45, 0.8)})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    }
    // radial mask so no puff ever shows a square edge
    g.globalCompositeOperation = 'destination-in';
    const mask = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(hard, 'rgba(0,0,0,0.9)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = mask;
    g.fillRect(0, 0, s, s);
  });
  const glow = canvasTexture(64, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  const smokeTextures = [puff(10, 0.55), puff(14, 0.5), puff(8, 0.6)];

  // ----------------------------------------------------------------- sprites
  const pools = { normal: [], add: [] };
  const live = [];
  const makeSprite = (additive) => {
    const material = new THREE.SpriteMaterial({
      map: glow, transparent: true, depthWrite: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.frustumCulled = false;
    sprite.renderOrder = additive ? 12 : 11;
    root.add(sprite);
    return sprite;
  };
  const tmpC0 = new THREE.Color();
  const tmpC1 = new THREE.Color();
  function emit({ pos, vel, life, size0, size1, c0, c1 = c0, a0 = 1, additive = false, drag = 1.5, grav = 0, spin = 0, tex = null }) {
    const pool = additive ? pools.add : pools.normal;
    if (live.length > 900) return null;
    const sprite = pool.pop() ?? makeSprite(additive);
    sprite.material.map = tex ?? (additive ? glow : smokeTextures[(Math.random() * smokeTextures.length) | 0]);
    sprite.material.rotation = rand(0, 6.28);
    sprite.position.copy(pos);
    sprite.visible = true;
    const p = {
      sprite, vel: vel.clone(), life, age: 0, size0, size1, a0, additive, drag, grav, spin: spin * rand(-1, 1),
      c0: new THREE.Color(c0), c1: new THREE.Color(c1),
    };
    live.push(p);
    return p;
  }
  function stepSprites(dt) {
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const p = live[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.sprite.visible = false;
        (p.additive ? pools.add : pools.normal).push(p.sprite);
        live.splice(i, 1);
        continue;
      }
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.vel.y += p.grav * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const size = p.size0 + (p.size1 - p.size0) * Math.sqrt(t);
      p.sprite.scale.set(size, size, 1);
      p.sprite.material.rotation += p.spin * dt;
      tmpC0.copy(p.c0).lerp(p.c1, clamp01(t * 1.4));
      p.sprite.material.color.copy(tmpC0);
      const fadeIn = clamp01(t / 0.08);
      p.sprite.material.opacity = p.a0 * fadeIn * (1 - t) * (1 - t * 0.4);
    }
  }

  // ------------------------------------------------------------------ sparks
  const SPARKS = 700;
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkCol = new Float32Array(SPARKS * 3);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  const sparkAge = new Float32Array(SPARKS).fill(1e9);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    size: 14, map: glow, vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
  }));
  sparks.frustumCulled = false;
  sparks.renderOrder = 13;
  root.add(sparks);
  let sparkCursor = 0;
  function emitSpark(pos, vel, life) {
    const i = sparkCursor;
    sparkCursor = (sparkCursor + 1) % SPARKS;
    sparkPos.set([pos.x, pos.y, pos.z], i * 3);
    sparkVel.set([vel.x, vel.y, vel.z], i * 3);
    sparkLife[i] = life;
    sparkAge[i] = 0;
  }
  function stepSparks(dt) {
    for (let i = 0; i < SPARKS; i += 1) {
      if (sparkAge[i] >= sparkLife[i]) { sparkCol[i * 3] = sparkCol[i * 3 + 1] = sparkCol[i * 3 + 2] = 0; continue; }
      sparkAge[i] += dt;
      const t = sparkAge[i] / sparkLife[i];
      sparkVel[i * 3 + 1] -= 900 * dt;
      for (let k = 0; k < 3; k += 1) sparkPos[i * 3 + k] += sparkVel[i * 3 + k] * dt;
      const f = Math.max(0, 1 - t);
      sparkCol[i * 3] = 1.2 * f;
      sparkCol[i * 3 + 1] = (0.45 + 0.4 * (1 - t)) * f;
      sparkCol[i * 3 + 2] = 0.12 * f;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;
  }

  // ------------------------------------------------- one-shot meshes (rings...)
  const ringGeo = new THREE.RingGeometry(0.78, 1, 64);
  ringGeo.rotateX(-Math.PI / 2);
  const decals = [];
  const rings = [];
  const debris = [];
  const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x3b3834, roughness: 0.9 });
  const scorchGeo = new THREE.CircleGeometry(1, 28);
  scorchGeo.rotateX(-Math.PI / 2);
  const scorchTex = canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.95)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.6)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });

  function addRing(pos, { color = 0xffb060, from = 30, to = 500, life = 0.6, opacity = 0.9 }) {
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const mesh = new THREE.Mesh(ringGeo, material);
    mesh.position.copy(pos);
    mesh.renderOrder = 10;
    root.add(mesh);
    rings.push({ mesh, from, to, life, age: 0, opacity });
  }
  function stepMeshes(dt) {
    for (let i = rings.length - 1; i >= 0; i -= 1) {
      const r = rings[i];
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) { root.remove(r.mesh); r.mesh.material.dispose(); rings.splice(i, 1); continue; }
      const e = 1 - (1 - t) ** 3;
      const s = r.from + (r.to - r.from) * e;
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = r.opacity * (1 - t);
    }
    for (let i = debris.length - 1; i >= 0; i -= 1) {
      const d = debris[i];
      d.age += dt;
      if (d.age >= d.life) { root.remove(d.mesh); debris.splice(i, 1); continue; }
      d.vel.y -= 1500 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (d.age > d.life - 0.3) d.mesh.scale.multiplyScalar(0.9);
    }
    for (let i = decals.length - 1; i >= 0; i -= 1) {
      const d = decals[i];
      d.age += dt;
      if (d.age >= d.life) { root.remove(d.mesh); d.mesh.material.dispose(); decals.splice(i, 1); continue; }
      d.mesh.material.opacity = d.opacity * (1 - (d.age / d.life) ** 2);
    }
  }

  // ------------------------------------------------------------- screen fx
  const flashEl = document.createElement('div');
  flashEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;z-index:3;' +
    'background:radial-gradient(circle at 50% 50%,rgba(255,244,214,1) 0%,rgba(255,190,110,.85) 45%,rgba(255,120,40,.35) 100%);mix-blend-mode:screen;';
  ctx.overlay.appendChild(flashEl);
  let flashLevel = 0;
  let trauma = 0;
  let appliedQuat = null;
  let baseQuat = null;
  const shakeEuler = new THREE.Euler();
  const shakeQuat = new THREE.Quaternion();
  let shakeClock = 0;

  const camDistance = (pos) => camera.position.distanceTo(pos);
  function screenImpact(pos, power = 1) {
    const d = camDistance(pos);
    const near = clamp01(1 - d / (1800 * power));
    trauma = Math.min(1, trauma + near * 0.9 * power);
    // flash only when the blast is roughly on screen
    const toBlast = pos.clone().sub(camera.position).normalize();
    const facing = toBlast.dot(camera.getWorldDirection(new THREE.Vector3()));
    flashLevel = Math.min(0.6, flashLevel + near * near * (0.2 + 0.8 * clamp01(facing)) * 0.7);
  }
  function stepScreen(dt) {
    flashLevel = Math.max(0, flashLevel - dt * 2.4);
    flashEl.style.opacity = flashLevel.toFixed(3);
    trauma = Math.max(0, trauma - dt * 0.9);
  }
  // Shake rides the camera quaternion. The previous frame's offset is undone
  // first, but only if nothing (mouse-look) rewrote the quaternion since.
  function beginCamera() {
    if (appliedQuat && baseQuat && camera.quaternion.angleTo(appliedQuat) < 1e-6) camera.quaternion.copy(baseQuat);
    appliedQuat = baseQuat = null;
  }
  function endCamera(dt) {
    if (trauma <= 0.001) return;
    shakeClock += dt * 38;
    const k = trauma * trauma * 0.05;
    shakeEuler.set(Math.sin(shakeClock * 1.3) * k, Math.sin(shakeClock * 1.9 + 2) * k, Math.sin(shakeClock * 1.1 + 5) * k * 1.4);
    baseQuat = camera.quaternion.clone();
    camera.quaternion.multiply(shakeQuat.setFromEuler(shakeEuler));
    appliedQuat = camera.quaternion.clone();
  }

  // ------------------------------------------------------------------- audio
  const audio = (() => {
    let ac = null;
    let master = null;
    let reverb = null;
    let noise = null;
    const init = () => {
      if (ac) return ac;
      ac = ctx.weaponEffects?.ensureContext?.() ?? null;
      if (!ac) return null;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;
      master = ac.createGain();
      master.gain.value = 0.95;
      master.connect(comp).connect(ac.destination);
      // generated room: 2.4 s decaying noise, gives booms their tail
      const len = Math.floor(ac.sampleRate * 2.4);
      const ir = ac.createBuffer(2, len, ac.sampleRate);
      for (let c = 0; c < 2; c += 1) {
        const data = ir.getChannelData(c);
        for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
      }
      const conv = ac.createConvolver();
      conv.buffer = ir;
      const wet = ac.createGain();
      wet.gain.value = 0.35;
      conv.connect(wet).connect(master);
      reverb = conv;
      const nlen = ac.sampleRate * 2;
      noise = ac.createBuffer(1, nlen, ac.sampleRate);
      const nd = noise.getChannelData(0);
      let b0 = 0;
      for (let i = 0; i < nlen; i += 1) { b0 = 0.97 * b0 + (Math.random() * 2 - 1) * 0.35; nd[i] = b0 + (Math.random() * 2 - 1) * 0.3; }
      return ac;
    };
    const out = (pos, vol) => {
      // distance gain + stereo pan from the camera's right vector
      const gain = ac.createGain();
      let pan = 0;
      let g = vol;
      if (pos) {
        const d = camera.position.distanceTo(pos);
        g = vol / (1 + (d / 900) ** 1.4);
        const dir = pos.clone().sub(camera.position).normalize();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        pan = Math.max(-0.85, Math.min(0.85, dir.dot(right)));
      }
      gain.gain.value = g;
      let node = gain;
      if (ac.createStereoPanner) {
        const p = ac.createStereoPanner();
        p.pan.value = pan;
        gain.connect(p);
        node = p;
      }
      node.connect(master);
      return { input: gain, tail: node, gain: g };
    };
    const noiseSrc = (loop = false) => {
      const s = ac.createBufferSource();
      s.buffer = noise;
      s.loop = loop;
      s.loopStart = 0;
      return s;
    };
    const tone = (type, f0, f1, dur, vol, o, delay = 0) => {
      const t = ac.currentTime + delay;
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      const env = ac.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 4));
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(env).connect(o.input);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    };
    const noiseBurst = (type, f0, f1, dur, vol, o, { q = 0.7, delay = 0, attack = 0.004, wet = 0 } = {}) => {
      const t = ac.currentTime + delay;
      const src = noiseSrc();
      const filter = ac.createBiquadFilter();
      filter.type = type;
      filter.Q.value = q;
      filter.frequency.setValueAtTime(f0, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const env = ac.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(vol, t + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter).connect(env).connect(o.input);
      if (wet) { const w = ac.createGain(); w.gain.value = wet; env.connect(w).connect(reverb); }
      src.start(t, Math.random());
      src.stop(t + dur + 0.1);
    };
    const api = {
      resume() { const c = init(); if (c?.state === 'suspended') c.resume().catch(() => {}); return Boolean(c); },
      boom(pos, power = 1) {
        if (!init()) return;
        const o = out(pos, 1.3 * power);
        noiseBurst('lowpass', 2600, 90, 1.7, 1.0, o, { q: 0.4, wet: 0.9 });
        noiseBurst('lowpass', 220, 40, 3.0, 0.9, o, { q: 0.2, delay: 0.05, wet: 0.5 });
        noiseBurst('highpass', 2500, 5000, 0.12, 0.5, o, { q: 0.5 });
        tone('sine', 95, 26, 0.9, 1.1, o);
        tone('triangle', 180, 40, 0.5, 0.5, o);
        for (let i = 0; i < 6; i += 1) noiseBurst('bandpass', rand(1200, 4000), 400, 0.07, 0.25, o, { q: 2, delay: 0.25 + i * rand(0.08, 0.18) });
      },
      whistle(pos, dur) {
        if (!init()) return;
        const o = out(pos, 0.2);
        tone('sine', 2400, 760, dur, 0.5, o);
        noiseBurst('bandpass', 3200, 1200, dur, 0.18, o, { q: 4, attack: dur * 0.5 });
      },
      ping(vol = 0.35) {
        if (!init()) return;
        const o = out(null, vol);
        tone('sine', 1760, 1760, 0.22, 0.6, o);
        tone('sine', 1320, 1320, 0.3, 0.45, o, 0.12);
        tone('sine', 1760, 1760, 0.45, 0.2, o, 0.34);
      },
      radioBeep() {
        if (!init()) return;
        const o = out(null, 0.3);
        tone('square', 1500, 1500, 0.06, 0.25, o);
        tone('square', 1100, 1100, 0.06, 0.25, o, 0.1);
        noiseBurst('bandpass', 2000, 2000, 0.25, 0.1, o, { q: 1, delay: 0.18 });
      },
      sweep() {
        if (!init()) return;
        const o = out(null, 0.5);
        noiseBurst('bandpass', 300, 5200, 1.6, 0.5, o, { q: 3, attack: 0.5, wet: 0.5 });
        tone('sine', 220, 1800, 1.5, 0.35, o);
      },
      thud(pos) {
        if (!init()) return;
        const o = out(pos, 0.9);
        tone('sine', 120, 35, 0.4, 0.9, o);
        noiseBurst('lowpass', 900, 100, 0.35, 0.5, o);
      },
      capture() {
        if (!init()) return;
        const o = out(null, 0.35);
        [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.22, 0.4, o, i * 0.07));
      },
      // continuous sources return {update(pos, closing, vol), stop()}
      jet() {
        if (!init()) return null;
        const o = out(null, 1);
        const body = noiseSrc(true);
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.value = 500;
        const roar = ac.createGain(); roar.gain.value = 1.2;
        body.connect(bp).connect(roar).connect(o.input);
        const saw = ac.createOscillator();
        saw.type = 'sawtooth'; saw.frequency.value = 110;
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
        const sg = ac.createGain(); sg.gain.value = 0.35;
        saw.connect(lp).connect(sg).connect(o.input);
        const whine = ac.createOscillator(); whine.type = 'sine'; whine.frequency.value = 1500;
        const wg = ac.createGain(); wg.gain.value = 0.05;
        whine.connect(wg).connect(o.input);
        body.start(0, Math.random()); saw.start(); whine.start();
        o.input.gain.value = 0;
        let stopped = false;
        return {
          update(distance, closing) {
            if (stopped) return;
            const near = 1 / (1 + (distance / 1300) ** 2);
            const doppler = 1 + Math.max(-0.35, Math.min(0.35, closing / 3500));
            const t = ac.currentTime;
            o.input.gain.setTargetAtTime(near * 1.6, t, 0.05);
            bp.frequency.setTargetAtTime(420 * doppler * (0.6 + near * 1.8), t, 0.05);
            saw.frequency.setTargetAtTime(110 * doppler, t, 0.05);
            whine.frequency.setTargetAtTime(1500 * doppler, t, 0.05);
          },
          stop() {
            if (stopped) return;
            stopped = true;
            const t = ac.currentTime;
            o.input.gain.setTargetAtTime(0, t, 0.1);
            for (const n of [body, saw, whine]) n.stop(t + 0.6);
          },
        };
      },
      rotor() {
        if (!init()) return null;
        const o = out(null, 1);
        const src = noiseSrc(true);
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
        const chop = ac.createGain(); chop.gain.value = 0.5;
        const lfo = ac.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 13;
        const lfoGain = ac.createGain(); lfoGain.gain.value = 0.5;
        lfo.connect(lfoGain).connect(chop.gain);
        src.connect(lp).connect(chop).connect(o.input);
        const turbine = ac.createOscillator(); turbine.type = 'sawtooth'; turbine.frequency.value = 340;
        const tl = ac.createBiquadFilter(); tl.type = 'lowpass'; tl.frequency.value = 800;
        const tg = ac.createGain(); tg.gain.value = 0.05;
        turbine.connect(tl).connect(tg).connect(o.input);
        src.start(0, Math.random()); lfo.start(); turbine.start();
        o.input.gain.value = 0;
        let stopped = false;
        return {
          update(distance) {
            if (stopped) return;
            o.input.gain.setTargetAtTime(2.2 / (1 + (distance / 700) ** 1.5), ac.currentTime, 0.08);
          },
          stop() {
            if (stopped) return;
            stopped = true;
            const t = ac.currentTime;
            o.input.gain.setTargetAtTime(0, t, 0.15);
            for (const n of [src, lfo, turbine]) n.stop(t + 0.8);
          },
        };
      },
      whine() {
        if (!init()) return null;
        const o = out(null, 1);
        const osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 420;
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
        const src = noiseSrc(true);
        const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 1.5;
        const ng = ac.createGain(); ng.gain.value = 0.3;
        osc.connect(lp).connect(o.input);
        src.connect(bp).connect(ng).connect(o.input);
        osc.start(); src.start(0, Math.random());
        o.input.gain.value = 0;
        let stopped = false;
        return {
          update(distance, speedRatio) {
            if (stopped) return;
            o.input.gain.setTargetAtTime(0.9 / (1 + (distance / 500) ** 1.5), ac.currentTime, 0.05);
            osc.frequency.setTargetAtTime(380 + speedRatio * 520, ac.currentTime, 0.05);
          },
          stop() {
            if (stopped) return;
            stopped = true;
            o.input.gain.setTargetAtTime(0, ac.currentTime, 0.05);
            osc.stop(ac.currentTime + 0.4); src.stop(ac.currentTime + 0.4);
          },
        };
      },
    };
    return api;
  })();

  // ----------------------------------------------------------- explosion
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  function explosion(pos, { scale = 1, detail = 1, sound = true, power = 1 } = {}) {
    const s = scale;
    emit({ pos: pos.clone().add(V(0, 40 * s, 0)), vel: V(), life: 0.2, size0: 200 * s, size1: 460 * s, c0: 0xffffff, c1: 0xffb050, a0: 0.9, additive: true, drag: 0 });
    emit({ pos: pos.clone().add(V(0, 30 * s, 0)), vel: V(), life: 0.55, size0: 180 * s, size1: 420 * s, c0: 0xffe0a0, c1: 0xff5a14, a0: 0.9, additive: true, drag: 0 });
    const fireCount = Math.round(14 * detail);
    for (let i = 0; i < fireCount; i += 1) {
      const a = rand(0, 6.28);
      const up = rand(0.15, 1);
      const sp = rand(120, 620) * s;
      emit({
        pos: pos.clone().add(V(0, 20 * s, 0)),
        vel: V(Math.cos(a) * sp * (1 - up * 0.5), sp * up * 1.4, Math.sin(a) * sp * (1 - up * 0.5)),
        life: rand(0.5, 1.0), size0: rand(80, 120) * s, size1: rand(190, 320) * s, c0: 0xffe28a, c1: 0xff4a0a, a0: 1,
        additive: true, drag: 2.2, grav: 160, spin: 1.5,
      });
    }
    const smokeCount = Math.round(18 * detail);
    for (let i = 0; i < smokeCount; i += 1) {
      const a = rand(0, 6.28);
      const sp = rand(40, 340) * s;
      emit({
        pos: pos.clone().add(V(rand(-40, 40) * s, rand(10, 90) * s, rand(-40, 40) * s)),
        vel: V(Math.cos(a) * sp, rand(120, 520) * s, Math.sin(a) * sp),
        life: rand(3.2, 6.2), size0: rand(110, 170) * s, size1: rand(380, 620) * s, c0: 0x2a2724, c1: 0x7d7a75, a0: 0.8,
        drag: 1.3, grav: 55, spin: 0.5,
      });
    }
    // dust shockwave hugging the ground
    const dustCount = Math.round(12 * detail);
    for (let i = 0; i < dustCount; i += 1) {
      const a = (i / dustCount) * 6.28 + rand(-0.2, 0.2);
      emit({
        pos: pos.clone().add(V(0, 14, 0)), vel: V(Math.cos(a) * rand(500, 900) * s, rand(10, 60), Math.sin(a) * rand(500, 900) * s),
        life: rand(1.1, 1.8), size0: 100 * s, size1: rand(260, 360) * s, c0: 0x9a8f7c, c1: 0x6e665a, a0: 0.55, drag: 2.8, spin: 0.8,
      });
    }
    const sparkCount = Math.round(70 * detail);
    for (let i = 0; i < sparkCount; i += 1) {
      const a = rand(0, 6.28);
      const up = rand(0.2, 1.1);
      const sp = rand(350, 1100) * s;
      emitSpark(pos.clone().add(V(0, 10, 0)), V(Math.cos(a) * sp * (1.1 - up * 0.5), sp * up, Math.sin(a) * sp * (1.1 - up * 0.5)), rand(0.5, 1.5));
    }
    addRing(pos.clone().add(V(0, 6, 0)), { color: 0xffc27a, from: 30 * s, to: 520 * s, life: 0.55, opacity: 0.95 });
    addRing(pos.clone().add(V(0, 8, 0)), { color: 0xffffff, from: 20 * s, to: 340 * s, life: 0.3, opacity: 0.7 });
    const chunks = Math.round(9 * detail);
    for (let i = 0; i < chunks; i += 1) {
      const mesh = new THREE.Mesh(debrisGeo, debrisMat);
      mesh.scale.set(rand(6, 18) * s, rand(4, 10) * s, rand(6, 18) * s);
      mesh.position.copy(pos).add(V(0, 20, 0));
      root.add(mesh);
      const a = rand(0, 6.28);
      const sp = rand(200, 650) * s;
      debris.push({ mesh, vel: V(Math.cos(a) * sp, rand(450, 1000) * s, Math.sin(a) * sp), spin: V(rand(-9, 9), 0, rand(-9, 9)), age: 0, life: 1.9 });
    }
    const scorch = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: false }));
    scorch.position.copy(pos).add(V(0, 2.5, 0));
    scorch.scale.setScalar(150 * s);
    scorch.renderOrder = 4;
    root.add(scorch);
    decals.push({ mesh: scorch, age: 0, life: 25, opacity: 0.8 });
    if (decals.length > 14) { const old = decals.shift(); root.remove(old.mesh); old.mesh.material.dispose(); }
    screenImpact(pos, power * Math.min(1.6, s));
    if (sound) audio.boom(pos, power);
  }

  // --------------------------------------------------------- smoke marker
  function smokeMarker(pos, { color = 0xff3b30, seconds = 14 } = {}) {
    const beamGeo = new THREE.CylinderGeometry(7, 14, 900, 12, 1, true);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    }));
    beam.position.copy(pos).add(V(0, 450, 0));
    root.add(beam);
    let age = 0;
    let acc = 0;
    return {
      update(dt) {
        age += dt;
        acc += dt;
        while (acc > 0.05 && age < seconds) {
          acc -= 0.05;
          emit({
            pos: pos.clone().add(V(rand(-6, 6), 8, rand(-6, 6))), vel: V(rand(-30, 30), rand(160, 260), rand(-30, 30)),
            life: rand(3, 5), size0: 40, size1: rand(180, 260), c0: color, c1: 0xffffff, a0: 0.8, drag: 0.5, spin: 1,
          });
        }
        beam.material.opacity = 0.3 * clamp01((seconds - age) / 2) * (0.8 + 0.2 * Math.sin(age * 8));
        return age < seconds + 4;
      },
      dispose() { root.remove(beam); beamGeo.dispose(); beam.material.dispose(); },
    };
  }

  // ------------------------------------------------------------ UAV scan
  function scanWave(pos) {
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { fade: { value: 1 } },
      vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float fade; varying float vY; void main(){ float h = clamp(vY/500.0,0.0,1.0); float a = pow(1.0-h,2.2)*fade; gl_FragColor = vec4(vec3(0.15,0.95,1.0)*(0.7+1.4*pow(1.0-h,6.0)), a); }',
    });
    const geo = new THREE.CylinderGeometry(1, 1, 500, 96, 1, true);
    geo.translate(0, 250, 0);
    const wall = new THREE.Mesh(geo, material);
    wall.position.copy(pos).add(V(0, -60, 0));
    wall.renderOrder = 9;
    root.add(wall);
    addRing(pos.clone().add(V(0, -50, 0)), { color: 0x56f4ff, from: 40, to: 3400, life: 2.4, opacity: 0.8 });
    audio.sweep();
    let age = 0;
    return {
      update(dt) {
        age += dt;
        const t = age / 2.4;
        const r = 40 + 3360 * (1 - (1 - t) ** 2);
        wall.scale.set(r, 1, r);
        material.uniforms.fade.value = clamp01(1 - t) * 0.9;
        return t < 1;
      },
      dispose() { root.remove(wall); geo.dispose(); material.dispose(); },
    };
  }

  // ------------------------------------------------------------- models
  // Flat-shaded vertex colours: reads as a lit low-poly object under any lighting.
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, flatShading: true, emissive: 0x22262c, ...extra });
  const addMesh = (group, geo, mat, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  function buildJet() {
    const jet = new THREE.Group();
    const hull = std(0xa4acb6, { roughness: 0.45, metalness: 0.2 });
    const dark = std(0x555b64, { roughness: 0.6 });
    const profile = [[0, -170], [12, -165], [22, -130], [30, -60], [34, 20], [30, 90], [20, 150], [9, 200], [1.5, 232]]
      .map(([r, z]) => new THREE.Vector2(r, z));
    const fuselageGeo = new THREE.LatheGeometry(profile, 20);
    fuselageGeo.rotateX(Math.PI / 2); // lathe axis Y -> Z
    addMesh(jet, fuselageGeo, hull);
    const wingShape = new THREE.Shape();
    wingShape.moveTo(18, 70); wingShape.lineTo(210, -95); wingShape.lineTo(210, -125); wingShape.lineTo(18, -135); wingShape.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 5, bevelEnabled: false });
    wingGeo.rotateX(-Math.PI / 2); // shape XY -> XZ, thin along Y
    const wingR = addMesh(jet, wingGeo, hull, 0, -6, 0);
    const wingL = addMesh(jet, wingGeo, hull, 0, -6, 0);
    wingL.scale.x = -1;
    wingR.material = wingL.material = std(0xa4acb6, { side: THREE.DoubleSide, roughness: 0.45, metalness: 0.2 });
    const tailShape = new THREE.Shape();
    tailShape.moveTo(14, -110); tailShape.lineTo(88, -160); tailShape.lineTo(88, -178); tailShape.lineTo(14, -170); tailShape.closePath();
    const tailGeo = new THREE.ExtrudeGeometry(tailShape, { depth: 4, bevelEnabled: false });
    tailGeo.rotateX(-Math.PI / 2);
    const tailMat = std(0x8d96a1, { side: THREE.DoubleSide });
    const tr = addMesh(jet, tailGeo, tailMat, 0, 0, 0);
    const tl = addMesh(jet, tailGeo, tailMat, 0, 0, 0);
    tl.scale.x = -1;
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0); finShape.lineTo(70, 0); finShape.lineTo(38, 78); finShape.lineTo(0, 78); finShape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 4, bevelEnabled: false });
    finGeo.rotateY(-Math.PI / 2); // chord along -Z
    for (const side of [-1, 1]) {
      const fin = addMesh(jet, finGeo, tailMat, side * 20, 18, -88);
      fin.rotation.z = side * 0.28;
    }
    const canopy = addMesh(jet, new THREE.SphereGeometry(1, 16, 12), std(0x16202c, { roughness: 0.08, metalness: 0.7, emissive: 0x0a1a2a }), 0, 26, 78);
    canopy.scale.set(15, 13, 52);
    for (const side of [-1, 1]) {
      const intake = addMesh(jet, new THREE.BoxGeometry(18, 20, 52), dark, side * 30, -4, 20);
      intake.rotation.y = side * 0.05;
      const pod = addMesh(jet, new THREE.CylinderGeometry(7, 7, 80, 10), dark, side * 150, -14, -60);
      pod.rotation.x = Math.PI / 2;
      addMesh(jet, new THREE.CylinderGeometry(15, 20, 36, 14), std(0x23262b, { metalness: 0.6 }), side * 15, 0, -178).rotation.x = Math.PI / 2;
    }
    // afterburners: additive cones pointing aft
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const flames = [];
    for (const side of [-1, 1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(11, 120, 12, 1, true), flameMat);
      cone.rotation.x = -Math.PI / 2; // tip toward -Z
      cone.position.set(side * 15, 0, -250);
      jet.add(cone);
      flames.push(cone);
    }
    const nav = [];
    for (const [x, y, z, c] of [[-208, -4, -110, 0xff2020], [208, -4, -110, 0x20ff50], [0, 70, -150, 0xffffff]]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      sp.scale.setScalar(36);
      sp.position.set(x, y, z);
      jet.add(sp);
      nav.push(sp);
    }
    jet.userData.flames = flames;
    jet.userData.nav = nav;
    return jet;
  }

  function buildHunter() {
    const g = new THREE.Group();
    const hull = std(0x4b5058, { metalness: 0.3, roughness: 0.4 });
    const body = addMesh(g, new THREE.CapsuleGeometry(10, 78, 6, 14), hull);
    body.rotation.x = Math.PI / 2;
    const nose = addMesh(g, new THREE.ConeGeometry(10, 26, 14), std(0xd02020, { emissive: 0x801010, emissiveIntensity: 0.9 }), 0, 0, 62);
    nose.rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      const wing = addMesh(g, new THREE.BoxGeometry(60, 2.5, 30), hull, side * 36, 0, -14);
      wing.rotation.y = side * 0.35;
      const fin = addMesh(g, new THREE.BoxGeometry(2.5, 22, 20), hull, side * 6, 0, -48);
      fin.rotation.z = side * 0.6;
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(7, 70, 10, 1, true), new THREE.MeshBasicMaterial({
      color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(0, 0, -86);
    g.add(flame);
    const light = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff3030, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    light.scale.setScalar(34);
    light.position.set(0, 12, -10);
    g.add(light);
    g.userData.flame = flame;
    g.userData.light = light;
    return g;
  }

  function buildCrate() {
    const group = new THREE.Group();
    const tex = canvasTexture(256, (g, s) => {
      g.fillStyle = '#4d5a3a'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 400; i += 1) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${rand(0.02, 0.07)})`; g.fillRect(rand(0, s), rand(0, s), rand(2, 30), rand(1, 3)); }
      g.strokeStyle = 'rgba(15,20,10,.9)'; g.lineWidth = 6; g.strokeRect(6, 6, s - 12, s - 12);
      g.fillStyle = '#d9c34a'; g.fillRect(s / 2 - 70, s / 2 - 24, 140, 6); g.fillRect(s / 2 - 70, s / 2 + 18, 140, 6);
      g.fillStyle = '#e8e3c8'; g.font = 'bold 30px Arial Black, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('SUPPLY', s / 2, s / 2 - 1);
      g.fillStyle = '#d9c34a'; g.font = 'bold 14px monospace'; g.fillText('CARE PACKAGE', s / 2, s - 24);
    });
    const crate = addMesh(group, new THREE.BoxGeometry(66, 44, 48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.1 }), 0, 22, 0);
    const band = std(0x1f2417);
    for (const x of [-22, 22]) addMesh(group, new THREE.BoxGeometry(5, 46, 50), band, x, 22, 0);
    addMesh(group, new THREE.BoxGeometry(24, 4, 6), std(0xd9c34a), 0, 46, 0);
    crate.userData.isCrate = true;
    // parachute
    const chute = new THREE.Group();
    const canopyTex = canvasTexture(128, (g, s) => {
      for (let i = 0; i < 8; i += 1) { g.fillStyle = i % 2 ? '#f2efe2' : '#d4572c'; g.fillRect((i * s) / 8, 0, s / 8, s); }
    });
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(105, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
      new THREE.MeshStandardMaterial({ map: canopyTex, side: THREE.DoubleSide, roughness: 0.9 }),
    );
    dome.position.y = 190;
    chute.add(dome);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.7 });
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      const pts = [new THREE.Vector3(Math.cos(a) * 24, 44, Math.sin(a) * 18), new THREE.Vector3(Math.cos(a) * 98, 190 - 20, Math.sin(a) * 98)];
      chute.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    }
    group.add(chute);
    group.userData.chute = chute;
    group.scale.setScalar(1.35);
    return group;
  }

  // Little Bird: the extracted MH-6 GLB. Falls back to null (caller draws a stand-in).
  let birdPromise = null;
  function loadBird() {
    birdPromise ??= (async () => {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const { clone } = await import('three/addons/utils/SkeletonUtils.js');
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => {
        if (!url.toLowerCase().endsWith('.dds')) return url;
        const name = url.replaceAll('\\', '/').split('/').pop().slice(0, -4);
        return name.endsWith('_n') ? BIRD_NORMAL_STUB : `textures/${name}.png`;
      });
      const gltf = await new GLTFLoader(manager).loadAsync(BIRD_URL);
      const model = gltf.scene;
      model.traverse((node) => {
        if (!node.isMesh) return;
        node.frustumCulled = false;
        for (const m of [].concat(node.material)) {
          m.normalMap = null;
          m.metalness = 0;
          m.roughness = 0.75;
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          m.emissive?.setScalar(0.12);
          m.emissiveMap = m.map ?? null;
          m.needsUpdate = true;
        }
      });
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      const bird = new THREE.Group();
      bird.add(model);
      // SkeletonUtils.clone rebinds skinned meshes to the cloned bones (Object3D.clone would not).
      return () => {
        const copy = clone(bird);
        copy.userData.rotors = [];
        copy.traverse((n) => { if (/main_rotor_jnt|tail_rotor_jnt/i.test(n.name)) copy.userData.rotors.push(n); });
        return copy;
      };
    })().catch((error) => { console.warn('[killstreaks] little bird model unavailable', error); return null; });
    return birdPromise;
  }

  // ------------------------------------------------------------- frame
  function update(dt) {
    stepSprites(dt);
    stepSparks(dt);
    stepMeshes(dt);
    stepScreen(dt);
  }

  return {
    THREE, root, update, beginCamera, endCamera, audio, explosion, smokeMarker, scanWave,
    buildJet, buildHunter, buildCrate, loadBird, emit, emitSpark, addRing, screenImpact, smokeTextures, glow,
    shake(amount) { trauma = Math.min(1, trauma + amount); },
    stats: () => ({ sprites: live.length, rings: rings.length, debris: debris.length }),
    dispose() { scene.remove(root); flashEl.remove(); },
  };
}
