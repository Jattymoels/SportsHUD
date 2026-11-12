// Finding north without a compass.
//
// A phone's camera, or glasses with cameras, can track their own movement
// very finely: a few centimetres over a few metres. But only in a frame of
// their own, which starts wherever the device was pointing when tracking
// began. GPS knows where in the world the device is, to a few metres, and
// nothing about which way it faces.
//
// Walk or run a little and the two describe the same path. Turning the
// device's path until it lies along the GPS path gives the one thing
// missing: which way north is in the device's own frame. The longer the
// path, the better: GPS being 3 m out matters little over 100 m.
//
// With that, anything with a place in the world can be given a place in the
// device's frame, where the fine tracking holds it still.

import { createProjection } from './geo.js';

export const ALIGN_DEFAULTS = {
  keep: 250, // metres of the device's own path to keep: older than that, its tracking has drifted
  rough: 8, // metres the path must span before any answer is given
  good: 30, // metres it must span before the answer is called good
  worstFix: 30, // metres: a GPS fix claiming to be worse than this is left out
  step: 0.5, // metres the device must have moved, by its own tracking, before another pair is taken
};

const DEG = 180 / Math.PI;

/**
 * @param {Partial<typeof ALIGN_DEFAULTS>} [options]
 * @returns an object fed pairs of positions, the device's own and the
 *   world's, taken at the same moment, and asked which way the device's
 *   frame points.
 */
export function createAligner(options) {
  const o = { ...ALIGN_DEFAULTS, ...options };
  let proj = null;
  let samples = []; // { right, ahead, east, north, weight, walked }
  let walked = 0;
  let answer = null;

  function solve() {
    answer = null;
    if (samples.length < 3) return;
    const fit = (set) => {
      let sum = 0, r0 = 0, a0 = 0, e0 = 0, n0 = 0;
      for (const s of set) {
        sum += s.weight;
        r0 += s.weight * s.right;
        a0 += s.weight * s.ahead;
        e0 += s.weight * s.east;
        n0 += s.weight * s.north;
      }
      r0 /= sum; a0 /= sum; e0 /= sum; n0 /= sum;
      let along = 0, across = 0, spread = 0;
      for (const s of set) {
        const [r, a, e, n] = [s.right - r0, s.ahead - a0, s.east - e0, s.north - n0];
        along += s.weight * (e * r + n * a);
        across += s.weight * (e * a - n * r);
        spread = Math.max(spread, Math.hypot(r, a));
      }
      const turn = Math.atan2(across, along); // the bearing of the frame's "ahead" axis
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const apart = (s) => Math.hypot(e0 + (s.right - r0) * cos + (s.ahead - a0) * sin - s.east, n0 - (s.right - r0) * sin + (s.ahead - a0) * cos - s.north);
      const residual = Math.sqrt(set.reduce((total, s) => total + apart(s) ** 2, 0) / set.length);
      return { turn, cos, sin, r0, a0, e0, n0, span: 2 * spread, residual, apart };
    };
    let best = fit(samples);
    // One pass to drop fixes that sit well off the rest: a GPS jump, not movement.
    const sound = samples.filter((s) => best.apart(s) <= Math.max(6, 3 * best.residual));
    if (sound.length >= 3 && sound.length < samples.length) best = fit(sound);
    if (best.span < o.rough) return;
    answer = best;
  }

  return {
    /**
     * A pair of positions taken at the same moment.
     * @param {object} pair
     * @param {number} pair.x the device's own position: metres to the right of where its frame began
     * @param {number} pair.z metres behind where its frame began (so ahead is negative, as tracking frames have it)
     * @param {number} pair.lat
     * @param {number} pair.lon
     * @param {number} [pair.accuracy] metres the GPS fix claims to be good to
     */
    add({ x, z, lat, lon, accuracy = 5 }) {
      if (!(accuracy <= o.worstFix)) return;
      proj ??= createProjection(lat, lon);
      const [east, north] = proj.toXY(lat, lon);
      const last = samples[samples.length - 1];
      // Standing still adds nothing: the path is no longer, only the pile of fixes at one end of it.
      if (last && Math.hypot(x - last.right, -z - last.ahead) < o.step) return;
      if (last) walked += Math.hypot(x - last.right, -z - last.ahead);
      samples.push({ right: x, ahead: -z, east, north, weight: 1 / Math.max(3, accuracy) ** 2, walked });
      samples = samples.filter((s) => walked - s.walked <= o.keep);
      solve();
    },

    /**
     * What has been worked out.
     * @returns {{bearing:number|null, span:number, residual:number, quality:'none'|'rough'|'good'}}
     *   bearing: the compass bearing, in degrees, that the device frame's
     *   "ahead" axis points along; add the device's own yaw in its frame to
     *   get the bearing it faces. span: metres the path used spans.
     *   residual: metres the two paths typically differ by once lined up,
     *   which is mostly GPS error.
     */
    state() {
      if (!answer) return { bearing: null, span: 0, residual: 0, quality: 'none' };
      return { bearing: ((answer.turn * DEG) % 360 + 360) % 360, span: answer.span, residual: answer.residual, quality: answer.span >= o.good ? 'good' : 'rough' };
    },

    /** Where a place in the world is in the device's own frame: `{x, z}` in metres, or null before there is an answer. */
    toLocal({ lat, lon }) {
      if (!answer) return null;
      const [east, north] = proj.toXY(lat, lon);
      const e = east - answer.e0;
      const n = north - answer.n0;
      const right = answer.r0 + e * answer.cos - n * answer.sin;
      const ahead = answer.a0 + e * answer.sin + n * answer.cos;
      return { x: right, z: -ahead };
    },
  };
}
