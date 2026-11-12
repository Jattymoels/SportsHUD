import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, buildRoute, snapToRoute, pointAtDistance } from '../index.js';
import { at, path } from './helpers.js';

const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);

test('haversine matches a known distance', () => {
  // One degree of latitude is 111.195 km on the mean-radius sphere.
  near(haversine(-35, 138.6, -34, 138.6), 111195, 1);
  near(haversine(0, 0, 0, 0), 0, 0);
});

test('distance along a route is the length of the line', () => {
  near(buildRoute(path([[0, 0], [300, 0]])).length, 300, 0.01);
  // A sharp corner is cut by up to about 2 m, because points closer than
  // 5 m together are merged.
  near(buildRoute(path([[0, 0], [300, 0], [300, 400]])).length, 700, 2.1);
});

test('snapping gives distance along the route and distance off it', () => {
  const route = buildRoute(path([[0, 0], [300, 0], [300, 400]]));
  let snap = snapToRoute(route, ...Object.values(at(150, 10)));
  near(snap.dist, 150, 0.2, 'dist');
  near(snap.offset, 10, 0.2, 'offset');
  snap = snapToRoute(route, ...Object.values(at(292, 250)));
  near(snap.dist, 550, 2.1, 'dist');
  near(snap.offset, 8, 0.2, 'offset');
});

test('positions beyond either end snap to that end', () => {
  const route = buildRoute(path([[0, 0], [300, 0]]));
  near(snapToRoute(route, ...Object.values(at(-20, 0))).dist, 0, 0.01);
  near(snapToRoute(route, ...Object.values(at(350, 0)), { near: 290, window: 30 }).dist, 300, 0.01);
});

test('GPS jitter while standing still adds no distance', () => {
  const points = path([[0, 0], [100, 0]]);
  const jitter = [[1, 1], [-1, 2], [2, -1], [0, 1.5], [-2, -2], [1, 0]];
  for (let i = 0; i < 60; i++) points.push(at(100 + jitter[i % 6][0], jitter[i % 6][1]));
  points.push(...path([[100, 0], [200, 0]]));
  near(buildRoute(points).length, 200, 6);
});

test('a turnaround keeps its far point', () => {
  // Out 102 m and straight back, sampled every 3 m so the corner falls between kept points.
  const route = buildRoute(path([[0, 0], [102, 0], [0, 0]], 3));
  near(route.length, 204, 0.5);
});

test('on an out-and-back, the expected position picks the leg', () => {
  const route = buildRoute(path([[0, 0], [200, 0], [0, 0]]));
  const p = Object.values(at(30, 2));
  near(snapToRoute(route, ...p, { near: 28, window: 25 }).dist, 30, 0.5, 'outbound');
  near(snapToRoute(route, ...p, { near: 372, window: 25 }).dist, 370, 0.5, 'return');
});

test('near a turnaround, the direction of travel picks the leg', () => {
  const route = buildRoute(path([[0, 0], [200, 0], [0, 0]]));
  const p = Object.values(at(190, 1));
  const opts = { near: 200, window: 30, nearSigma: 10 };
  near(snapToRoute(route, ...p, { ...opts, heading: [1, 0] }).dist, 190, 0.5, 'heading out');
  near(snapToRoute(route, ...p, { ...opts, heading: [-1, 0] }).dist, 210, 0.5, 'heading back');
});

test('on a loop, the first fix is placed at the start, not the finish', () => {
  const route = buildRoute(path([[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]));
  near(snapToRoute(route, ...Object.values(at(-1, 3))).dist, 0, 3.5);
  // ...but someone who really is part-way round is found part-way round.
  near(snapToRoute(route, ...Object.values(at(103, 60))).dist, 160, 2.1);
});

test('a match at the end of the stretch searched says so when the route beyond fits better', () => {
  const route = buildRoute(path([[0, 0], [1000, 0]]));
  const here = Object.values(at(500, 2));
  // Searching 350 to 450 m for someone who is really at 500 m.
  const short = snapToRoute(route, ...here, { near: 400, window: 50 });
  assert.ok(short.dist <= 455 && short.offset > 40, JSON.stringify(short));
  assert.equal(short.edge, true);
  // Searching far enough finds them, and that is no edge.
  const found = snapToRoute(route, ...here, { near: 460, window: 50 });
  near(found.dist, 500, 0.5);
  assert.equal(found.edge, false);
  // The end of the route itself is not an edge of the search.
  assert.equal(snapToRoute(route, ...Object.values(at(1040, 0)), { near: 990, window: 50 }).edge, false);
});

test('pointAtDistance is the inverse of snapping', () => {
  const route = buildRoute(path([[0, 0], [300, 0], [300, 400]]));
  for (const d of [0, 123.4, 300, 512, route.length]) {
    const p = pointAtDistance(route, d);
    const snap = snapToRoute(route, p.lat, p.lon, { near: d, window: 20 });
    near(snap.dist, d, 0.05, 'dist');
    near(snap.offset, 0, 0.05, 'offset');
  }
  assert.deepEqual(pointAtDistance(route, 9999), pointAtDistance(route, route.length));
});

test('a route needs two distinct points', () => {
  assert.throws(() => buildRoute([at(0, 0), at(0, 0)]), /two distinct points/);
});
