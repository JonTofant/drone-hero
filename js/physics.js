// Quadrotor rigid-body model with a geometric (SO(3)) attitude controller.
// Frames: world and body are y-up, matching three.js. Body axes follow the
// Skydio X2 mesh: +y up, nose towards -x. Units are SI.
// No dependency on three.js, so the model can be tested in Node.

export const G = 9.81;

// Mass and rotor layout follow the Skydio X2 MJCF in MuJoCo Menagerie
// (1.325 kg, 0.25 kg per rotor). Rotor centres are measured on the mesh.
export const PARAMS = {
  mass: 1.325,
  inertia: [0.037, 0.058, 0.023],
  // Centre of mass in mesh coordinates; rotor positions below are relative to it.
  comInMesh: [0, 0.045, 0],
  // Resting height of the centre of mass when the landing gear touches the ground.
  restHeight: 0.0502,
  rotors: [
    { pos: [0.1435, 0.003, -0.1886], spin: -1 },
    { pos: [0.1435, 0.003, 0.1879], spin: 1 },
    { pos: [-0.1417, 0.0343, 0.1764], spin: -1 },
    { pos: [-0.1417, 0.0343, -0.1766], spin: 1 },
  ],
  yawCoeff: 0.0201,        // reaction torque per newton of thrust
  maxThrust: 13,           // N per motor
  motorTau: 0.04,          // s, first-order motor response
  maxOmega: 900,           // rad/s at full thrust, for the propeller visuals
  linDrag: 0.25,
  quadDrag: 0.12,
  angDrag: 0.012,
};

// Controller gains. Attitude loop: natural frequency per body axis.
const ATT_WN = [14, 6, 14];
const ATT_ZETA = 0.85;
const POS_KP = [4.2, 6.5, 4.2];
const POS_KD = [3.4, 4.6, 3.4];
const ALT_KI = 1.2;
const MAX_TILT = 35 * Math.PI / 180;

// --- small vector and quaternion helpers -------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a) => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Quaternions are [w, x, y, z].
function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
function qnormalize(q) { const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map((v) => v / n); }
export function qfromAxisAngle(axis, angle) {
  const a = normalize(axis), s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), a[0] * s, a[1] * s, a[2] * s];
}
// Rotation matrix (body to world) as rows.
export function qtoMat(q) {
  const [w, x, y, z] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}
const mulMV = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
const mulMtV = (m, v) => [
  m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
  m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
  m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
];
const col = (m, j) => [m[0][j], m[1][j], m[2][j]];
function qslerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((v) => -v); d = -d; }
  if (d > 0.9995) return qnormalize(a.map((v, i) => v + (b[i] - v) * t));
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + b[i] * wb);
}

function invert4(m) {
  const n = 4, a = m.map((r, i) => [...r, ...[0, 1, 2, 3].map((j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((r) => r.slice(n));
}

// Heading as a yaw angle about +y, from the body x axis projected on the ground.
function yawOf(R) {
  const x = col(R, 0);
  return Math.atan2(-x[2], x[0]);
}

export class Quadrotor {
  constructor(params = PARAMS) {
    this.p = params;
    const k = params.yawCoeff;
    // Mixer: [total thrust, body torque x, y, z] = A * rotor thrusts.
    const A = [
      params.rotors.map(() => 1),
      params.rotors.map((r) => -r.pos[2]),
      params.rotors.map((r) => r.spin * k),
      params.rotors.map((r) => r.pos[0]),
    ];
    this.mixInv = invert4(A);
    this.kR = params.inertia.map((I, i) => I * ATT_WN[i] ** 2);
    this.kW = params.inertia.map((I, i) => 2 * ATT_ZETA * I * ATT_WN[i]);
    this.reset();
  }

  reset(position = [0, this.p.restHeight, 0], yaw = 0) {
    this.pos = [...position];
    this.vel = [0, 0, 0];
    this.q = qfromAxisAngle([0, 1, 0], yaw);
    this.omega = [0, 0, 0];           // body frame
    this.thrust = [0, 0, 0, 0];       // actual motor thrusts
    this.cmd = [0, 0, 0, 0];
    this.propAngle = [0, 0, 0, 0];
    this.altIntegral = 0;
    this.onGround = true;
    this.mode = 'off';                // off | spinup | auto
    this.spinup = 0;                  // 0..1 idle throttle during spin-up
    this.target = { pos: [...position], yaw };
    this.extForce = [0, 0, 0];        // world, applied at the centre of mass
    this.extTorque = [0, 0, 0];       // world
  }

  hoverThrust() { return this.p.mass * G / 4; }

  // Applies a world-frame force at a world-frame point for the next step.
  applyForceAtPoint(force, point) {
    this.extForce = add(this.extForce, force);
    this.extTorque = add(this.extTorque, cross(sub(point, this.pos), force));
  }

  // Body-frame point (relative to the centre of mass) to world.
  bodyToWorld(local) { return add(this.pos, mulMV(qtoMat(this.q), local)); }
  worldToBody(world) { return mulMtV(qtoMat(this.q), sub(world, this.pos)); }
  pointVelocity(local) {
    const R = qtoMat(this.q);
    return add(this.vel, mulMV(R, cross(this.omega, local)));
  }

  setMode(mode) {
    if (mode === 'auto' && this.mode !== 'auto') this.altIntegral = 0;
    this.mode = mode;
  }

  control(dt) {
    const p = this.p, hover = this.hoverThrust();
    if (this.mode === 'off') return [0, 0, 0, 0];
    if (this.mode === 'spinup') return [0, 0, 0, 0].map(() => hover * 0.35 * this.spinup);

    const R = qtoMat(this.q);
    const ePos = sub(this.target.pos, this.pos);
    // Integrate only near the setpoint, so the climb itself does not wind up the integrator.
    if (!this.onGround && Math.abs(ePos[1]) < 0.1 && Math.abs(this.vel[1]) < 0.3) {
      this.altIntegral = clamp(this.altIntegral + ePos[1] * dt, -1, 1);
    }
    let acc = [0, 1, 2].map((i) => POS_KP[i] * ePos[i] - POS_KD[i] * this.vel[i]);
    acc[1] += ALT_KI * this.altIntegral;
    // Keep the requested tilt and vertical acceleration within sensible limits.
    acc[1] = clamp(acc[1], -0.6 * G, 1.2 * G);
    const hMax = (G + acc[1]) * Math.tan(MAX_TILT);
    const h = Math.hypot(acc[0], acc[2]);
    if (h > hMax) { acc[0] *= hMax / h; acc[2] *= hMax / h; }
    const F = scale(add(acc, [0, G, 0]), p.mass);

    const b2 = normalize(F);
    const yaw = this.target.yaw;
    const xc = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const b3 = normalize(cross(xc, b2));
    const b1 = cross(b2, b3);
    const Rd = [[b1[0], b2[0], b3[0]], [b1[1], b2[1], b3[1]], [b1[2], b2[2], b3[2]]];

    // e_R = 0.5 * vee(Rd^T R - R^T Rd)
    const RdtR = [0, 1, 2].map((i) => [0, 1, 2].map((j) => dot(col(Rd, i), col(R, j))));
    const eR = [
      0.5 * (RdtR[2][1] - RdtR[1][2]),
      0.5 * (RdtR[0][2] - RdtR[2][0]),
      0.5 * (RdtR[1][0] - RdtR[0][1]),
    ];
    const I = p.inertia, w = this.omega;
    const Iw = [I[0] * w[0], I[1] * w[1], I[2] * w[2]];
    const gyro = cross(w, Iw);
    const tau = [0, 1, 2].map((i) => -this.kR[i] * eR[i] - this.kW[i] * w[i] + gyro[i]);
    const T = clamp(dot(F, col(R, 1)), 0, 4 * p.maxThrust);

    // Yaw has the lowest priority, as in real flight controllers: it gets only
    // the motor headroom left after thrust, roll and pitch.
    const base = this.mixInv.map((row) => dot4(row, [T, tau[0], 0, tau[2]]));
    const yawPart = this.mixInv.map((row) => dot4(row, [0, 0, tau[1], 0]));
    let k = 1;
    base.forEach((b, i) => {
      const y = yawPart[i];
      if (y > 0 && b + y > p.maxThrust) k = Math.min(k, Math.max(0, (p.maxThrust - b) / y));
      if (y < 0 && b + y < 0) k = Math.min(k, Math.max(0, -b / y));
    });
    return base.map((b, i) => clamp(b + k * yawPart[i], 0, p.maxThrust));
  }

  step(dt) {
    const p = this.p;
    this.cmd = this.control(dt);
    const a = 1 - Math.exp(-dt / p.motorTau);
    this.thrust = this.thrust.map((t, i) => t + (this.cmd[i] - t) * a);

    const R = qtoMat(this.q);
    let total = 0, tauB = [0, 0, 0];
    p.rotors.forEach((r, i) => {
      const t = this.thrust[i];
      total += t;
      tauB = add(tauB, [-r.pos[2] * t, r.spin * p.yawCoeff * t, r.pos[0] * t]);
      const omega = p.maxOmega * Math.sqrt(t / p.maxThrust);
      this.propAngle[i] = (this.propAngle[i] - r.spin * omega * dt) % (Math.PI * 2);
    });

    const speed = norm(this.vel);
    let F = mulMV(R, [0, total, 0]);
    F = add(F, [0, -p.mass * G, 0]);
    F = add(F, scale(this.vel, -(p.linDrag + p.quadDrag * speed)));
    F = add(F, this.extForce);
    this.vel = add(this.vel, scale(F, dt / p.mass));
    this.pos = add(this.pos, scale(this.vel, dt));

    const w = this.omega, I = p.inertia;
    tauB = add(tauB, mulMtV(R, this.extTorque));
    tauB = add(tauB, scale(w, -p.angDrag));
    const Iw = [I[0] * w[0], I[1] * w[1], I[2] * w[2]];
    const gyro = cross(w, Iw);
    this.omega = [0, 1, 2].map((i) => w[i] + (tauB[i] - gyro[i]) / I[i] * dt);
    const dq = qmul(this.q, [0, ...this.omega]);
    this.q = qnormalize(this.q.map((v, i) => v + 0.5 * dq[i] * dt));

    this.extForce = [0, 0, 0];
    this.extTorque = [0, 0, 0];
    this.contactGround(dt);
  }

  // Simple ground contact: stops the fall, adds friction and levels the frame.
  contactGround(dt) {
    const contact = this.p.restHeight;
    if (this.pos[1] > contact + 0.002) { this.onGround = false; return; }
    this.onGround = true;
    this.pos[1] = Math.max(this.pos[1], contact);
    if (this.vel[1] < 0) this.vel[1] = -this.vel[1] * 0.15;
    const f = Math.exp(-8 * dt);
    this.vel[0] *= f; this.vel[2] *= f;
    this.omega = scale(this.omega, Math.exp(-14 * dt));
    this.q = qslerp(this.q, qfromAxisAngle([0, 1, 0], yawOf(qtoMat(this.q))), 1 - Math.exp(-10 * dt));
  }

  tiltDeg() {
    const up = col(qtoMat(this.q), 1);
    return Math.acos(clamp(up[1], -1, 1)) * 180 / Math.PI;
  }
}

function dot4(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; }

// Minimum-jerk interpolation, used for the takeoff climb.
export function minJerk(t) {
  const s = clamp(t, 0, 1);
  return s * s * s * (10 - 15 * s + 6 * s * s);
}

export { yawOf };
