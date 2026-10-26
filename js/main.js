// Full-screen drone hero: alpine scene, takeoff sequence, then a live controller
// that keeps the drone hovering while the visitor pushes it around.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { Quadrotor, PARAMS, minJerk } from './physics.js';
import { loadDrone } from './drone-model.js';
import { createGround, createGrass, createPad } from './environment.js';

const PHYSICS_DT = 1 / 500;
const HOVER = [0, 1.35, 0];
// Takeoff timeline in seconds.
const T_SPINUP = 1.2, T_LIFTOFF = 3.0, CLIMB = 3.4, T_READY = T_LIFTOFF + CLIMB + 0.4;
// Sun direction measured on the Alps Field HDRI (u = 0.60, v = 0.26 from the top).
const SUN = (() => {
  const el = (0.5 - 0.264) * Math.PI, az = (0.5995 - 0.5) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
})();
const GRAB_K = 90, GRAB_C = 8, GRAB_MAX = 30;
// The pull acts between the centre of mass and the grabbed point: enough lever
// to tilt the frame, but the drone still follows the hand instead of spinning.
const GRAB_LEVER = 0.3;
const BOUNDS = { r: 2.4, yMin: 0.5, yMax: 2.4 };

const canvas = document.getElementById('scene');
const ui = {
  loader: document.getElementById('loader'),
  progress: document.getElementById('loader-progress'),
  hero: document.getElementById('hero'),
  phase: document.getElementById('phase'),
  alt: document.getElementById('t-alt'),
  tilt: document.getElementById('t-tilt'),
  motors: [...document.querySelectorAll('.motor-bar i')],
  gust: document.getElementById('btn-gust'),
  replay: document.getElementById('btn-replay'),
  fullscreen: document.getElementById('btn-fullscreen'),
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.02, 300);

const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -0.8, right: 0.8, top: 0.8, bottom: -0.8, near: 0.5, far: 20 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.01;
scene.add(sun, sun.target);

// Fewer grass clumps on phones and small screens.
const lowPower = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
const grass = createGrass({ count: lowPower ? 50000 : 200000 });
scene.add(grass.mesh, createPad());
const wind = new THREE.Vector2();

// Soft contact shadow and flattened grass under the drone (downwash).
function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d'), g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const contact = new THREE.Mesh(
  new THREE.PlaneGeometry(0.75, 0.75),
  new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(0,0,0,0.7)'], [0.5, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false }),
);
contact.rotation.x = -Math.PI / 2;
contact.position.y = 0.007;
scene.add(contact);

// Dust and grass bits lifted by the downwash near the ground.
const DUST = 160;
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(DUST * 3), 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  size: 0.018, map: radialTexture([[0, 'rgba(214,200,160,1)'], [1, 'rgba(214,200,160,0)']]),
  transparent: true, depthWrite: false, opacity: 0, color: 0xd8cfb4,
}));
const dustState = Array.from({ length: DUST }, () => ({ a: Math.random() * Math.PI * 2, r: 0, y: 0, life: Math.random() }));
scene.add(dust);

// Grab feedback: a line from the grabbed point to the pointer.
const grabLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }),
);
const grabDot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
grabLine.renderOrder = grabDot.renderOrder = 10;
grabLine.visible = grabDot.visible = false;
scene.add(grabLine, grabDot);

const drone = new Quadrotor();
let model = null;
let clock = 0;            // seconds since the takeoff sequence started
let ready = false;
let accumulator = 0;
let gust = null;          // { force, until }
const keys = new Set();
const grab = { active: false, local: null, target: new THREE.Vector3(), plane: new THREE.Plane(), pointerId: null };

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep the drone a similar size on portrait phones.
  camera.fov = camera.aspect < 0.8 ? 48 : 32;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => { ui.progress.style.transform = `scaleX(${loaded / total})`; };

async function init() {
  const [hdr, backplate, droneModel, ground] = await Promise.all([
    new RGBELoader(manager).loadAsync('assets/env/alps_field_1k.hdr'),
    new THREE.TextureLoader(manager).loadAsync('assets/env/alps-field-8k.jpg'),
    loadDrone(manager),
    createGround(manager, renderer),
  ]);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;
  scene.environmentIntensity = 1.15;

  // The photo is only the distant backdrop: sky, mountains and the far meadow.
  // Near the camera, where a projected photo would look stretched, the ground
  // is real geometry with grass, fading into the photo further out.
  backplate.mapping = THREE.EquirectangularReflectionMapping;
  backplate.colorSpace = THREE.SRGBColorSpace;
  backplate.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const skybox = new GroundedSkybox(backplate, 1.6, 250, 128);
  skybox.material.toneMapped = false;
  skybox.position.y = 1.6 - 0.04;
  scene.add(skybox, ground);

  model = droneModel;
  scene.add(model.root);
  restart();
  ui.loader.classList.add('is-done');
  renderer.setAnimationLoop(frame);
}

function restart() {
  drone.reset([0, PARAMS.restHeight, 0], 0.55);
  clock = reducedMotion ? T_READY : 0;
  ready = false;
  gust = null;
  if (reducedMotion) {
    drone.setMode('auto');
    drone.pos = [...HOVER];
    drone.target.pos = [...HOVER];
    drone.thrust = drone.thrust.map(() => drone.hoverThrust());
    drone.onGround = false;
  }
  ui.hero.classList.remove('is-ready');
  placeCamera(true);
}

// --- takeoff director ----------------------------------------------------------
function direct() {
  if (clock < T_SPINUP) {
    drone.setMode('off');
  } else if (clock < T_LIFTOFF) {
    drone.setMode('spinup');
    drone.spinup = minJerk((clock - T_SPINUP) / (T_LIFTOFF - T_SPINUP));
  } else if (!ready) {
    drone.setMode('auto');
    const s = minJerk((clock - T_LIFTOFF) / CLIMB);
    drone.target.pos = [0, PARAMS.restHeight + (HOVER[1] - PARAMS.restHeight) * s, 0];
    if (clock >= T_READY) {
      ready = true;
      ui.hero.classList.add('is-ready');
    }
  }
}

function steerWithKeys(dt) {
  if (!ready || !keys.size) return;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  const move = new THREE.Vector3();
  if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(fwd);
  if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(fwd);
  if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);
  if (keys.has('KeyE') || keys.has('PageUp')) move.y += 1;
  if (keys.has('KeyQ') || keys.has('PageDown')) move.y -= 1;
  const t = drone.target.pos;
  t[0] += move.x * 1.2 * dt;
  t[1] = THREE.MathUtils.clamp(t[1] + move.y * 0.8 * dt, BOUNDS.yMin, BOUNDS.yMax);
  t[2] += move.z * 1.2 * dt;
  const r = Math.hypot(t[0], t[2]);
  if (r > BOUNDS.r) { t[0] *= BOUNDS.r / r; t[2] *= BOUNDS.r / r; }
}

function physics(dt) {
  accumulator = Math.min(accumulator + dt, 0.1);
  while (accumulator >= PHYSICS_DT) {
    if (grab.active) {
      const p = drone.bodyToWorld(grab.local), v = drone.pointVelocity(grab.local);
      const f = [0, 1, 2].map((i) => GRAB_K * (grab.target.getComponent(i) - p[i]) - GRAB_C * v[i]);
      const n = Math.hypot(...f);
      if (n > GRAB_MAX) f.forEach((_, i) => { f[i] *= GRAB_MAX / n; });
      drone.applyForceAtPoint(f, drone.bodyToWorld(grab.local.map((c) => c * GRAB_LEVER)));
    }
    if (gust && clock < gust.until) drone.applyForceAtPoint(gust.force, drone.bodyToWorld([0, 0.05, 0]));
    drone.step(PHYSICS_DT);
    accumulator -= PHYSICS_DT;
  }
}

// --- camera -------------------------------------------------------------------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function cameraGoal(out, look) {
  const d = new THREE.Vector3(...drone.pos);
  const intro = THREE.MathUtils.smoothstep(clock, T_LIFTOFF - 0.6, T_READY + 0.6);
  // Ground-level close-up before takeoff, wide shot once hovering.
  const close = new THREE.Vector3(0.66, 0.26, 0.86).applyAxisAngle(new THREE.Vector3(0, 1, 0), clock * 0.05);
  const wide = new THREE.Vector3(0.84, 0.3, 1.22).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(clock * 0.07) * 0.18);
  const offset = close.lerp(wide, intro);
  // The camera climbs with the drone, so it stays in frame during takeoff.
  const anchor = new THREE.Vector3(d.x * 0.85, Math.min(d.y, HOVER[1] + 0.6) * 0.92 + 0.04, d.z * 0.85);
  out.copy(anchor).add(offset);
  // Once hovering, frame the drone right of centre, clear of the headline.
  const settle = THREE.MathUtils.smoothstep(clock, T_READY - 1.2, T_READY + 1);
  const side = new THREE.Vector3(offset.z, 0, -offset.x).normalize().multiplyScalar(-0.3 * settle * frameShift());
  look.copy(d).add(side);
  look.y += 0.12 * settle;
}
const frameShift = () => (camera.aspect < 0.8 ? 0 : 1);
function placeCamera(snap, dt = 0) {
  const goal = new THREE.Vector3(), look = new THREE.Vector3();
  cameraGoal(goal, look);
  const k = snap ? 1 : 1 - Math.exp(-dt * 2.2);
  camPos.lerp(goal, k);
  camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 5));
  // A little hand-held movement.
  const t = performance.now() / 1000;
  const shake = reducedMotion ? 0 : 0.004;
  camera.position.copy(camPos).add(new THREE.Vector3(Math.sin(t * 1.3) * shake, Math.sin(t * 1.7 + 1) * shake, Math.sin(t * 1.1 + 2) * shake));
  camera.lookAt(camLook);
}

// --- frame --------------------------------------------------------------------
let last = performance.now(), hudTimer = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  clock += dt;
  direct();
  steerWithKeys(dt);
  physics(dt);

  const [x, y, z] = drone.pos, [w, qx, qy, qz] = drone.q;
  model.root.position.set(x, y, z);
  model.root.quaternion.set(qx, qy, qz, w);
  model.update(drone, dt, clock);

  sun.position.set(x, y, z).addScaledVector(SUN, 8);
  sun.target.position.set(x, y, z);

  const h = Math.max(0, y - PARAMS.restHeight);
  contact.position.set(x, 0.007, z);
  contact.scale.setScalar(1 + h * 0.8);
  contact.material.opacity = Math.max(0, 0.85 - h * 0.55);
  updateDust(dt, x, z, h);
  const gusting = gust && clock < gust.until + 0.5;
  wind.set(0.05, 0.02);
  if (gusting) wind.add(new THREE.Vector2(gust.force[0], gust.force[2]).multiplyScalar(0.03));
  const wash = drone.thrust.reduce((a, b) => a + b, 0) / (4 * drone.hoverThrust());
  grass.update(clock, drone.pos, Math.min(wash, 1.5), wind);

  if (grab.active) {
    const p = new THREE.Vector3(...drone.bodyToWorld(grab.local));
    grabLine.geometry.attributes.position.setXYZ(0, p.x, p.y, p.z);
    grabLine.geometry.attributes.position.setXYZ(1, grab.target.x, grab.target.y, grab.target.z);
    grabLine.geometry.attributes.position.needsUpdate = true;
    grabDot.position.copy(grab.target);
  }

  placeCamera(false, dt);
  renderer.render(scene, camera);

  hudTimer -= dt;
  if (hudTimer <= 0) { hudTimer = 0.08; updateHud(h); }
}

function updateDust(dt, x, z, h) {
  const thrust = drone.thrust.reduce((a, b) => a + b, 0) / (4 * drone.hoverThrust());
  const strength = THREE.MathUtils.clamp(thrust, 0, 1.3) * Math.max(0, 1 - h / 0.9);
  const pos = dustGeo.attributes.position;
  dustState.forEach((p, i) => {
    p.life += dt * (0.6 + Math.random() * 0.4);
    if (p.life > 1) { p.life = 0; p.a = Math.random() * Math.PI * 2; p.r = 0.12 + Math.random() * 0.15; p.y = 0; }
    p.r += dt * (0.6 + strength * 1.2);
    p.y = Math.sin(p.life * Math.PI) * 0.06 * (0.5 + strength);
    pos.setXYZ(i, x + Math.cos(p.a) * p.r, p.y + 0.01, z + Math.sin(p.a) * p.r);
  });
  pos.needsUpdate = true;
  dust.material.opacity = 0.55 * strength;
}

function updateHud(h) {
  ui.alt.textContent = h.toFixed(2).replace('.', ',') + ' m';
  ui.tilt.textContent = drone.tiltDeg().toFixed(1).replace('.', ',') + '°';
  drone.thrust.forEach((t, i) => { ui.motors[i].style.transform = `scaleY(${Math.min(1, t / PARAMS.maxThrust * 2)})`; });
  let phase;
  if (clock < T_SPINUP) phase = 'Mirovanje';
  else if (clock < T_LIFTOFF) phase = 'Zagon motorjev';
  else if (!ready) phase = 'Vzlet';
  else if (grab.active) phase = 'Motnja · regulator se upira';
  else if (drone.tiltDeg() > 2 || (gust && clock < gust.until + 0.6)) phase = 'Regulator popravlja';
  else phase = 'Lebdenje';
  ui.phase.textContent = phase;
}

// --- interaction ----------------------------------------------------------------
const raycaster = new THREE.Raycaster();
function pointerRay(e) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  return raycaster.ray;
}

canvas.addEventListener('pointerdown', (e) => {
  if (!model || clock < T_LIFTOFF + 1) return;
  const ray = pointerRay(e);
  const hit = raycaster.intersectObjects(model.meshes, false)[0];
  if (!hit) { blowGust(e); return; }
  grab.active = true;
  grab.pointerId = e.pointerId;
  grab.local = drone.worldToBody([hit.point.x, hit.point.y, hit.point.z]);
  const normal = new THREE.Vector3();
  camera.getWorldDirection(normal);
  grab.plane.setFromNormalAndCoplanarPoint(normal.negate(), hit.point);
  grab.target.copy(hit.point);
  ray.intersectPlane(grab.plane, grab.target);
  grabLine.visible = grabDot.visible = true;
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('is-grabbing');
});
canvas.addEventListener('pointermove', (e) => {
  if (grab.active && e.pointerId === grab.pointerId) {
    pointerRay(e).intersectPlane(grab.plane, grab.target);
    return;
  }
  if (!model || !ready) return;
  pointerRay(e);
  canvas.classList.toggle('is-over-drone', raycaster.intersectObjects(model.meshes, false).length > 0);
});
function release(e) {
  if (!grab.active || e.pointerId !== grab.pointerId) return;
  grab.active = false;
  grabLine.visible = grabDot.visible = false;
  canvas.classList.remove('is-grabbing');
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// A gust pushes the drone away from where the visitor clicked (or sideways).
function blowGust(e) {
  const d = new THREE.Vector3(...drone.pos);
  let dir;
  if (e) {
    const screen = d.clone().project(camera);
    const r = canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    dir = right.multiplyScalar(Math.sign(screen.x - sx) || 1);
  } else {
    dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5);
  }
  dir.y = 0;
  dir.normalize();
  gust = { force: [dir.x * 11, 0.5, dir.z * 11], until: clock + 0.35 };
}

ui.gust.addEventListener('click', () => { if (ready) blowGust(); });
ui.replay.addEventListener('click', restart);
ui.fullscreen.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && ready) { blowGust(); e.preventDefault(); }
  if (e.code === 'KeyR') restart();
  if (/^(Key[WASDQE]|Arrow|Page)/.test(e.code)) { keys.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

init().catch((err) => {
  console.error(err);
  ui.loader.querySelector('p').textContent = 'Prizora ni bilo mogoče naložiti. Preveri, ali stran teče prek strežnika (npr. python3 -m http.server).';
});
