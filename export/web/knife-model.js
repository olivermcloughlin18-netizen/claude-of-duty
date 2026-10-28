// The knife viewmodel, built in code: the rip ships no knife or melee animation.
// Local frame: origin at the grip, blade along -z, edge on -x, handle and
// forearm running back along +z. Sized in inches like the rifle viewmodels.
import * as THREE from 'three';

function bladeGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0.7, 0);
  s.lineTo(0.7, 6.6);
  s.quadraticCurveTo(0.62, 8.7, 0.04, 9.7); // spine sweeps down to a drop point
  s.quadraticCurveTo(-0.55, 8.1, -0.7, 5.4); // belly
  s.lineTo(-0.7, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.16, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 2, curveSegments: 10,
  });
  g.translate(0, 0, -0.08);
  g.rotateX(-Math.PI / 2); // length (+y) -> -z, thickness -> y
  return g;
}

/** Build the knife + gloved forearm. Returns a Group; dispose via traverse if ever needed. */
export function buildKnife() {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xa9b0b8, metalness: 0.9, roughness: 0.32, envMapIntensity: 1.3 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.7, roughness: 0.45 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x17191b, metalness: 0.05, roughness: 0.85 });
  const gripRing = new THREE.MeshStandardMaterial({ color: 0x2c3033, metalness: 0.1, roughness: 0.7 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x202326, metalness: 0, roughness: 0.92 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3d4636, metalness: 0, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0, roughness: 0.9 });

  const blade = new THREE.Mesh(bladeGeometry(), steel);
  // A darker fuller along the spine side, and a bright edge line, give the flat blade some read.
  const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 5.2), darkSteel);
  fuller.position.set(0.3, 0, -3.4);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 5.4), new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 0.6, roughness: 0.1, emissive: 0x6d7782, emissiveIntensity: 0.6,
  }));
  edge.position.set(-0.7, 0, -2.9);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.8, 0.45), darkSteel);
  guard.position.z = 0.1;

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.6, 4.8, 14).rotateX(Math.PI / 2), grip);
  handle.position.z = 2.7;
  const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.62, 0.5, 14).rotateX(Math.PI / 2), darkSteel);
  pommel.position.z = 5.3;
  const rings = [1.5, 2.3, 3.1, 3.9].map((z) => {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 14).rotateX(Math.PI / 2), gripRing);
    ring.position.z = z;
    return ring;
  });

  // Fist closed round the handle, thumb along the spine, sleeve running back out of frame.
  const fist = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), glove);
  fist.scale.set(1.25, 1.15, 1.8);
  fist.position.set(0, -0.05, 3.1);
  const knuckles = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.3, 6, 12).rotateZ(Math.PI / 2), glove);
  knuckles.position.set(0, 0.95, 2.2);
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.1, 6, 10).rotateX(Math.PI / 2), skin);
  thumb.position.set(0.5, 0.95, 0.9);
  thumb.rotation.y = 0.12;
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 3, 16).rotateX(Math.PI / 2), glove);
  wrist.position.z = 5.6;
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.85, 16, 18).rotateX(Math.PI / 2), sleeve);
  forearm.position.z = 14.2;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.7, 18).rotateX(Math.PI / 2), grip);
  cuff.position.z = 6.4;

  group.scale.setScalar(1.15);
  group.add(blade, fuller, edge, guard, handle, pommel, ...rings, fist, knuckles, thumb, wrist, cuff, forearm);
  group.traverse((o) => { o.frustumCulled = false; });
  group.visible = false;
  return group;
}
