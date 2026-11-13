// The direction of travel felt from the head, against made-up running.
//
// These signals are invented: a bounce once a step, a brake-and-push along
// the way of travel once a step, a sway from foot to foot once every two
// steps, and noise. They show the method finds a line that was put there.
// They do not show that a real head carries such a line cleanly; only a
// recording from one can.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strideLine, createStrideDirection, headFrame, deviceAxes, mountFrom } from '../index.js';
import { noise } from './helpers.js';

const RAD = Math.PI / 180;
const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];

/**
 * Readings in the head's level frame for someone moving with their body
 * going `aside` degrees to the right of where their head faces.
 *
 * @param {object} how
 * @param {number|((t:number)=>number)} how.aside degrees, or a way of working it out from the time
 * @param {number} [how.steps] steps a second
 * @param {number} [how.nod] m/s2 of to-and-fro along the way the HEAD faces, once a step, as a nodding head gives a sensor on the forehead
 * @param {number} [how.uneven] m/s2 of side-to-side once a step, as an uneven gait gives: left and right steps that do not match
 */
function gait({ aside, seconds = 30, steps = 2.8, bounce = 8, push = 1.8, sway = 1.5, nod = 0, uneven = 0.1, rough = 0.5, seed = 1 }) {
  const rnd = noise(seed);
  const gauss = () => rnd() + rnd() + rnd();
  const samples = [];
  for (let i = 0; i / 60 <= seconds; i++) {
    const t = i / 60 + 0.003 * rnd(); // sixty readings a second, not quite evenly
    const turn = 2 * Math.PI * steps * t;
    const angle = (typeof aside === 'function' ? aside(t) : aside) * RAD;
    const along = push * Math.sin(turn); // braking, then pushing on, after each footfall
    const across = sway * Math.sin(turn / 2 + 1) + uneven * Math.sin(turn + 2); // foot to foot, and a little unevenness
    samples.push({
      t,
      forward: along * Math.cos(angle) - across * Math.sin(angle) + nod * Math.sin(turn + 0.6) + rough * gauss(),
      right: along * Math.sin(angle) + across * Math.cos(angle) + rough * gauss(),
      up: 9.81 + bounce * Math.cos(turn) + 2 * Math.cos(2 * turn + 0.5) + rough * gauss(),
    });
  }
  return samples;
}

/** Feed a stretch through the running estimator and collect its answers. */
function answers(samples, options) {
  const stride = createStrideDirection(options);
  const out = [];
  for (const s of samples) {
    const found = stride.add(s.t, s.forward, s.right, s.up);
    if (found) out.push(found);
  }
  return out;
}

test('running with the head facing the way of travel: the line found is straight ahead', (t) => {
  const found = answers(gait({ aside: 0 }));
  assert.ok(found.length >= 20, `an answer a second once there is enough to go on: ${found.length}`);
  const off = found.map((f) => Math.abs(f.right));
  t.diagnostic(`head facing the way of travel: typically ${median(off).toFixed(1)}° out, at worst ${Math.max(...off).toFixed(1)}°`);
  assert.ok(median(off) < 2.5, `typical ${median(off)}`);
  assert.ok(Math.max(...off) < 6, `worst ${Math.max(...off)}`);
  near(median(found.map((f) => f.steps)), 2.8, 0.06, 'step rate');
  assert.ok(median(found.map((f) => f.confidence)) > 0.8);
});

test('running with the head turned: the angle between head and body is found, either way', (t) => {
  for (const [aside, seed] of [[30, 2], [-40, 3], [12, 4], [-70, 5]]) {
    const found = answers(gait({ aside, seed }));
    const off = found.map((f) => Math.abs(f.right - aside));
    t.diagnostic(`body ${Math.abs(aside)}° to the ${aside > 0 ? 'right' : 'left'} of the head: typically ${median(off).toFixed(1)}° out, at worst ${Math.max(...off).toFixed(1)}°`);
    assert.ok(median(off) < 2.5, `at ${aside}: typical ${median(off)}`);
    assert.ok(Math.max(...off) < 7, `at ${aside}: worst ${Math.max(...off)}`);
  }
});

test('walking, slower and gentler, works the same way', (t) => {
  const found = answers(gait({ aside: -25, steps: 1.9, bounce: 3, push: 0.8, sway: 0.7, uneven: 0.05, rough: 0.25, seed: 6 }));
  const off = found.map((f) => Math.abs(f.right + 25));
  t.diagnostic(`walking, body 25° to the left: typically ${median(off).toFixed(1)}° out`);
  assert.ok(median(off) < 3, `typical ${median(off)}`);
  near(median(found.map((f) => f.steps)), 1.9, 0.06, 'step rate');
});

test('when the head turns part-way through, the answer follows within the stretch it looks at', () => {
  // Facing the way of travel for 20 s, then looking 35° to the left, so the body goes 35° to the right of the head.
  const found = answers(gait({ aside: (t) => (t < 20 ? 0 : 35), seconds: 45, seed: 7 }));
  const before = found.filter((f) => f.t > 8 && f.t < 20).map((f) => f.right);
  const after = found.filter((f) => f.t > 27).map((f) => f.right);
  near(median(before), 0, 2.5, 'before');
  near(median(after), 35, 3, 'six seconds and more after');
});

test('standing still, or readings with no steps in them, give no answer', () => {
  const rnd = noise(8);
  const still = [];
  for (let i = 0; i < 600; i++) still.push({ t: i / 60, forward: 0.1 * rnd(), right: 0.1 * rnd(), up: 9.81 + 0.1 * rnd() });
  assert.equal(strideLine(still), null);
  assert.deepEqual(answers(still), []);
  assert.equal(strideLine([]), null);
});

test('the two ends of the line: the timing of the push against the bounce tells them apart', () => {
  // The line is taken to point within 90° of the head. Past that, the answer comes out the other way round,
  // and the timing, reported as `phase`, is what shows it.
  const ahead = strideLine(gait({ aside: 20, seconds: 6 }));
  const behind = strideLine(gait({ aside: 200, seconds: 6 }));
  near(ahead.right, 20, 5);
  near(behind.right, 20, 5, 'body going 200° round reads as 20°: the same line');
  near(ahead.phase, -90, 15, 'the push follows the bounce by a quarter of a step');
  near(behind.phase, 90, 15, 'the other end: it leads by a quarter instead');
});

test('the risk named in stride.js: a nodding head pulls the answer towards the head', (t) => {
  // A sensor on the forehead of a head that nods once a step is moved to and fro along the way the HEAD faces.
  // With that at a third of the size of the push, and the body 30° aside:
  const found = answers(gait({ aside: 30, nod: 0.6, seed: 9 }));
  const seen = median(found.map((f) => f.right));
  t.diagnostic(`body 30° aside with a nodding head: read as ${seen.toFixed(1)}°`);
  assert.ok(seen > 12 && seen < 30, `read as ${seen}`);
});

test('a second risk: steps that do not match from left to right turn the line a little', (t) => {
  // Side-to-side movement once a step, in time with the push, cannot be told from the push. Here it is a
  // fifth of the push's size, four times what the other tests assume.
  const found = answers(gait({ aside: 0, uneven: 0.4, seed: 10 }));
  const seen = median(found.map((f) => f.right));
  t.diagnostic(`head facing the way of travel, with a markedly uneven gait: read as ${Math.abs(seen).toFixed(1)}° to the ${seen > 0 ? 'right' : 'left'}`);
  assert.ok(Math.abs(seen) > 2 && Math.abs(seen) < 10, `read as ${seen}`);
});

test('a reading in the device\'s own axes is put into the head\'s level frame, however the device sits', () => {
  for (const fit of [[0, 90, 0], [200, 180, 0], [33, 61, -17]]) {
    // Lined up facing 70°. Then an acceleration of 2 along that way, 1 to its right and 9.81 up, in the world.
    const axes = deviceAxes(...fit);
    const mount = mountFrom(axes, 70);
    const world = [2 * Math.sin(70 * RAD) + Math.cos(70 * RAD), 2 * Math.cos(70 * RAD) - Math.sin(70 * RAD), 9.81];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const reading = { x: dot(world, axes.x), y: dot(world, axes.y), z: dot(world, axes.z) };
    const seen = headFrame(axes, mount, reading);
    near(seen.forward, 2, 1e-9, `fit ${fit}`);
    near(seen.right, 1, 1e-9, `fit ${fit}`);
    near(seen.up, 9.81, 1e-9, `fit ${fit}`);
  }
});
