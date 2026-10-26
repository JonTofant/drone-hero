// Skydio X2 mesh with propellers drawn in code: real blades at low speed,
// a translucent motion-blur disc at high speed, and blinking navigation lights.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PARAMS } from './physics.js';

const BLADE_RADIUS = 0.128;
// Above this speed the eye (and a camera) no longer sees separate blades.
const BLUR_START = 60, BLUR_FULL = 260;
// Displayed blade rotation is capped, as in video footage, so fast props do not flicker.
const MAX_VISIBLE_SPIN = 38;

function bladeGeometry() {
  // Planform of one blade from the hub outwards (x), chord along y.
  const s = new THREE.Shape();
  s.moveTo(0.008, -0.006);
  s.bezierCurveTo(0.035, -0.013, 0.07, -0.012, 0.105, -0.008);
  s.quadraticCurveTo(BLADE_RADIUS + 0.002, -0.006, BLADE_RADIUS, 0.001);
  s.quadraticCurveTo(BLADE_RADIUS - 0.004, 0.006, 0.105, 0.007);
  s.bezierCurveTo(0.07, 0.011, 0.035, 0.013, 0.008, 0.006);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.0016, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0007, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -0.0008);
  // Twist: more pitch near the hub than at the tip.
  const pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const twist = THREE.MathUtils.lerp(0.42, 0.14, v.x / BLADE_RADIUS);
    const c = Math.cos(twist), sn = Math.sin(twist);
    pos.setXYZ(i, v.x, v.y * c - v.z * sn, v.y * sn + v.z * c);
  }
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function blurTexture() {
  const size = 256, c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d'), r = size / 2;
  const grad = ctx.createRadialGradient(r, r, r * 0.08, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.15, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.6)');
  grad.addColorStop(0.9, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.97, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  // Faint concentric bands, like the tip path in a photograph.
  ctx.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 7; k++) {
    ctx.beginPath();
    ctx.arc(r, r, r * (0.3 + k * 0.09), 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export async function loadDrone(manager) {
  const texture = await new THREE.TextureLoader(manager).loadAsync('assets/models/x2-texture.png');
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const obj = await new OBJLoader(manager).loadAsync('assets/models/x2-body.obj');

  const root = new THREE.Group();
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    map: texture, roughness: 0.62, metalness: 0.08, clearcoat: 0.35, clearcoatRoughness: 0.45,
  });
  const meshes = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.material = bodyMaterial;
    o.castShadow = true;
    o.receiveShadow = true;
    o.geometry.computeVertexNormals();
    meshes.push(o);
  });
  obj.scale.setScalar(0.01);
  obj.position.set(-PARAMS.comInMesh[0], -PARAMS.comInMesh[1], -PARAMS.comInMesh[2]);
  root.add(obj);

  const bladeGeo = bladeGeometry();
  const bladeMat = new THREE.MeshPhysicalMaterial({ color: 0x17191c, roughness: 0.38, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.3, transparent: true });
  const hubGeo = new THREE.CylinderGeometry(0.011, 0.013, 0.012, 24);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.35, metalness: 0.6 });
  const blurMap = blurTexture();
  const props = PARAMS.rotors.map((r) => {
    const group = new THREE.Group();
    group.position.set(r.pos[0], r.pos[1] + 0.006, r.pos[2]);
    const spinner = new THREE.Group();
    // The blade pitch must match the spin direction.
    const mirror = r.spin > 0 ? -1 : 1;
    for (const a of [0, Math.PI]) {
      const blade = new THREE.Mesh(bladeGeo, bladeMat.clone());
      blade.scale.z = mirror;
      blade.rotation.y = a;
      blade.castShadow = true;
      spinner.add(blade);
      meshes.push(blade);
    }
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.castShadow = true;
    spinner.add(hub);
    group.add(spinner);
    const blur = new THREE.Mesh(
      new THREE.CircleGeometry(BLADE_RADIUS + 0.004, 64),
      new THREE.MeshStandardMaterial({ map: blurMap, color: 0x16181b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.2 }),
    );
    blur.rotation.x = -Math.PI / 2;
    blur.renderOrder = 2;
    group.add(blur);
    root.add(group);
    return { spinner, blur, angle: Math.random() * Math.PI * 2, spin: r.spin };
  });

  // Navigation lights under the motor pods: red on the left, green on the right.
  const leds = PARAMS.rotors.map((r) => {
    const color = r.pos[2] < 0 ? 0xff2a1a : 0x2bff6a;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 12, 8), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    led.position.set(r.pos[0], r.pos[1] - 0.022, r.pos[2]);
    led.userData.color = color;
    root.add(led);
    return led;
  });

  function update(drone, dt, time) {
    drone.thrust.forEach((t, i) => {
      const p = props[i];
      const omega = PARAMS.maxOmega * Math.sqrt(Math.max(0, t) / PARAMS.maxThrust);
      const visible = Math.min(omega, MAX_VISIBLE_SPIN);
      p.angle += -p.spin * visible * dt;
      p.spinner.rotation.y = p.angle;
      const blur = THREE.MathUtils.smoothstep(omega, BLUR_START, BLUR_FULL);
      p.blur.material.opacity = 0.62 * blur;
      p.spinner.children.forEach((c) => { if (c.material.transparent) c.material.opacity = 1 - 0.72 * blur; });
    });
    const armed = drone.mode !== 'off';
    leds.forEach((led, i) => {
      const blink = armed ? (Math.sin(time * 6 + i * 0.4) > 0.2 ? 1 : 0.15) : 0.08;
      led.material.color.setHex(led.userData.color).multiplyScalar(blink * 3);
    });
  }

  return { root, meshes, update };
}
