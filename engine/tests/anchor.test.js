// The heading with no compass: a device's own blended orientation, kept
// true by the direction of travel. Against made-up sensors, as in
// heading.test.js: these show the method takes out the errors assumed, not
// that any real sensor has them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTravelAnchor, createHeadingFuser } from '../index.js';
import { noise } from './helpers.js';

const turn = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;
const wrap = (bearing) => ((bearing % 360) + 360) % 360;
const sorted = (values) => [...values].sort((a, b) => a - b);
const median = (values) => sorted(values)[values.length >> 1];
const most = (values) => sorted(values)[Math.floor(values.length * 0.95)];

/**
 * Ten minutes round some streets, head bobbing and glancing about.
 *
 * @param {object} how
 * @param {number} [how.start] degrees: where the device's own idea of north happens to begin
 * @param {number} [how.drift] degrees a minute it wanders by
 * @param {boolean} [how.linedUp] whether the wearer faced along the route and said so before setting off
 * @param {number} [how.lean] degrees the wearer looks to one side, from `leanFrom` to `leanUntil` seconds
 * @param {Array<[number, number, number]>} [how.upsets] moments a compass is thrown: [from, to, degrees]
 */
function wear({ seconds = 600, start = 137, drift = 1.5, linedUp = true, lean = 0, leanFrom = 120, leanUntil = 300, bob = 3, speed = 3, seed = 1, upsets = [], options } = {}) {
  const rnd = noise(seed);
  const gauss = () => rnd() + rnd() + rnd();
  // A corner every 50 to 80 seconds, four seconds to get round each.
  const legs = [[0, 20], [60, 110], [130, 20], [190, 290], [265, 20], [330, 110], [400, 200], [470, 110], [540, 20]];
  const travelAt = (t) => {
    let from = legs[0][1];
    for (const [at, bearing] of legs) {
      if (t >= at + 4) from = bearing;
      else if (t >= at && at > 0) return from + (turn(from, bearing) * (t - at)) / 4;
    }
    return from;
  };
  const glanceAt = (t) => (t % 23 > 10 && t % 23 < 12 ? (Math.floor(t / 23) % 2 ? 40 : -40) : 0);
  const trueAt = (t) => travelAt(t) + glanceAt(t) + (t >= leanFrom && t < leanUntil ? lean : 0) + bob * Math.sin(2 * Math.PI * 2.8 * t);
  // The device's own yaw: true, from an arbitrary start, wandering steadily and a little unsteadily.
  const ownAt = (t) => trueAt(t) + start + (drift * t) / 60 + 1.5 * Math.sin((2 * Math.PI * t) / 170);
  const upsetAt = (t) => upsets.reduce((sum, [from, to, by]) => sum + (t >= from && t < to ? by : 0), 0);

  const anchor = createTravelAnchor(options);
  const fuser = createHeadingFuser();
  const off = { anchor: [], fuser: [], raw: [], at: [] };
  const dt = 0.02;
  let before = trueAt(0);
  for (let i = 0; i * dt <= seconds; i++) {
    const t = i * dt;
    const truth = trueAt(t);
    anchor.orientation(wrap(ownAt(t) + 0.2 * gauss()), t);
    if (i === 0 && linedUp) anchor.set(wrap(travelAt(0)));
    // The same walk for a compass with a gyroscope, to compare.
    fuser.gyro(turn(before, truth) / dt + 0.3 + 2 * gauss(), t);
    before = truth;
    if (i % 3 === 0) fuser.compass(wrap(truth + 6 + upsetAt(t) + 4 * gauss()), t);
    if (i % 50 === 0) {
      const going = wrap(travelAt(t) + 4 * gauss());
      anchor.travel(going, speed, t);
      fuser.travel(going, speed, t);
    }
    if (t >= 30 && i % 5 === 0) {
      off.anchor.push(Math.abs(turn(truth, anchor.at().yaw)));
      off.at.push(t);
      off.fuser.push(Math.abs(turn(truth, fuser.at(t).yaw)));
      off.raw.push(Math.abs(turn(truth, ownAt(t) - start)));
    }
  }
  return { off, anchor };
}

test('lined up at the start, the heading stays true for ten minutes with no compass', (t) => {
  const { off } = wear();
  t.diagnostic(`error with no compass: typically ${median(off.anchor).toFixed(1)}°, 19 in 20 within ${most(off.anchor).toFixed(1)}°; left alone the device's own heading would be ${most(off.raw).toFixed(1)}° out by the end`);
  assert.ok(median(off.anchor) < 2, `typical ${median(off.anchor)}`);
  assert.ok(most(off.anchor) < 4, `19 in 20 within ${most(off.anchor)}`);
  assert.ok(most(off.raw) > 10, 'the drift assumed is enough to matter');
});

test('not lined up at all, it finds north from a few seconds of running', (t) => {
  const { off, anchor } = wear({ linedUp: false, start: 251, seed: 3 });
  t.diagnostic(`error when never lined up: typically ${median(off.anchor).toFixed(1)}°, 19 in 20 within ${most(off.anchor).toFixed(1)}°`);
  assert.equal(anchor.at().corrected, true);
  assert.ok(median(off.anchor) < 2, `typical ${median(off.anchor)}`);
  assert.ok(most(off.anchor) < 4.5, `19 in 20 within ${most(off.anchor)}`);
});

test('a device that wanders three times as fast is followed just as well', (t) => {
  const { off } = wear({ drift: 5, seed: 5 });
  t.diagnostic(`error with the device wandering 5° a minute: typically ${median(off.anchor).toFixed(1)}°, 19 in 20 within ${most(off.anchor).toFixed(1)}°`);
  assert.ok(median(off.anchor) < 2.5, `typical ${median(off.anchor)}`);
  assert.ok(most(off.anchor) < 6, `19 in 20 within ${most(off.anchor)}`);
});

test('a compass thrown by something nearby does not come into it', (t) => {
  // Twice in ten minutes a compass reads 30 degrees out for 25 seconds: a line of parked cars, a rail bridge.
  const { off } = wear({ upsets: [[150, 175, 30], [420, 445, -30]], seed: 7 });
  t.diagnostic(`19 in 20 within: no compass ${most(off.anchor).toFixed(1)}°, compass with gyroscope ${most(off.fuser).toFixed(1)}°`);
  assert.ok(most(off.anchor) < 5);
  assert.ok(most(off.fuser) > most(off.anchor), 'the compass-led heading suffers where this one does not');
});

test('the known weakness: looking to one side for minutes is taken for wander, until the head comes back', (t) => {
  // It takes the middle of where the head points to be the way of travel. Run for three minutes looking 12 degrees
  // aside, at someone beside you say, and the heading follows the head; look ahead again and it comes back.
  const { off } = wear({ lean: 12, leanFrom: 120, leanUntil: 300, seed: 9 });
  const during = (from, to) => median(off.anchor.filter((_, i) => off.at[i] >= from && off.at[i] < to));
  const [before, late, after] = [during(60, 120), during(240, 300), during(420, 600)];
  t.diagnostic(`typical error before the look aside ${before.toFixed(1)}°, by its third minute ${late.toFixed(1)}°, two minutes after it ends ${after.toFixed(1)}°`);
  assert.ok(before < 2.5);
  assert.ok(late > 6 && late < 14, `while looking aside ${late}`);
  assert.ok(after < 3, `afterwards ${after}`);
});

test('before anything is known it passes the device heading through and says so', () => {
  const anchor = createTravelAnchor();
  assert.equal(anchor.at(), null);
  anchor.orientation(200, 0);
  assert.deepEqual(anchor.at(), { yaw: 200, offset: 0, corrected: false });
  anchor.travel(90, 0.2, 1); // standing: teaches nothing
  assert.equal(anchor.at().corrected, false);
  anchor.set(90);
  assert.equal(anchor.at().corrected, true);
  assert.ok(Math.abs(turn(90, anchor.at().yaw)) < 1e-9);
  anchor.orientation(215, 2);
  assert.ok(Math.abs(turn(105, anchor.at().yaw)) < 1e-9, 'a turn of the head shows at once, in full');
});
