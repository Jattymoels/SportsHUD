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
