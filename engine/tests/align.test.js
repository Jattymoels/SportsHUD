import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAligner, trackedPose } from '../index.js';
import { at, noise } from './helpers.js';

const RAD = Math.PI / 180;
const turn = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;
const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];

/**
 * Someone moving through `corners` (metres east and north) at `speed`, seen
 * two ways once a second: by a device tracking its own movement in a frame
 * whose "ahead" points along `bearing`, and by GPS.
 *
 * @param {object} how
 * @param {number} [how.gps] metres of GPS error, each way; it wanders over `wander` seconds rather than jumping about
 * @param {number} [how.drift] degrees a minute the device's own frame slowly turns
 * @param {number} [how.stretch] how much the device over- or under-measures distance: 0.01 is 1%
 */
function walk(corners, speed, bearing, { gps = 0, wander = 25, drift = 0, stretch = 0, seed = 1, origin = [40, -25] } = {}) {
  const rand = noise(seed);
  const gauss = () => (rand() + rand() + rand()) * 1; // roughly bell-shaped, spread about 1
  const keep = Math.exp(-1 / wander);
  let errE = gps * gauss();
  let errN = gps * gauss();
  const pairs = [];
  let t = 0;
  let localX = 0;
  let localAhead = 0;
  let before = null;
  for (let i = 1; i < corners.length; i++) {
    const [x0, y0] = corners[i - 1];
    const [x1, y1] = corners[i];
    const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / speed));
    for (let k = i === 1 ? 0 : 1; k <= steps; k++) {
      const e = x0 + ((x1 - x0) * k) / steps;
      const n = y0 + ((y1 - y0) * k) / steps;
      // The device adds up its own steps, in its own frame, which may be slowly turning.
      const b = (bearing + (drift * t) / 60) * RAD;
      if (before) {
        const de = (e - before.e) * (1 + stretch);
        const dn = (n - before.n) * (1 + stretch);
        localX += de * Math.cos(b) - dn * Math.sin(b);
        localAhead += de * Math.sin(b) + dn * Math.cos(b);
      }
      before = { e, n };
      errE = errE * keep + gps * Math.sqrt(1 - keep * keep) * gauss();
      errN = errN * keep + gps * Math.sqrt(1 - keep * keep) * gauss();
      pairs.push({ t, e, n, x: origin[0] + localX, z: origin[1] - localAhead, ...at(e + errE, n + errN), accuracy: Math.max(3, gps) });
      t += 1;
    }
  }
  return pairs;
}

const STREETS = [[0, 0], [0, 180], [140, 180], [140, 420], [-60, 420], [-60, 700]];

test('with perfect positions the bearing of the device frame is found exactly', () => {
  for (const bearing of [0, 37, 137, 265, 359]) {
    const aligner = createAligner();
    for (const pair of walk([[0, 0], [0, 40], [30, 40]], 1.4, bearing)) aligner.add(pair);
    const state = aligner.state();
    near(turn(bearing, state.bearing), 0, 0.01, `frame at ${bearing}°`);
    assert.equal(state.quality, 'good');
    near(state.residual, 0, 0.01);
  }
});

test('a place in the world gets its place in the device frame', () => {
  const pairs = walk([[0, 0], [0, 40], [30, 40]], 1.4, 137);
  const aligner = createAligner();
  for (const pair of pairs) aligner.add(pair);
  // The device's own idea of where it was at each moment is the answer to check against.
  for (const pair of [pairs[0], pairs[20], pairs[pairs.length - 1]]) {
    const local = aligner.toLocal(at(pair.e, pair.n));
    near(local.x, pair.x, 0.02);
    near(local.z, pair.z, 0.02);
  }
});

test('standing still gives no answer, however long', () => {
  const aligner = createAligner();
  const rand = noise(3);
  for (let t = 0; t < 120; t++) aligner.add({ x: 0.05 * rand(), z: 0.05 * rand(), ...at(3 * rand(), 3 * rand()), accuracy: 5 });
  assert.equal(aligner.state().bearing, null);
  assert.equal(aligner.state().quality, 'none');
  assert.equal(aligner.toLocal(at(0, 0)), null);
});

test('GPS a few metres out: rough after a short walk, within a few degrees after a long one', () => {
  const after = { 30: [], 60: [], 150: [], 400: [] };
  for (let seed = 1; seed <= 40; seed++) {
    const aligner = createAligner();
    let gone = 0;
    let before = null;
    const left = new Set(Object.keys(after).map(Number));
    for (const pair of walk(STREETS, 1.4, 201, { gps: 3, seed })) {
      aligner.add(pair);
      if (before) gone += Math.hypot(pair.e - before.e, pair.n - before.n);
      before = pair;
      for (const mark of left) {
        if (gone < mark) continue;
        left.delete(mark);
        const state = aligner.state();
        after[mark].push(state.bearing == null ? 180 : Math.abs(turn(201, state.bearing)));
      }
    }
  }
  const typical = Object.fromEntries(Object.entries(after).map(([mark, errors]) => [mark, median(errors)]));
  const worst = Object.fromEntries(Object.entries(after).map(([mark, errors]) => [mark, [...errors].sort((a, b) => a - b)[Math.floor(errors.length * 0.9)]]));
  console.log('bearing error walking, GPS 3 m out: typical', JSON.stringify(typical), '9 in 10 within', JSON.stringify(worst));
  assert.ok(typical[30] < 12, `after 30 m: ${typical[30]}`);
  assert.ok(typical[60] < 6, `after 60 m: ${typical[60]}`);
  assert.ok(typical[150] < 3, `after 150 m: ${typical[150]}`);
  assert.ok(typical[400] < 2, `after 400 m: ${typical[400]}`);
  assert.ok(worst[150] < 6, `after 150 m, 9 in 10: ${worst[150]}`);
});

test('running, with the device frame slowly turning and its distances 1% long', () => {
  const errors = [];
  for (let seed = 1; seed <= 20; seed++) {
    const aligner = createAligner();
    const pairs = walk([...STREETS, [300, 700], [300, 100], [600, 100], [600, 900]], 3.2, 80, { gps: 3, drift: 1.5, stretch: 0.01, seed });
    for (const pair of pairs) {
      aligner.add(pair);
      const state = aligner.state();
      // Where the frame points right now, drift and all, is what a ghost drawn now needs.
      if (pair.t > 120 && state.bearing != null) errors.push(Math.abs(turn(80 + (1.5 * pair.t) / 60, state.bearing)));
    }
  }
  const typical = median(errors);
  const most = [...errors].sort((a, b) => a - b)[Math.floor(errors.length * 0.9)];
  console.log(`bearing error running with a drifting frame: typical ${typical.toFixed(2)}°, 9 in 10 within ${most.toFixed(2)}°`);
  assert.ok(typical < 2.5, `typical ${typical}`);
  assert.ok(most < 5, `9 in 10 within ${most}`);
});

test('a GPS fix that jumps away, or admits it is poor, does not pull the answer', () => {
  const pairs = walk([[0, 0], [0, 120]], 1.4, 300);
  const clean = createAligner();
  const jumpy = createAligner();
  pairs.forEach((pair, i) => {
    clean.add(pair);
    if (i === 40) jumpy.add({ ...pair, ...at(pair.e + 45, pair.n - 20) });
    else if (i === 60) jumpy.add({ ...pair, ...at(pair.e - 300, pair.n), accuracy: 150 });
    else jumpy.add(pair);
  });
  near(turn(300, clean.state().bearing), 0, 0.01);
  near(turn(300, jumpy.state().bearing), 0, 0.5);
});

// --------------------------------------------------------- tracked pose --

/** The rotation a tracker would report for turning `angle` degrees about an axis. */
const about = ([x, y, z], angle) => {
  const half = (angle * RAD) / 2;
  return { x: x * Math.sin(half), y: y * Math.sin(half), z: z * Math.sin(half), w: Math.cos(half) };
};
/** One rotation followed by another: `second` applied after `first`. */
const then = (first, second) => ({
  w: second.w * first.w - second.x * first.x - second.y * first.y - second.z * first.z,
  x: second.w * first.x + second.x * first.w + second.y * first.z - second.z * first.y,
  y: second.w * first.y - second.x * first.z + second.y * first.w + second.z * first.x,
  z: second.w * first.z + second.x * first.y - second.y * first.x + second.z * first.w,
});
const deg = (radians) => radians / RAD;

test('a tracked device that has not moved faces the way it began, level', () => {
  const pose = trackedPose({ x: 0, y: 0, z: 0, w: 1 });
  near(deg(pose.yaw), 0, 1e-9);
  near(deg(pose.pitch), 0, 1e-9);
  near(deg(pose.roll), 0, 1e-9);
});

test('turning right is yaw growing; looking up is pitch; leaning right is roll', () => {
  // About "up", the tracker counts anticlockwise seen from above: a turn to the right is negative.
  near(deg(trackedPose(about([0, 1, 0], -40)).yaw), 40, 1e-9, 'turned right');
  near(deg(trackedPose(about([0, 1, 0], 110)).yaw), -110, 1e-9, 'turned left');
  near(deg(trackedPose(about([1, 0, 0], 25)).pitch), 25, 1e-9, 'looking up');
  near(deg(trackedPose(about([1, 0, 0], -25)).pitch), -25, 1e-9, 'looking down');
  near(deg(trackedPose(about([0, 0, 1], -15)).roll), 15, 1e-9, 'leaning right');
  near(deg(trackedPose(about([0, 0, 1], 15)).roll), -15, 1e-9, 'leaning left');
});

test('the three hold together: turned, tilted down and leaning at once', () => {
  // Lean first, then tilt, then turn: each about the world's axes, so they add up to "facing 70° right, 20° down, 10° rolled".
  const q = then(then(about([0, 0, 1], -10), about([1, 0, 0], -20)), about([0, 1, 0], -70));
  const pose = trackedPose(q);
  near(deg(pose.yaw), 70, 1e-6);
  near(deg(pose.pitch), -20, 1e-6);
  near(deg(pose.roll), 10, 1e-6);
});
