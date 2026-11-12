import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSegmentTracker, ghostFromFixes, parseGpx, checkSegments } from '../index.js';
import { SCENARIOS, SHARED_RUN, simulate, GPS_NOISE, NO_NOISE } from '../../fixtures/generate.mjs';
import { path, steady, recording } from './helpers.js';

const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);

// A street running east for a kilometre, which a ghost ran at 3.3 m/s.
const street = path([[0, 0], [1000, 0]]);
const ghost = () => {
  const { route, ghost: profile } = ghostFromFixes(steady(street, 3.3), []);
  return { route, profile };
};

/** Run `points` at 3 m/s against a 3 m/s pace ghost and the street's ghost; one reading a second. */
function race(points, tracks = [ghost()]) {
  const tracker = createSegmentTracker({ secondsPerKm: 1000 / 3, tracks });
  return steady(points, 3).map((fix) => {
    tracker.update(fix);
    return tracker.at(fix.t);
  });
}
const biggestStep = (readings) => Math.max(...readings.slice(1).map((r, i) => Math.abs(r.timeGap - readings[i].timeGap)));

test('a recorded ghost takes over on the stretch the runner shares with it, and the gap carries on', () => {
  // Up a side street, 600 m east along the ghost's street, then off up another.
  // At 3 m/s: joins the street at 50 s, leaves it at 250 s.
  const readings = race(path([[200, -150], [200, 0], [800, 0], [800, 150]]));
  const first = readings.findIndex((r) => r.ghost === 'recording');
  const last = readings.findLastIndex((r) => r.ghost === 'recording');
  assert.ok(first >= 50 && first <= 56, `joined at ${first} s`);
  assert.ok(last >= 249 && last <= 255, `left at ${last} s`);
  assert.ok(readings.slice(first, last + 1).every((r) => r.ghost === 'recording' && r.track === 0), 'no flapping in between');

  // Before joining: level with a pace ghost at the same speed.
  near(readings[45].timeGap, 0, 1);
  assert.equal(readings[45].routeDist, null);
  // On the street: 3 m/s against the recording's 3.3 m/s loses about 0.091 s every second.
  near(readings[150].timeGap, -0.091 * 100, 1.5, 'half-way along');
  near(readings[150].routeDist, 500, 3);
  near(readings[150].ghostDist - readings[150].routeDist, -readings[150].distGap, 1e-6);
  // After leaving: what was lost on the street stays lost, and no more is.
  near(readings[260].timeGap, -0.091 * 200, 2);
  near(readings.at(-1).timeGap, readings[260].timeGap, 1);
  // And nowhere does the gap jump.
  assert.ok(biggestStep(readings) < 1, `biggest change in one second ${biggestStep(readings).toFixed(2)} s`);
});

test('running the same street the other way does not join the ghost', () => {
  const readings = race(path([[800, -150], [800, 0], [200, 0], [200, 150]]));
  assert.ok(readings.every((r) => r.ghost === 'pace'));
  near(readings.at(-1).timeGap, 0, 1.5);
});

test('a parallel street 30 m away does not join the ghost', () => {
  const readings = race(path([[100, 30], [900, 30]]));
  assert.ok(readings.every((r) => r.ghost === 'pace'));
});

test('crossing the ghost\'s street does not join it', () => {
  const readings = race(path([[500, -200], [500, 200]]));
  assert.ok(readings.every((r) => r.ghost === 'pace'));
});

test('with no recordings it is simply a pace ghost', () => {
  const readings = race(path([[0, 0], [600, 0]]), []);
  assert.ok(readings.every((r) => r.ghost === 'pace' && r.track === null));
  near(readings.at(-1).timeGap, 0, 1);
});

test('leaving a recording and rejoining it further on picks it up again', () => {
  // Along the street, round a block to the north, back onto the street.
  const readings = race(path([[100, 0], [400, 0], [400, 80], [600, 80], [600, 0], [900, 0]]));
  const modes = readings.map((r) => r.ghost);
  const changes = modes.filter((m, i) => i > 0 && m !== modes[i - 1]).length;
  assert.equal(changes, 3, `changes: ${modes.join('').replace(/pace/g, 'p').replace(/recording/g, 'R')}`);
  assert.equal(modes.at(-1), 'recording');
  near(readings.at(-1).routeDist, 900, 4);
  assert.ok(biggestStep(readings) < 1, `biggest change in one second ${biggestStep(readings).toFixed(2)} s`);
});

test('pausing holds the gap on a recording too', () => {
  const tracker = createSegmentTracker({ secondsPerKm: 1000 / 3, tracks: [ghost()] });
  const fixes = steady(path([[100, 0], [700, 0]]), 3);
  for (const fix of fixes.slice(0, 61)) tracker.update(fix);
  assert.equal(tracker.at(60).ghost, 'recording');
  const before = tracker.at(60).timeGap;
  tracker.pause(60);
  for (let t = 61; t <= 100; t++) tracker.update({ ...fixes[60], t });
  near(tracker.at(100).timeGap, before, 0.5);
  assert.equal(tracker.at(100).paused, true);
});

test('skipping a detour the ghost made is picked up again within seconds, at the right place', () => {
  // The ghost went 25 m up a side street at the 400 m mark and came back: 50 m further by its count.
  const detour = path([[0, 0], [400, 0], [400, 25], [400, 0], [1000, 0]]);
  const { route, ghost: profile } = ghostFromFixes(steady(detour, 3.3), []);
  const readings = race(path([[100, 0], [900, 0]]), [{ route, profile }]);
  // The runner passes the side street at 100 s.
  const away = readings.map((r, t) => (r.ghost === 'pace' && t > 20 ? t : null)).filter((t) => t != null);
  assert.ok(away.length > 0 && away.length <= 8, `on the pace ghost for ${away.length} s`);
  assert.ok(away[0] >= 98 && away.at(-1) <= 112, `from ${away[0]} s to ${away.at(-1)} s`);
  // At 150 s the runner is 450 m short of the far end of the ghost's street.
  near(readings[150].routeDist, route.length - 450, 4, 'place on the route afterwards');
  assert.ok(route.length > 1040, 'the detour is part of the route');
  assert.ok(biggestStep(readings) < 1, `biggest change in one second ${biggestStep(readings).toFixed(2)} s`);
});

test('stepping aside to wait, with the clock paused, does not move the gap', () => {
  // Along the street, 16 m aside to a kerb, a minute's wait, then back and on.
  const before = steady(path([[100, 0], [400, 0], [410, -16]]), 3);
  const waitUntil = before.at(-1).t + 60;
  const after = steady(path([[410, -16], [420, 0], [700, 0]]), 3).map((f) => ({ ...f, t: f.t + waitUntil }));
  const tracker = createSegmentTracker({ secondsPerKm: 1000 / 3, tracks: [ghost()] });
  const readings = [];
  const feed = (fix) => {
    tracker.update(fix);
    readings.push(tracker.at(fix.t));
  };
  before.forEach(feed);
  tracker.pause(before.at(-1).t);
  for (let t = before.at(-1).t + 1; t < waitUntil; t++) feed({ ...before.at(-1), t });
  tracker.resume(waitUntil);
  after.slice(1).forEach(feed);

  assert.ok(biggestStep(readings) < 1, `biggest change in one second ${biggestStep(readings).toFixed(2)} s`);
  assert.equal(readings.at(-1).ghost, 'recording');
  near(readings.at(-1).routeDist, 700, 4);
  // 3 m/s against 3.3 m/s over 600 m of street, less the little that stepping aside cost.
  near(readings.at(-1).timeGap, -0.091 * 200, 4);
});

test('joining where the ghost stood still does not jump the gap either', () => {
  // The ghost waited 30 s at the 500 m mark. The runner comes down a side
  // street, a little slower than their pace ghost, and joins right there.
  const to = steady(path([[0, 0], [500, 0]]), 3.3);
  const waited = Array.from({ length: 30 }, (_, k) => ({ ...to.at(-1), t: to.at(-1).t + 1 + k }));
  const on = steady(path([[500, 0], [1000, 0]]), 3.3).slice(1).map((f) => ({ ...f, t: f.t + waited.at(-1).t }));
  const { route, ghost: profile } = ghostFromFixes([...to, ...waited, ...on], []);
  assert.equal(profile.stops.length, 1);

  const tracker = createSegmentTracker({ secondsPerKm: 300, tracks: [{ route, profile }] });
  const readings = steady(path([[495, -150], [495, 0], [900, 0]]), 3).map((fix) => {
    tracker.update(fix);
    return tracker.at(fix.t);
  });
  const joined = readings.findIndex((r) => r.ghost === 'recording');
  assert.ok(joined >= 50 && joined <= 57, `joined at ${joined} s`);
  assert.ok(readings[joined].routeDist < 515, 'joined within the place the ghost stood');
  near(readings[joined].timeGap, readings[joined - 1].timeGap, 0.3, 'gap across the join');
  assert.ok(readings[joined].timeGap < -4, 'having lost about 5 s to the pace ghost by then');
});

// ---------------------------------------------------------------- B12 --
//
// fixtures/synthetic/run-shared.gpx is a made-up run that comes in from the
// west, shares about 800 m of the synthetic run's loop, and leaves to the
// east. Being made up, it is known exactly when it joins and leaves, and
// what the gap truly is.

const fixtures = new URL('../../fixtures/', import.meta.url);
const load = (path) => parseGpx(readFileSync(new URL(path, fixtures), 'utf8'));
const sharedPair = JSON.parse(readFileSync(new URL('index.json', fixtures), 'utf8')).pairs.find((p) => p.segments);

for (const clock of ['moving', 'elapsed']) {
  test(`B12, ${clock} clock: the recorded ghost takes over within 5 s of joining, hands back within 7 s of leaving, and the gap does not jump`, (t) => {
    const { switches, stretches, stats } = checkSegments([load(sharedPair.ghost)], load(sharedPair.runner), sharedPair.secondsPerKm, { clock });
    const { joinS, leaveS } = sharedPair.shared;
    t.diagnostic(`joins at ${joinS} s, leaves at ${leaveS} s; switches at ${switches.map((s) => `${s.t} s to ${s.to}`).join(', ')}; biggest jump at a switch ${stats.maxSwitchJump.toFixed(2)} s, biggest change in any second ${stats.maxStep.toFixed(2)} s`);
    assert.deepEqual(switches.map((s) => s.to), ['recording', 'pace'], 'one stretch on the recording');
    near(switches[0].t, joinS, 5, 'took over');
    // Two seconds longer than joining: one stray fix off the route must not
    // hand over, so leaving has to last a second before it counts.
    near(switches[1].t, leaveS, 7, 'handed back');
    assert.equal(stats.pass, true);
    assert.ok(stats.maxSwitchJump < 0.5, `jump at a switch ${stats.maxSwitchJump.toFixed(2)} s`);
    assert.ok(stats.maxStep < 1.5, `biggest change in one second ${stats.maxStep.toFixed(2)} s`);
    assert.deepEqual(stretches, [{ from: switches[0].t, to: switches[1].t, track: 0 }]);
    near(stats.onRecordingS, leaveS - joinS, 6);
    assert.equal(switches[1].routeDist, null, 'no place on a route once back on the pace ghost');
  });
}

/**
 * The made-up run replayed against the made-up ghost, with the true gap at
 * every reading: the set pace up to the moment of truly joining, the
 * recording's own pacing over the shared ground, the set pace again from the
 * moment of truly leaving. On clocks that never stop, so that nothing
 * depends on how a pause is detected.
 */
function againstTruth(noise) {
  const runner = simulate(SHARED_RUN, 'a', noise);
  const ghostRun = simulate(SCENARIOS[0], 'a', noise);
  const { live, switches } = checkSegments([recording(ghostRun.fixes)], recording(runner.fixes), sharedPair.secondsPerKm, { clock: 'elapsed' });
  const timeAt = (run, metres) => run.truth.findIndex((d) => d >= metres) * run.step;
  const distAt = (run, t) => run.truth[Math.min(run.truth.length - 1, Math.round(t / run.step))];
  const [ownFrom, ownTo] = SHARED_RUN.shares.own;
  const [routeFrom, routeTo] = SHARED_RUN.shares.route;
  const perMetre = sharedPair.secondsPerKm / 1000;
  const joined = timeAt(runner, ownFrom);
  const left = timeAt(runner, ownTo);
  const ghostTook = (metres) => timeAt(ghostRun, routeFrom + metres) - timeAt(ghostRun, routeFrom);
  const atJoin = ownFrom * perMetre - joined;
  const atLeave = atJoin + ghostTook(routeTo - routeFrom) - (left - joined);
  const trueGap = (t) => {
    const d = distAt(runner, t);
    if (t <= joined) return d * perMetre - t;
    if (t <= left) return atJoin + ghostTook(d - ownFrom) - (t - joined);
    return atLeave + (d - ownTo) * perMetre - (t - left);
  };
  const off = live.map((r) => r.timeGap - trueGap(r.t));
  return { live, switches, off, joined, left, gained: atLeave - atJoin, total: distAt(runner, live.at(-1).t) };
}
const worst = (values) => values.reduce((most, v) => Math.max(most, Math.abs(v)), 0);

test('B12: with perfect GPS the live gap is the true gap, on the shared stretch and off it', (t) => {
  const { live, switches, off, gained, total } = againstTruth(NO_NOISE);
  const [from, to] = switches.map((s) => s.t);
  const onStretch = off.slice(from + 5, to - 5);
  t.diagnostic(`worst difference ${worst(off).toFixed(2)} s, on the stretch ${worst(onStretch).toFixed(2)} s; at the end ${off.at(-1).toFixed(2)} s; the runner truly gains ${gained.toFixed(1)} s on the recording`);
  assert.ok(gained > 10, 'the runner gains on the recording over the shared stretch');
  assert.ok(worst(onStretch) < 0.5, `on the stretch, up to ${worst(onStretch).toFixed(2)} s from the truth`);
  // Off it, the sharp corner where the runner leaves costs the distance
  // count about 3 m (see odometer.js), which is a second at this pace.
  assert.ok(worst(off) < 2, `live gap up to ${worst(off).toFixed(2)} s from the truth`);
  near(live.at(-1).dist, total, 0.005 * total, 'distance covered');
});

test('B12: with GPS drift the recording\'s pacing is still followed to within 3 s over the shared stretch', (t) => {
  const { live, switches, off, total } = againstTruth(GPS_NOISE);
  // On the stretch, nothing depends on distance measured by GPS: only on
  // where the runner is on the ghost's route. So the live gap should move
  // as the true gap moves, from wherever it stood when the recording took over.
  const [from, to] = switches.map((s) => s.t);
  const onStretch = off.slice(from + 5, to - 5).map((d) => d - off[from + 5]);
  t.diagnostic(`on the stretch the live gap strays up to ${worst(onStretch).toFixed(2)} s from the true change; at the end it is ${off.at(-1).toFixed(1)} s from the truth, with distance measured ${(100 * (live.at(-1).dist / total - 1)).toFixed(1)}% out`);
  assert.ok(worst(onStretch) < 3, `strays ${worst(onStretch).toFixed(2)} s`);
  // Off the stretch the gap is only as good as distance measured by GPS,
  // which on a run this short, with this much drift, is a few percent out.
  near(live.at(-1).dist, total, 0.03 * total, 'distance covered');
  assert.ok(Math.abs(off.at(-1)) < 9, `at the end ${off.at(-1).toFixed(1)} s from the truth`);
});
