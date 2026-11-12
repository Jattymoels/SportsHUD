import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoPause, createRunSession, ghostFromFixes, parseGpx, toFixes, toGpx } from '../index.js';
import { path, steady } from './helpers.js';

const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);

const loop = path([[0, 0], [300, 0], [300, 300], [0, 300], [0, 5]]);

/** Steady running with a stand of `seconds` after `at` seconds, the position still being reported throughout. */
function withStand(fixes, at, seconds) {
  const standing = Array.from({ length: seconds }, (_, i) => ({ ...fixes[at], t: at + 1 + i }));
  return [...fixes.slice(0, at + 1), ...standing, ...fixes.slice(at + 1).map((f) => ({ ...f, t: f.t + seconds }))];
}

/** Feed a whole run to a session, as a phone would, and end it. */
function runThrough(session, fixes) {
  for (const fix of fixes) session.update(fix);
  return session.finish(fixes.at(-1).t);
}

/** Fixes one second apart at the given distances (metres) along a straight line. */
const along = (metres) => metres.map((m, t) => ({ t, ...path([[0, 0], [m || 0.001, 0]], m || 0.001).at(-1) }));

test('auto-pause dates a stop back to when the standing began, and a restart to when the moving began', () => {
  const pause = createAutoPause();
  // Running 3 m/s, arriving at 12 m at t=4, standing until t=10, then off again.
  const fixes = along([0, 3, 6, 9, 12, 12, 12.5, 12, 11.6, 12, 12, 14, 17, 20]);
  const changes = fixes.map((fix) => pause.update(fix));
  assert.deepEqual(changes.slice(0, 7), [null, null, null, null, null, null, null]);
  assert.deepEqual(changes[7], { paused: true, at: 4 }, 'certain at t=7, dated back to arriving at t=4');
  assert.deepEqual(changes.slice(8, 12), [null, null, null, null]);
  assert.deepEqual(changes[12], { paused: false, at: 11 }, 'moving again at t=12, dated back to the last fix still at the standing spot');
  assert.equal(changes[13], null);
});

test('auto-pause is not fooled by walking, or by GPS wobble while standing', () => {
  const walking = createAutoPause();
  for (const fix of along(Array.from({ length: 30 }, (_, t) => t * 1.4))) assert.equal(walking.update(fix), null, `t=${fix.t}`);
  const standing = createAutoPause();
  const wobble = [0, 0.8, -0.6, 1.1, 0.2, -0.9, 0.5, 1.2, -0.4, 0.3, -1.0, 0.7, 0.1, -0.5, 0.9, 0];
  const changes = along(wobble.map((w) => 50 + w)).map((fix) => standing.update(fix)).filter(Boolean);
  assert.deepEqual(changes, [{ paused: true, at: 0 }], 'one pause, and no false restart');
});

test('a session against a pace ghost: distance, time, splits and gap', () => {
  const session = createRunSession({ ghost: { kind: 'pace', secondsPerKm: 1000 / 3 }, splitEvery: 200 });
  assert.equal(session.at(0), null);
  const fixes = steady(loop, 3);
  const summary = runThrough(session, fixes);
  near(summary.distance, 1195, 8);
  near(summary.elapsed, 398, 1);
  near(summary.secondsPerKm, 333.3, 4);
  near(summary.timeGap, 0, 3, 'level with a ghost at the same pace');
  assert.equal(summary.splits.length, 5);
  for (const split of summary.splits) near(split.lap, 66.7, 2.5, `lap to ${split.distance} m`);
  assert.equal(summary.fixes.length, fixes.length);
});

test('a session stops its clock while the runner stands, and starts it again', () => {
  const fixes = withStand(steady(loop, 3), 150, 40);
  const session = createRunSession({ ghost: { kind: 'pace', secondsPerKm: 1000 / 3 } });
  for (const fix of fixes.filter((f) => f.t <= 175)) session.update(fix);
  assert.equal(session.at(156).paused, true, 'paused within about 5 s of stopping');
  const waiting = session.at(175);
  assert.equal(waiting.paused, true);
  near(waiting.time, 150, 1.5, 'clock held at when the standing began');
  for (const fix of fixes.filter((f) => f.t > 175)) session.update(fix);
  const summary = session.finish(fixes.at(-1).t);
  assert.equal(summary.pauses.length, 1);
  const stand = summary.pauses[0];
  near(stand.start, 150, 1.5);
  near(stand.end, 190, 1.5);
  near(summary.time, 398, 2, 'moving time is the run without the stand');
  near(summary.timeGap, 0, 3, 'and the stand cost nothing against the ghost');
});

test('on the clock that never stops, standing costs time', () => {
  const fixes = withStand(steady(loop, 3), 150, 40);
  const summary = runThrough(createRunSession({ ghost: { kind: 'pace', secondsPerKm: 1000 / 3 }, clock: 'elapsed' }), fixes);
  assert.deepEqual(summary.pauses, []);
  near(summary.time, 438, 1);
  near(summary.timeGap, -40, 3);
});

test('pausing by hand overrides auto-pause until resumed', () => {
  const fixes = steady(loop, 3);
  const session = createRunSession({ ghost: { kind: 'pace', secondsPerKm: 1000 / 3 } });
  for (const fix of fixes.slice(0, 101)) session.update(fix);
  session.pause(100);
  for (const fix of fixes.slice(101, 161)) session.update(fix); // still moving, clock held
  assert.equal(session.at(160).paused, true);
  near(session.at(160).time, 100, 2);
  session.resume(160);
  for (const fix of fixes.slice(161, 201)) session.update(fix);
  assert.equal(session.at(200).paused, false);
  near(session.at(200).time, 140, 2);
});

test('a finished run becomes the ghost for the next one, pauses and all', () => {
  // First run: steady, with a 40 s stand. Second run: same pace, no stand.
  const first = runThrough(createRunSession({ ghost: { kind: 'pace', secondsPerKm: 300 } }), withStand(steady(loop, 3), 150, 40));
  const { route, ghost } = ghostFromFixes(first.fixes, first.pauses);
  const session = createRunSession({ ghost: { kind: 'track', route, profile: ghost } });
  const fixes = steady(loop, 3);
  for (const fix of fixes.slice(0, 301)) session.update(fix);
  const now = session.at(300);
  assert.equal(now.offRoute, false);
  near(now.timeGap, 0, 5, 'the ghost\'s stand does not count against it');
  near(now.distance, 900, 6);
});

test('toGpx writes a run that parseGpx reads back', () => {
  const fixes = steady(loop, 3).slice(0, 20);
  const startedAt = Date.UTC(2026, 10, 12, 21, 0, 0);
  const text = toGpx(fixes, { name: 'Tuesday <easy> & steady', startedAt });
  const back = parseGpx(text);
  assert.equal(back.name, 'Tuesday <easy> & steady');
  assert.equal(back.points[0].time, startedAt);
  const read = toFixes(back);
  assert.equal(read.length, fixes.length);
  read.forEach((f, i) => {
    assert.equal(f.t, fixes[i].t);
    near(f.lat, fixes[i].lat, 1e-7);
    near(f.lon, fixes[i].lon, 1e-7);
  });
});

// ------------------------------- a recording, with a pace ghost standing in --

// A ghost that ran 900 m of street at 3.3 m/s, and the two ways to race it.
const street = path([[0, 0], [900, 0]]);
const past = ghostFromFixes(steady(street, 3.3), []);
const plain = () => createRunSession({ ghost: { kind: 'track', route: past.route, profile: past.ghost }, clock: 'elapsed' });
const guarded = () => createRunSession({ ghost: { kind: 'track', route: past.route, profile: past.ghost, fallback: 1000 / 3.3 }, clock: 'elapsed' });
/** Feed fixes and collect the reading after each. */
const readings = (session, fixes) => fixes.map((fix) => (session.update(fix), session.at(fix.t)));

test('on the ghost\'s own route, racing it with a stand-in gives the same race', () => {
  const fixes = steady(street, 3);
  const a = readings(plain(), fixes);
  const b = readings(guarded(), fixes);
  // 3 m/s against 3.3 m/s loses about 0.091 s every second, either way.
  near(a[200].timeGap, -0.091 * 200, 1.5);
  near(b[200].timeGap, a[200].timeGap, 1.5, 'half-way');
  assert.equal(b[200].racing, 'recording');
  assert.equal(b[200].offRoute, false);
  near(b[200].routeDist, 600, 4);
  // No "off route" at the start, in the seconds before the recording takes over.
  assert.ok(b.slice(0, 20).every((r) => !r.offRoute));
  // At the end the race is over and the gap stays as it stood.
  assert.equal(b.at(-1).finished, true);
  near(b.at(-1).timeGap, a.at(-1).timeGap, 2, 'at the finish');
  assert.equal(b.at(-1).racing, 'recording');
});

test('taking another street for a while: without a stand-in the gap runs away, with one it carries on', () => {
  // The next street over, 80 m north, for 300 m, at the ghost's own speed.
  const roundabout = steady(path([[0, 0], [200, 0], [200, 80], [500, 80], [500, 0], [900, 0]]), 3.3);
  const a = readings(plain(), roundabout);
  const b = readings(guarded(), roundabout);
  // By 130 s the runner has been off the route for a minute and a half.
  assert.ok(a[130].timeGap < -30, `held progress: ${a[130].timeGap.toFixed(0)} s`);
  assert.equal(a[130].offRoute, true);
  near(b[130].timeGap, 0, 2.5, 'with the stand-in');
  assert.equal(b[130].racing, 'pace');
  assert.equal(b[130].offRoute, true, 'and the display is told the ghost is a stand-in for now');
  assert.equal(b[130].routeDist, null);
  // Back on the street (at 200 s) the recording takes over again within seconds, and nothing jumped.
  assert.equal(b[212].racing, 'recording');
  assert.equal(b[212].offRoute, false);
  near(b[212].timeGap, 0, 3);
  const biggest = Math.max(...b.slice(1).map((r, i) => Math.abs(r.timeGap - b[i].timeGap)));
  assert.ok(biggest < 1, `biggest change in one second ${biggest.toFixed(2)} s`);
  assert.equal(b.at(-1).finished, true);
});

test('starting part-way along the ghost\'s route races it from there', () => {
  // Joining 400 m in. The ghost passed that spot two minutes into its run.
  const fixes = steady(path([[400, -60], [400, 0], [900, 0]]), 3.3);
  const a = readings(plain(), fixes);
  const b = readings(guarded(), fixes);
  assert.ok(Math.abs(a[60].timeGap) > 60, `without a stand-in the gap is nonsense: ${a[60].timeGap.toFixed(0)} s`);
  near(b[60].timeGap, 0, 2.5, 'with one, level from where the runner joined');
  assert.equal(b[60].racing, 'recording');
});

test('a pace ghost carrying saved runs: each takes over on its own route, on any run', () => {
  // Two saved runs: the street east (at 3.3 m/s), and an avenue going north from its 600 m mark (at 2.7 m/s).
  const avenue = ghostFromFixes(steady(path([[600, 0], [600, 500]]), 2.7), []);
  const session = createRunSession({
    ghost: { kind: 'pace', secondsPerKm: 1000 / 3, tracks: [{ route: past.route, profile: past.ghost }, { route: avenue.route, profile: avenue.ghost }] },
    clock: 'elapsed',
  });
  // Today: in from the south, east along the street from 200 m to 600 m, then north up the avenue, all at 3 m/s.
  const r = readings(session, steady(path([[200, -150], [200, 0], [600, 0], [600, 400]]), 3));
  // Up the side street: the pace ghost, level.
  assert.deepEqual([r[40].racing, r[40].track, r[40].routeDist], ['pace', null, null]);
  near(r[40].timeGap, 0, 1);
  // On the street (from 50 s to 183 s): the first saved run, which was faster.
  assert.deepEqual([r[120].racing, r[120].track], ['recording', 0]);
  near(r[120].routeDist, 200 + (120 - 50) * 3, 5);
  assert.ok(r[170].timeGap < -8, `losing to the faster run: ${r[170].timeGap.toFixed(1)} s`);
  // Up the avenue (from 183 s): the second saved run, which was slower, so the gap comes back.
  const late = r.at(-10);
  assert.deepEqual([late.racing, late.track], ['recording', 1]);
  assert.ok(late.timeGap > r[185].timeGap + 8, `gaining on the slower run: from ${r[185].timeGap.toFixed(1)} to ${late.timeGap.toFixed(1)} s`);
  // Nothing jumped at any change, it never "finishes", and it is never "off route".
  const biggest = Math.max(...r.slice(1).map((x, i) => Math.abs(x.timeGap - r[i].timeGap)));
  assert.ok(biggest < 1, `biggest change in one second ${biggest.toFixed(2)} s`);
  assert.ok(r.every((x) => !x.finished && !x.offRoute));
  // With no saved runs it is a plain pace ghost.
  const alone = readings(createRunSession({ ghost: { kind: 'pace', secondsPerKm: 1000 / 3, tracks: [] }, clock: 'elapsed' }), steady(street, 3));
  assert.ok(alone.every((x) => x.racing === 'pace' && x.track === null));
});
