// Route guide: turns, climbs and waiting places worked out from recordings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRoute, buildGuide, groupRuns, elevationAlong, upsAndDowns, findTurns, agreedTurns, findPausePoints, distanceMarkers, upcoming, nextCue, parseGpx } from '../index.js';
import { SCENARIOS, terrain } from '../../fixtures/generate.mjs';
import { path, steady, recording, noise } from './helpers.js';

const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);

// ---------------------------------------------------------------- turns --

test('a corner is a turn, with its side, angle and place along the route', () => {
  // 300 m east, then north: a left turn. Then east again: a right turn.
  const turns = findTurns(buildRoute(path([[0, 0], [300, 0], [300, 200], [600, 200]])));
  assert.deepEqual(turns.map((t) => [t.side, t.shape]), [['left', 'turn'], ['right', 'turn']]);
  near(turns[0].dist, 300, 6, 'first corner');
  near(turns[0].angle, 90, 8);
  near(turns[1].dist, 500, 8, 'second corner');
});

test('a hairpin is sharp, and doubling back is called that', () => {
  // East, then back to the west-north-west: a hairpin to the left.
  const hairpin = findTurns(buildRoute(path([[0, 0], [300, 0], [100, 115]])));
  assert.equal(hairpin.length, 1);
  assert.equal(hairpin[0].side, 'left');
  assert.ok(hairpin[0].shape === 'sharp' || hairpin[0].shape === 'back', hairpin[0].shape);
  // Out and straight back along the same line.
  const outAndBack = findTurns(buildRoute(path([[0, 0], [300, 0], [0, 0]])));
  assert.equal(outAndBack.length, 1);
  assert.equal(outAndBack[0].shape, 'back');
  near(outAndBack[0].dist, 300, 8);
});

test('a gentle bend and the wobble of a GPS line are not turns', () => {
  // A quarter circle of 150 m radius.
  const arc = [];
  for (let a = 0; a <= 90; a += 0.4) arc.push([150 * Math.sin((a * Math.PI) / 180), 150 - 150 * Math.cos((a * Math.PI) / 180)]);
  assert.deepEqual(findTurns(buildRoute(path(arc))), []);
  // A straight street recorded with 2 m of wobble.
  const rnd = noise(7);
  const wobbly = [];
  for (let x = 0; x <= 600; x += 3) wobbly.push([x, 2 * rnd()]);
  assert.deepEqual(findTurns(buildRoute(path(wobbly))), []);
});

// ---------------------------------------------------------------- climb --

/** Fixes along a 2 km street at 3 m/s, with elevation `ele(x)` plus whatever error `wrong(t)` adds. */
function streetWithHill(ele, wrong = () => 0) {
  return steady(path([[0, 0], [2000, 0]]), 3).map((fix) => ({ ...fix, ele: ele(fix.t * 3) + wrong(fix.t) }));
}
// Flat for 500 m, up 30 m over the next 600 m (5%), flat, then down 10 m from 1500 to 1800 m.
const hill = (x) => (x < 500 ? 10 : x < 1100 ? 10 + (30 * (x - 500)) / 600 : x < 1500 ? 40 : x < 1800 ? 40 - (10 * (x - 1500)) / 300 : 30);
const street = buildRoute(path([[0, 0], [2000, 0]]));

test('climb and descent are measured from recorded elevation, and the climb is called out', () => {
  const climb = elevationAlong(street, [streetWithHill(hill)]);
  near(climb.gain, 30, 1.5, 'gain');
  near(climb.loss, 10, 1.5, 'loss');
  near(climb.lowest, 10, 0.5);
  near(climb.highest, 40, 0.5);
  assert.equal(climb.climbs.length, 1);
  const [up] = climb.climbs;
  near(up.from, 500, 60, 'foot of the climb');
  near(up.to, 1100, 60, 'top of the climb');
  near(up.gain, 30, 3);
  near(up.grade, 0.05, 0.008);
  near(climb.profile.ele[climb.profile.dist.findIndex((d) => d >= 800)], 25, 1, 'half-way up');
});

test('a jittery watch does not add climb that is not there', () => {
  // Readings that step up and down by half a metre around the true height.
  const rnd = noise(3);
  const jitter = () => Math.round(rnd()) * 0.5;
  const flat = elevationAlong(street, [streetWithHill(() => 25, jitter)]);
  assert.ok(flat.gain < 1 && flat.loss < 1, `flat ground measured as +${flat.gain.toFixed(1)} / -${flat.loss.toFixed(1)} m`);
  assert.deepEqual(flat.climbs, []);
  const hilly = elevationAlong(street, [streetWithHill(hill, jitter)]);
  near(hilly.gain, 30, 2.5, 'gain');
  near(hilly.loss, 10, 2.5, 'loss');
});

test('recordings whose barometers disagree by a few metres still average to one profile', () => {
  const rnd = noise(5);
  const runs = [0, 6, -3].map((offset) => streetWithHill(hill, () => offset + 0.3 * rnd()));
  const climb = elevationAlong(street, runs);
  near(climb.gain, 30, 2, 'gain');
  assert.equal(climb.climbs.length, 1);
  // The height is the first recording's.
  near(climb.lowest, 10, 0.7);
});

test('with no elevation in the recordings there is no climb to report', () => {
  assert.equal(elevationAlong(street, [steady(path([[0, 0], [2000, 0]]), 3)]), null);
  assert.equal(buildGuide([recording(steady(path([[0, 0], [600, 0]]), 3))]).climb, null);
});

// ---------------------------------------------------------------- waits --

/** A run along `points` at 3 m/s that stands still for `seconds` at each of `stops` (metres along). */
function runWithStops(points, stops, { paused = false } = {}) {
  const fixes = [];
  let delay = 0;
  const pending = [...stops];
  for (const fix of steady(points, 3)) {
    fixes.push({ ...fix, t: fix.t + delay });
    if (pending.length && fix.t * 3 >= pending[0].at) {
      const { seconds } = pending.shift();
      // Standing: the same position every second. Paused: the watch saves nothing.
      if (!paused) for (let k = 1; k < seconds; k++) fixes.push({ ...fix, t: fix.t + delay + k });
      delay += seconds;
    }
  }
  return fixes;
}
const kilometre = path([[0, 0], [1000, 0]]);
const kmRoute = buildRoute(kilometre);

test('places where runs stood still are found, and the same place on different runs is one place', () => {
  const runs = [
    runWithStops(kilometre, [{ at: 400, seconds: 30 }]),
    runWithStops(kilometre, [{ at: 410, seconds: 20 }, { at: 800, seconds: 10 }]),
    runWithStops(kilometre, []),
  ];
  const places = findPausePoints(kmRoute, runs);
  assert.equal(places.length, 2);
  near(places[0].dist, 405, 8, 'the crossing');
  assert.deepEqual([places[0].runs, places[0].of], [2, 3]);
  near(places[0].share, 2 / 3, 1e-9);
  // Standing with the watch running reads a few seconds short.
  near(places[0].typical, 23, 4, 'typical wait');
  near(places[0].longest, 28, 4, 'longest wait');
  near(places[1].dist, 800, 8);
  assert.equal(places[1].runs, 1);
  near(places[1].typical, 8, 4);
});

test('a watch that pauses itself leaves a hole, and the hole is a wait too', () => {
  const places = findPausePoints(kmRoute, [runWithStops(kilometre, [{ at: 600, seconds: 40 }], { paused: true })]);
  assert.equal(places.length, 1);
  near(places[0].dist, 600, 8);
  near(places[0].typical, 40, 3);
});

test('standing at the start or the finish, or for a moment, is not a wait', () => {
  const runs = [runWithStops(kilometre, [{ at: 0, seconds: 20 }, { at: 500, seconds: 3 }, { at: 995, seconds: 20 }])];
  assert.deepEqual(findPausePoints(kmRoute, runs), []);
});

// ---------------------------------------------------------------- guide --

test('the guide lists everything in order along the route, and what is coming up from any point', () => {
  // 600 m east with a hill, left turn, 900 m north. One run waits at 300 m.
  const corners = [[0, 0], [600, 0], [600, 900]];
  const up = (d) => (d < 800 ? 10 : d < 1200 ? 10 + (20 * (d - 800)) / 400 : 30);
  const withEle = (stops) => {
    const rec = recording(runWithStops(path(corners), stops));
    let d = 0;
    rec.points.forEach((p, i) => {
      if (i) d += Math.hypot((p.lat - rec.points[i - 1].lat) * 111195, (p.lon - rec.points[i - 1].lon) * 111195 * Math.cos((p.lat * Math.PI) / 180));
      p.ele = up(d);
    });
    return rec;
  };
  const guide = buildGuide([withEle([{ at: 300, seconds: 25 }]), withEle([])]);
  near(guide.length, 1500, 3);
  assert.equal(guide.runs, 2);
  assert.deepEqual(guide.features.map((f) => f.kind), ['wait', 'marker', 'turn', 'climb', 'marker', 'finish']);
  assert.ok(guide.features.every((f, i, all) => i === 0 || f.dist >= all[i - 1].dist), 'in order along the route');
  near(guide.climb.gain, 20, 1.5);
  near(guide.usualWait, 0.5 * 23, 2.5, 'half the runs wait about 25 s');
  near(guide.times.elapsed - guide.times.moving, 11.5, 2.5, 'the median run');

  // From 450 m: the 500 m marker, then the turn, then nothing else within 400 m.
  const ahead = upcoming(guide, 450);
  assert.deepEqual(ahead.map((f) => f.kind), ['marker', 'turn', 'climb']);
  near(ahead[0].in, 50, 1);
  near(ahead[1].in, 150, 8);
  assert.equal(ahead[1].side, 'left');
  // Only some kinds, and a shorter look ahead.
  assert.deepEqual(upcoming(guide, 450, { kinds: ['turn', 'wait'], ahead: 100 }), []);
  // Half-way up the climb: it is listed as under way, with what is left of it.
  const onClimb = upcoming(guide, 1000).find((f) => f.kind === 'climb');
  assert.equal(onClimb.in, 0);
  near(onClimb.left, 200, 60);
  // Past everything but the finish.
  assert.deepEqual(upcoming(guide, 1400).map((f) => f.kind), ['finish']);

  // The cue: the next thing to act on, however far, and the one after.
  let cue = nextCue(guide, 100);
  assert.deepEqual([cue.now.kind, cue.then.kind, cue.climb], ['wait', 'turn', null]);
  near(cue.now.in, 200, 10);
  // A distance marker is the cue only when it is close and nothing to act on is.
  cue = nextCue(guide, 420);
  assert.equal(cue.now.kind, 'turn', 'the 500 m marker is 80 m off, but so is the turn, 180 m off');
  cue = nextCue(guide, 900);
  assert.deepEqual([cue.now.kind, cue.now.label, cue.then.kind], ['marker', '1 km', 'finish']);
  near(cue.now.in, 100, 1);
  // On the climb: the climb under way is reported beside the cue.
  assert.equal(cue.climb.kind, 'climb');
  near(cue.climb.left, 300, 60);
  cue = nextCue(guide, 1050);
  assert.deepEqual([cue.now.kind, cue.then], ['finish', null]);
  near(cue.climb.left, 150, 60);
  // At the finish there is nothing left.
  assert.deepEqual(nextCue(guide, guide.length), { now: null, then: null, climb: null });
});

test('a recording of some other route is left out of the guide', () => {
  const here = recording(steady(kilometre, 3));
  const elsewhere = recording(steady(path([[0, 400], [1000, 400]]), 3));
  const guide = buildGuide([here, elsewhere, recording(runWithStops(kilometre, [{ at: 500, seconds: 15 }]))]);
  assert.equal(guide.runs, 2);
  assert.equal(guide.leftOut, 1);
  assert.equal(guide.pausePoints[0].of, 2);
});

test('distance markers are every 500 m, labelled, and stop short of the finish', () => {
  assert.deepEqual(distanceMarkers(2100).map((m) => m.label), ['500 m', '1 km', '1.5 km', '2 km']);
  assert.deepEqual(distanceMarkers(1050).map((m) => m.dist), [500]);
  assert.deepEqual(distanceMarkers(3000, 1000).map((m) => m.label), ['1 km', '2 km']);
});

// ------------------------------------------------------------- fixtures --

test('the synthetic run: its climb, its turnaround and the crossing both efforts waited at', (t) => {
  const fixtures = new URL('../../fixtures/', import.meta.url);
  const load = (file) => parseGpx(readFileSync(new URL(file, fixtures), 'utf8'));
  const guide = buildGuide([load('synthetic/run-a.gpx'), load('synthetic/run-b.gpx')]);
  const scenario = SCENARIOS[0];

  // The true climb: the same counting, on the true ground along the true path.
  const { gain } = upsAndDowns(scenario.path.xy.map(([x, y]) => terrain(x, y)));
  t.diagnostic(`climb ${guide.climb.gain.toFixed(1)} m against a true ${gain.toFixed(1)} m; ${guide.climb.climbs.length} climb(s) called out; ${guide.turns.length} turns; waits at ${guide.pausePoints.map((p) => `${p.dist.toFixed(0)} m (${p.runs} of ${p.of}, ${p.typical.toFixed(0)} s)`).join(', ')}`);
  near(guide.climb.gain, gain, 0.15 * gain, 'climb');
  assert.ok(guide.climb.climbs.length >= 1, 'the hill on the loop is called out');

  // The out-and-back turns round at 500 m.
  const back = guide.turns.find((turn) => turn.shape === 'back');
  assert.ok(guide.features.some((f) => f.kind === 'turn' && f.shape === 'back'), 'and it is a turn in the list of features');
  assert.ok(back, 'the turnaround is found');
  near(back.dist, 505, 15, 'turnaround');

  // Both efforts stop at the crossing just past 1 km, for 45 s and 20 s.
  assert.equal(guide.pausePoints.length, 1);
  const [crossing] = guide.pausePoints;
  near(crossing.dist, 1010, 15, 'crossing');
  assert.deepEqual([crossing.runs, crossing.of], [2, 2]);
  near(crossing.longest, 45, 6);
  near(crossing.typical, 32.5, 6);
});

// ------------------------------------------------- many runs of a route --

test('the same streets run the other way are a different route', () => {
  const out = recording(steady(kilometre, 3));
  const home = recording(steady([...kilometre].reverse(), 3));
  const guide = buildGuide([out, home, recording(runWithStops(kilometre, [{ at: 500, seconds: 15 }]))]);
  assert.equal(guide.runs, 2, 'the run home is not a run of the route out');
  assert.equal(guide.leftOut, 1);
  // A run of only the first third is not a run of the route either.
  assert.equal(buildGuide([out, recording(steady(path([[0, 0], [330, 0]]), 3))]).leftOut, 1);
});

test('a pile of recordings is sorted into routes, the one with most runs first', () => {
  const corner = path([[0, 0], [600, 0], [600, 400]]);
  const back = [...corner].reverse();
  // A longer way round the same corner: 40 m up a side street and back.
  const detour = path([[0, 0], [300, 0], [300, 40], [300, 0], [600, 0], [600, 400]]);
  const pile = [
    recording(steady(back, 3)), // 0: the way home
    recording(steady(detour, 3)), // 1: the way out, with a detour
    recording(steady(corner, 3.2)), // 2: the way out
    recording(steady(back, 2.8)), // 3: the way home
    recording(steady(corner, 2.9)), // 4: the way out
    recording(steady(path([[0, 900], [800, 900]]), 3)), // 5: somewhere else
  ];
  const routes = groupRuns(pile);
  assert.deepEqual(routes.map((r) => [...r].sort()), [[1, 2, 4], [0, 3], [5]]);
  // The run to draw the route out is one of the plain ones, not the detour.
  assert.ok(routes[0][0] === 2 || routes[0][0] === 4, `drawn by run ${routes[0][0]}`);
});

test('with three or more runs, a turn only one of them made is not a turn of the route', () => {
  const corner = path([[0, 0], [600, 0], [600, 400]]);
  // One run crosses the road and comes back half-way along: two sharp corners of its own.
  const wander = path([[0, 0], [300, 0], [300, 25], [330, 25], [330, 0], [600, 0], [600, 400]]);
  const runs = [steady(wander, 3), steady(corner, 3), steady(corner, 3.1)];
  const route = buildRoute(runs[0]);
  assert.ok(findTurns(route).length > 1, 'the wandering run has turns of its own');
  const turns = agreedTurns(route, runs);
  assert.equal(turns.length, 1);
  assert.deepEqual([turns[0].side, turns[0].shape, turns[0].runs, turns[0].of], ['left', 'turn', 3, 3]);
  // Placed on the wandering run's own line, where the corner comes 50 m later.
  near(turns[0].dist, 650, 12);
  // With only two runs there is nothing to outvote the first one's line.
  assert.equal(agreedTurns(route, runs.slice(0, 2)).length, findTurns(route).length);
  // And the guide uses the agreed turns.
  assert.equal(buildGuide(runs.map((fixes) => recording(fixes))).turns.length, 1);
});

test('a run that takes another street for a while has not waited there', () => {
  // Three runs of a street. One goes round by the next street over, 80 m
  // away, for 300 m: its progress along the route stands still meanwhile,
  // but it was moving the whole time.
  const street = path([[0, 0], [900, 0]]);
  const roundabout = path([[0, 0], [200, 0], [200, 80], [500, 80], [500, 0], [900, 0]]);
  const up = (x) => 10 + x / 50; // the street rises 18 m; the other street is taken to be 30 m higher
  const plain = (speed) => { const fixes = steady(street, speed); return fixes.map((f) => ({ ...f, ele: up(f.t * speed) })); };
  const detour = steady(roundabout, 3).map((f) => {
    const d = f.t * 3; // metres along its own way: on the other street from 280 m to 580 m
    const x = d < 200 ? d : d < 280 ? 200 : d < 580 ? 200 + (d - 280) : d < 660 ? 500 : 500 + (d - 660);
    return { ...f, ele: up(x) + (d > 280 && d < 580 ? 30 : 0) };
  });
  const route = buildRoute(street);
  assert.deepEqual(findPausePoints(route, [detour, plain(3), plain(3.1)]), []);
  // And the height of that other street is not mixed into this one's.
  const climb = elevationAlong(route, [plain(3), detour, plain(3.1)]);
  near(climb.highest, 28, 1.5, 'highest point');
  near(climb.gain, 18, 2, 'climb');
});
