// Diagnostics for ?debug: what the GPU, the WebGL context and the video report,
// plus every error, so a failure on a phone can be read off one screenshot.
// Loaded before the renderer exists, so even a failed context shows up here.
import * as THREE from 'three';

const t0 = performance.now();
const since = () => ((performance.now() - t0) / 1000).toFixed(1);
const errors = [];
const events = [];
const ctx = {};

function text(a) {
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  if (a && typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
  return String(a);
}
function note(kind, args) {
  const lines = args.map(text).join(' ').split('\n');
  // Shader errors run to hundreds of lines; keep the head and the lines that name the fault.
  const short = lines.length > 6 ? [...lines.slice(0, 2), ...lines.filter((l) => /ERROR|Material Type|Info Log/i.test(l)).slice(0, 8)] : lines;
  errors.push(`${since()}s ${kind}: ${short.join('\n').slice(0, 700)}`);
}
for (const kind of ['error', 'warn']) {
  const original = console[kind].bind(console);
  console[kind] = (...args) => { note(kind, args); original(...args); };
}
const log = console.log.bind(console);
console.log = (...args) => { if (String(args[0]).startsWith('THREE.')) note('log', args); log(...args); };
addEventListener('error', (e) => note('onerror', [e instanceof ErrorEvent ? e.message : `${e.target.tagName} ${e.target.currentSrc || e.target.src || ''}`]), true);
addEventListener('unhandledrejection', (e) => note('rejection', [e.reason]));

document.head.insertAdjacentHTML('beforeend', `<style>
.debug { position: fixed; top: 0; left: 0; right: 0; z-index: 100; max-height: 62vh; overflow: auto; padding: 8px 10px 10px;
  background: rgba(0, 0, 0, 0.84); color: #e8f0f2; font: 10px/1.4 ui-monospace, Menlo, monospace; }
.debug.is-small { max-height: 4.4em; }
.debug pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
.debug nav { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.debug a, .debug button { padding: 5px 8px; border: 1px solid #7fd3ff; border-radius: 4px; color: #7fd3ff; background: none; font: inherit; text-decoration: none; }
.debug a.is-current { background: #7fd3ff; color: #000; }
</style>`);
const panel = document.createElement('div');
panel.className = 'debug';
const out = document.createElement('pre');
const nav = document.createElement('nav');
// One switch at a time narrows down which feature the device cannot handle.
const variants = [
  ['privzeto', ''],
  ['brez 3D', 'gl=0'],
  ['vse lahko', 'pr=1&aa=0&shadow=off&env=0&plate=720'],
  ['pr=1', 'pr=1'],
  ['brez AA', 'aa=0'],
  ['sence PCF', 'shadow=pcf'],
  ['brez senc', 'shadow=off'],
  ['brez okolja', 'env=0'],
  ['video 720p', 'plate=720'],
];
const current = location.search.replace(/^\?debug&?/, '');
nav.innerHTML = variants.map(([label, q]) => `<a href="?debug${q && '&' + q}"${q === current ? ' class="is-current"' : ''}>${label}</a>`).join('')
  + '<button type="button">skrij</button>';
nav.querySelector('button').addEventListener('click', (e) => {
  e.target.textContent = panel.classList.toggle('is-small') ? 'pokaži' : 'skrij';
});
panel.append(out, nav);
document.body.append(panel);

let frames = 0, fps = 0, counted = 0, countedAt = performance.now();
let probe = 'še ni izrisa';
const pixel = new Uint8Array(4);

// Reads the canvas right after a frame: at the drone, and in the empty sky above it.
// A drawn drone has alpha > 0; the sky must stay at alpha 0 for the video to show.
function sample(gl, camera, target) {
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const read = (x, y) => {
    // three.js may leave a half-float target bound for reading after PMREM.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.readPixels(Math.round(x), Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel.join(',');
  };
  const sky = read(w / 2, h - 4);
  const object = target();
  if (!object) return `nebo rgba(${sky})`;
  const p = object.getWorldPosition(new THREE.Vector3()).project(camera);
  const x = (p.x + 1) / 2 * w, y = (p.y + 1) / 2 * h;
  const inside = x >= 0 && x < w && y >= 0 && y < h && p.z < 1;
  return `na zaslonu ${inside ? 'da' : 'NE'} (${Math.round(x)}, ${Math.round(h - y)}) · dron rgba(${inside ? read(x, y) : '-'}) · nebo rgba(${sky})`;
}

export function attach({ renderer, camera, video, manager, drone }) {
  const gl = renderer.getContext();
  const canvas = renderer.domElement;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const supported = gl.getSupportedExtensions() || [];
  ctx.gpu = info ? `${gl.getParameter(info.UNMASKED_RENDERER_WEBGL)} (${gl.getParameter(info.UNMASKED_VENDOR_WEBGL)})` : gl.getParameter(gl.RENDERER);
  ctx.caps = `${renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'} · natančnost ${renderer.capabilities.precision} · maxTex ${renderer.capabilities.maxTextureSize} · MSAA ${gl.getContextAttributes()?.antialias}`;
  ctx.ext = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear']
    .map((name) => `${name} ${supported.includes(name) ? '✓' : '✗'}`).join(' · ');
  Object.assign(ctx, { renderer, canvas, video, gl });

  canvas.addEventListener('webglcontextlost', () => events.push(`${since()}s GL kontekst IZGUBLJEN`));
  canvas.addEventListener('webglcontextrestored', () => events.push(`${since()}s GL kontekst obnovljen`));
  for (const type of ['loadedmetadata', 'loadeddata', 'playing', 'waiting', 'stalled', 'pause', 'emptied', 'error']) {
    video.addEventListener(type, () => events.push(`${since()}s video ${type}`));
  }
  const poster = new Image();
  poster.onload = () => events.push(`${since()}s plakat naložen`);
  poster.onerror = () => events.push(`${since()}s plakat NI naložen`);
  poster.src = video.poster;
  manager.onError = (url) => note('nalaganje', [url]);

  const render = renderer.render.bind(renderer);
  renderer.render = (scene, cam) => {
    render(scene, cam);
    frames++;
    if (frames % 30 === 1) probe = sample(gl, camera, drone);
  };
}

function update() {
  const now = performance.now();
  fps = Math.round((frames - counted) / ((now - countedAt) / 1000));
  counted = frames;
  countedAt = now;
  const { renderer, canvas, video: v, gl } = ctx;
  const lines = [
    `drone-hero ?debug · ${since()} s · ${location.search}`,
    navigator.userAgent,
    `zaslon ${innerWidth}×${innerHeight} @${devicePixelRatio.toFixed(2)} · jedra ${navigator.hardwareConcurrency ?? '?'} · RAM ${navigator.deviceMemory ?? '?'} GB`,
  ];
  if (renderer) {
    lines.push(
      `GPU ${ctx.gpu}`,
      ctx.caps,
      ctx.ext,
      `kontekst ${gl.isContextLost() ? 'IZGUBLJEN' : 'ok'} · platno ${canvas.width}×${canvas.height} · sličic ${frames} · ${fps} fps · programov ${renderer.info.programs?.length ?? 0} · klicev ${renderer.info.render.calls} · trikotnikov ${renderer.info.render.triangles}`,
      `dron ${probe}`,
      `video ${v.currentSrc.split('/').pop() || '-'} ${v.videoWidth}×${v.videoHeight} · readyState ${v.readyState} · networkState ${v.networkState} · t ${v.currentTime.toFixed(1)} · ${v.paused ? 'ustavljen' : 'teče'}${v.error ? ` · NAPAKA ${v.error.code} ${v.error.message}` : ''}`,
      `nalagalnik ${document.getElementById('loader').classList.contains('is-done') ? 'skrit' : 'VIDEN'}`,
    );
  } else {
    lines.push('renderer še ni ustvarjen');
  }
  lines.push('', 'dogodki:', ...events.slice(-12), '', `napake (${errors.length}):`, ...errors.slice(-8));
  out.textContent = lines.join('\n');
}
setInterval(update, 500);
update();
