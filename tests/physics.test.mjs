import test from 'node:test';
import assert from 'node:assert/strict';
import { Quadrotor, PARAMS, minJerk } from '../js/physics.js';

const DT = 1 / 500;
const run = (drone, seconds, each) => {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) { if (each) each(drone, i * DT); drone.step(DT); }
};
const hovering = (h = 1.4) => {
  const d = new Quadrotor();
  d.setMode('auto');
  d.target.pos = [0, h, 0];
  run(d, 8);
  return d;
};

test('rests on the ground with motors off', () => {
  const d = new Quadrotor();
  run(d, 2);
  assert.ok(Math.abs(d.pos[1] - PARAMS.restHeight) < 1e-3);
  assert.ok(d.onGround);
});

test('spin-up stays on the ground', () => {
  const d = new Quadrotor();
  d.setMode('spinup');
  run(d, 2, (dr, t) => { dr.spinup = Math.min(1, t / 1.5); });
  assert.ok(d.onGround);
  assert.ok(d.thrust[0] > 0.3 * d.hoverThrust());
});

test('takes off and settles at the target height', () => {
  const d = new Quadrotor();
  d.setMode('auto');
  run(d, 9, (dr, t) => { dr.target.pos = [0, PARAMS.restHeight + (1.4 - PARAMS.restHeight) * minJerk(t / 3), 0]; });
  assert.ok(Math.abs(d.pos[1] - 1.4) < 0.02, `height ${d.pos[1]}`);
  assert.ok(Math.hypot(d.pos[0], d.pos[2]) < 0.02);
  assert.ok(d.tiltDeg() < 1);
});

test('hover thrust is shared by all four motors', () => {
  const d = hovering();
  const total = d.thrust.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - PARAMS.mass * 9.81) < 0.2, `total ${total}`);
  d.thrust.forEach((t) => assert.ok(t > 2.5 && t < 4));
});

test('recovers from a push at the rotor tip', () => {
  const d = hovering();
  run(d, 0.3, (dr) => dr.applyForceAtPoint([6, 0, 3], dr.bodyToWorld([0.14, 0.03, 0.18])));
  assert.ok(d.tiltDeg() > 5, `tilt after push ${d.tiltDeg()}`);
  run(d, 6);
  assert.ok(d.tiltDeg() < 1);
  assert.ok(Math.hypot(d.pos[0], d.pos[1] - 1.4, d.pos[2]) < 0.05);
});

test('keeps heading after a yaw disturbance', () => {
  const d = hovering();
  d.omega = [0, 3, 0];
  run(d, 5);
  assert.ok(Math.abs(d.omega[1]) < 0.01);
  assert.ok(d.tiltDeg() < 1);
});

test('follows a moved setpoint without overshooting much', () => {
  const d = hovering();
  d.target.pos = [1, 1.4, 0];
  let maxX = 0;
  run(d, 6, (dr) => { maxX = Math.max(maxX, dr.pos[0]); });
  assert.ok(Math.abs(d.pos[0] - 1) < 0.02);
  assert.ok(maxX < 1.12, `overshoot ${maxX}`);
});

