// Which way the wearer is facing: steadier and truer than a compass alone.
//
// Glasses with no cameras cannot see where they are pointing. They have a
// compass, which knows north but is noisy, lags, and can be out by a steady
// amount: the gap between magnetic and true north (8 degrees in Adelaide),
// and whatever the frame, a buggy or a bike adds. They may have a gyroscope,
// which is smooth and quick but only knows change, and drifts. And there is
// a third source nobody has to wear: the direction the wearer is travelling,
// from GPS or from the route they are on. That is where the body is going
// rather than where the head points, but over a minute of running or
// walking the two agree, and it has no steady error at all.
//
// So: follow the gyroscope from moment to moment, lean on the compass over
// seconds, and learn the compass's steady error over a minute or so from
// the direction of travel.
//
// Everything is in degrees, clockwise from north.

export const HEADING_DEFAULTS = {
  compassOver: 2.5, // seconds over which the heading leans back onto the compass, when there is a gyroscope
  compassAlone: 0.35, // the same with no gyroscope: just enough to take the jitter off
  errorOver: 45, // seconds over which the compass's steady error is learned from travel
  minSpeed: 1, // m/s: slower than this, the direction of travel means nothing
  glance: 30, // degrees: a compass further than this from the way of travel is a look aside, not an error
  startAfter: 6, // readings of travel to gather before trusting the first estimate of the error
  steadyTurn: 12, // degrees a second: turning faster than this, the direction of travel is changing too fast to compare
};

/** The short way round from one bearing to another, -180 to 180: positive is clockwise. */
const turn = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;
const wrap = (bearing) => ((bearing % 360) + 360) % 360;
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];

/**
 * @param {Partial<typeof HEADING_DEFAULTS>} [options]
 * @returns an object fed with readings as they arrive, each with the time
 *   `t` in seconds, and asked for the heading at any moment.
 */
export function createHeadingFuser(options) {
  const o = { ...HEADING_DEFAULTS, ...options };
  let yaw = null; // the heading being kept
  let yawAt = null;
  let error = 0; // the compass's steady error, as learned so far: compass minus true
  let known = false; // whether `error` has been estimated at all
  let early = []; // the first few comparisons, for a sound first estimate
  let rate = 0; // latest turn rate from the gyroscope, degrees a second
  let gyroAt = null;
  let compassSlow = null; // the compass smoothed over a second, for comparing with travel
  let compassAt = null;
  let travelBefore = null;

  return {
    /** A turn rate from the gyroscope: degrees a second about the vertical, clockwise positive. */
    gyro(degreesPerSecond, t) {
      if (yaw != null && gyroAt != null && t > gyroAt) {
        yaw = wrap(yaw + rate * (t - gyroAt));
        yawAt = t;
      }
      rate = degreesPerSecond;
      gyroAt = t;
    },

    /** A compass reading: the bearing faced, as the device reports it. */
    compass(bearing, t) {
      const dt = compassAt == null ? 0 : Math.max(0, t - compassAt);
      compassSlow = compassSlow == null ? bearing : wrap(compassSlow + turn(compassSlow, bearing) * (1 - Math.exp(-dt / 1)));
      compassAt = t;
      const corrected = wrap(bearing - error);
      if (yaw == null) {
        yaw = corrected;
        yawAt = t;
        return;
      }
      // With a gyroscope the compass only has to stop the drift; without one it is all there is.
      const over = gyroAt != null && t - gyroAt < 1 ? o.compassOver : o.compassAlone;
      yaw = wrap(yaw + turn(yaw, corrected) * (1 - Math.exp(-dt / over)));
      yawAt = t;
    },

    /**
     * The direction of travel: the bearing being moved along, from GPS or
     * from the route being followed, and the speed in m/s.
     */
    travel(bearing, speed, t) {
      const before = travelBefore;
      travelBefore = { bearing, t };
      if (compassSlow == null || !(speed >= o.minSpeed)) return;
      // Mid-turn the body and the head are not yet going the same way.
      if (before && t > before.t && Math.abs(turn(before.bearing, bearing)) / (t - before.t) > o.steadyTurn) return;
      const seen = turn(bearing, compassSlow); // what the compass's error looks like right now
      if (!known) {
        early.push(seen);
        if (early.length < o.startAfter) return;
        error = median(early);
        known = true;
        early = [];
        if (yaw != null) yaw = wrap(compassSlow - error);
        return;
      }
      // A head turned well aside is a glance, not news about the compass.
      if (Math.abs(turn(error, seen)) > o.glance) return;
      const dt = before ? Math.min(5, Math.max(0, t - before.t)) : 1;
      error += turn(error, seen) * (1 - Math.exp(-dt / o.errorOver));
    },

    /**
     * The heading at time `t`.
     * @returns {{yaw:number, error:number, corrected:boolean}|null} yaw: the
     *   bearing faced. error: the compass's steady error as learned, which
     *   has been taken off. corrected: whether that error has been learned
     *   yet; until it has, yaw is the compass's own idea of north.
     */
    at(t) {
      if (yaw == null) return null;
      const since = gyroAt != null && t - gyroAt < 0.5 && yawAt != null ? Math.max(0, t - yawAt) : 0;
      return { yaw: wrap(yaw + rate * since), error, corrected: known };
    },
  };
}

/**
 * The turn rate about the vertical from a phone's or glasses' motion
 * reading, for the gyro() above.
 *
 * A browser reports rotation about the device's own three axes, in degrees
 * a second. Which of those is "turning to face another way" depends on how
 * the device is held, which gravity tells us.
 *
 * @param {{alpha:number, beta:number, gamma:number}} rotationRate from a
 *   `devicemotion` event: degrees a second about the device's z, x and y axes
 * @param {{x:number, y:number, z:number}} gravity `accelerationIncludingGravity`
 *   from the same event, or any vector pointing along it
 * @returns {number|null} degrees a second, clockwise seen from above; null if gravity is unusable
 */
export function turnRate(rotationRate, gravity) {
  const g = Math.hypot(gravity.x, gravity.y, gravity.z);
  if (!(g > 1)) return null;
  // Resting, the reading points away from the ground: up, in the device's axes.
  const up = [gravity.x / g, gravity.y / g, gravity.z / g];
  // rotationRate.beta is about x, gamma about y, alpha about z.
  const aboutUp = (rotationRate.beta ?? 0) * up[0] + (rotationRate.gamma ?? 0) * up[1] + (rotationRate.alpha ?? 0) * up[2];
  // Anticlockwise about "up" is positive in the device's convention; a compass bearing grows clockwise.
  return -aboutUp;
}
