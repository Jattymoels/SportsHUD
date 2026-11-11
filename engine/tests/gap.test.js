import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareGhost,
  gapAt,
  createGapTracker,
  compareGapSeries,
  createReplay,
  checkB1,
  toFixes,
} from '../index.js';
import { path, steady, recording } from './helpers.js';

const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);

const loop = path([[0, 0], [300, 0], [300, 300], [0, 300], [0, 5]]);

test('positive gaps mean ahead of the ghost, negative mean behind', () => {
  // Ghost at a steady 3 m/s.
  const ghost = { t: Float64Array.from([0, 200]), dist: Float64Array.from([0, 600]) };
  const ahead = gapAt(ghost, 100, 330);
  near(ahead.ghostDist, 300, 1e-9);
  near(ahead.distGap, 30, 1e-9);
  near(ahead.timeGap, 10, 1e-9);
  const behind = gapAt(ghost, 100, 240);
  near(behind.distGap, -60, 1e-9);
  near(behind.timeGap, -20, 1e-9);
});

test('passing a spot where the ghost stood still jumps the time gap by the length of the stop', () => {
  // Ghost runs 300 m in 100 s, stands for 30 s, then runs on.
  const ghost = { t: Float64Array.from([0, 100, 130, 230]), dist: Float64Array.from([0, 300, 300, 600]) };
  near(gapAt(ghost, 105, 299.7).timeGap, -5.1, 1e-6);
  near(gapAt(ghost, 105, 300.3).timeGap, 25.1, 1e-6);
  // The distance gap does not jump.
  near(gapAt(ghost, 105, 299.7).distGap, -0.3, 1e-6);
  near(gapAt(ghost, 105, 300.3).distGap, 0.3, 1e-6);
});

test('a recording raced against itself has no gap', () => {
  const rec = recording(steady(loop, 3));
  const { live, stats } = checkB1(rec, rec);
  assert.ok(stats.samples > 300);
  for (const s of live.slice(0, stats.samples)) {
    near(s.timeGap, 0, 0.3, `time gap at t=${s.t}`);
    near(s.distGap, 0, 1, `distance gap at t=${s.t}`);
  }
});

test('a steadily slower effort falls behind by the expected amount', () => {
  // Ghost 3 m/s, runner 2.5 m/s: after t seconds the runner has covered
  // 2.5t m, which the ghost reached at 2.5t/3 s. So the gap is -t/6 s and -0.5t m.
  const { live, stats } = checkB1(recording(steady(loop, 3)), recording(steady(loop, 2.5)));
  assert.ok(stats.samples > 450);
  for (const s of live.slice(5, 390)) { // the ghost finishes just before t=400
    near(s.timeGap, -s.t / 6, 0.4, `time gap at t=${s.t}`);
    near(s.distGap, -0.5 * s.t, 1.5, `distance gap at t=${s.t}`);
  }
});

test('a faster effort gets ahead, and the gap freezes once it finishes', () => {
  const { route, ghost } = prepareGhost(recording(steady(loop, 3)));
  const runner = steady(loop, 4);
  const tracker = createGapTracker(route, ghost);
  let finish = null;
  for (const fix of runner) {
    tracker.update(fix);
    const s = tracker.at(fix.t);
    if (s.finished && !finish) finish = s;
  }
  assert.ok(finish, 'runner should finish');
  // 1195 m at 4 m/s against 3 m/s: about 100 s ahead at the line.
  near(finish.timeGap, route.length / 3 - route.length / 4, 4);
  const later = tracker.at(finish.t + 60);
  assert.equal(later.timeGap, finish.timeGap);
  assert.equal(later.t, finish.t + 60);
});

test('a replay hands over a reading every second, including between sparse fixes', () => {
  const { route, ghost } = prepareGhost(recording(steady(loop, 3)));
  const runner = steady(loop, 3).filter((f) => f.t % 5 === 0); // a fix every 5 s
  const replay = createReplay(route, ghost, runner);
  const first = replay.advanceTo(62.4);
  assert.deepEqual(first.map((s) => s.t), Array.from({ length: 63 }, (_, i) => i));
  assert.equal(first[62].fixAge, 2);
  near(first[62].dist, 186, 1.5);
  near(first[62].timeGap, 0, 0.5);
  // Carrying on does not repeat or skip readings.
  assert.deepEqual(replay.advanceTo(65).map((s) => s.t), [63, 64, 65]);
  replay.reset();
  assert.deepEqual(replay.advanceTo(1).map((s) => s.t), [0, 1]);
});

test('compareGapSeries: same-instant and with-slack scoring', () => {
  const series = (gaps) => gaps.map((timeGap, t) => ({ t, timeGap, distGap: 0, finished: false }));
  // Afterwards jumps +30 s at t=10; live makes the same jump one second later.
  const afterwards = series(Array.from({ length: 20 }, (_, t) => (t < 10 ? -5 : 25)));
  const late = series(Array.from({ length: 20 }, (_, t) => (t < 11 ? -5 : 25)));
  let stats = compareGapSeries(late, afterwards);
  assert.equal(stats.samples, 20);
  assert.equal(stats.maxTimeError, 30);
  assert.deepEqual(stats.sameInstantMisses, [10]);
  assert.equal(stats.withinSameInstant, 0.95);
  assert.equal(stats.within, 1);
  assert.equal(stats.pass, true);

  // A reading that is simply wrong fails either way.
  const wrong = series(Array.from({ length: 20 }, (_, t) => (t < 10 ? -5 : 25) + (t === 4 ? 6 : 0)));
  stats = compareGapSeries(wrong, afterwards);
  assert.deepEqual(stats.misses, [4]);
  assert.equal(stats.maxTimeErrorWithSlack, 6);
  assert.equal(stats.pass, false);

  // A jump that lands later than the slack allows fails too.
  const tooLate = series(Array.from({ length: 20 }, (_, t) => (t < 14 ? -5 : 25)));
  assert.deepEqual(compareGapSeries(tooLate, afterwards).misses, [12, 13]);
});

test('compareGapSeries stops at the finish', () => {
  const live = [0, 1, 2, 3].map((t) => ({ t, timeGap: 1, distGap: 3, finished: t >= 2 }));
  const afterwards = [0, 1, 2, 3].map((t) => ({ t, timeGap: 1, distGap: 3, finished: t >= 3 }));
  assert.equal(compareGapSeries(live, afterwards).samples, 2);
  assert.equal(compareGapSeries([], []).pass, false);
});

test('a ghost needs timestamps', () => {
  const rec = recording(steady(loop, 3));
  rec.points.forEach((p) => (p.time = null));
  assert.throws(() => prepareGhost(rec), /no timestamps/);
  assert.throws(() => toFixes(rec), /no timestamps/);
});
