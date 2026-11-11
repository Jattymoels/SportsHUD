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
// Nothing here knows what sport is being done.

import { snapToRoute } from './route.js';

export const PROGRESS_DEFAULTS = {
  gpsSigma: 3, // metres: assumed along-route error of one fix
  accelNoise: 0.5, // m²/s³: how freely speed may change (higher follows surges faster, smooths less)
  window: 20, // metres: how far either side of the expected position to look for the route
  startSpeedSigma: 5, // m/s: how uncertain the speed is at the first fix
  headingBaseline: 3, // metres moved before the direction of travel is trusted
  headingMaxAge: 15, // seconds: older movement says nothing about the current direction
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The filter itself. `update` returns the state before and after the fix. */
function createFilter(route, options) {
  const o = { ...PROGRESS_DEFAULTS, ...options };
  let s = null; // { t, d, v, p00, p01, p11, offset }
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

  function predict(t) {
    const dt = Math.max(0, t - s.t);
    const q = o.accelNoise;
    return {
      d: s.d + s.v * dt,
      v: s.v,
      p00: s.p00 + 2 * dt * s.p01 + dt * dt * s.p11 + (q * dt ** 3) / 3,
      p01: s.p01 + dt * s.p11 + (q * dt * dt) / 2,
      p11: s.p11 + q * dt,
    };
  }

  function update(fix) {
    // A fix the browser reports as inaccurate, or one that lands far from
    // the route, is trusted less rather than thrown away.
    const baseSigma = Math.max(o.gpsSigma, 0.7 * (fix.accuracy ?? 0));

    if (s && !(fix.t > s.t)) return null;
    const [x, y] = route.proj.toXY(fix.lat, fix.lon);
    const heading = headingTo(fix.t, x, y);

    if (!s) {
      const snap = snapToRoute(route, fix.lat, fix.lon);
      const sigma = Math.max(baseSigma, snap.offset / 2);
      s = { t: fix.t, d: snap.dist, v: 0, p00: sigma ** 2, p01: 0, p11: o.startSpeedSigma ** 2, offset: snap.offset };
      return { pred: s, filt: s };
    }
    const pred = predict(fix.t);
    const predSigma = Math.sqrt(pred.p00);
    const snap = snapToRoute(route, fix.lat, fix.lon, {
      near: clamp(pred.d, 0, route.length),
      window: o.window + 3 * predSigma,
      nearSigma: Math.max(predSigma, o.window / 2),
      gpsSigma: baseSigma,
      heading,
    });
    const sigma = Math.max(baseSigma, snap.offset / 2);
    const k0 = pred.p00 / (pred.p00 + sigma ** 2);
    const k1 = pred.p01 / (pred.p00 + sigma ** 2);
    const innovation = snap.dist - pred.d;
    s = {
      t: fix.t,
      d: pred.d + k0 * innovation,
      v: pred.v + k1 * innovation,
      p00: (1 - k0) * pred.p00,
      p01: (1 - k0) * pred.p01,
      p11: pred.p11 - k1 * pred.p01,
      offset: snap.offset,
    };
    return { pred, filt: s };
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
     * @returns {{t:number, dist:number, speed:number, offset:number, fixAge:number}|null}
     *   dist: metres along the route. speed: m/s. offset: metres between the
     *   latest fix and the route. fixAge: seconds since the latest fix.
     */
    at(t) {
      const s = filter.state();
      if (!s) return null;
      const fixAge = Math.max(0, t - s.t);
      return {
        t,
        dist: clamp(s.d + s.v * fixAge, 0, route.length),
        speed: s.v,
        offset: s.offset,
        fixAge,
      };
    },
  };
}

/**
 * Progress of a whole recording, computed afterwards.
 *
 * @param route from buildRoute
 * @param {Array<{t:number, lat:number, lon:number, accuracy?:number}>} fixes
 * @returns {{t:Float64Array, dist:Float64Array}} seconds on the recording's
 *   clock, and metres along the route at each of those times.
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

  // Backward (Rauch-Tung-Striebel) pass over the forward filter's states.
  const d = new Float64Array(n);
  const v = new Float64Array(n);
  d[n - 1] = steps[n - 1].filt.d;
  v[n - 1] = steps[n - 1].filt.v;
  for (let k = n - 2; k >= 0; k--) {
    const f = steps[k].filt;
    const p = steps[k + 1].pred;
    const dt = steps[k + 1].filt.t - f.t;
    const m00 = f.p00 + f.p01 * dt;
    const m10 = f.p01 + f.p11 * dt;
    const det = p.p00 * p.p11 - p.p01 * p.p01;
    const c00 = (m00 * p.p11 - f.p01 * p.p01) / det;
    const c01 = (f.p01 * p.p00 - m00 * p.p01) / det;
    const c10 = (m10 * p.p11 - f.p11 * p.p01) / det;
    const c11 = (f.p11 * p.p00 - m10 * p.p01) / det;
    const ed = d[k + 1] - p.d;
    const ev = v[k + 1] - p.v;
    d[k] = f.d + c00 * ed + c01 * ev;
    v[k] = f.v + c10 * ed + c11 * ev;
  }

  const t = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    t[k] = steps[k].filt.t;
    d[k] = clamp(d[k], 0, route.length);
  }
  return { t, dist: d };
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
