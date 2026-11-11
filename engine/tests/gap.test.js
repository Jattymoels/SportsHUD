import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareGhost,
  findStops,
  findPauses,
  movingTime,
  gapAt,
  createGapTracker,
  compareGapSeries,
  fillGaps,
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

/** A profile from [time, distance] pairs, one sample a second between them. */
function profileOf(points) {
  const t = [];
  const dist = [];
  for (let i = 1; i < points.length; i++) {
    const [t0, d0] = points[i - 1];
    const [t1, d1] = points[i];
    for (let s = t0; s < t1; s++) {
      t.push(s);
      dist.push(d0 + ((s - t0) / (t1 - t0)) * (d1 - d0));
    }
  }
  t.push(points.at(-1)[0]);
  dist.push(points.at(-1)[1]);
  return { t: Float64Array.from(t), dist: Float64Array.from(dist) };
}

test('findStops finds where a profile stood still', () => {
  // 3 m/s, a 40 s wait at 300 m, on to 600 m, a 5 s hesitation, on to 900 m.
  const profile = profileOf([[0, 0], [100, 300], [140, 300], [240, 600], [245, 600], [345, 900]]);
  assert.deepEqual(findStops(profile), [{ lo: 285, hi: 315, arrive: 100, depart: 140 }]);
});

test('findStops counts a hole in the recording as a stop, but not sparse fixes', () => {
  // Fixes every second, then nothing for 60 s while 6 m is covered: a pause.
  const paused = { t: Float64Array.from([0, 1, 2, 3, 63, 64, 65, 66]), dist: Float64Array.from([0, 3, 6, 9, 15, 18, 21, 24]) };
  assert.deepEqual(findStops(paused), [{ lo: -6, hi: 30, arrive: 3, depart: 63 }]);
  // A fix every 6 s at a steady 3 m/s is just a sparse recording.
  const sparse = { t: Float64Array.from([0, 6, 12, 18, 24]), dist: Float64Array.from([0, 18, 36, 54, 72]) };
  assert.deepEqual(findStops(sparse), []);
});

test('findStops does not mistake a steady slow walker for someone standing', () => {
  assert.deepEqual(findStops(profileOf([[0, 0], [1000, 400]])), []); // 0.4 m/s throughout
});

test('findStops merges stops that are close together', () => {
  const profile = profileOf([[0, 0], [100, 300], [130, 300], [136, 318], [166, 318], [266, 618]]);
  assert.deepEqual(findStops(profile), [{ lo: 285, hi: 333, arrive: 100, depart: 166 }]);
});

test('around a ghost stop the time gap is measured against the whole stay', () => {
  const ghost = profileOf([[0, 0], [100, 300], [140, 300], [240, 600]]);
  ghost.stops = findStops(ghost);
  // Waiting at the same crossing, a few metres either side of where the ghost stood:
  for (const dist of [292, 300, 311]) {
    assert.equal(gapAt(ghost, 90, dist).timeGap > 0, true, 'ahead until the ghost arrives');
    assert.equal(gapAt(ghost, 100, dist).timeGap, 0);
    assert.equal(gapAt(ghost, 120, dist).timeGap, 0, 'level while both are there');
    assert.equal(gapAt(ghost, 140, dist).timeGap, 0);
    assert.equal(gapAt(ghost, 150, dist).timeGap < 0, true, 'behind once the ghost has left');
  }
  // The ghost left its waiting spot at 140 s, and passed 11 m beyond it 3.7 s later.
  near(gapAt(ghost, 150, 292).timeGap, -10, 1e-9);
  near(gapAt(ghost, 150, 311).timeGap, -6.33, 0.01);
  // Arriving before the ghost, the gap counts down to its arrival wherever in the zone you stand.
  near(gapAt(ghost, 80, 296).timeGap, 18.7, 0.05);
  near(gapAt(ghost, 80, 310).timeGap, 20, 1e-9);
  // Outside the zone it is the ordinary gap again.
  near(gapAt(ghost, 80, 270).timeGap, 10, 1e-9);
  near(gapAt(ghost, 150, 330).timeGap, 0, 1e-9);
  near(gapAt(ghost, 130, 330).timeGap, 20, 1e-9);
});

test('fillGaps fills holes in a recording with one fix a second', () => {
  const fixes = [
    { t: 0, lat: 10, lon: 20 },
    { t: 1, lat: 10.001, lon: 20 },
    { t: 5, lat: 10.005, lon: 20.004 },
    { t: 6.5, lat: 10.006, lon: 20.004 },
  ];
  const filled = fillGaps(fixes);
  assert.deepEqual(filled.map((f) => f.t), [0, 1, 2, 3, 4, 5, 5.75, 6.5]);
  near(filled[3].lat, 10.003, 1e-9);
  near(filled[3].lon, 20.002, 1e-9);
  assert.equal(filled[1], fixes[1]);
  assert.deepEqual(fillGaps(fixes.slice(0, 2)), fixes.slice(0, 2));
});

// Ghost runs 300 m, stands 60 s, runs on. Runner sets off 10 s later, stands
// 20 s at the same crossing, runs on. Neither watch saved anything while standing.
function crossingPair() {
  const hole = (fixes, from, seconds) => [...fixes.slice(0, from + 1), ...fixes.slice(from + 1).map((f) => ({ ...f, t: f.t + seconds }))];
  const ghostFixes = hole(steady(loop, 3), 100, 60);
  const runnerFixes = hole(steady(loop, 3).map((f) => ({ ...f, t: f.t + 10 })), 100, 20);
  runnerFixes.unshift({ ...runnerFixes[0], t: 0 });
  return [recording(ghostFixes), recording(runnerFixes)];
}

test('findPauses finds the holes a paused watch leaves, but not sparse fixes', () => {
  const [ghost, runner] = crossingPair();
  assert.deepEqual(findPauses(toFixes(ghost)), [{ start: 100, end: 161 }]);
  // The runner also stood for the first 10 s before setting off.
  assert.deepEqual(findPauses(toFixes(runner)), [{ start: 0, end: 10 }, { start: 110, end: 131 }]);
  const sparse = steady(loop, 3).filter((f) => f.t % 6 === 0);
  assert.deepEqual(findPauses(sparse), []);
});

test('movingTime leaves paused time out', () => {
  const pauses = [{ start: 100, end: 160 }, { start: 300, end: 310 }];
  assert.equal(movingTime(pauses, 50), 50);
  assert.equal(movingTime(pauses, 100), 100);
  assert.equal(movingTime(pauses, 130), 100);
  assert.equal(movingTime(pauses, 200), 140);
  assert.equal(movingTime(pauses, 305), 240);
  assert.equal(movingTime(pauses, 400), 330);
  assert.equal(movingTime([], 400), 400);
});

test('pausing stops the runner\'s clock but not the tracking', () => {
  const { route, ghost } = prepareGhost(recording(steady(loop, 3)));
  const tracker = createGapTracker(route, ghost);
  const fixes = steady(loop, 3);
  for (const fix of fixes.slice(0, 101)) tracker.update(fix);
  near(tracker.at(100).timeGap, 0, 0.3);
  tracker.pause(100);
  tracker.pause(105); // already paused: no effect
  // Standing for 40 s: the same position reported each second.
  for (let t = 101; t <= 140; t++) tracker.update({ ...fixes[100], t });
  const waiting = tracker.at(140);
  assert.equal(waiting.paused, true);
  assert.equal(waiting.time, 100);
  near(waiting.timeGap, 0, 0.5, 'gap holds while paused');
  tracker.resume(140);
  tracker.resume(150); // not paused: no effect
  for (const fix of fixes.slice(101, 161)) tracker.update({ ...fix, t: fix.t + 40 });
  const later = tracker.at(200);
  assert.equal(later.paused, false);
  assert.equal(later.time, 160);
  near(later.dist, 480, 1.5);
  near(later.timeGap, 0, 0.5, 'and is unchanged afterwards');
});

test('waiting at the same crossing: on the moving clock the waits do not count', () => {
  const [ghost, runner] = crossingPair();
  const result = checkB1(ghost, runner);
  const { live, stats } = result;
  assert.equal(stats.clock, 'moving');
  assert.deepEqual(stats.pausedS, { runner: 31, ghost: 61 });
  assert.equal(result.ghost.stops.length, 0, 'the ghost\'s wait is gone from its clock');
  assert.equal(stats.pass, true, `misses at t = ${stats.misses}`);
  // Same pace, same route: level all the way, whoever waited longer.
  for (const t of [20, 100, 115, 128, 150, 300]) near(live[t].timeGap, 0, 1, `t=${t}`);
  assert.equal(live[120].paused, true);
  assert.equal(live[120].time, 100);
});

test('waiting at the same crossing: on the elapsed clock the waits count', () => {
  const [ghost, runner] = crossingPair();
  const { live, stats, ghost: prepared } = checkB1(ghost, runner, { clock: 'elapsed' });
  assert.equal(stats.clock, 'elapsed');
  assert.deepEqual(stats.pausedS, { runner: 0, ghost: 0 });
  assert.equal(prepared.stops.length, 1);
  assert.equal(stats.pass, true, `misses at t = ${stats.misses}`);
  assert.equal(stats.maxFixAge, 0);
  const at = (t) => live[t].timeGap;
  near(at(100), -10, 1, 'behind on the way in');
  near(at(120), 0, 0.5, 'level while both stand at the crossing');
  near(at(128), 0, 0.5);
  near(at(150), 30, 1.5, 'ahead after leaving 30 s before the ghost did');
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
