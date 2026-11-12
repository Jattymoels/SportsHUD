// Heading fusion, against made-up sensors whose true heading is known.
//
// The wearer moves along a path that turns now and then, mostly facing the
// way they go, glancing aside from time to time, head bobbing. The compass
// is out by a steady amount, wanders slowly and jitters; the gyroscope is
// smooth with a small drift. These are assumptions about the sensors, not
// measurements of any: what the tests show is that the method takes out the
// kinds of error assumed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHeadingFuser, turnRate } from '../index.js';
import { noise } from './helpers.js';

const turn = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];

/**
 * A stretch of movement with made-up sensors.
 * @returns {{median:{compass:number, fused:number}, worst:number, error:number}} degrees
 */
function wear({ seconds = 240, steady = 9, wander = 4, jitter = 5, bob = 3, glances = true, gyro = true, speed = 3, seed = 1, options } = {}) {
  const rnd = noise(seed);
  const gauss = () => (rnd() + rnd() + rnd()) / 1.0; // roughly bell-shaped, standard deviation about 1
  // The way of travel: north, then a corner to the east at 60 s, back north at 130 s, west at 190 s.
  const legs = [[0, 0], [60, 90], [130, 0], [190, 270]];
  const travelAt = (t) => {
    let from = legs[0][1];
    for (const [at, bearing] of legs) {
      if (t >= at + 4) from = bearing;
      else if (t >= at && at > 0) return from + (turn(from, bearing) * (t - at)) / 4; // four seconds to round a corner
    }
    return from;
  };
  // A look aside of 25 degrees for two seconds, every 23 seconds.
  const glanceAt = (t) => (glances && t % 23 > 10 && t % 23 < 12 ? (Math.floor(t / 23) % 2 ? 25 : -25) : 0);
  const trueAt = (t) => travelAt(t) + glanceAt(t) + bob * Math.sin(2 * Math.PI * 2.8 * t);

  const fuser = createHeadingFuser(options);
  const off = { compass: [], fused: [] };
  const dt = 0.02;
  let before = trueAt(0);
  for (let i = 0; i * dt <= seconds; i++) {
    const t = i * dt;
    const truth = trueAt(t);
    if (gyro) fuser.gyro((turn(before, truth) / dt) * (i ? 1 : 0) + 0.3 + 2 * gauss(), t);
    before = truth;
    let reading = null;
    if (i % 3 === 0) {
      reading = truth + steady + wander * Math.sin((2 * Math.PI * t) / 40) + jitter * gauss();
      fuser.compass(((reading % 360) + 360) % 360, t);
    }
    if (i % 50 === 0) fuser.travel(((travelAt(t) + 4 * gauss()) % 360 + 360) % 360, speed, t);
    // Score once the method has had half a minute to learn the compass.
    if (t >= 30 && reading != null) {
      off.compass.push(Math.abs(turn(truth, reading)));
      off.fused.push(Math.abs(turn(truth, fuser.at(t).yaw)));
    }
  }
  return { median: { compass: median(off.compass), fused: median(off.fused) }, worst: Math.max(...off.fused), error: fuser.at(seconds).error };
}

test('running: a compass 9 degrees out, with jitter, is brought inside 5 degrees', (t) => {
  const run = wear();
  t.diagnostic(`median error: compass alone ${run.median.compass.toFixed(1)}, fused ${run.median.fused.toFixed(1)} degrees; steady error learned as ${run.error.toFixed(1)}`);
  assert.ok(run.median.compass > 8, 'the compass alone misses the 5 degree target');
  assert.ok(run.median.fused < 3, `fused ${run.median.fused.toFixed(1)}`);
  assert.ok(Math.abs(run.error - 9) < 3, `learned ${run.error.toFixed(1)} for a true 9`);
});

test('walking, and with the steady error the other way', (t) => {
  const walk = wear({ steady: -8, jitter: 3, bob: 1.5, speed: 1.4, seed: 2 });
  t.diagnostic(`median error: compass alone ${walk.median.compass.toFixed(1)}, fused ${walk.median.fused.toFixed(1)} degrees`);
  assert.ok(walk.median.fused < 3, `fused ${walk.median.fused.toFixed(1)}`);
  assert.ok(Math.abs(walk.error + 8) < 3);
});

test('without a gyroscope the steady error is still taken out, with more jitter left in', (t) => {
  const run = wear({ gyro: false, seed: 3 });
  const both = wear({ seed: 3 });
  t.diagnostic(`median error: compass alone ${run.median.compass.toFixed(1)}, fused without a gyroscope ${run.median.fused.toFixed(1)}, with one ${both.median.fused.toFixed(1)} degrees`);
  assert.ok(run.median.fused < 5, `fused ${run.median.fused.toFixed(1)}`);
  assert.ok(run.median.fused < run.median.compass - 3);
  assert.ok(both.median.fused <= run.median.fused);
});

test('a good compass is left alone', () => {
  const fine = wear({ steady: 0, wander: 1, jitter: 2, seed: 4 });
  assert.ok(Math.abs(fine.error) < 2, `invented an error of ${fine.error.toFixed(1)}`);
  assert.ok(fine.median.fused < 2.5);
});

test('standing still teaches nothing, and the compass is passed through', () => {
  const fuser = createHeadingFuser();
  for (let i = 0; i < 200; i++) {
    fuser.compass(100, i * 0.05);
    if (i % 20 === 0) fuser.travel(40, 0.2, i * 0.05); // GPS wobble while standing: not a direction of travel
  }
  const now = fuser.at(10);
  assert.equal(now.corrected, false);
  assert.ok(Math.abs(turn(100, now.yaw)) < 0.5);
  assert.equal(createHeadingFuser().at(0), null);
});

test('looking aside for a long while does not drag the compass correction with it', () => {
  // Running north with a true compass, then watching something 60 degrees to the right for 20 seconds.
  const fuser = createHeadingFuser();
  for (let i = 0; i <= 3000; i++) {
    const t = i * 0.02;
    const facing = t > 30 && t < 50 ? 60 : 0;
    if (i % 3 === 0) fuser.compass(facing, t);
    if (i % 50 === 0) fuser.travel(0, 3, t);
  }
  assert.ok(Math.abs(fuser.at(60).error) < 2, `error learned as ${fuser.at(60).error.toFixed(1)}`);
});

test('headings near north wrap without a wobble', () => {
  const fuser = createHeadingFuser();
  for (let i = 0; i < 400; i++) fuser.compass(i % 2 ? 359 : 1, i * 0.05);
  const yaw = fuser.at(20).yaw;
  assert.ok(Math.abs(turn(0, yaw)) < 1.5, `yaw ${yaw}`);
});

test('turn rate about the vertical from a phone\'s motion reading, however it is held', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  // Lying flat, screen up: gravity reads along +z, and turning it clockwise seen from above is negative about z.
  close(turnRate({ alpha: -30, beta: 0, gamma: 0 }, { x: 0, y: 0, z: 9.8 }), 30);
  // Held upright in portrait: gravity reads along +y, so turning to face another way is rotation about y.
  close(turnRate({ alpha: 0, beta: 0, gamma: -20 }, { x: 0, y: 9.8, z: 0 }), 20);
  // Nodding the upright phone (about x) is not turning.
  close(turnRate({ alpha: 0, beta: 50, gamma: 0 }, { x: 0, y: 9.8, z: 0 }), 0);
  assert.equal(turnRate({ alpha: 1, beta: 1, gamma: 1 }, { x: 0, y: 0, z: 0 }), null);
});
