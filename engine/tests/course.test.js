// A course from map data: OpenStreetMap-shaped input built from the made-up
// hole, so what should come out is known.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { courseFromOsm, holeAt, nearestOnLine, greenDistances, distanceTo, centreOf, inside } from '../index.js';
import { HOLE, LAYOUT, at, oval } from '../../fixtures/golf.mjs';

const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);

/** Map data in OpenStreetMap's JSON shape, built up one thing at a time. */
function mapData() {
  const elements = [];
  let id = 0;
  const node = (p, tags) => {
    elements.push({ type: 'node', id: ++id, lat: p.lat, lon: p.lon, ...(tags ? { tags } : {}) });
    return id;
  };
  return {
    elements,
    node,
    /** A line: its points in order. */
    line(points, tags) {
      elements.push({ type: 'way', id: ++id, nodes: points.map((p) => node(p)), tags });
    },
    /** An outline: closed, so its first node is repeated at the end. */
    area(points, tags) {
      const ids = points.map((p) => node(p));
      elements.push({ type: 'way', id: ++id, nodes: [...ids, ids[0]], tags });
    },
  };
}

/** The made-up hole as hole 1, a second hole beside it drawn green to tee, and things that are not the course's. */
function sample() {
  const map = mapData();
  map.area([at(-150, -60), at(260, -60), at(260, 460), at(-150, 460)], { leisure: 'golf_course', name: 'Made-up Links' });
  map.area([at(900, 0), at(1100, 0), at(1100, 200), at(900, 200)], { leisure: 'golf_course', name: 'Somewhere Else' });
  map.line(HOLE.line, { golf: 'hole', ref: '1', par: '4', handicap: '7' });
  map.area(HOLE.green, { golf: 'green' });
  map.node(HOLE.pin, { golf: 'pin' });
  map.area(HOLE.fairway, { golf: 'fairway' });
  map.area(oval(0, -2, 6, 5), { golf: 'tee' });
  for (const hazard of HOLE.hazards) map.area(hazard.shape, hazard.kind === 'water' ? { golf: 'water_hazard' } : { golf: 'bunker', natural: 'sand' });
  // Hole 2: a par 3 along the west side, its line of play drawn from the green back to the tee.
  map.line([at(-110, 150), at(-110, 300)], { golf: 'hole', ref: '2', par: '3' });
  map.area(oval(-110, 150, 10, 9), { golf: 'green' });
  map.area(oval(-110, 302, 5, 5), { golf: 'tee' });
  map.area(oval(-125, 162, 5, 4), { golf: 'bunker' });
  // Not this course's: a bunker and a green over at the other one.
  map.area(oval(1000, 100, 6, 5), { golf: 'bunker' });
  map.area(oval(1000, 150, 10, 9), { golf: 'green' });
  return { elements: map.elements };
}

test('a course is put together from separate map features', () => {
  const course = courseFromOsm(sample());
  assert.equal(course.name, 'Made-up Links');
  assert.match(course.attribution, /OpenStreetMap/);
  assert.deepEqual(course.holes.map((h) => [h.number, h.par, h.index]), [[1, 4, 7], [2, 3, null]]);
  assert.deepEqual(course.mapped, { holes: 2, greens: 2, tees: 2, fairways: 1, bunkers: 4, water: 1, pins: 1 });

  const one = course.holes[0];
  near(one.length, 220 + Math.hypot(70, 125), 1, 'length of hole 1');
  near(distanceTo(centreOf(one.green), at(...LAYOUT.green.centre)), 0, 0.3, 'its green');
  near(distanceTo(one.pin, HOLE.pin), 0, 0.2, 'its pin');
  assert.equal(one.fairways.length, 1);
  assert.equal(one.tees.length, 1);
  // Its hazards, in the order they are met, named by where they lie.
  assert.deepEqual(one.hazards.map((h) => [h.kind, h.name]), [
    ['water', 'Water, right'],
    ['bunker', 'Fairway bunker, left'],
    // Seen coming up the hole, the one short of the green is more to its right than in front of it,
    // and the one beyond it more to its left than behind.
    ['bunker', 'Greenside bunker, right'],
    ['bunker', 'Greenside bunker, left'],
  ]);
  // The engine's golf maths works on it as on the hand-made hole.
  const d = greenDistances(at(0, 220), one.green);
  near(d.centre, Math.hypot(70, 125), 0.3);
  near(d.front, Math.hypot(70, 125) - 14, 0.6);
});

test('a line of play drawn green to tee is turned round', () => {
  const two = courseFromOsm(sample()).holes[1];
  // It ends at its green, and starts at its tee 150 m to the north.
  assert.equal(inside(two.line.at(-1), two.green), true);
  near(distanceTo(two.tee, at(-110, 300)), 0, 0.3);
  assert.equal(two.length, 150);
  assert.equal(two.pin, null, 'no pin is mapped on this green');
  assert.deepEqual(two.hazards.map((h) => h.name), ['Greenside bunker, right']);
  assert.equal(two.tees.length, 1);
});

test('which course, when the map data holds more than one', () => {
  assert.equal(courseFromOsm(sample(), { name: 'made-up' }).name, 'Made-up Links');
  // Asked for by name, the other course is found, with nothing to play: no line of play is mapped there.
  const other = courseFromOsm(sample(), { name: 'Somewhere' });
  assert.equal(other.name, 'Somewhere Else');
  assert.deepEqual(other.holes, []);
  assert.deepEqual([other.mapped.greens, other.mapped.bunkers], [1, 1]);
  assert.throws(() => courseFromOsm(sample(), { name: 'Nowhere' }), /No golf course named/);
  assert.throws(() => courseFromOsm({ elements: [] }), /No golf course/);
});

test('the hole you are on is the one whose line of play is nearest, and it does not flip at a green', () => {
  const course = courseFromOsm(sample());
  assert.equal(holeAt(course, at(5, 100)).hole.number, 1);
  assert.equal(holeAt(course, at(-105, 250)).hole.number, 2);
  near(holeAt(course, at(-105, 250)).distance, 5, 0.3);
  // Half-way between the two (55 m from each line): whichever is being played stays.
  const between = at(-55, 200);
  assert.equal(holeAt(course, between, { current: 1 }).hole.number, 1);
  assert.equal(holeAt(course, between, { current: 2 }).hole.number, 2);
  // Clearly on the other hole, it changes.
  assert.equal(holeAt(course, at(-100, 200), { current: 1 }).hole.number, 2);
});

test('nearest point on a line of play: how far off it, how far along, and which side', () => {
  const spot = nearestOnLine(at(12, 100), HOLE.line);
  near(spot.distance, 12, 0.1);
  near(spot.along, 100, 0.2);
  assert.equal(spot.side, 1, 'to the right of the way the hole runs');
  assert.equal(nearestOnLine(at(-12, 100), HOLE.line).side, -1);
  // Past the corner, distance along counts both legs.
  near(nearestOnLine(at(...LAYOUT.green.centre), HOLE.line).along, 220 + Math.hypot(70, 125), 0.5);
});

test('the Grange course file: 18 holes, each with a green to play to and a pin', () => {
  const course = JSON.parse(readFileSync(new URL('../../fixtures/courses/grange.json', import.meta.url), 'utf8'));
  assert.match(course.attribution, /OpenStreetMap/);
  assert.deepEqual(course.holes.map((h) => h.number), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.equal(course.holes.reduce((sum, h) => sum + h.par, 0), 72);
  for (const hole of course.holes) {
    assert.ok(hole.green.length >= 8, `hole ${hole.number}: a green outline`);
    assert.ok(inside(hole.line.at(-1), hole.green), `hole ${hole.number}: its line of play ends on its green`);
    assert.ok(hole.pin && inside(hole.pin, hole.green), `hole ${hole.number}: a pin on the green`);
    // From the tee, the green is about as far as the hole is long (less on a dog-leg).
    const d = greenDistances(hole.tee, hole.green);
    assert.ok(d.centre <= hole.length + 2 && d.centre > 0.8 * hole.length, `hole ${hole.number}: ${d.centre.toFixed(0)} m to the green for a ${hole.length} m hole`);
    assert.ok(d.back - d.front > 12 && d.back - d.front < 60, `hole ${hole.number}: green ${(d.back - d.front).toFixed(0)} m deep`);
  }
});
