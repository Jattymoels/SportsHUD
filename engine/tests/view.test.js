import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute, sight, onDisplay, coverage, bearingAlong } from '../index.js';
import { path } from './helpers.js';

const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);

const STRAIGHT = buildRoute(path([[0, 0], [0, 1000]]));
// North for 300 m, a square corner to the east, 300 m more.
const CORNER = buildRoute(path([[0, 0], [0, 300], [300, 300]]));

test('a ghost straight ahead on a straight road: dead centre, and the size its distance says', () => {
  const seen = sight(STRAIGHT, 100, 120, { pitch: 0 });
  near(seen.range, 20, 0.2);
  near(seen.right, 0, 0.2, 'neither left nor right');
  // Eyes 1.6 m up, a figure 1.75 m tall, 20 m off: feet 4.6° below level, head 0.4° above.
  near(seen.feet, -4.57, 0.05);
  near(seen.head, 0.43, 0.05);
  near(seen.tall, 5.0, 0.05);
  // Tip the head down 5° and everything in view rises by 5°.
  near(sight(STRAIGHT, 100, 120, { pitch: -5 }).feet, 0.43, 0.05);
});

test('a ghost round a corner is off to that side', () => {
  // 20 m short of the corner, facing north; the ghost is 40 m ahead by the route: 20 m north and 20 m east.
  const seen = sight(CORNER, 280, 320, { facing: 0, smooth: 0.5 });
  near(seen.right, 45, 4, 'to the right'); // the route is kept as points 5 m apart, which rounds the corner a little
  near(seen.range, 28.3, 2);
  // Facing where the route goes next, it is nearer the middle.
  assert.ok(Math.abs(sight(CORNER, 280, 320, { smooth: 0.5 }).right) < 45);
  near(bearingAlong(CORNER, 100, 110), 0, 0.5);
  near(bearingAlong(CORNER, 400, 410), 90, 0.5);
});

test('whether a display shows it depends on where the display sits, not only its size', () => {
  const seen = sight(STRAIGHT, 100, 120); // head tipped 5° down: feet 0.4° up, head 5.4° up
  assert.equal(onDisplay(seen, { w: 14, h: 14 }), 'whole');
  assert.equal(onDisplay(seen, { w: 14, h: 14, right: 12, up: -10 }), 'out', 'the same display off to the lower right misses it');
  assert.equal(onDisplay(seen, { w: 20, h: 8 }), 'part', 'a short display cuts its head off');
  assert.equal(onDisplay(sight(STRAIGHT, 100, 105), { w: 24, h: 18 }), 'part', 'a ghost 5 m off is taller than the display');
});

test('over a route: a centred display shows a ghost ahead nearly always, and loses it only at corners', () => {
  const display = { w: 24, h: 18 };
  const straight = coverage(STRAIGHT, 20, display);
  near(straight.shown, 1, 1e-9);
  near(straight.whole, 1, 1e-9);
  assert.equal(straight.longestGap, 0);
  near(straight.tall, 5.0, 0.1);
  const corner = coverage(CORNER, 40, display);
  assert.ok(corner.shown > 0.85 && corner.shown < 1, `shown ${corner.shown}`);
  assert.ok(corner.longestGap > 0 && corner.longestGap <= 60, `longest ${corner.longestGap} m, on the way into the corner`);
  // The same display off to one side shows nothing at all.
  assert.equal(coverage(STRAIGHT, 20, { ...display, right: 20 }).shown, 0);
});
