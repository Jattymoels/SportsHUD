// The small filter behind both progress along a route and distance covered
// off one. It tracks two numbers, a distance and a speed, from distance
// readings that arrive with GPS noise on them.
//
// A state is { t, d, v, p00, p01, p11 }: time, distance (m), speed (m/s),
// and how uncertain those two are.

/**
 * Carry a state forward to time `t`, at its current speed.
 * @param {number} accelNoise how freely speed may change, m²/s³
 */
export function predict(s, t, accelNoise) {
  const dt = Math.max(0, t - s.t);
  return {
    t,
    d: s.d + s.v * dt,
    v: s.v,
    p00: s.p00 + 2 * dt * s.p01 + dt * dt * s.p11 + (accelNoise * dt ** 3) / 3,
    p01: s.p01 + dt * s.p11 + (accelNoise * dt * dt) / 2,
    p11: s.p11 + accelNoise * dt,
  };
}

/** Fold a distance reading (good to about `sigma` metres) into a predicted state. */
export function correct(pred, reading, sigma) {
  const k0 = pred.p00 / (pred.p00 + sigma ** 2);
  const k1 = pred.p01 / (pred.p00 + sigma ** 2);
  const innovation = reading - pred.d;
  return {
    t: pred.t,
    d: pred.d + k0 * innovation,
    v: pred.v + k1 * innovation,
    p00: (1 - k0) * pred.p00,
    p01: (1 - k0) * pred.p01,
    p11: pred.p11 - k1 * pred.p01,
  };
}

/**
 * Hindsight. Given every step of a finished run of the filter, refine each
 * state using the readings that came after it (a Rauch-Tung-Striebel pass).
 *
 * @param {Array<{pred:object, filt:object, cut:boolean}>} steps the state
 *   before and after each reading. `cut` marks a reading that re-set the
 *   state rather than refining it; hindsight does not reach across one.
 * @returns {{t:Float64Array, d:Float64Array, v:Float64Array}}
 */
export function smooth(steps) {
  const n = steps.length;
  const t = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Float64Array(n);
  for (let k = n - 1; k >= 0; k--) {
    const f = steps[k].filt;
    t[k] = f.t;
    if (k === n - 1 || steps[k + 1].cut) {
      d[k] = f.d;
      v[k] = f.v;
      continue;
    }
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
  return { t, d, v };
}
