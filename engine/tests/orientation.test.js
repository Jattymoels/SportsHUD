import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angleBetween, cameraPose, createRunSession, buildRoute, paceProfile } from '../index.js';
import { path, steady } from './helpers.js';

const deg = (radians) => (radians * 180) / Math.PI;
const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);
/** Bearings compared the short way round. */
const bearing = (actual, expected, label) => near(deg(angleBetween((expected * Math.PI) / 180, actual)), 0, 0.01, label);

test('angleBetween goes the short way round', () => {
  near(deg(angleBetween((350 * Math.PI) / 180, (10 * Math.PI) / 180)), 20, 1e-9);
  near(deg(angleBetween((10 * Math.PI) / 180, (350 * Math.PI) / 180)), -20, 1e-9);
  near(deg(angleBetween(0, Math.PI / 2)), 90, 1e-9);
});

test('a phone held upright faces the bearing its compass says', () => {
  // Upright in portrait: beta 90. alpha counts anticlockwise from north.
  for (const [alpha, facing] of [[0, 0], [90, 270], [180, 180], [270, 90], [315, 45]]) {
    const pose = cameraPose(alpha, 90, 0);
    bearing(pose.yaw, facing, `alpha ${alpha}`);
    near(deg(pose.pitch), 0, 1e-6, 'level');
    near(deg(pose.roll), 0, 1e-6, 'not rolled');
  }
});

test('tilting the top of the phone back looks up; forward looks down', () => {
  near(deg(cameraPose(0, 110, 0).pitch), 20, 1e-6);
  near(deg(cameraPose(0, 70, 0).pitch), -20, 1e-6);
  bearing(cameraPose(40, 70, 0).yaw, 320, 'still facing the same way');
  near(deg(cameraPose(0, 0, 0).pitch), -90, 1e-6, 'flat on a table, the camera looks at the ground');
});

/**
 * The three angles a browser would report for a device whose own axes point
 * along x (right of the screen), y (top of the screen) and z (out of the
 * screen), each given as [east, north, up]. Built from the axes so the tests
 * below do not depend on working the angles out by hand.
 */
function reported(x, y, z) {
  const d = (r) => (r * 180) / Math.PI;
  return [(d(Math.atan2(-y[0], y[1])) + 360) % 360, d(Math.asin(y[2])), d(Math.atan2(-x[2], z[2]))];
}
const sin = (degrees) => Math.sin((degrees * Math.PI) / 180);
const cos = (degrees) => Math.cos((degrees * Math.PI) / 180);

test('leaning the phone to one side is roll, not a change of direction', () => {
  // Upright, facing north, top leaning 15° to the right (east), then to the left.
  const right = cameraPose(...reported([cos(15), 0, -sin(15)], [sin(15), 0, cos(15)], [0, -1, 0]));
  bearing(right.yaw, 0, 'still facing north');
  near(deg(right.pitch), 0, 1e-6);
  near(deg(right.roll), 15, 1e-6);
  const left = cameraPose(...reported([cos(15), 0, sin(15)], [-sin(15), 0, cos(15)], [0, -1, 0]));
  bearing(left.yaw, 0, 'still facing north');
  near(deg(left.roll), -15, 1e-6);
});

test('a phone on its side in landscape, with the page turned to match', () => {
  // Facing north, turned anticlockwise so the top of the phone points west
  // and its right edge points up. The page turns 90° to stay upright.
  const pose = cameraPose(...reported([0, 0, 1], [-1, 0, 0], [0, -1, 0]), 90);
  bearing(pose.yaw, 0, 'facing north');
  near(deg(pose.pitch), 0, 1e-6);
  near(deg(pose.roll), 0, 1e-6, 'the page is the right way up');
  // Turned the other way: top to the east, right edge down, page at 270°.
  const other = cameraPose(...reported([0, 0, -1], [1, 0, 0], [0, -1, 0]), 270);
  bearing(other.yaw, 0, 'facing north');
  near(deg(other.roll), 0, 1e-6);
  // Without telling it the page has turned, the same phone reads as rolled a quarter turn.
  near(Math.abs(deg(cameraPose(...reported([0, 0, 1], [-1, 0, 0], [0, -1, 0])).roll)), 90, 1e-6);
});

test('a pace ghost on a known route has a place on it', () => {
  const points = path([[0, 0], [600, 0]]);
  const route = buildRoute(points);
  // 4:00 per km is 4.1667 m/s; the runner does 3 m/s.
  const session = createRunSession({ ghost: { kind: 'track', route, profile: paceProfile(route.length, 240) }, clock: 'elapsed' });
  for (const fix of steady(points, 3).slice(0, 101)) session.update(fix);
  const now = session.at(100);
  near(now.routeDist, 300, 1);
  near(now.ghostDist, 416.7, 0.5);
  near(now.distGap, -116.7, 1.5);
  near(now.timeGap, -28, 0.5);
});
