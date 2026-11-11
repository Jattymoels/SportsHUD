import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseGpx,
  createOdometer,
  measureDistance,
  speedOfPace,
  paceOf,
  paceGapAt,
  createPaceTracker,
  checkPace,
} from '../index.js';
import { SCENARIOS, simulate, NO_NOISE } from '../../fixtures/generate.mjs';
import { at, path, steady, recording, noise } from './helpers.js';

const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);

const loop = path([[0, 0], [300, 0], [300, 300], [0, 300], [0, 5]]);
const straight = path([[0, 0], [600, 0]]);

test('odometer measures distance covered with no route', () => {
  const odometer = createOdometer();
  assert.equal(odometer.at(0), null);
  for (const fix of steady(straight, 3).slice(0, 101)) odometer.update(fix);
  const now = odometer.at(100);
  near(now.dist, 300, 1, 'dist');
  near(now.speed, 3, 0.05, 'speed');
  // Between fixes it carries on at the current speed.
  near(odometer.at(101.5).dist, 304.5, 1);
  assert.equal(odometer.at(101.5).fixAge, 1.5);
});

test('odometer counts round corners, cutting each by no more than a couple of metres', () => {
  const profile = measureDistance(steady(loop, 3));
  near(profile.dist.at(-1), 1195, 8); // four right-angle corners
});

test('odometer adds almost nothing while standing still under GPS wobble', () => {
  const odometer = createOdometer();
  const rand = noise(3);
  for (let t = 0; t <= 300; t++) odometer.update({ t, ...at(2 * rand(), 2 * rand()) });
  assert.ok(odometer.at(300).dist < 4, `counted ${odometer.at(300).dist.toFixed(1)} m while standing for 5 minutes`);
  near(odometer.at(300).speed, 0, 0.1);
});

test('odometer counts both ways on an out-and-back', () => {
  const profile = measureDistance(steady(path([[0, 0], [200, 0], [0, 0]]), 3));
  near(profile.dist.at(-1), 400, 10);
});

test('pace and speed convert, and gaps to a pace ghost have the usual signs', () => {
  near(speedOfPace(300), 3.3333, 1e-4); // 5:00 per km
  // Ghost at 4 m/s. After 100 s it has gone 400 m.
  assert.deepEqual(paceGapAt(4, 100, 440), { timeGap: 10, distGap: 40, ghostDist: 400 });
  assert.deepEqual(paceGapAt(4, 100, 360), { timeGap: -10, distGap: -40, ghostDist: 400 });
});

test('pace tracker: ahead of a slower ghost, behind a faster one', () => {
  const fixes = steady(straight, 3).slice(0, 181);
  const gapTo = (speed) => {
    const tracker = createPaceTracker(speed);
    for (const fix of fixes) tracker.update(fix);
    return tracker.at(180);
  };
  // 540 m in 180 s. A 2.7 m/s ghost needs 200 s for that; a 3.6 m/s ghost needs 150 s.
  near(gapTo(2.7).timeGap, 20, 0.5);
  near(gapTo(2.7).distGap, 54, 1.5);
  near(gapTo(3.6).timeGap, -30, 0.5);
  near(gapTo(3).timeGap, 0, 0.4);
});

test('pace tracker: the ghost waits while the runner\'s clock is paused', () => {
  const fixes = steady(straight, 3);
  const tracker = createPaceTracker(3);
  for (const fix of fixes.slice(0, 61)) tracker.update(fix);
  tracker.pause(60);
  for (let t = 61; t <= 120; t++) tracker.update({ ...fixes[60], t }); // standing for a minute
  const waiting = tracker.at(120);
  assert.equal(waiting.paused, true);
  assert.equal(waiting.time, 60);
  near(waiting.ghostDist, 180, 1e-9);
  near(waiting.timeGap, 0, 0.5);
  tracker.resume(120);
  for (const fix of fixes.slice(61, 121)) tracker.update({ ...fix, t: fix.t + 60 });
  near(tracker.at(180).timeGap, 0, 0.5);
  // Without the pause, the same minute standing costs a minute.
  const unpaused = createPaceTracker(3);
  for (const fix of fixes.slice(0, 61)) unpaused.update(fix);
  for (let t = 61; t <= 120; t++) unpaused.update({ ...fixes[60], t });
  near(unpaused.at(120).timeGap, -60, 0.5);
});

test('paceOf gives a recording\'s average pace, with or without its pauses', () => {
  // 600 m at 3 m/s, with a 100 s hole (a paused watch) half-way.
  const fixes = steady(straight, 3).map((f) => (f.t > 100 ? { ...f, t: f.t + 100 } : f));
  const moving = paceOf(recording(fixes));
  near(moving.distance, 600, 2);
  near(moving.time, 200, 1e-9);
  near(moving.secondsPerKm, 333.3, 1.5);
  const elapsed = paceOf(recording(fixes), { clock: 'elapsed' });
  near(elapsed.time, 300, 1e-9);
  near(elapsed.secondsPerKm, 500, 2);
});

test('checkPace: a recording against its own average pace finishes level', () => {
  const rec = recording(steady(loop, 3));
  const { live, stats } = checkPace(rec, paceOf(rec).secondsPerKm);
  assert.equal(stats.pass, true, `misses at t = ${stats.misses}`);
  assert.equal(stats.tickS, 1);
  near(live.at(-1).timeGap, 0, 1);
  near(stats.distance.live, stats.distance.afterwards, 2);
});

// The pace ghost on the fixture recordings. Proposed as behaviour B11.
const fixtures = new URL('../../fixtures/', import.meta.url);
const { pairs } = JSON.parse(readFileSync(new URL('index.json', fixtures), 'utf8'));
for (const clock of ['moving', 'elapsed']) {
  for (const pair of pairs.filter((p) => p.synthetic)) {
    test(`pace ghost, ${pair.id}, ${clock} clock: live gap within 3 s of the gap computed afterwards`, (t) => {
      const rec = parseGpx(readFileSync(new URL(pair.runner, fixtures), 'utf8'));
      const pace = paceOf(rec, { clock }).secondsPerKm;
      // A ghost 5% quicker than the recording's own average.
      const { stats, live } = checkPace(rec, pace * 0.95, { clock });
      t.diagnostic(`${(100 * stats.within).toFixed(1)}% within ${stats.targetS} s, worst ${stats.maxTimeError.toFixed(2)} s, final gap ${live.at(-1).timeGap.toFixed(0)} s`);
      assert.ok(stats.samples > 300);
      assert.equal(stats.pass, true, `readings outside 3 s at t = ${stats.misses}`);
      assert.equal(stats.withinSameInstant, 1);
      assert.ok(stats.p95TimeError < 1);
      assert.ok(live.at(-1).timeGap < 0, 'finishes behind a quicker ghost');
    });
  }
}

// Against the truth: a pace ghost is only as right as the distance measured.
for (const scenario of SCENARIOS) {
  test(`pace ghost, ${scenario.id}: distance measured within 2% of the true distance, with GPS drift`, () => {
    for (const who of ['a', 'b']) {
      for (const seedShift of [0, 100, 200]) {
        const shifted = { ...scenario, efforts: { ...scenario.efforts, [who]: { ...scenario.efforts[who], seed: scenario.efforts[who].seed + seedShift } } };
        const measured = measureDistance(simulate(shifted, who).fixes).dist.at(-1);
        const error = measured / scenario.path.length - 1;
        assert.ok(Math.abs(error) < 0.02, `${who}, seed +${seedShift}: ${(100 * error).toFixed(2)}% out`);
      }
    }
  });

  test(`pace ghost, ${scenario.id}: with perfect GPS the live gap follows the true gap`, () => {
    const run = simulate({ ...scenario, efforts: { ...scenario.efforts, b: { ...scenario.efforts.b, autoPause: false } } }, 'b', NO_NOISE);
    const speed = scenario.efforts.b.speed;
    const { live } = checkPace(recording(run.fixes), 1000 / speed, { clock: 'elapsed' });
    for (const s of live) {
      const trueDist = run.truth[Math.min(run.truth.length - 1, Math.round(s.t / run.step))];
      const trueGap = trueDist / speed - s.t;
      // Corners cut by the odometer cost up to half a percent of the distance; allow 1% of the time, plus 2 s.
      near(s.timeGap, trueGap, 2 + 0.01 * s.t, `t=${s.t}`);
    }
  });
}
