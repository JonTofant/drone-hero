// Full-screen drone hero: real footage of a lawn below the Drakensberg, with a
// 3D drone composited on top. It takes off from a pad, then a live controller
// keeps it hovering while the visitor pushes it around.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Quadrotor, PARAMS, minJerk } from './physics.js';
import { loadDrone } from './drone-model.js';
import { createPad } from './pad.js';
import { PLATE, poseCamera, fitCamera, startPlate, loadLightCurve, alignedX } from './plate.js';

const PHYSICS_DT = 1 / 500;
// After the climb the drone glides towards the camera and hovers about 3 m from it.
const HOVER = [alignedX(2.6), 1.25, 2.6];
// Takeoff timeline in seconds.
const T_SPINUP = 1.4, T_LIFTOFF = 3.2, CLIMB = 4.2, T_READY = T_LIFTOFF + CLIMB + 0.4;
// The brightest part of the cloud cover is ahead and to the right of the camera.
const SKY_KEY = new THREE.Vector3(1.1, 2.6, -2.2).normalize();
const EXPOSURE = 1.0;
// Digital push-in on the pad before takeoff (both layers scale together).
const PUSH = 1.3;
const GRAB_K = 90, GRAB_C = 8, GRAB_MAX = 30;
// The pull acts between the centre of mass and the grabbed point: enough lever
// to tilt the frame, but the drone still follows the hand instead of spinning.
const GRAB_LEVER = 0.3;
// Keep the drone over the lawn and inside the frame.
const BOUNDS = { x: [-2.2, 2.2], y: [0.5, 2.6], z: [-3.5, 2.2] };

const canvas = document.getElementById('scene');
const video = document.getElementById('plate');
const stack = document.getElementById('stack');
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

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = EXPOSURE;
renderer.shadowMap.enabled = true;
// Overcast light: wide, soft shadows.
renderer.shadowMap.type = THREE.VSMShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(PLATE.vfov, 16 / 9, 0.05, 200);
poseCamera(camera);

const skyKey = new THREE.DirectionalLight(0xfff3e6, 1.1);
skyKey.castShadow = true;
skyKey.shadow.mapSize.set(1024, 1024);
Object.assign(skyKey.shadow.camera, { left: -1.4, right: 1.4, top: 1.4, bottom: -1.4, near: 1, far: 20 });
skyKey.shadow.radius = 14;
skyKey.shadow.blurSamples = 24;
skyKey.shadow.bias = -0.0006;
scene.add(skyKey, skyKey.target);

// Only shadows are drawn on the real lawn.
const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.42, color: 0x1c1408 }));
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.receiveShadow = true;
const pad = createPad();
scene.add(shadowCatcher, pad);

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d'), g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
// Ambient occlusion under the drone: under an overcast sky this is most of the shadow.
const contact = new THREE.Mesh(
  new THREE.PlaneGeometry(0.8, 0.8),
  new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(20,14,6,0.75)'], [0.5, 'rgba(20,14,6,0.3)'], [1, 'rgba(20,14,6,0)']]), transparent: true, depthWrite: false }),
);
contact.rotation.x = -Math.PI / 2;
contact.position.y = 0.008;
contact.renderOrder = 1;
scene.add(contact);

// Dust lifted from the dry lawn by the downwash.
const DUST = 180;
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(DUST * 3), 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  size: 0.02, map: radialTexture([[0, 'rgba(196,180,140,1)'], [1, 'rgba(196,180,140,0)']]),
  transparent: true, depthWrite: false, opacity: 0, color: 0xcbbd98,
}));
const dustState = Array.from({ length: DUST }, () => ({ a: Math.random() * Math.PI * 2, r: 0, y: 0, life: Math.random() }));
scene.add(dust);

// Grab feedback: a line from the grabbed point to the pointer.
const grabLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }),
);
const grabDot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
grabLine.renderOrder = grabDot.renderOrder = 10;
grabLine.visible = grabDot.visible = false;
scene.add(grabLine, grabDot);

const drone = new Quadrotor();
let model = null;
let lightAt = () => 1;
let clock = 0;            // seconds since the takeoff sequence started
let ready = false;
let accumulator = 0;
let gust = null;          // { force, until }
const keys = new Set();
const grab = { active: false, local: null, target: new THREE.Vector3(), plane: new THREE.Plane(), pointerId: null };

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  video.style.objectPosition = fitCamera(camera, w, h);
}
addEventListener('resize', resize);
resize();

const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => { ui.progress.style.transform = `scaleX(${loaded / total})`; };

async function init() {
  const [hdr, droneModel, curve] = await Promise.all([
    new RGBELoader(manager).loadAsync('assets/env/fouriesburg_mountain_cloudy_1k.hdr'),
    loadDrone(manager),
    loadLightCurve(),
    startPlate(video),
  ]);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;
  scene.environmentIntensity = 0.9;
  lightAt = curve;

  model = droneModel;
  scene.add(model.root);
  restart();
  ui.loader.classList.add('is-done');
  renderer.setAnimationLoop(frame);
}

function restart() {
  drone.reset([0, PARAMS.restHeight, 0], -0.35);
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
    // Climb first, then move in towards the camera.
    const up = minJerk((clock - T_LIFTOFF) / (CLIMB * 0.6));
    const across = minJerk((clock - T_LIFTOFF - CLIMB * 0.35) / (CLIMB * 0.65));
    drone.target.pos = [HOVER[0] * across, PARAMS.restHeight + (HOVER[1] - PARAMS.restHeight) * up, HOVER[2] * across];
    if (clock >= T_READY) {
      ready = true;
      ui.hero.classList.add('is-ready');
    }
  }
}

// The push-in eases out while the drone climbs, ending on the full frame.
function pushIn() {
  if (reducedMotion) return;
  const zoom = THREE.MathUtils.lerp(PUSH, 1, THREE.MathUtils.smoothstep(clock, T_LIFTOFF - 0.4, T_READY + 0.8));
  const p = new THREE.Vector3(0, 0.25, 0).project(camera);
  stack.style.transformOrigin = `${(p.x + 1) / 2 * 100}% ${(1 - p.y) / 2 * 100}%`;
  stack.style.transform = zoom > 1.0005 ? `scale(${zoom.toFixed(4)})` : '';
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
  t[0] = THREE.MathUtils.clamp(t[0] + move.x * 1.2 * dt, ...BOUNDS.x);
  t[1] = THREE.MathUtils.clamp(t[1] + move.y * 0.8 * dt, ...BOUNDS.y);
  t[2] = THREE.MathUtils.clamp(t[2] + move.z * 1.2 * dt, ...BOUNDS.z);
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

  skyKey.position.set(x, y, z).addScaledVector(SKY_KEY, 8);
  skyKey.target.position.set(x, y, z);
  // Follow the cloud shadows passing over the lawn in the footage.
  renderer.toneMappingExposure = EXPOSURE * lightAt(video.currentTime);

  const h = Math.max(0, y - PARAMS.restHeight);
  contact.position.set(x, 0.008, z);
  contact.scale.setScalar(1 + h * 0.9);
  contact.material.opacity = Math.max(0, 0.9 - h * 0.6);
  updateDust(dt, x, z, h);

  if (grab.active) {
    const p = new THREE.Vector3(...drone.bodyToWorld(grab.local));
    grabLine.geometry.attributes.position.setXYZ(0, p.x, p.y, p.z);
    grabLine.geometry.attributes.position.setXYZ(1, grab.target.x, grab.target.y, grab.target.z);
    grabLine.geometry.attributes.position.needsUpdate = true;
    grabDot.position.copy(grab.target);
  }

  pushIn();
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
    if (p.life > 1) { p.life = 0; p.a = Math.random() * Math.PI * 2; p.r = 0.3 + Math.random() * 0.12; p.y = 0; }
    p.r += dt * (0.6 + strength * 1.2);
    p.y = Math.sin(p.life * Math.PI) * 0.06 * (0.5 + strength);
    pos.setXYZ(i, x + Math.cos(p.a) * p.r, p.y + 0.01, z + Math.sin(p.a) * p.r);
  });
  pos.needsUpdate = true;
  dust.material.opacity = 0.5 * strength;
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
  // The rect includes the push-in scale, so pointer and picture stay aligned.
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
