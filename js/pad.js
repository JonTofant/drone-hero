// Foldable landing mat that the drone takes off from.
import * as THREE from 'three';

const PAD_RADIUS = 0.36;

// Dark centre with an H, orange rim.
export function createPad() {
  const s = 512, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c8622c';
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#34363a';
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.41, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(235,232,222,0.7)';
  ctx.lineWidth = s * 0.012;
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(232,228,216,0.85)';
  const u = s * 0.045;
  ctx.fillRect(s / 2 - 3.2 * u, s / 2 - 4 * u, 1.6 * u, 8 * u);
  ctx.fillRect(s / 2 + 1.6 * u, s / 2 - 4 * u, 1.6 * u, 8 * u);
  ctx.fillRect(s / 2 - 1.6 * u, s / 2 - 0.8 * u, 3.2 * u, 1.6 * u);
  // Fabric grain and a little dirt.
  const img = ctx.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // Dust and grass stains from use on a lawn.
  for (let k = 0; k < 260; k++) {
    const r = s * 0.5 * Math.sqrt(Math.random()), t = Math.random() * Math.PI * 2;
    ctx.fillStyle = `rgba(${110 + Math.random() * 40},${95 + Math.random() * 30},${60 + Math.random() * 20},${0.05 + Math.random() * 0.12})`;
    ctx.beginPath(); ctx.arc(s / 2 + Math.cos(t) * r, s / 2 + Math.sin(t) * r, 2 + Math.random() * 14, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS + 0.004, 0.006, 96),
    [new THREE.MeshStandardMaterial({ color: 0xb85a28, roughness: 0.92 }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88 }), new THREE.MeshStandardMaterial({ color: 0x222222 })],
  );
  pad.position.y = 0.003;
  pad.receiveShadow = true;
  return pad;
}
