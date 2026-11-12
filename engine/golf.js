// Golf: distances and landing zones on a mapped hole. Plain numbers, no
// display code, like the rest of the engine.
//
// A hole is described by positions on the ground:
//
//   { number, par,
//     tee:   { lat, lon },
//     green: [{ lat, lon }, ...]            its outline
//     pin:   { lat, lon }                   optional; today's hole position
//     line:  [{ lat, lon }, ...]            the line of play, tee to green
//     hazards: [{ kind: 'bunker' | 'water', name, shape: [{ lat, lon }, ...] }] }
//
// which is what OpenStreetMap's golf tags give (golf=green, golf=bunker,
// golf=hole and so on). Distances are metres, bearings degrees clockwise
// from north, wind in km/h.

import { haversine, createProjection } from './geo.js';

const RAD = Math.PI / 180;

/** Compass bearing from one position to another, degrees clockwise from north, 0 to 360. */
export function bearingTo(from, to) {
  const [x, y] = createProjection(from.lat, from.lon).toXY(to.lat, to.lon);
  return (Math.atan2(x, y) / RAD + 360) % 360;
}

/** Metres between two positions. */
export const distanceTo = (from, to) => haversine(from.lat, from.lon, to.lat, to.lon);

/** The difference between two bearings as the short way round, -180 to 180: positive is clockwise. */
export const turnBetween = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;

/** The position `metres` from `from` on bearing `bearing`. */
export function pointAlong(from, bearing, metres) {
  const [lat, lon] = createProjection(from.lat, from.lon).toLatLon(metres * Math.sin(bearing * RAD), metres * Math.cos(bearing * RAD));
  return { lat, lon };
}

/** The middle of an outline: the centre of its area. */
export function centreOf(shape) {
  const proj = createProjection(shape[0].lat, shape[0].lon);
  const pts = shape.map((p) => proj.toXY(p.lat, p.lon));
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    // A line or a point rather than an outline: the average of its points.
    cx = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
    cy = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
  } else {
    cx /= 3 * area;
    cy /= 3 * area;
  }
  const [lat, lon] = proj.toLatLon(cx, cy);
  return { lat, lon };
}

/**
 * Where a straight line from `from` on `bearing` crosses an outline: the
 * distances, in metres from `from`, at which it enters and leaves, nearest
 * first. Empty if it misses.
 */
export function crossings(from, bearing, shape) {
  const proj = createProjection(from.lat, from.lon);
  const pts = shape.map((p) => proj.toXY(p.lat, p.lon));
  const dx = Math.sin(bearing * RAD);
  const dy = Math.cos(bearing * RAD);
  const hits = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const ex = bx - ax;
    const ey = by - ay;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) continue; // parallel to this edge
    const along = (ax * ey - ay * ex) / denom; // metres from `from`
    const onEdge = (ax * dy - ay * dx) / denom; // 0 to 1 along the edge
    if (along >= 0 && onEdge >= 0 && onEdge < 1) hits.push(along);
  }
  return hits.sort((a, b) => a - b);
}

/** Is this position inside the outline? */
export function inside(position, shape) {
  return crossings(position, 0, shape).length % 2 === 1;
}

/**
 * Distances to the front, centre and back of the green, as a golfer means
 * them: along the line from where they stand through the middle of the
 * green. Front is where that line reaches the green, back where it leaves.
 *
 * @param {{lat:number, lon:number}} position
 * @param {Array<{lat:number, lon:number}>} green its outline
 * @returns {{front:number, centre:number, back:number, bearing:number, onGreen:boolean}}
 *   metres, and the bearing to the centre. On the green, front is 0.
 */
export function greenDistances(position, green) {
  const centre = centreOf(green);
  const bearing = bearingTo(position, centre);
  const hits = crossings(position, bearing, green);
  const onGreen = hits.length % 2 === 1;
  const middle = distanceTo(position, centre);
  return {
    front: onGreen ? 0 : hits[0] ?? middle,
    centre: middle,
    back: hits[hits.length - 1] ?? middle,
    bearing,
    onGreen,
  };
}

// ----------------------------------------------------------------- wind --

/**
 * How much wind moves a shot. These are rules of thumb, not measurements:
 * a headwind costs more than a tailwind gives, and a crosswind pushes the
 * ball sideways in proportion to how far it flies. They are here to be
 * replaced by something learned from real shots.
 */
export const WIND_MODEL = {
  headPerKmh: 0.006, // share of carry lost per km/h of headwind (about 1% per mph)
  tailPerKmh: 0.003, // share of carry gained per km/h of tailwind (about half that)
  crossPerKmh: 0.004, // metres sideways per metre of carry, per km/h of crosswind
};

/**
 * A club's carry in the wind.
 *
 * @param {number} carry metres the club carries in still air
 * @param {{speed:number, from:number}|null} wind km/h, and the bearing it blows FROM
 * @param {number} aim bearing the shot is aimed on
 * @returns {{carry:number, drift:number, head:number, cross:number}}
 *   carry: metres it carries in this wind. drift: metres it lands to the
 *   right of the aim line (negative is left). head: km/h of wind against
 *   the shot (negative is helping). cross: km/h of wind from the left
 *   (negative is from the right).
 */
export function carryInWind(carry, wind, aim, model = WIND_MODEL) {
  if (!wind || !(wind.speed > 0)) return { carry, drift: 0, head: 0, cross: 0 };
  const angle = turnBetween(aim, wind.from) * RAD; // 0: blowing straight at the golfer
  const head = wind.speed * Math.cos(angle);
  const cross = -wind.speed * Math.sin(angle); // from the left pushes the ball right
  const change = head > 0 ? -model.headPerKmh * head : model.tailPerKmh * -head;
  const flown = carry * Math.max(0.3, 1 + change);
  return { carry: flown, drift: model.crossPerKmh * cross * flown, head, cross };
}

// ---------------------------------------------------------------- clubs --

/** A bag to start from: carry in metres in still air. Meant to be replaced by the golfer's own. */
export const DEFAULT_CLUBS = [
  { name: 'Driver', carry: 205 },
  { name: '3 wood', carry: 185 },
  { name: '5 wood', carry: 172 },
  { name: '4 iron', carry: 162 },
  { name: '5 iron', carry: 153 },
  { name: '6 iron', carry: 144 },
  { name: '7 iron', carry: 135 },
  { name: '8 iron', carry: 125 },
  { name: '9 iron', carry: 115 },
  { name: 'Pitching wedge', carry: 105 },
  { name: 'Gap wedge', carry: 92 },
  { name: 'Sand wedge', carry: 78 },
  { name: 'Lob wedge', carry: 62 },
];

/** How big a landing zone is drawn: half its depth and half its width, as shares of the carry, with a floor in metres. */
export const ZONE = { deep: 0.05, wide: 0.08, least: 4 };

/**
 * Where a club lands the ball: the middle of the zone, and its size.
 *
 * @param {{lat:number, lon:number}} position where the golfer stands
 * @param {number} aim bearing the shot is aimed on
 * @param {{name:string, carry:number}} club
 * @param {{speed:number, from:number}|null} [wind]
 * @returns {{centre:{lat:number, lon:number}, carry:number, drift:number, stillCarry:number,
 *   bearing:number, deep:number, wide:number}}
 *   centre: where the middle of the zone is. carry, drift: as from
 *   carryInWind. bearing: the zone's long axis, which is the aim. deep,
 *   wide: half its length along the aim and half its width across it.
 */
export function landingZone(position, aim, club, wind = null, model = WIND_MODEL) {
  const flight = carryInWind(club.carry, wind, aim, model);
  const onLine = pointAlong(position, aim, flight.carry);
  return {
    centre: pointAlong(onLine, aim + 90, flight.drift),
    carry: flight.carry,
    drift: flight.drift,
    stillCarry: club.carry,
    bearing: aim,
    deep: Math.max(ZONE.least, ZONE.deep * club.carry),
    wide: Math.max(ZONE.least, ZONE.wide * club.carry),
  };
}

/**
 * The club whose carry in this wind comes nearest to a distance.
 * @returns {{club:object, carry:number, short:number}} short: metres the
 *   club comes up short of the distance (negative: it carries past).
 */
export function clubFor(distance, aim, clubs = DEFAULT_CLUBS, wind = null, model = WIND_MODEL) {
  let best = null;
  for (const club of clubs) {
    const { carry } = carryInWind(club.carry, wind, aim, model);
    if (!best || Math.abs(distance - carry) < Math.abs(best.short)) best = { club, carry, short: distance - carry };
  }
  return best;
}

/** Does a landing zone reach into an outline? Checked at its middle and round its edge. */
export function zoneTouches(zone, shape) {
  const spots = [zone.centre];
  for (let a = 0; a < 360; a += 30) {
    const along = zone.deep * Math.cos(a * RAD);
    const across = zone.wide * Math.sin(a * RAD);
    spots.push(pointAlong(pointAlong(zone.centre, zone.bearing, along), zone.bearing + 90, across));
  }
  return spots.some((spot) => inside(spot, shape));
}

// -------------------------------------------------------------- hazards --

/**
 * The hazards that matter from here: for each one ahead and near the aim
 * line, how far to reach it and how far to carry it.
 *
 * @param {{lat:number, lon:number}} position
 * @param {number} aim bearing the shot is aimed on
 * @param {Array<{kind:string, name:string, shape:Array}>} hazards
 * @param {{within?:number}} [options] degrees either side of the aim that count as in play
 * @returns {Array<{kind:string, name:string, reach:number, carry:number, off:number}>}
 *   nearest first. reach: metres to its near edge. carry: metres to clear
 *   its far edge. off: degrees it lies to the right of the aim (negative is
 *   left). Reach and carry are taken along the line to its middle.
 */
export function hazardsInPlay(position, aim, hazards, { within = 25 } = {}) {
  const out = [];
  for (const hazard of hazards) {
    const middle = centreOf(hazard.shape);
    const bearing = bearingTo(position, middle);
    const off = turnBetween(aim, bearing);
    if (Math.abs(off) > within) continue;
    const hits = crossings(position, bearing, hazard.shape);
    if (!hits.length) continue;
    out.push({ kind: hazard.kind, name: hazard.name, reach: hits.length % 2 ? 0 : hits[0], carry: hits[hits.length - 1], off });
  }
  return out.sort((a, b) => a.reach - b.reach);
}

// -------------------------------------------------------- look to range --

/**
 * Look to range: the mapped thing the golfer is looking towards, and how
 * far it is.
 *
 * @param {{lat:number, lon:number}} position
 * @param {number} heading bearing the golfer is facing
 * @param {Array<{name:string, kind:string, at?:{lat:number, lon:number}, shape?:Array}>} features
 *   each with a position, or an outline whose middle is used
 * @param {{within?:number, nearest?:number}} [options] within: degrees
 *   either side of the gaze a feature may be and still be the one meant.
 *   nearest: features closer than this many metres are ignored, since the
 *   bearing to something at your feet means nothing.
 * @returns {{feature:object, distance:number, off:number, others:Array}|null}
 *   the feature nearest the line of gaze: its distance in metres and how
 *   many degrees it is to the right of the gaze (negative is left).
 *   others: the rest within reach, in order, for a display to hint at. Null
 *   if nothing is within reach; see lookAround for which way to turn.
 */
export function lookTarget(position, heading, features, { within = 7.5, nearest = 5 } = {}) {
  const seen = lookAround(position, heading, features, { nearest }).filter((f) => Math.abs(f.off) <= within);
  if (!seen.length) return null;
  seen.sort((a, b) => Math.abs(a.off) - Math.abs(b.off));
  return { ...seen[0], others: seen.slice(1) };
}

/**
 * Every feature with its distance and how far round it is from the gaze,
 * nearest to the line of gaze first. For a cue to turn towards something
 * outside the display.
 */
export function lookAround(position, heading, features, { nearest = 5 } = {}) {
  return features
    .map((feature) => {
      const at = feature.at ?? centreOf(feature.shape);
      return { feature, distance: distanceTo(position, at), off: turnBetween(heading, bearingTo(position, at)) };
    })
    .filter((f) => f.distance >= nearest)
    .sort((a, b) => Math.abs(a.off) - Math.abs(b.off));
}

/** A hole's features for looking at: the green, the pin if there is one, and each hazard. */
export function featuresOf(hole) {
  return [
    { name: 'Green', kind: 'green', shape: hole.green },
    ...(hole.pin ? [{ name: 'Pin', kind: 'pin', at: hole.pin }] : []),
    ...(hole.hazards ?? []).map((h) => ({ name: h.name, kind: h.kind, shape: h.shape })),
  ];
}

// ------------------------------------------------------ hide at address --

export const ADDRESS_DEFAULTS = {
  downBelow: -40, // degrees below the horizon the gaze must drop to count as looking at the ball
  upAbove: -25, // and it must come back above this for the display to return
  after: 0.3, // seconds it must stay down before the display hides: a glance at your feet is not an address
};

/**
 * Hide the display while the golfer is looking down at the ball.
 *
 * Feed it the pitch of the gaze as it changes; it says whether the display
 * should be hidden. Two angles rather than one, so that a head held near
 * the line does not make the display flicker.
 *
 * @returns {{update(pitch:number, t:number): boolean}} pitch in degrees
 *   above the horizon (looking down is negative), t in seconds. Returns
 *   true while the display should be hidden.
 */
export function createAddressHider(options) {
  const o = { ...ADDRESS_DEFAULTS, ...options };
  let downSince = null;
  let hidden = false;
  return {
    update(pitch, t) {
      if (pitch <= o.downBelow) {
        downSince ??= t;
        if (t - downSince >= o.after) hidden = true;
      } else {
        downSince = null;
        if (pitch >= o.upAbove) hidden = false;
      }
      return hidden;
    },
  };
}

// ------------------------------------------------------- course checks --

/**
 * Score distance checks against a rangefinder or a course marker (B7).
 *
 * @param {Array<{app:number, measured:number}>} readings metres: what the
 *   app said, and what the rangefinder or marker said
 * @param {{within?:number, share?:number, least?:number}} [target] a
 *   reading is good within `within` metres; the check passes when `share`
 *   of at least `least` readings are good
 * @returns {{count:number, good:number, worst:number, typical:number, pass:boolean|null}}
 *   worst and typical: the largest and the median difference, metres. pass
 *   is null until there are `least` readings.
 */
export function scoreDistances(readings, { within = 5, share = 0.9, least = 10 } = {}) {
  const off = readings.map((r) => Math.abs(r.app - r.measured)).sort((a, b) => a - b);
  const good = off.filter((d) => d <= within).length;
  return {
    count: off.length,
    good,
    worst: off.length ? off[off.length - 1] : 0,
    typical: off.length ? off[(off.length - 1) >> 1] : 0,
    pass: off.length >= least ? good / off.length >= share : null,
  };
}

/**
 * Score look-to-range checks (B9): was the feature named the one being
 * looked at?
 * @param {Array<{right:boolean}>} looks
 * @returns {{count:number, right:number, pass:boolean|null}} pass is null until there are `least` looks
 */
export function scoreLooks(looks, { share = 0.8, least = 10 } = {}) {
  const right = looks.filter((l) => l.right).length;
  return { count: looks.length, right, pass: looks.length >= least ? right / looks.length >= share : null };
}
