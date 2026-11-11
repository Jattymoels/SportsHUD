// Distance covered, with no route to measure against.
//
// Adding up the gaps between GPS fixes over-counts: every wobble of the
// signal looks like movement, most of all while standing still. So movement
// is only counted once it has gone `minSpacing` metres from the last counted
// point, and the same filter that steadies progress along a route steadies
// the total. Sharp corners and turnarounds are cut by a few metres each.

import { haversine } from './geo.js';
import { predict, correct, smooth } from './filter.js';

export const ODOMETER_DEFAULTS = {
  minSpacing: 5, // metres from the last counted point before more distance is counted
  gpsSigma: 3, // metres: assumed error of one fix
  accelNoise: 0.5, // m²/s³: how freely speed may change
  startSpeedSigma: 5, // m/s: how uncertain the speed is at the first fix
};

function createMeter(options) {
  const o = { ...ODOMETER_DEFAULTS, ...options };
  let s = null;
  let anchor = null; // the last counted point
  let counted = 0; // metres counted up to the anchor

  function update(fix) {
    if (s && !(fix.t > s.t)) return null;
    if (!s) {
      anchor = fix;
      s = { t: fix.t, d: 0, v: 0, p00: 0, p01: 0, p11: o.startSpeedSigma ** 2 };
      return { pred: s, filt: s, cut: true };
    }
    const away = haversine(anchor.lat, anchor.lon, fix.lat, fix.lon);
    const reading = counted + away;
    if (away >= o.minSpacing) {
      counted = reading;
      anchor = fix;
    }
    const pred = predict(s, fix.t, o.accelNoise);
    s = correct(pred, reading, Math.max(o.gpsSigma, 0.7 * (fix.accuracy ?? 0)));
    return { pred, filt: s, cut: false };
  }

  return { update, state: () => s };
}

/**
 * Live distance covered. Feed it fixes as they arrive; ask it how far the
 * runner has gone at any moment.
 * @param {Partial<typeof ODOMETER_DEFAULTS>} [options]
 */
export function createOdometer(options) {
  const meter = createMeter(options);
  return {
    /** @param {{t:number, lat:number, lon:number, accuracy?:number}} fix */
    update(fix) {
      meter.update(fix);
    },
    /**
     * @returns {{t:number, dist:number, speed:number, fixAge:number}|null}
     *   dist: metres covered. speed: m/s. fixAge: seconds since the latest fix.
     */
    at(t) {
      const s = meter.state();
      if (!s) return null;
      const fixAge = Math.max(0, t - s.t);
      return { t, dist: Math.max(0, s.d + s.v * fixAge), speed: s.v, fixAge };
    },
  };
}

/**
 * Distance covered over a whole recording, computed afterwards.
 * @param {Array<{t:number, lat:number, lon:number, accuracy?:number}>} fixes
 * @returns {{t:Float64Array, dist:Float64Array}} seconds on the recording's
 *   clock, and metres covered by each of those times.
 */
export function measureDistance(fixes, options) {
  const meter = createMeter(options);
  const steps = [];
  for (const fix of fixes) {
    const step = meter.update(fix);
    if (step) steps.push(step);
  }
  if (steps.length === 0) throw new Error('Recording has no usable fixes');
  const { t, d } = smooth(steps);
  for (let k = 0; k < d.length; k++) d[k] = Math.max(0, d[k]);
  return { t, dist: d };
}
