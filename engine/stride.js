// Which way the body is going, felt from the head.
//
// The heading kept by createTravelAnchor (heading.js) rests on one
// assumption: over a minute, the middle of where the head points is the way
// the runner is going. Run along looking at someone beside you and it is
// wrong for as long as you look.
//
// The body says where it is going in another way. Every footfall brakes it
// and then pushes it on, along its direction of travel, once a step. A
// motion sensor on the head feels that push whichever way the head is
// turned. So: take the sideways-and-forwards part of the acceleration, keep
// only what repeats at the rate of the steps, and find the line it moves
// along. The angle between that line and the way the head faces is the
// angle between head and body, with no assumption about where the eyes are.
//
// The sway from foot to foot repeats once every two steps, at half the
// rate, and is left out by looking only at the step rate.
//
// This has been tried only on made-up signals. On a real head two things
// may spoil it, and only recordings will say how much:
//  - a nodding head moves a sensor on the forehead back and forth along the
//    way the head faces, once a step, which pulls the answer towards the
//    head (the tests show by how much, for a nod of an assumed size);
//  - the line has two ends. Which is "ahead" is settled here by taking the
//    one within 90 degrees of where the head faces. The timing of the push
//    against the bounce could settle it without that assumption; it is
//    reported as `phase` so that real recordings can show whether it does.
//
// Accelerations are in metres per second squared; angles in degrees.

export const STRIDE_DEFAULTS = {
  window: 6, // seconds of movement looked at for each answer
  every: 1, // seconds between answers
  slowest: 1.2, // steps a second: the slowest walk looked for
  fastest: 4, // steps a second: the fastest run looked for
  bounce: 0.5, // m/s2 of up-and-down at the step rate below which this is neither walking nor running
  push: 0.08, // m/s2 of to-and-fro at the step rate below which no line can be trusted
};

const DEG = 180 / Math.PI;

/**
 * A motion reading put into the head's own level frame.
 *
 * @param {{x:number[], y:number[], z:number[]}} axes the device's axes at that moment, from deviceAxes
 * @param {{forward:number[], up:number[]}} mount how the device sits on the head, from mountFrom
 * @param {{x:number, y:number, z:number}} reading acceleration in the device's own axes, gravity
 *   included, as a browser's `devicemotion` gives it
 * @returns {{forward:number, right:number, up:number}} the same acceleration
 *   along the way the head faces (taken level), to its right, and straight up
 */
export function headFrame(axes, mount, reading) {
  const world = [0, 1, 2].map((i) => reading.x * axes.x[i] + reading.y * axes.y[i] + reading.z * axes.z[i]);
  const faces = [0, 1].map((i) => mount.forward[0] * axes.x[i] + mount.forward[1] * axes.y[i] + mount.forward[2] * axes.z[i]);
  const flat = Math.hypot(faces[0], faces[1]) || 1e-9;
  const [fe, fn] = [faces[0] / flat, faces[1] / flat];
  // Level, and a quarter turn clockwise from the way faced, is to the right.
  return { forward: world[0] * fe + world[1] * fn, right: world[0] * fn - world[1] * fe, up: world[2] };
}

/**
 * The line of travel in one stretch of readings.
 *
 * @param {Array<{t:number, forward:number, right:number, up:number}>} samples
 *   in the head's level frame, as headFrame gives them, oldest first
 * @param {Partial<typeof STRIDE_DEFAULTS>} [options]
 * @returns {{right:number, steps:number, bounce:number, push:number, confidence:number, phase:number}|null}
 *   right: degrees the direction of travel sits to the right of where the
 *   head faces (negative is left), taken to be within 90 either way.
 *   steps: steps a second. bounce: m/s2 of up-and-down at that rate. push:
 *   m/s2 of to-and-fro along the line found. confidence: 0 to 1, how much
 *   more the movement at the step rate runs along that line than across it.
 *   phase: degrees by which the push along the line leads the bounce; it
 *   differs by 180 between the two ends of the line. Null when the readings
 *   show no steps.
 */
export function strideLine(samples, options) {
  const o = { ...STRIDE_DEFAULTS, ...options };
  const n = samples.length;
  if (n < 16) return null;
  const t0 = samples[0].t;
  const span = samples[n - 1].t - t0;
  if (!(span > 0)) return null;
  const mean = { forward: 0, right: 0, up: 0 };
  for (const s of samples) for (const k of ['forward', 'right', 'up']) mean[k] += s[k] / n;
  // Each reading counts for most in the middle of the stretch and for nothing
  // at its ends, so that a rhythm cut off part-way through a step does not
  // smear into its neighbours.
  const weight = samples.map((s) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (s.t - t0)) / span));
  const total = weight.reduce((sum, w) => sum + w, 0);
  /** How much of one of the three there is at `rate` times a second, as a size and a timing. */
  const at = (key, rate) => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const angle = 2 * Math.PI * rate * (samples[i].t - t0);
      const v = weight[i] * (samples[i][key] - mean[key]);
      re += v * Math.cos(angle);
      im -= v * Math.sin(angle);
    }
    return [(2 * re) / total, (2 * im) / total];
  };

  // The step rate: where the up-and-down is strongest.
  let steps = 0;
  let strongest = 0;
  for (let rate = o.slowest; rate <= o.fastest + 1e-9; rate += 0.05) {
    const [re, im] = at('up', rate);
    const size = Math.hypot(re, im);
    if (size > strongest) {
      strongest = size;
      steps = rate;
    }
  }
  if (strongest < o.bounce) return null;

  // The to-and-fro at that rate, and a little either side of it since no
  // one's steps keep perfect time: along which line does it run?
  let ff = 0;
  let rr = 0;
  let fr = 0;
  const near = [-1 / span, 0, 1 / span].map((shift) => steps + shift);
  for (const rate of near) {
    const f = at('forward', rate);
    const r = at('right', rate);
    ff += f[0] * f[0] + f[1] * f[1];
    rr += r[0] * r[0] + r[1] * r[1];
    fr += f[0] * r[0] + f[1] * r[1];
  }
  // Half the angle of the usual two-by-two sum: that lands within 90 degrees
  // of "forward", which is the assumption about which end is ahead.
  const line = 0.5 * Math.atan2(2 * fr, ff - rr);
  const spread = Math.hypot((ff - rr) / 2, fr);
  const along = (ff + rr) / 2 + spread;
  const across = Math.max(0, (ff + rr) / 2 - spread);
  const f = at('forward', steps);
  const r = at('right', steps);
  const up = at('up', steps);
  const push = [f[0] * Math.cos(line) + r[0] * Math.sin(line), f[1] * Math.cos(line) + r[1] * Math.sin(line)];
  const size = Math.hypot(push[0], push[1]);
  if (size < o.push) return null;
  // The timing of the push against the bounce: push times the bounce turned back on itself.
  const phase = Math.atan2(push[1] * up[0] - push[0] * up[1], push[0] * up[0] + push[1] * up[1]) * DEG;
  return { right: line * DEG, steps, bounce: strongest, push: size, confidence: along + across > 0 ? (along - across) / (along + across) : 0, phase };
}

/**
 * The same, kept up to date as readings arrive.
 *
 * @param {Partial<typeof STRIDE_DEFAULTS>} [options]
 */
export function createStrideDirection(options) {
  const o = { ...STRIDE_DEFAULTS, ...options };
  let samples = [];
  let latest = null;
  let answeredAt = null;
  return {
    /** One reading in the head's level frame (see headFrame), at time `t` in seconds. Returns a new answer when there is one. */
    add(t, forward, right, up) {
      samples.push({ t, forward, right, up });
      if (t - samples[0].t > o.window) samples = samples.filter((s) => t - s.t <= o.window);
      if (answeredAt != null && t - answeredAt < o.every) return null;
      if (t - samples[0].t < 0.8 * o.window) return null;
      answeredAt = t;
      const found = strideLine(samples, o);
      latest = found && { ...found, t };
      return latest;
    },
    /** The latest answer, or null if the last stretch showed no steps. */
    at: () => latest,
  };
}
