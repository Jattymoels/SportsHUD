// A made-up golf hole, used until a real course is mapped.
//
// It is laid out in metres on a flat grid (x east, y north, the tee at the
// origin) so that every distance can be checked by hand, then placed on the
// ground at ORIGIN. A par 4 of about 360 m that bends to the right:
//
//   - the tee at (0, 0), playing due north
//   - a fairway bunker on the left at 200 m, a pond on the right at 150 m
//   - the fairway turns right at 220 m
//   - the green 143 m further on, with a bunker short right and one behind

import { createProjection } from '../engine/geo.js';

const ORIGIN = { lat: -34.92, lon: 138.6 };
const proj = createProjection(ORIGIN.lat, ORIGIN.lon);

/** A position from grid metres. */
export function at(x, y) {
  const [lat, lon] = proj.toLatLon(x, y);
  return { lat, lon };
}

/** An oval outline: centre, half-length along `bearing`, half-width across it. */
export function oval(cx, cy, along, across, bearing = 0, points = 28) {
  const b = (bearing * Math.PI) / 180;
  const shape = [];
  for (let i = 0; i < points; i++) {
    const a = (2 * Math.PI * i) / points;
    const u = along * Math.cos(a); // along the bearing
    const v = across * Math.sin(a); // to its right
    shape.push(at(cx + u * Math.sin(b) + v * Math.cos(b), cy + u * Math.cos(b) - v * Math.sin(b)));
  }
  return shape;
}

// The numbers the layout is built from, for tests to check against.
export const LAYOUT = {
  tee: [0, 0],
  corner: [0, 220], // where the fairway turns
  green: { centre: [70, 345], deep: 14, wide: 11 }, // half-depth along the approach, half-width across it
  approach: (Math.atan2(70, 125) * 180) / Math.PI, // bearing of the approach from the corner, about 29.2 degrees
  fairwayBunker: { centre: [-22, 200], along: 6, across: 9 },
  pond: { centre: [38, 150], along: 24, across: 16 },
  frontBunker: { centre: [86, 322], along: 5, across: 7 },
  backBunker: { centre: [62, 368], along: 4, across: 6 },
};

const g = LAYOUT.green;
const sin = Math.sin((LAYOUT.approach * Math.PI) / 180);
const cos = Math.cos((LAYOUT.approach * Math.PI) / 180);

export const HOLE = {
  name: 'Made-up hole',
  number: 1,
  par: 4,
  tee: at(...LAYOUT.tee),
  line: [at(...LAYOUT.tee), at(...LAYOUT.corner), at(...g.centre)],
  green: oval(...g.centre, g.deep, g.wide, LAYOUT.approach),
  // Today's hole: 5 m beyond the middle and 3 m to its right, seen from the fairway.
  pin: at(g.centre[0] + 5 * sin + 3 * cos, g.centre[1] + 5 * cos - 3 * sin),
  // The mown ground, for drawing: a strip either side of the line of play.
  fairway: [at(-16, 60), at(-18, 215), at(-2, 240), at(52, 318), at(74, 306), at(22, 215), at(18, 60)],
  hazards: [
    { kind: 'bunker', name: 'Fairway bunker', shape: oval(...LAYOUT.fairwayBunker.centre, LAYOUT.fairwayBunker.along, LAYOUT.fairwayBunker.across) },
    { kind: 'water', name: 'Pond', shape: oval(...LAYOUT.pond.centre, LAYOUT.pond.along, LAYOUT.pond.across) },
    { kind: 'bunker', name: 'Front bunker', shape: oval(...LAYOUT.frontBunker.centre, LAYOUT.frontBunker.along, LAYOUT.frontBunker.across) },
    { kind: 'bunker', name: 'Back bunker', shape: oval(...LAYOUT.backBunker.centre, LAYOUT.backBunker.along, LAYOUT.backBunker.across) },
  ],
};
