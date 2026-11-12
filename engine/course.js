// A golf course from map data.
//
// OpenStreetMap draws a course as separate things: an outline of the whole
// course, a line of play for each hole (tee to green, with its number and
// par), and an outline for each green, tee, bunker, fairway and water
// hazard, with a point for each pin. Nothing says which bunker belongs to
// which hole. This turns that into holes in the shape engine/golf.js works
// with, by putting each thing with the holes it lies beside.

import { createProjection } from './geo.js';
import { centreOf, inside, distanceTo, bearingTo, turnBetween } from './golf.js';

export const COURSE_DEFAULTS = {
  besideLine: 50, // metres from a hole's line of play within which a hazard is that hole's
  besideGreen: 45, // metres from the middle of a green within which a hazard is greenside
  teeWithin: 45, // metres from the start of the line within which a tee is that hole's
  fairwayWithin: 30, // metres from the line within which a fairway is that hole's
};

const WATER = new Set(['water_hazard', 'lateral_water_hazard']);
const round = (p) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6 });

/** Metres from a position to the nearest point of a line of several legs, and how far along the line that point is. */
export function nearestOnLine(position, line) {
  const proj = createProjection(position.lat, position.lon);
  const pts = line.map((p) => proj.toXY(p.lat, p.lon));
  let best = { distance: Infinity, along: 0, side: 0 };
  let walked = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    const f = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (len * len)));
    const distance = Math.hypot(ax + f * dx, ay + f * dy);
    // Which side of the leg the position is on: positive is to the right of the way it runs.
    if (distance < best.distance) best = { distance, along: walked + f * len, side: Math.sign(ay * dx - ax * dy) };
    walked += len;
  }
  return best;
}

/** Positions every `step` metres along a line of several legs, ends included. */
function along(line, step = 10) {
  const out = [line[0]];
  for (let i = 0; i < line.length - 1; i++) {
    const n = Math.max(1, Math.ceil(distanceTo(line[i], line[i + 1]) / step));
    for (let k = 1; k <= n; k++) out.push({ lat: line[i].lat + ((line[i + 1].lat - line[i].lat) * k) / n, lon: line[i].lon + ((line[i + 1].lon - line[i].lon) * k) / n });
  }
  return out;
}

/** A hazard's name from where it lies on its hole: greenside or fairway, and which side. */
function nameHazard(kind, middle, hole) {
  const greenCentre = centreOf(hole.green);
  const what = kind === 'water' ? 'Water' : 'bunker';
  if (distanceTo(middle, greenCentre) <= hole.besideGreen) {
    // Seen coming up the hole: is it short of the green, beyond it, or to one side?
    const approach = bearingTo(hole.line[hole.line.length - 2], greenCentre);
    const turn = turnBetween(approach, bearingTo(greenCentre, middle));
    const where = Math.abs(turn) <= 45 ? 'back' : Math.abs(turn) >= 135 ? 'front' : turn > 0 ? 'right' : 'left';
    return kind === 'water' ? `Water, ${where} of the green` : `Greenside bunker, ${where}`;
  }
  const { side } = nearestOnLine(middle, hole.line);
  return `${kind === 'water' ? what : `Fairway ${what}`}, ${side > 0 ? 'right' : 'left'}`;
}

/**
 * Build a course from OpenStreetMap data.
 *
 * @param {{elements:Array}} osm as OpenStreetMap's map call or an Overpass
 *   query returns it in JSON: nodes with lat and lon, ways with their nodes
 * @param {{name?:string}} [options] part of the course's name, to pick one
 *   where the data holds several. By default, the course with the most holes.
 * @returns {{name:string, attribution:string, holes:Array, mapped:object}}
 *   holes in order of number, each `{number, par, index, length, tee, line,
 *   green, pin, fairways, tees, hazards}` as engine/golf.js takes them.
 *   mapped: counts of what the data holds inside the course, for judging
 *   how completely it is mapped.
 */
export function courseFromOsm(osm, options = {}) {
  const o = { ...COURSE_DEFAULTS, ...options };
  const nodes = new Map();
  for (const e of osm.elements) if (e.type === 'node') nodes.set(e.id, e);
  const ways = osm.elements.filter((e) => e.type === 'way' && e.tags);
  const points = (way) => way.nodes.map((id) => nodes.get(id)).filter(Boolean).map((n) => ({ lat: n.lat, lon: n.lon }));
  /** A closed way as an outline, without its repeated last point. */
  const outlineOf = (way) => {
    const pts = points(way);
    return way.nodes[0] === way.nodes[way.nodes.length - 1] ? pts.slice(0, -1) : pts;
  };

  const holeWays = ways.filter((w) => w.tags.golf === 'hole' && w.nodes.length >= 2);
  const courses = ways
    .filter((w) => w.tags.leisure === 'golf_course')
    .map((w) => ({ way: w, shape: outlineOf(w) }))
    .filter((c) => c.shape.length >= 3 && (!o.name || (c.way.tags.name ?? '').toLowerCase().includes(o.name.toLowerCase())));
  if (!courses.length) throw new Error(o.name ? `No golf course named "${o.name}" in this map data` : 'No golf course in this map data');
  const holesIn = (c) => holeWays.filter((w) => inside(points(w)[0], c.shape)).length;
  const course = courses.reduce((best, c) => (holesIn(c) > holesIn(best) ? c : best));
  const within = (shape) => inside(centreOf(shape), course.shape);

  const shapesOf = (test) => ways.filter((w) => test(w.tags)).map(outlineOf).filter((s) => s.length >= 3 && within(s));
  const greens = shapesOf((t) => t.golf === 'green');
  const tees = shapesOf((t) => t.golf === 'tee');
  const fairways = shapesOf((t) => t.golf === 'fairway');
  const bunkers = shapesOf((t) => t.golf === 'bunker');
  const waters = shapesOf((t) => WATER.has(t.golf) || t.natural === 'water');
  const pins = osm.elements.filter((e) => e.type === 'node' && e.tags?.golf === 'pin').map((n) => ({ lat: n.lat, lon: n.lon }));

  const holes = [];
  for (const way of holeWays) {
    let line = points(way);
    if (!inside(line[0], course.shape) && !inside(line[line.length - 1], course.shape)) continue;
    const greenAt = (p) => greens.find((g) => inside(p, g)) ?? null;
    // A line of play runs tee to green. One drawn the other way round is turned.
    if (!greenAt(line[line.length - 1]) && greenAt(line[0])) line = [...line].reverse();
    const end = line[line.length - 1];
    const green = greenAt(end) ?? greens.reduce((best, g) => (!best || distanceTo(centreOf(g), end) < distanceTo(centreOf(best), end) ? g : best), null);
    if (!green || distanceTo(centreOf(green), end) > 60) continue; // a line of play with no green to play to
    const hole = {
      number: Number(way.tags.ref) || holes.length + 1,
      par: Number(way.tags.par) || null,
      index: Number(way.tags.handicap) || null,
      length: Math.round(line.slice(1).reduce((sum, p, i) => sum + distanceTo(line[i], p), 0)),
      tee: round(line[0]),
      line: line.map(round),
      green: green.map(round),
      pin: null,
      fairways: [],
      tees: [],
      hazards: [],
      besideGreen: o.besideGreen,
    };
    const pin = pins.find((p) => inside(p, green));
    if (pin) hole.pin = round(pin);
    hole.tees = tees.filter((t) => distanceTo(centreOf(t), line[0]) <= o.teeWithin).map((t) => t.map(round));
    const samples = along(line);
    hole.fairways = fairways.filter((f) => samples.some((p) => inside(p, f)) || nearestOnLine(centreOf(f), line).distance <= o.fairwayWithin).map((f) => f.map(round));
    for (const [kind, shapes] of [['bunker', bunkers], ['water', waters]]) {
      for (const shape of shapes) {
        const middle = centreOf(shape);
        const near = nearestOnLine(middle, line);
        if (near.distance > o.besideLine && distanceTo(middle, centreOf(green)) > o.besideGreen) continue;
        hole.hazards.push({ kind, name: nameHazard(kind, middle, hole), shape: shape.map(round), along: near.along });
      }
    }
    // Hazards in the order they are met, and without the working figures.
    hole.hazards.sort((a, b) => a.along - b.along);
    hole.hazards = hole.hazards.map(({ along: _, ...hazard }) => hazard);
    delete hole.besideGreen;
    holes.push(hole);
  }
  holes.sort((a, b) => a.number - b.number);

  return {
    name: course.way.tags.name ?? 'Golf course',
    attribution: '© OpenStreetMap contributors, ODbL',
    holes,
    mapped: { holes: holes.length, greens: greens.length, tees: tees.length, fairways: fairways.length, bunkers: bunkers.length, water: waters.length, pins: pins.filter((p) => inside(p, course.shape)).length },
  };
}

/**
 * The hole a golfer is on: the one whose line of play they are nearest.
 *
 * Standing on a green, the next tee is often closer than the hole just
 * played, so a change of hole only counts once the new hole's line is
 * `stick` metres nearer than the current one's.
 *
 * @param {{holes:Array}} course
 * @param {{lat:number, lon:number}} position
 * @param {{current?:number|null, stick?:number}} [options] current: the number of the hole being played
 * @returns {{hole:object, distance:number}|null} the hole, and the metres from the golfer to its line of play
 */
export function holeAt(course, position, { current = null, stick = 30 } = {}) {
  let best = null;
  let now = null;
  for (const hole of course.holes) {
    const { distance } = nearestOnLine(position, hole.line);
    if (!best || distance < best.distance) best = { hole, distance };
    if (hole.number === current) now = { hole, distance };
  }
  if (now && best && best.hole !== now.hole && now.distance - best.distance < stick) return now;
  return best;
}
