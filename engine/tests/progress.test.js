import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRoute,
  snapToRoute,
  createProgressTracker,
  projectRecording,
  monotone,
  distAtTime,
  timeAtDist,
} from '../index.js';
import { at, path, steady, noise } from './helpers.js';

const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);

const straight = path([[0, 0], [400, 0]]);

test('tracker follows steady movement and reports speed', () => {
  const route = buildRoute(straight);
  const tracker = createProgressTracker(route);
  assert.equal(tracker.at(0), null);
  for (const fix of steady(straight, 3).slice(0, 61)) tracker.update(fix);
  const now = tracker.at(60);
  near(now.dist, 180, 0.3, 'dist');
  near(now.speed, 3, 0.05, 'speed');
  near(now.offset, 0, 0.05, 'offset');
  assert.equal(now.fixAge, 0);
});

test('between fixes the position carries on at the current speed', () => {
  const route = buildRoute(straight);
  const tracker = createProgressTracker(route);
  for (const fix of steady(straight, 3).slice(0, 61)) tracker.update(fix);
  const later = tracker.at(62.5);
  near(later.dist, 187.5, 0.4);
  assert.equal(later.fixAge, 2.5);
});

test('tracker is steadier than raw snapping when fixes are noisy', () => {
  const route = buildRoute(straight);
  const tracker = createProgressTracker(route);
  const rand = noise(7);
  let rawSq = 0;
  let trackedSq = 0;
  let n = 0;
  for (const fix of steady(straight, 3)) {
    const truth = fix.t * 3;
    const noisy = { ...fix, ...at(truth + 4 * rand(), 4 * rand()) };
    tracker.update(noisy);
    if (fix.t < 10) continue; // let the speed estimate settle
    rawSq += (snapToRoute(route, noisy.lat, noisy.lon).dist - truth) ** 2;
    trackedSq += (tracker.at(fix.t).dist - truth) ** 2;
    n++;
  }
  const raw = Math.sqrt(rawSq / n);
  const tracked = Math.sqrt(trackedSq / n);
  assert.ok(tracked < 0.75 * raw, `tracked error ${tracked.toFixed(2)} m should be well under raw ${raw.toFixed(2)} m`);
});

test('tracker keeps to the right leg through a turnaround', () => {
  const points = path([[0, 0], [150, 0], [0, 0]]);
  const route = buildRoute(points);
  const tracker = createProgressTracker(route);
  for (const fix of steady(points, 3)) {
    tracker.update(fix);
    near(tracker.at(fix.t).dist, fix.t * 3, 1.5, `t=${fix.t}`);
  }
});

test('fixes that do not move time forward are ignored', () => {
  const route = buildRoute(straight);
  const tracker = createProgressTracker(route);
  const fixes = steady(straight, 3);
  for (const fix of fixes.slice(0, 31)) tracker.update(fix);
  const before = tracker.at(30);
  tracker.update({ ...fixes[90], t: 30 });
  tracker.update({ ...fixes[90], t: 12 });
  assert.deepEqual(tracker.at(30), before);
});

test('an inaccurate fix moves the estimate less than an accurate one', () => {
  const route = buildRoute(straight);
  const run = (accuracy) => {
    const tracker = createProgressTracker(route);
    for (const fix of steady(straight, 3).slice(0, 31)) tracker.update(fix);
    tracker.update({ t: 31, ...at(93 + 15, 0), accuracy });
    return tracker.at(31).dist;
  };
  assert.ok(run(40) < run(5) - 3);
});

test('cutting a corner: progress is held while off the route, then picked up where the route is rejoined', () => {
  // Route goes 300 m east then 300 m north. The runner leaves it 60 m before
  // the corner and cuts straight across to 60 m after it.
  const route = buildRoute(path([[0, 0], [300, 0], [300, 300]]));
  const taken = path([[0, 0], [240, 0], [300, 60], [300, 300]]);
  const tracker = createProgressTracker(route);
  let held = 0;
  let fastest = 0;
  for (const fix of steady(taken, 3)) {
    tracker.update(fix);
    const now = tracker.at(fix.t);
    if (now.offRoute) held++;
    fastest = Math.max(fastest, now.speed);
    if (fix.t === 60) near(now.dist, 180, 1, 'before the shortcut');
    if (fix.t === 90) assert.equal(now.offRoute, true, 'mid-shortcut, 30 m from the route');
    if (fix.t === 90) assert.ok(now.dist > 230 && now.dist < 300, `held at ${now.dist.toFixed(0)} m`);
    // 85 m of shortcut replaces 120 m of route, so by t = 140 the runner is 35 m further along than 3 m/s alone would give.
    if (fix.t === 140) near(now.dist, 140 * 3 + 120 - Math.hypot(60, 60), 3, 'after rejoining');
  }
  assert.ok(held >= 5 && held <= 30, `held for ${held} s`);
  assert.ok(fastest < 4, `speed estimate reached ${fastest.toFixed(1)} m/s for a 3 m/s runner`);
});

test('skipping a detour the route makes: progress is picked up where the runner is, not short of it', () => {
  // The route goes 25 m up a side street at the 400 m mark and back. The
  // runner goes straight past, so the route ahead of them is 50 m further
  // along than the search expects.
  const route = buildRoute(path([[0, 0], [400, 0], [400, 25], [400, 0], [1000, 0]]));
  const tracker = createProgressTracker(route);
  let held = 0;
  let shortBy = 0;
  for (const fix of steady(path([[0, 0], [1000, 0]]), 3)) {
    tracker.update(fix);
    const now = tracker.at(fix.t);
    if (now.offRoute) held++;
    // Once picked up again, the runner is as far from the end of the route as from the end of their own line.
    else if (held > 0) shortBy = Math.max(shortBy, route.length - (1000 - fix.t * 3) - now.dist);
  }
  assert.ok(held > 0 && held <= 25, `held for ${held} s`);
  assert.ok(shortBy < 4, `picked up ${shortBy.toFixed(1)} m short of where the runner was`);
});

test('far from the route but travelling along it still counts as on it', () => {
  // The other side of a wide road: 25 m to one side, same direction.
  const route = buildRoute(straight);
  const tracker = createProgressTracker(route);
  for (const fix of steady(path([[0, 25], [400, 25]]), 3)) {
    tracker.update(fix);
    const now = tracker.at(fix.t);
    if (fix.t < 2) continue; // no direction of travel yet
    assert.equal(now.offRoute, false, `t=${fix.t}`);
    if (fix.t >= 10) near(now.dist, fix.t * 3, 1.5, `t=${fix.t}`); // once the speed estimate has settled
  }
});

test('hindsight does not reach across a stretch off the route', () => {
  const route = buildRoute(path([[0, 0], [300, 0], [300, 300]]));
  const fixes = steady(path([[0, 0], [240, 0], [300, 60], [300, 300]]), 3);
  const profile = projectRecording(route, fixes);
  const tracker = createProgressTracker(route);
  fixes.forEach((fix, i) => {
    tracker.update(fix);
    // Afterwards and live agree to within a few metres throughout, including at the jump.
    near(profile.dist[i], tracker.at(fix.t).dist, 4, `t=${fix.t}`);
  });
});

test('projectRecording gives progress for a whole recording', () => {
  const route = buildRoute(straight);
  const fixes = steady(straight, 2.5);
  const profile = projectRecording(route, fixes);
  assert.equal(profile.t.length, fixes.length);
  for (let i = 0; i < fixes.length; i += 10) near(profile.dist[i], fixes[i].t * 2.5, 0.3, `t=${fixes[i].t}`);
});

test('profile lookups interpolate and hold at the ends', () => {
  const profile = { t: Float64Array.from([0, 10, 20, 30]), dist: Float64Array.from([0, 30, 30, 90]) };
  assert.equal(distAtTime(profile, -5), 0);
  assert.equal(distAtTime(profile, 5), 15);
  assert.equal(distAtTime(profile, 15), 30);
  assert.equal(distAtTime(profile, 25), 60);
  assert.equal(distAtTime(profile, 99), 90);

  assert.equal(timeAtDist(profile, -1), 0);
  assert.equal(timeAtDist(profile, 15), 5);
  assert.equal(timeAtDist(profile, 30), 10, 'a stop counts from when it was first reached');
  assert.equal(timeAtDist(profile, 30.6), 20.1);
  assert.equal(timeAtDist(profile, 60), 25);
  assert.equal(timeAtDist(profile, 500), 30);
});

test('monotone removes backward steps without touching the original', () => {
  const profile = { t: Float64Array.from([0, 1, 2, 3]), dist: Float64Array.from([0, 5, 4, 9]) };
  assert.deepEqual(Array.from(monotone(profile).dist), [0, 5, 5, 9]);
  assert.deepEqual(Array.from(profile.dist), [0, 5, 4, 9]);
});
