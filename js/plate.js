// Video plate: a locked-off clip behind a transparent WebGL canvas. The 3D camera
// is matched to the footage, and both layers are cropped the same way on any screen.
import * as THREE from 'three';

// Camera match for assets/plate (Pexels 3115566, Magda Ehlers). Estimated from
// the lawn edge, the bench and the far plain; units are metres and degrees.
export const PLATE = {
  width: 1920,
  height: 1080,
  vfov: 45,
  horizon: 0.57,        // eye level, as a fraction of the frame height from the top
  roll: -1.6,           // the lawn edge rises slightly to the right
  cameraHeight: 1.0,
  fps: 30000 / 1001,
};

// Where the take-off pad sits in the frame, and how far it is from the camera.
export const PAD_SCREEN = { x: 0.58, distance: 5.0 };
// Crop anchor for screens with another aspect ratio: keep the pad in view.
export const FOCUS = { x: PAD_SCREEN.x, y: 0.62 };

const focalPx = () => (PLATE.height / 2) / Math.tan(THREE.MathUtils.degToRad(PLATE.vfov / 2));

// World x at depth z that appears on the same vertical line as the pad, which is
// also the centre of the crop on narrow screens.
const lateral = () => (PAD_SCREEN.x - 0.5) * PLATE.width / focalPx();
const cameraX = () => -lateral() * PAD_SCREEN.distance;
export function alignedX(z) {
  return cameraX() + lateral() * (PAD_SCREEN.distance - z);
}

// Places the camera so that the world origin (the pad) lands where the footage
// has room for it, with the pitch and roll of the real camera.
export function poseCamera(camera) {
  camera.position.set(cameraX(), PLATE.cameraHeight, PAD_SCREEN.distance);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(Math.atan((PLATE.horizon - 0.5) * PLATE.height / focalPx()), 0, THREE.MathUtils.degToRad(PLATE.roll));
  camera.fov = PLATE.vfov;
}

// object-fit: cover for both layers. Returns the CSS object-position to use.
export function fitCamera(camera, viewW, viewH) {
  const s = Math.max(viewW / PLATE.width, viewH / PLATE.height);
  const fw = PLATE.width * s, fh = PLATE.height * s;
  camera.aspect = fw / fh;
  camera.setViewOffset(fw, fh, (fw - viewW) * FOCUS.x, (fh - viewH) * FOCUS.y, viewW, viewH);
  camera.updateProjectionMatrix();
  return `${FOCUS.x * 100}% ${FOCUS.y * 100}%`;
}

// Picks the 720p loop for small screens, starts playback and resolves once
// the first frame can be shown.
export function startPlate(video) {
  const big = Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio, 2) > 1400;
  video.src = big ? 'assets/plate/plate-1080.mp4' : 'assets/plate/plate-720.mp4';
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  return new Promise((resolve) => {
    const ready = () => { video.play().catch(() => {}); resolve(); };
    if (video.readyState >= 2) ready();
    else video.addEventListener('loadeddata', ready, { once: true });
  });
}

// Brightness of the lawn over the loop (cloud shadows), relative to its mean.
export async function loadLightCurve() {
  const data = await (await fetch('assets/plate/plate-light.json')).json();
  return (time) => data.lawn[Math.floor(time * data.fps) % data.lawn.length] || 1;
}
