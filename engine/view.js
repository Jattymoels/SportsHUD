// Where things on the route appear to someone running it.
//
// A ghost on the road ahead is a much smaller problem than putting any
// picture anywhere in the world. It is always somewhere along a line that is
// known in advance, and usually in front of the runner. This file works out
// where it appears, in degrees from the way the head is facing, so that two
// questions can be answered with numbers rather than guesses: how big a
// display has to be, and where in the view it has to sit, for the ghost to
// be on it.
//
// Angles are in degrees. Bearings run clockwise from north; "right" and
// "up" are measured from the way the head faces.

import { pointAtDistance } from './route.js';

export const VIEW_DEFAULTS = {
  eye: 1.6, // metres: the runner's eyes above the ground
  tall: 1.75, // metres: how tall the ghost stands
  lookAhead: 15, // metres along the route to the place the runner's head points at
  pitch: -5, // degrees the head is tipped from level: a runner looks slightly down
  smooth: 12, // metres either side over which the route's GPS wobble is averaged out
};

const DEG = 180 / Math.PI;
const turn = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;

/**
 * The point `d` metres along the route, with GPS wobble averaged out over
 * `over` metres either side, so that the path and the view along it are
 * steady.
 */
export function smoothPoint(route, d, over = VIEW_DEFAULTS.smooth) {
  let x = 0;
  let y = 0;
  for (const shift of [-over, -over / 2, 0, over / 2, over]) {
    const p = pointAtDistance(route, d + shift);
    x += p.x / 5;
    y += p.y / 5;
  }
  return { x, y };
}

/** The compass bearing from the place `from` metres along the route to the place `to` metres along it. */
export function bearingAlong(route, from, to) {
  const a = smoothPoint(route, from);
  const b = smoothPoint(route, to);
  return ((Math.atan2(b.x - a.x, b.y - a.y) * DEG) % 360 + 360) % 360;
}

/**
 * Where something standing on the route appears from further back on it.
 *
 * @param route from buildRoute
 * @param {number} dist metres along the route the runner is
 * @param {number} targetDist metres along the route the ghost, or anything else, is
 * @param {Partial<typeof VIEW_DEFAULTS> & {facing?: number}} [options]
 *   `facing`: the bearing the head faces; otherwise it points at the place
 *   `lookAhead` metres on along the route
 * @returns {{range:number, right:number, feet:number, head:number, tall:number}}
 *   range: metres away in a straight line. right: degrees to the right of
 *   where the head faces (negative is left). feet, head: degrees above where
 *   the head faces for the bottom and top of a figure standing there. tall:
 *   degrees from feet to head.
 */
export function sight(route, dist, targetDist, options) {
  const o = { ...VIEW_DEFAULTS, ...options };
  const here = smoothPoint(route, dist, o.smooth);
  const there = smoothPoint(route, targetDist, o.smooth);
  const range = Math.hypot(there.x - here.x, there.y - here.y);
  const bearing = Math.atan2(there.x - here.x, there.y - here.y) * DEG;
  const facing = o.facing ?? bearingAlong(route, dist, Math.min(route.length, dist + Math.max(2, o.lookAhead)));
  const feet = -Math.atan2(o.eye, Math.max(range, 0.01)) * DEG - o.pitch;
  const head = Math.atan2(o.tall - o.eye, Math.max(range, 0.01)) * DEG - o.pitch;
  return { range, right: turn(facing, bearing), feet, head, tall: head - feet };
}

/**
 * Whether a display shows something at a given place in the view.
 *
 * @param {{right:number, feet:number, head:number}} seen from sight()
 * @param {{w:number, h:number, right?:number, up?:number}} display degrees it
 *   covers across and down, and how far its centre sits to the right of and
 *   above the way the head faces
 * @returns {'whole'|'part'|'out'} the whole figure, its middle at least, or neither
 */
export function onDisplay(seen, display) {
  const across = Math.abs(seen.right - (display.right ?? 0)) <= display.w / 2;
  const bottom = (display.up ?? 0) - display.h / 2;
  const top = (display.up ?? 0) + display.h / 2;
  const middle = (seen.feet + seen.head) / 2;
  if (!across || middle < bottom || middle > top) return 'out';
  return seen.feet >= bottom && seen.head <= top ? 'whole' : 'part';
}

/**
 * Over a whole route: how much of the way a display would show a ghost that
 * is a given distance ahead.
 *
 * @param route from buildRoute
 * @param {number} lead metres the ghost is ahead
 * @param {{w:number, h:number, right?:number, up?:number}} display
 * @param {Partial<typeof VIEW_DEFAULTS> & {every?: number}} [options] `every`: metres between the places checked
 * @returns {{shown:number, whole:number, longestGap:number, tall:number}}
 *   shown: the share of the route, 0 to 1, on which at least the ghost's
 *   middle is on the display. whole: the share on which all of it is.
 *   longestGap: the longest stretch, in metres, with the ghost off the
 *   display. tall: degrees the ghost typically stands at that distance.
 */
export function coverage(route, lead, display, options) {
  const every = options?.every ?? 5;
  let places = 0;
  let shown = 0;
  let whole = 0;
  let gap = 0;
  let longestGap = 0;
  let tall = 0;
  for (let d = 0; d + lead <= route.length; d += every) {
    const seen = sight(route, d, d + lead, options);
    const how = onDisplay(seen, display);
    places++;
    tall += seen.tall;
    if (how === 'out') gap += every;
    else {
      shown++;
      gap = 0;
    }
    if (how === 'whole') whole++;
    longestGap = Math.max(longestGap, gap);
  }
  return places ? { shown: shown / places, whole: whole / places, longestGap, tall: tall / places } : { shown: 0, whole: 0, longestGap: 0, tall: 0 };
}
