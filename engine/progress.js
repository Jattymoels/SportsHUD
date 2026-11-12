// Progress: how far along the route someone is, over time.
//
// Each GPS fix is snapped to the route, then a small filter tracks two
// numbers: distance along the route and speed. The filter is what makes the
// output steady (GPS noise is averaged out) and continuous (between fixes the
// position is carried forward at the current speed).
//
// The same filter serves two uses:
//   live       - createProgressTracker: uses only the fixes seen so far.
//   afterwards - projectRecording: a second, backward pass lets every
//                estimate also use the fixes that came after it.
//
// Away from the route there is nothing to measure progress against. A fix
// that is well off the route, from someone not travelling along it, holds
// progress where it was; the first fix back on the route picks it up again
// from wherever that is. (Someone far from the route but moving along it,
// on the other side of a wide road say, still counts as on it.)
//
// Nothing here knows what sport is being done.

import { snapToRoute } from './route.js';
import { predict, correct, smooth } from './filter.js';

export const PROGRESS_DEFAULTS = {
  gpsSigma: 3, // metres: assumed along-route error of one fix
  accelNoise: 0.5, // m²/s³: how freely speed may change (higher follows surges faster, smooths less)
  window: 20, // metres: how far either side of the expected position to look for the route
  startSpeedSigma: 5, // m/s: how uncertain the speed is at the first fix
  headingBaseline: 3, // metres moved before the direction of travel is trusted
  headingMaxAge: 15, // seconds: older movement says nothing about the current direction
  startNear: null, // metres along the route to expect the first fix at; by default, wherever fits best from the start
  offRoute: 15, // metres from the route beyond which a fix may count as off it
  alongRoute: 0.8, // how closely travel must follow the route's direction (1 = exactly) to count as on it anyway
  farOff: 50, // metres: beyond this from the route is off it even when travelling its way
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The filter itself. `update` returns the state before and after the fix. */
function createFilter(route, options) {
  const o = { ...PROGRESS_DEFAULTS, ...options };
  let s = null; // { t, d, v, p00, p01, p11, offset, offRoute }
  const trail = []; // recent fixes as { t, x, y }, newest last

  /** Direction of travel as a unit vector, from the recent fixes; null if barely moving. */
  function headingTo(t, x, y) {
    while (trail.length && t - trail[0].t > o.headingMaxAge) trail.shift();
    let heading = null;
    for (let i = trail.length - 1; i >= 0 && !heading; i--) {
      const dx = x - trail[i].x;
      const dy = y - trail[i].y;
      const moved = Math.hypot(dx, dy);
      if (moved >= o.headingBaseline) heading = [dx / moved, dy / moved];
    }
    trail.push({ t, x, y });
    return heading;
  }

  /**
   * Take in one fix. Returns the state before and after it. `cut` marks a
   * fix that held or re-set progress rather than refining it; estimates on
   * either side of a cut say nothing about each other.
   */
  function update(fix) {
    if (s && !(fix.t > s.t)) return null;
    // A fix the browser reports as inaccurate, or one that lands away from
    // the route, is trusted less rather than thrown away.
    const baseSigma = Math.max(o.gpsSigma, 0.7 * (fix.accuracy ?? 0));
    const [x, y] = route.proj.toXY(fix.lat, fix.lon);
    const heading = headingTo(fix.t, x, y);
    const isOff = (snap) => {
      if (snap.offset <= Math.max(o.offRoute, 3 * baseSigma)) return false;
      // Further than a wide road is across, it is another street, whichever way it runs.
      if (snap.offset > Math.max(o.farOff, 3 * baseSigma)) return true;
      const along = heading ? Math.abs(heading[0] * snap.dir[0] + heading[1] * snap.dir[1]) : 0;
      return along < o.alongRoute;
    };

    if (!s) {
      const snap = o.startNear == null ? snapToRoute(route, fix.lat, fix.lon) : snapToRoute(route, fix.lat, fix.lon, { near: o.startNear, window: 2 * o.window, gpsSigma: baseSigma, heading });
      const sigma = Math.max(baseSigma, snap.offset / 2);
      s = { t: fix.t, d: snap.dist, v: 0, p00: sigma ** 2, p01: 0, p11: o.startSpeedSigma ** 2, offset: snap.offset, offRoute: isOff(snap) };
      return { pred: s, filt: s, cut: true };
    }

    const pred = predict(s, fix.t, o.accelNoise);
    const expected = s.offRoute ? s.d : pred.d;
    const predSigma = Math.sqrt(pred.p00);
    const snap = snapToRoute(route, fix.lat, fix.lon, {
      near: clamp(expected, 0, route.length),
      window: o.window + 3 * predSigma,
      nearSigma: Math.max(predSigma, o.window / 2),
      gpsSigma: baseSigma,
      heading,
    });
    const sigma = Math.max(baseSigma, snap.offset / 2);

    // While progress is held, a match at the very end of the stretch searched
    // is not a return to the route: the place they came back to is further
    // on than the search reaches yet.
    if (isOff(snap) || (s.offRoute && snap.edge)) {
      // Hold progress; let the uncertainty grow so the search widens.
      s = { t: fix.t, d: s.d, v: s.v, p00: pred.p00, p01: pred.p01, p11: pred.p11, offset: snap.offset, offRoute: true };
      return { pred: s, filt: s, cut: true };
    }
    if (s.offRoute) {
      // Back on the route: take the position as found and keep the old speed.
      s = { t: fix.t, d: snap.dist, v: s.v, p00: sigma ** 2, p01: 0, p11: pred.p11, offset: snap.offset, offRoute: false };
      return { pred: s, filt: s, cut: true };
    }

    s = { ...correct(pred, snap.dist, sigma), offset: snap.offset, offRoute: false };
    return { pred, filt: s, cut: false };
  }

  return { update, state: () => s };
}

/**
 * Live progress along a route. Feed it fixes as they arrive; ask it where
 * the runner is at any moment.
 *
 * @param route from buildRoute
 * @param {Partial<typeof PROGRESS_DEFAULTS>} [options]
 */
export function createProgressTracker(route, options) {
  const filter = createFilter(route, options);
  return {
    /** @param {{t:number, lat:number, lon:number, accuracy?:number}} fix `t` in seconds on the runner's clock */
    update(fix) {
      filter.update(fix);
    },
    /**
     * Progress at time `t`, at or after the latest fix.
     * @returns {{t:number, dist:number, speed:number, offset:number, fixAge:number, offRoute:boolean}|null}
     *   dist: metres along the route. speed: m/s. offset: metres between the
     *   latest fix and the route. fixAge: seconds since the latest fix.
     *   offRoute: progress is being held because the latest fix was off the route.
     */
    at(t) {
      const s = filter.state();
      if (!s) return null;
      const fixAge = Math.max(0, t - s.t);
      return {
        t,
        dist: clamp(s.d + (s.offRoute ? 0 : s.v * fixAge), 0, route.length),
        speed: s.v,
        offset: s.offset,
        fixAge,
        offRoute: s.offRoute,
      };
    },
  };
}

/**
 * Progress of a whole recording, computed afterwards.
 *
 * @param route from buildRoute
 * @param {Array<{t:number, lat:number, lon:number, accuracy?:number}>} fixes
 * @returns {{t:Float64Array, dist:Float64Array, off:Uint8Array}} seconds on
 *   the recording's clock, and metres along the route at each of those
 *   times. off: 1 where that fix was off the route, with progress held.
 */
export function projectRecording(route, fixes, options) {
  const filter = createFilter(route, options);
  const steps = [];
  for (const fix of fixes) {
    const step = filter.update(fix);
    if (step) steps.push(step);
  }
  const n = steps.length;
  if (n === 0) throw new Error('Recording has no usable fixes');

  const { t, d } = smooth(steps);
  for (let k = 0; k < n; k++) d[k] = clamp(d[k], 0, route.length);
  return { t, dist: d, off: Uint8Array.from(steps, (step) => (step.filt.offRoute ? 1 : 0)) };
}

/** The same profile with distance never going backwards, so each distance has one arrival time. */
export function monotone(profile) {
  const dist = Float64Array.from(profile.dist);
  for (let i = 1; i < dist.length; i++) dist[i] = Math.max(dist[i], dist[i - 1]);
  return { t: profile.t, dist };
}

/** Distance along the route at time `t`, held at the ends outside the recording. */
export function distAtTime(profile, t) {
  const { t: ts, dist } = profile;
  const last = ts.length - 1;
  if (t <= ts[0]) return dist[0];
  if (t >= ts[last]) return dist[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  return dist[lo] + ((t - ts[lo]) / (ts[hi] - ts[lo])) * (dist[hi] - dist[lo]);
}

/**
 * Time at which a monotone profile first reached distance `d`. Held at the
 * ends: before the first sample's distance it is the start time, and beyond
 * the last sample's distance it is the end time.
 */
export function timeAtDist(profile, d) {
  const { t: ts, dist } = profile;
  const last = ts.length - 1;
  if (d <= dist[0]) return ts[0];
  if (d > dist[last]) return ts[last];
  let lo = 0; // dist[lo] < d
  let hi = last; // dist[hi] >= d
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] < d) lo = mid;
    else hi = mid;
  }
  return ts[lo] + ((d - dist[lo]) / (dist[hi] - dist[lo])) * (ts[hi] - ts[lo]);
}
