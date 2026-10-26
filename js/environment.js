// 3D meadow: textured ground that fades into the photographed far meadow
// (the ground-projected backdrop),
// a landing pad, and instanced grass that bends in the wind and the downwash.
import * as THREE from 'three';

// Meadow albedo at the edge of the 3D ground, tuned to match the photo there.
const FAR_MEADOW = new THREE.Color('#62692f');
// The 3D ground fades out between these radii, revealing the photographed meadow.
const FADE_START = 13, FADE_END = 30;
// Albedo between the blades, close to the average grass colour.
const GRASS_BASE = new THREE.Color('#5a6626');
const GRASS_RADIUS = 14;
const PAD_RADIUS = 0.36;

export async function createGround(manager, renderer) {
  const loader = new THREE.TextureLoader(manager);
  const [diff, nor, rough] = await Promise.all([
    loader.loadAsync('assets/ground/sparse-grass-diff.jpg'),
    loader.loadAsync('assets/ground/sparse-grass-nor.jpg'),
    loader.loadAsync('assets/ground/sparse-grass-rough.jpg'),
  ]);
  diff.colorSpace = THREE.SRGBColorSpace;
  // The texture covers 2 x 2 m.
  const size = 2 * FADE_END, repeat = size / 2;
  for (const t of [diff, nor, rough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  const material = new THREE.MeshStandardMaterial({
    map: diff, normalMap: nor, roughnessMap: rough, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8), transparent: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFar = { value: FAR_MEADOW };
    shader.uniforms.uBase = { value: GRASS_BASE };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;\nuniform vec3 uFar;\nuniform vec3 uBase;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        // A second, larger sample breaks up the visible tiling.
        vec3 broad = texture2D(map, vMapUv * 0.137 + vec2(0.31, 0.77)).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, broad, 0.45);
        // Pull the brown soil towards the grass colour, then fade into the far meadow.
        float gd = distance(vGroundWorld.xz, cameraPosition.xz);
        diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.8, 1.1, 0.55), uBase, 0.35 + 0.35 * smoothstep(2.0, 14.0, gd));
        float rr = length(vGroundWorld.xz);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFar, smoothstep(6.0, ${FADE_START.toFixed(1)}, rr));
        diffuseColor.a *= 1.0 - smoothstep(${FADE_START.toFixed(1)}, ${FADE_END.toFixed(1)}, rr);`);
  };
  const ground = new THREE.Mesh(new THREE.CircleGeometry(FADE_END, 96), material);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}

// Foldable landing mat: dark centre with an H, orange rim.
export function createPad() {
  const s = 512, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8641c';
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b2f33';
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.41, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = s * 0.012;
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(245,245,240,0.92)';
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
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS + 0.004, 0.006, 96),
    [new THREE.MeshStandardMaterial({ color: 0xd65a18, roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88 }), new THREE.MeshStandardMaterial({ color: 0x222222 })],
  );
  pad.position.y = 0.003;
  pad.receiveShadow = true;
  return pad;
}

// A clump of several curved, tapered blades. Height is normalised to about 1;
// each instance scales it to its real height.
function clumpGeometry(blades = 5, segments = 4) {
  const pos = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 0.025;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const yaw = Math.random() * Math.PI * 2, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const h = 0.6 + Math.random() * 0.55, lean = 0.1 + Math.random() * 0.3, w = 0.0028 + Math.random() * 0.0018;
    const base = pos.length / 3;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments, y = t * h, half = w * (1 - t * 0.92);
      const fwd = lean * t * t;
      for (const side of [-1, 1]) {
        const lx = side * half, lz = fwd;
        pos.push(ox + lx * cy - lz * sy, y, oz + lx * sy + lz * cy);
      }
    }
    for (let i = 0; i < segments; i++) {
      const k = base + i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createGrass({ count }) {
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(0.05, 0.02) },
    uDrone: { value: new THREE.Vector3(0, 0, 0) },
    uWash: { value: 0 },
  };
  // Low specular: thin blades seen edge-on would otherwise mirror the bright sky.
  const material = new THREE.MeshPhysicalMaterial({ roughness: 0.85, metalness: 0, specularIntensity: 0.12, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec2 uWind; uniform vec3 uDrone; uniform float uWash;
        varying float vBladeT;`)
      // Light the blades mostly from above, like a canopy, so back faces are not black.
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.65));`)
      .replace('#include <project_vertex>', `
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
          vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float bladeH = length(instanceMatrix[1].xyz);
        #else
          vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float bladeH = 1.0;
        #endif
        wp = modelMatrix * wp;
        float t = clamp(position.y, 0.0, 1.2);
        vBladeT = t;
        float bend = t * t;
        float phase = root.x * 0.9 + root.z * 0.7;
        // Wind: a slow sway plus small fast flutter.
        vec2 push = uWind * (0.55 + 0.45 * sin(uTime * 1.3 + phase))
          + vec2(sin(uTime * 2.7 + phase * 1.7), cos(uTime * 2.1 + phase * 1.3)) * 0.018;
        // Downwash: pushes blades away from the point under the drone.
        vec2 rel = root.xz - uDrone.xz;
        float d = length(rel);
        float hgt = max(uDrone.y, 0.0);
        float radius = 0.42 + 0.45 * hgt;
        float wash = uWash * exp(-d * d / (radius * radius)) * clamp(1.0 - hgt / 2.2, 0.0, 1.0);
        vec2 dir = rel / max(d, 0.001);
        float flutter = 0.7 + 0.3 * sin(uTime * 31.0 + phase * 9.0);
        push += dir * wash * flutter * 1.4;
        // Thin out blades right in front of the lens.
        float lens = smoothstep(0.18, 0.55, distance(root.xz, cameraPosition.xz));
        wp.xyz = root + (wp.xyz - root) * lens;
        wp.xz += push * bend * bladeH * lens;
        wp.y -= min(dot(push, push), 0.8) * bend * bladeH * 0.6 * lens;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBladeT;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Darker at the root, where the blades shade each other.
        diffuseColor.rgb *= mix(0.32, 1.08, smoothstep(0.0, 1.0, vBladeT));`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(vNormal);`)
      // A little light through the blades.
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * 0.06 * vBladeT;`);
  };

  const mesh = new THREE.InstancedMesh(clumpGeometry(), material, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  let n = 0;
  while (n < count) {
    // Denser near the take-off spot, thinner towards the edge of the patch.
    const r = GRASS_RADIUS * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    if (Math.random() > 1.2 - THREE.MathUtils.smoothstep(r, 3, GRASS_RADIUS)) continue;
    if (r < PAD_RADIUS + 0.02) continue;
    p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    // Grass around the pad is pressed lower.
    const nearPad = THREE.MathUtils.smoothstep(r, PAD_RADIUS, PAD_RADIUS + 0.5);
    const h = (0.035 + Math.random() * 0.075) * (0.6 + 0.4 * nearPad) * (Math.random() < 0.06 ? 1.8 : 1);
    const w = 0.8 + Math.random() * 0.6;
    q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
    m.compose(p, q, s.set(w, h, w));
    mesh.setMatrixAt(n, m);
    // Mostly fresh green, some yellowed and dry blades.
    const dry = Math.random() < 0.1;
    col.setHSL(dry ? 0.12 + Math.random() * 0.03 : 0.18 + Math.random() * 0.06, dry ? 0.3 : 0.38 + Math.random() * 0.18, dry ? 0.3 + Math.random() * 0.08 : 0.12 + Math.random() * 0.08);
    mesh.setColorAt(n, col);
    n++;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  function update(time, dronePos, wash, wind) {
    uniforms.uTime.value = time;
    uniforms.uDrone.value.set(dronePos[0], dronePos[1], dronePos[2]);
    uniforms.uWash.value = wash;
    uniforms.uWind.value.copy(wind);
  }
  return { mesh, update };
}
