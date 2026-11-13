import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWayOfTravel, straightAhead, pointAtDistance, bearingAlong, haversine } from '../index.js';
import { at, path, steady, noise } from './helpers.js';

const turn = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;
const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);

/** Fixes along `corners` at `speed`, each up to `wobble` metres out, with the receiver's own heading if `heading` says what it is at time t. */
function fixes(corners, speed, { wobble = 0, seed = 1, heading = null } = {}) {
  const rand = noise(seed);
  return steady(path(corners), speed).map((f) => {
    const out = at(wobble * rand(), wobble * rand());
    const zero = at(0, 0);
    return { ...f, lat: f.lat + out.lat - zero.lat, lon: f.lon + out.lon - zero.lon, gpsHeading: heading ? heading(f.t) : null, gpsSpeed: heading ? speed : null };
  });
}

test('with no heading from the receiver, the way of travel comes from where the runner has been', () => {
  const way = createWayOfTravel();
  const run = fixes([[0, 0], [300, 300]], 3, { wobble: 2 }); // north-east
  assert.equal(way.at().bearing, null, 'nothing known before any movement');
  for (const fix of run.slice(0, 4)) way.update(fix);
  assert.equal(way.at().bearing, null, 'nor after 9 m: too short a line to trust');
  for (const fix of run.slice(4, 30)) way.update(fix);
  const now = way.at();
  near(turn(45, now.bearing), 0, 8, 'north-east');
  assert.equal(now.moving, true);
  assert.equal(now.settled, true);
  near(now.speed, 3, 0.6);
});

test('it follows a corner within a few seconds, and is not called settled part-way round', () => {
  const way = createWayOfTravel();
  const run = fixes([[0, 0], [0, 150], [200, 150]], 3, { wobble: 1.5, seed: 2 }); // north for 50 s, then east
  let unsettled = false;
  for (const fix of run) {
    way.update(fix);
    if (fix.t === 49) near(turn(0, way.at().bearing), 0, 8, 'north before the corner');
    if (fix.t > 51 && fix.t < 56 && !way.at(fix.t).settled) unsettled = true;
    if (fix.t === 65) near(turn(90, way.at().bearing), 0, 10, 'east, 15 s after it');
  }
  assert.ok(unsettled, 'not settled while the bearing is swinging');
  assert.equal(way.at().settled, true);
});

test('the receiver\'s own heading is used where it gives one, and is quicker', () => {
  const way = createWayOfTravel();
  // The positions say north-east; the receiver says 60 degrees. Believe the receiver.
  for (const fix of fixes([[0, 0], [300, 300]], 3, { heading: () => 60 }).slice(0, 4)) way.update(fix);
  near(way.at().bearing, 60, 0.01, 'known within a few fixes, with no line to draw');
});

test('standing still keeps the bearing as it was, and says the runner is not moving', () => {
  const way = createWayOfTravel();
  const run = fixes([[0, 0], [0, 120]], 3, { wobble: 1 });
  for (const fix of run) way.update(fix);
  const before = way.at().bearing;
  const rand = noise(5);
  const last = run[run.length - 1];
  // A minute at a crossing: the fixes wander 3 m about one spot, and a receiver's heading while standing is noise.
  for (let k = 1; k <= 60; k++) {
    const wander = at(3 * rand(), 120 + 3 * rand());
    way.update({ t: last.t + k, ...wander, gpsHeading: 360 * Math.abs(rand()), gpsSpeed: 0.2 });
  }
  const now = way.at();
  assert.equal(now.moving, false);
  assert.equal(now.settled, false);
  near(turn(before, now.bearing), 0, 0.01, 'unchanged');
});

test('bearings near north do not swing the long way round', () => {
  const way = createWayOfTravel();
  let t = 0;
  for (const heading of [350, 355, 5, 10, 358, 2, 8, 352]) way.update({ t: t++, ...at(0, 3 * t), gpsHeading: heading, gpsSpeed: 3 });
  const bearing = way.at().bearing;
  assert.ok(bearing > 345 || bearing < 15, `bearing ${bearing}`);
});

test('a straight stand-in for a route runs through the place, along the bearing', () => {
  const here = at(40, -20);
  const { route, at: along } = straightAhead(here, 120, { behind: 30, ahead: 400 });
  near(route.length, 430, 0.5);
  const there = pointAtDistance(route, along);
  near(haversine(here.lat, here.lon, there.lat, there.lon), 0, 0.05, 'the place is where it says along the line');
  near(bearingAlong(route, along, along + 50), 120, 0.2);
  // A ghost 80 m ahead is 80 m away, in that direction.
  const ghost = pointAtDistance(route, along + 80);
  near(haversine(here.lat, here.lon, ghost.lat, ghost.lon), 80, 0.2);
});
