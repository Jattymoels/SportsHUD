// Golf maths against a made-up hole laid out on a grid, so every expected
// number below is a hand calculation from fixtures/golf.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bearingTo, distanceTo, turnBetween, pointAlong, centreOf, inside, greenDistances,
  carryInWind, landingZone, clubFor, zoneTouches, hazardsInPlay, lookTarget, lookAround, featuresOf,
  createAddressHider, scoreDistances, scoreLooks, DEFAULT_CLUBS, WIND_MODEL,
} from '../index.js';
import { HOLE, LAYOUT, at, layOut } from '../../fixtures/golf.mjs';

const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);
const club = (name) => DEFAULT_CLUBS.find((c) => c.name === name);
const [gx, gy] = LAYOUT.green.centre;
const sin = Math.sin((LAYOUT.approach * Math.PI) / 180);
const cos = Math.cos((LAYOUT.approach * Math.PI) / 180);
/** A position `metres` short of the middle of the green, back down the approach. */
const shortOfGreen = (metres) => at(gx - metres * sin, gy - metres * cos);

test('bearings, distances and positions on the ground', () => {
  near(bearingTo(at(0, 0), at(0, 100)), 0, 0.01, 'north');
  near(bearingTo(at(0, 0), at(100, 0)), 90, 0.01, 'east');
  near(bearingTo(at(0, 0), at(-50, -50)), 225, 0.01, 'south-west');
  near(distanceTo(at(0, 0), at(30, 40)), 50, 0.05);
  const p = pointAlong(at(10, 20), 90, 35);
  near(distanceTo(p, at(45, 20)), 0, 0.05, 'pointAlong');
  assert.equal(turnBetween(350, 10), 20);
  assert.equal(turnBetween(10, 350), -20);
  assert.equal(turnBetween(90, 270), -180);
  near(distanceTo(centreOf(HOLE.green), at(gx, gy)), 0, 0.1, 'middle of the green');
  assert.equal(inside(at(gx, gy), HOLE.green), true);
  assert.equal(inside(at(gx + 30, gy), HOLE.green), false);
});

// ------------------------------------------------------------------ B7 --

test('B7: front, centre and back of the green, from the fairway', () => {
  // 150 m short of the middle, straight down the approach. The green is 14 m deep either side of its middle.
  const d = greenDistances(shortOfGreen(150), HOLE.green);
  near(d.centre, 150, 0.2, 'centre');
  near(d.front, 136, 0.5, 'front');
  near(d.back, 164, 0.5, 'back');
  near(d.bearing, LAYOUT.approach, 0.1, 'bearing');
  assert.equal(d.onGreen, false);
});

test('B7: front and back are along the line from where you stand, not along the fairway', () => {
  // 60 m to the side of the green, square to the approach: it is 11 m wide either side of its middle.
  const side = greenDistances(at(gx + 60 * cos, gy - 60 * sin), HOLE.green);
  near(side.centre, 60, 0.2);
  near(side.front, 49, 0.5, 'front');
  near(side.back, 71, 0.5, 'back');
  // From the tee the green is 351.8 m away as the crow flies, across the corner.
  const tee = greenDistances(HOLE.tee, HOLE.green);
  near(tee.centre, Math.hypot(gx, gy), 0.3);
  assert.ok(tee.front < tee.centre && tee.centre < tee.back);
  near(tee.back - tee.front, 28, 3, 'depth of the green seen from the tee');
});

test('B7: on the green, the front is behind you', () => {
  const d = greenDistances(shortOfGreen(6), HOLE.green);
  assert.equal(d.onGreen, true);
  assert.equal(d.front, 0);
  near(d.centre, 6, 0.2);
  near(d.back, 20, 0.5);
});

// ------------------------------------------------------------------ B8 --

test('B8: with no wind the landing zone is the club\'s carry down the aim line', () => {
  // A 7 iron (135 m) from the tee, aimed due north.
  const zone = landingZone(HOLE.tee, 0, club('7 iron'));
  near(distanceTo(zone.centre, at(0, 135)), 0, 0.2, 'zone centre');
  assert.equal(zone.carry, 135);
  assert.equal(zone.drift, 0);
  // The spec's target is within 2 m of the carry.
  near(distanceTo(HOLE.tee, zone.centre), 135, 2);
  // And aimed anywhere else it is still 135 m away on that bearing.
  const east = landingZone(HOLE.tee, 73, club('7 iron'));
  near(distanceTo(HOLE.tee, east.centre), 135, 0.2);
  near(bearingTo(HOLE.tee, east.centre), 73, 0.05);
});

test('B8: wind moves the landing zone the right way, by the rule of thumb', () => {
  const seven = club('7 iron');
  // Wind is given by where it blows FROM. Aiming north:
  const into = landingZone(HOLE.tee, 0, seven, { speed: 20, from: 0 }); // from the north: against
  const helped = landingZone(HOLE.tee, 0, seven, { speed: 20, from: 180 }); // from the south: behind
  const fromLeft = landingZone(HOLE.tee, 0, seven, { speed: 20, from: 270 }); // from the west
  const fromRight = landingZone(HOLE.tee, 0, seven, { speed: 20, from: 90 }); // from the east
  // Shorter into it, longer with it, and a headwind costs more than a tailwind gives.
  near(into.carry, 135 * (1 - 20 * WIND_MODEL.headPerKmh), 0.01);
  near(helped.carry, 135 * (1 + 20 * WIND_MODEL.tailPerKmh), 0.01);
  assert.ok(into.carry < 135 && helped.carry > 135);
  assert.ok(135 - into.carry > helped.carry - 135);
  near(distanceTo(into.centre, at(0, 118.8)), 0, 0.2, 'into the wind');
  // A wind from the left carries the ball right, and the other way about.
  near(fromLeft.drift, 20 * WIND_MODEL.crossPerKmh * 135, 0.01);
  near(distanceTo(fromLeft.centre, at(10.8, 135)), 0, 0.2, 'wind from the left');
  near(distanceTo(fromRight.centre, at(-10.8, 135)), 0, 0.2, 'wind from the right');
  near(fromLeft.carry, 135, 0.01, 'a pure crosswind leaves the carry alone');
  // Quartering from ahead and to the left: shorter and to the right.
  const quarter = landingZone(HOLE.tee, 0, seven, { speed: 20, from: 315 });
  assert.ok(quarter.carry < 135 && quarter.drift > 0);
  // The same wind is a headwind or a crosswind depending on where the shot is aimed.
  const turned = carryInWind(135, { speed: 20, from: 0 }, 90); // aiming east, wind from the north: from the left
  near(turned.head, 0, 1e-9);
  near(turned.cross, 20, 1e-9);
  assert.ok(turned.drift > 0);
});

test('B8: the club for a distance changes with the wind', () => {
  assert.equal(clubFor(150, 0).club.name, '5 iron');
  near(clubFor(150, 0).short, -3, 1e-9, 'a 5 iron carries 3 m past');
  // Into 20 km/h a 5 iron only carries 134.6 m; the 5 wood's 151.4 m is nearest.
  assert.equal(clubFor(150, 0, DEFAULT_CLUBS, { speed: 20, from: 0 }).club.name, '5 wood');
  // With it behind, a 6 iron's 152.6 m does.
  assert.equal(clubFor(150, 0, DEFAULT_CLUBS, { speed: 20, from: 180 }).club.name, '6 iron');
});

test('a landing zone that reaches into a hazard is noticed', () => {
  // Driver from the tee: zone centred 205 m out, 16.4 m either side. The fairway bunker's near edge is 13 m left of the line.
  const driver = landingZone(HOLE.tee, 0, club('Driver'));
  near(driver.wide, 16.4, 0.01);
  assert.equal(zoneTouches(driver, HOLE.hazards[0].shape), true, 'the fairway bunker');
  // A 7 iron's zone, 10.8 m either side at 135 m, is clear of the pond, whose near edge is 22 m right of the line.
  const pond = HOLE.hazards[1].shape;
  assert.equal(zoneTouches(landingZone(HOLE.tee, 0, club('7 iron')), pond), false);
  // A 30 km/h wind from the left moves it 16.2 m right, and then it is not.
  assert.equal(zoneTouches(landingZone(HOLE.tee, 0, club('7 iron'), { speed: 30, from: 270 }), pond), true);
});

test('hazards in play: how far to reach each one and how far to carry it', () => {
  const list = hazardsInPlay(HOLE.tee, 0, HOLE.hazards);
  assert.deepEqual(list.map((h) => h.name), ['Pond', 'Fairway bunker', 'Front bunker', 'Back bunker']);
  // The fairway bunker's middle is 201.2 m away, 6.3 degrees left; it is about 6 m deep either side of that.
  const bunker = list[1];
  near(bunker.off, -6.3, 0.1);
  near(bunker.reach, 195, 1.5, 'reach');
  near(bunker.carry, 207.5, 1.5, 'carry');
  // The pond: middle 154.7 m away, 14.2 degrees right, 24 m long either side.
  near(list[0].off, 14.2, 0.1);
  near(list[0].reach, 132, 2.5);
  near(list[0].carry, 177.5, 2.5);
  // Aiming well left, only the fairway bunker is in play.
  assert.deepEqual(hazardsInPlay(HOLE.tee, 330, HOLE.hazards).map((h) => h.name), ['Fairway bunker']);
});

// ------------------------------------------------------------------ B9 --

test('B9: look to range picks the feature being looked at, and gives its distance', () => {
  const features = featuresOf(HOLE);
  const corner = at(...LAYOUT.corner); // standing where the fairway turns
  // From here: green 29.2 degrees and 143 m; front bunker 40.1 degrees and 133 m; back bunker 22.7 degrees and 160 m.
  const bunker = lookTarget(corner, 40, features);
  assert.equal(bunker.feature.name, 'Front bunker');
  near(bunker.distance, Math.hypot(86, 102), 0.3);
  near(bunker.off, 0.1, 0.2);
  assert.equal(lookTarget(corner, 22, features).feature.name, 'Back bunker');
  near(lookTarget(corner, 22, features).distance, Math.hypot(62, 148), 0.3);
  // The green and its pin are 2 degrees apart from here: looking at the middle of the green finds the green.
  assert.equal(lookTarget(corner, 29, features).feature.name, 'Green');
  // A compass a few degrees out still finds the right one, when features are 15 degrees apart or more.
  const apart = [features[0], features[2]]; // the green, and the fairway bunker back towards the tee
  for (const error of [-6, -3, 0, 3, 6]) assert.equal(lookTarget(corner, 29.2 + error, apart).feature.name, 'Green', `compass ${error} degrees out`);
  // Looking at nothing mapped.
  assert.equal(lookTarget(corner, 120, features), null);
  // Which way to turn for the nearest thing: the pond, back down the fairway at 151.5 degrees, is to the right.
  const round = lookAround(corner, 120, features);
  assert.equal(round[0].feature.name, 'Pond');
  near(round[0].off, 31.5, 0.3);
  // Facing north-west, the nearest is the fairway bunker, behind and to the left.
  assert.ok(lookAround(corner, 300, features)[0].off < 0);
});

test('look to range ignores what is at your feet', () => {
  // Standing in the fairway bunker: it is not what you are looking towards.
  const inBunker = at(...LAYOUT.fairwayBunker.centre);
  const seen = lookAround(inBunker, 0, featuresOf(HOLE));
  assert.ok(seen.every((f) => f.feature.name !== 'Fairway bunker'));
});

// ----------------------------------------------------------------- B10 --

test('B10: the display hides within a second of looking down at the ball, and comes back when the head does', () => {
  const hider = createAddressHider();
  // Looking down the fairway.
  assert.equal(hider.update(-5, 0), false);
  // Head goes down to the ball at t = 1.
  assert.equal(hider.update(-55, 1.0), false);
  assert.equal(hider.update(-55, 1.2), false);
  assert.equal(hider.update(-56, 1.35), true, 'hidden 0.35 s after looking down');
  // A little movement over the ball does not bring it back.
  assert.equal(hider.update(-32, 2.0), true);
  assert.equal(hider.update(-48, 2.5), true);
  // Looking up after the shot does, at once.
  assert.equal(hider.update(-10, 4.0), false);
});

test('B10: a glance at your feet does not hide the display', () => {
  const hider = createAddressHider();
  assert.equal(hider.update(-5, 0), false);
  assert.equal(hider.update(-50, 1.0), false);
  assert.equal(hider.update(-45, 1.2), false);
  assert.equal(hider.update(-10, 1.25), false);
  assert.equal(hider.update(-10, 3), false);
});

// --------------------------------------------------------- course checks --

test('B7 scoring: within 5 m on 9 of 10 readings', () => {
  const reading = (app, measured) => ({ app, measured });
  // Nine within 5 m and one 8 m out: a pass.
  const nine = [...Array.from({ length: 9 }, (_, i) => reading(150 + i, 152 + i)), reading(120, 128)];
  const score = scoreDistances(nine);
  assert.deepEqual([score.count, score.good, score.pass], [10, 9, true]);
  near(score.worst, 8, 1e-9);
  near(score.typical, 2, 1e-9);
  // Two out: a fail.
  assert.equal(scoreDistances([...nine.slice(0, 8), reading(100, 107), reading(120, 128)]).pass, false);
  // Fewer than ten readings: not yet a result either way.
  assert.equal(scoreDistances(nine.slice(0, 6)).pass, null);
  assert.deepEqual(scoreDistances([]), { count: 0, good: 0, worst: 0, typical: 0, pass: null });
  // Exactly 5 m out still counts.
  assert.equal(scoreDistances([reading(100, 105)]).good, 1);
});

test('B9 scoring: the right feature in 8 of 10 looks', () => {
  const looks = (right, wrong) => [...Array(right).fill({ right: true }), ...Array(wrong).fill({ right: false })];
  assert.deepEqual(scoreLooks(looks(8, 2)), { count: 10, right: 8, pass: true });
  assert.equal(scoreLooks(looks(7, 3)).pass, false);
  assert.equal(scoreLooks(looks(5, 0)).pass, null);
});

test('the made-up hole can be laid out anywhere, playing any way, and is the same hole', () => {
  // Somewhere else entirely, with the tee shot played due east.
  const here = { lat: 51.5, lon: -0.12 };
  const { hole } = layOut(here, 90);
  near(distanceTo(hole.tee, here), 0, 0.01, 'the tee is where you stand');
  near(bearingTo(hole.tee, hole.line[1]), 90, 0.05, 'the tee shot plays east');
  near(distanceTo(hole.tee, hole.line[1]), 220, 0.2);
  // The same distances as on the grid: 150 m short of the green, front 136, back 164.
  const along = (metres) => pointAlong(hole.line[1], bearingTo(hole.line[1], centreOf(hole.green)), metres);
  const d = greenDistances(along(Math.hypot(70, 125) - 150), hole.green);
  near(d.centre, 150, 0.3);
  near(d.front, 136, 0.6);
  near(d.back, 164, 0.6);
  // The pond is still on the right of the tee shot: to the south when playing east.
  const pond = centreOf(hole.hazards[1].shape);
  assert.ok(pond.lat < hole.tee.lat, 'pond to the right');
  near(turnBetween(90, bearingTo(hole.tee, pond)), 14.2, 0.2);
});
