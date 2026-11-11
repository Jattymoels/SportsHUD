// A route is the line a ghost recording drew on the ground. Everything else
// in the engine works in one dimension: metres along this line.

import { haversine, createProjection } from './geo.js';

/**
 * Build a route from recorded points.
 *
 * A point is kept once it is `minSpacing` metres from the last kept point,
 * so GPS jitter while someone stands still does not pile up fake distance.
 * Where the track doubles back (a turnaround) the furthest point reached is
 * kept as well, so the corner is not cut off.
 *
 * @param {Array<{lat:number, lon:number}>} points
 * @param {{minSpacing?: number}} [opts]
 */
export function buildRoute(points, { minSpacing = 5 } = {}) {
  const gap = (a, b) => haversine(a.lat, a.lon, b.lat, b.lon);
  const kept = [];
  let far = null; // furthest skipped point since the last kept one
  let farGap = 0;
  for (const p of points) {
    const last = kept[kept.length - 1];
    const d = last ? gap(last, p) : Infinity;
    if (d < minSpacing) {
      if (far && gap(far, p) >= minSpacing) {
        kept.push(far, p); // came back from `far`: a turnaround
        far = null;
        farGap = 0;
      } else if (d > farGap) {
        far = p;
        farGap = d;
      }
      continue;
    }
    kept.push(p);
    far = null;
    farGap = 0;
  }
  // End exactly where the recording ended.
  const end = points[points.length - 1];
  const tail = kept[kept.length - 1];
  if (end && tail && end !== tail && gap(tail, end) > 0.01) kept.push(end);
  if (kept.length < 2) throw new Error('Route needs at least two distinct points');

  const n = kept.length;
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const p of kept) {
    latMin = Math.min(latMin, p.lat);
    latMax = Math.max(latMax, p.lat);
    lonMin = Math.min(lonMin, p.lon);
    lonMax = Math.max(lonMax, p.lon);
  }
  const proj = createProjection((latMin + latMax) / 2, (lonMin + lonMax) / 2);

  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const cum = new Float64Array(n); // metres from the start to each point
  for (let i = 0; i < n; i++) {
    lat[i] = kept[i].lat;
    lon[i] = kept[i].lon;
    [x[i], y[i]] = proj.toXY(lat[i], lon[i]);
    if (i > 0) cum[i] = cum[i - 1] + haversine(lat[i - 1], lon[i - 1], lat[i], lon[i]);
  }
  return { lat, lon, x, y, cum, length: cum[n - 1], proj };
}

/** Index of the segment that contains distance `d` along the route. */
function segmentAt(route, d) {
  const { cum } = route;
  let lo = 0;
  let hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Closest point on segment `i` to (px, py), and the segment's direction. */
function projectOnSegment(route, i, px, py) {
  const { x, y, cum } = route;
  const dx = x[i + 1] - x[i];
  const dy = y[i + 1] - y[i];
  const len2 = dx * dx + dy * dy;
  let f = len2 > 0 ? ((px - x[i]) * dx + (py - y[i]) * dy) / len2 : 0;
  f = Math.max(0, Math.min(1, f));
  const ox = px - (x[i] + f * dx);
  const oy = py - (y[i] + f * dy);
  const len = Math.sqrt(len2) || 1;
  return { dist: cum[i] + f * (cum[i + 1] - cum[i]), offset2: ox * ox + oy * oy, ux: dx / len, uy: dy / len };
}

// How strongly a candidate is marked down when the route there runs against
// the direction of travel: the same as being this many `gpsSigma` off the route.
const WRONG_WAY_SIGMAS = 4;

/**
 * Snap a position to the route.
 *
 * Without `near`, the whole route is searched and the earliest good match
 * wins, so on a loop someone standing at the start is placed at the start,
 * not the finish.
 *
 * With `near` (the expected distance along the route) only the stretch
 * within `window` metres of it is searched. Where the route passes the
 * position more than once (an out-and-back, a lap, a hairpin, a crossing)
 * each pass is a candidate. The choice weighs three things: how far the
 * position is from the route (against `gpsSigma`), whether the route there
 * runs the way the person is moving (`heading`), and how far the candidate
 * is from where we expected to be (against `nearSigma`).
 *
 * @param {object} [opts]
 * @param {number} [opts.near] expected metres along the route
 * @param {number} [opts.window] metres either side of `near` to search
 * @param {number} [opts.nearSigma] how uncertain `near` is, metres
 * @param {number} [opts.gpsSigma] how uncertain the position is, metres
 * @param {[number, number]} [opts.heading] unit vector of travel in the route's x/y frame
 * @returns {{dist:number, offset:number}} metres along the route, and metres
 *   between the position and the route.
 */
export function snapToRoute(route, lat, lon, opts = {}) {
  const { near = null, window = Infinity, nearSigma = 5, gpsSigma = 3, heading = null, startTolerance = 15 } = opts;
  const [px, py] = route.proj.toXY(lat, lon);
  const lastSeg = route.cum.length - 2;
  const from = near == null ? 0 : segmentAt(route, Math.max(0, near - window));
  const to = near == null ? lastSeg : segmentAt(route, Math.min(route.length, near + window));

  const hits = [];
  for (let i = from; i <= to; i++) hits.push(projectOnSegment(route, i, px, py));
  const result = (hit) => ({ dist: hit.dist, offset: Math.sqrt(hit.offset2) });

  if (near == null) {
    const best = Math.sqrt(hits.reduce((least, h) => Math.min(least, h.offset2), Infinity));
    const limit = (best + startTolerance) ** 2;
    let i = hits.findIndex((h) => h.offset2 <= limit);
    while (i < hits.length - 1 && hits[i + 1].offset2 <= hits[i].offset2) i++;
    return result(hits[i]);
  }

  for (const h of hits) {
    h.cost = h.offset2 / gpsSigma ** 2;
    if (heading) {
      const along = h.ux * heading[0] + h.uy * heading[1]; // 1 with the route, -1 against it
      if (along < 0) h.cost += (WRONG_WAY_SIGMAS * along) ** 2;
    }
  }
  // One candidate per pass of the route: the local minima of the cost.
  let chosen = null;
  let bestScore = Infinity;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (i > 0 && hits[i - 1].cost < h.cost) continue;
    if (i < hits.length - 1 && hits[i + 1].cost <= h.cost) continue;
    const score = h.cost + ((h.dist - near) / nearSigma) ** 2;
    if (score < bestScore) {
      bestScore = score;
      chosen = h;
    }
  }
  return result(chosen);
}

/** The point `d` metres along the route, clamped to its ends. */
export function pointAtDistance(route, d) {
  const dist = Math.max(0, Math.min(route.length, d));
  const i = segmentAt(route, dist);
  const span = route.cum[i + 1] - route.cum[i];
  const f = span > 0 ? (dist - route.cum[i]) / span : 0;
  const x = route.x[i] + f * (route.x[i + 1] - route.x[i]);
  const y = route.y[i] + f * (route.y[i + 1] - route.y[i]);
  const [lat, lon] = route.proj.toLatLon(x, y);
  return { lat, lon, x, y };
}
