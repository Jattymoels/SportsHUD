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
  lostAfter: Infinity, // comparisons in a row, each further than a glance from what was learned, before learning starts afresh; never, for a compass
};

/** The short way round from one bearing to another, -180 to 180: positive is clockwise. */
const turn = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;
const wrap = (bearing) => ((bearing % 360) + 360) % 360;
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];

/**
 * Learns a steady difference between two bearings from a stream of noisy
 * comparisons: the middle of the first few for a sound start, then a slow
 * lean towards each new one, leaving out any that are far from what has
 * been learned, which are the wearer looking aside.
 */
function createLearner(o) {
  let error = 0;
  let rate = 0; // degrees a second the difference is growing by, where that is being learned too
  let seenAt = null; // when the difference was last brought up to date
  let known = false;
  let first = null; // the first comparison, which the early ones are measured from so that none wraps round
  let early = [];
  let far = 0; // comparisons in a row that were further than a glance from what has been learned
  /** The difference at time `t`, carried on from when it was last learned by the rate it was growing at. */
  const at = (t) => (o.learnDrift && seenAt != null && t != null ? error + rate * Math.min(o.carry, Math.max(0, t - seenAt)) : error);
  return {
    at,
    get known() {
      return known;
    },
    /** One comparison, at time `t`, `dt` seconds after the last. Returns true when this one gives the first estimate. */
    see(seen, dt, t) {
      if (!known) {
        first ??= seen;
        early.push(turn(first, seen));
        if (early.length < o.startAfter) return false;
        error = first + median(early);
        known = true;
        first = null;
        early = [];
        seenAt = t;
        return true;
      }
      const expected = at(t);
      const out = turn(expected, seen);
      error = expected;
      seenAt = t;
      if (Math.abs(out) > o.glance) {
        // One of these is a look aside. A long unbroken run of them is not:
        // what was learned no longer holds, as when the device starts
        // measuring its heading from somewhere new. Then begin again, with
        // this comparison as the first, and keep the old answer until the
        // new one is ready.
        if (++far >= o.lostAfter) {
          known = false;
          first = seen;
          early = [0];
          far = 0;
        }
        return false;
      }
      far = 0;
      if (o.learnDrift) {
        // Following a difference that grows steadily: lean on each comparison
        // twice as hard, and let what is left over say how fast it is growing.
        error += out * (1 - Math.exp((-2 * dt) / o.errorOver));
        rate = Math.max(-o.fastest, Math.min(o.fastest, rate + (out * dt) / o.errorOver ** 2));
      } else error += out * (1 - Math.exp(-dt / o.errorOver));
      return false;
    },
    /** Told the difference outright, at time `t`. */
    set(value, t) {
      error = value;
      known = true;
      first = null;
      early = [];
      far = 0;
      seenAt = t ?? seenAt;
    },
  };
}

/** Whether a reading of travel is fit to learn from, and how long since the last. */
function travelStep(o, before, bearing, speed, t) {
  if (!(speed >= o.minSpeed)) return null;
  // Mid-turn the body and the head are not yet going the same way.
  if (before && t > before.t && Math.abs(turn(before.bearing, bearing)) / (t - before.t) > o.steadyTurn) return null;
  return before ? Math.min(5, Math.max(0, t - before.t)) : 1;
}

/**
 * @param {Partial<typeof HEADING_DEFAULTS>} [options]
 * @returns an object fed with readings as they arrive, each with the time
 *   `t` in seconds, and asked for the heading at any moment.
 */
export function createHeadingFuser(options) {
  const o = { ...HEADING_DEFAULTS, ...options };
  const learner = createLearner(o); // the compass's steady error: compass minus true
  let yaw = null; // the heading being kept
  let yawAt = null;
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
      const corrected = wrap(bearing - learner.at());
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
      const dt = travelStep(o, before, bearing, speed, t);
      if (compassSlow == null || dt == null) return;
      // What the compass's error looks like right now. The first estimate moves the heading at once.
      if (learner.see(turn(bearing, compassSlow), dt, t) && yaw != null) yaw = wrap(compassSlow - learner.at());
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
      return { yaw: wrap(yaw + rate * since), error: turn(0, learner.at()), corrected: learner.known };
    },
  };
}

export const ANCHOR_DEFAULTS = {
  ...HEADING_DEFAULTS,
  errorOver: 60, // seconds over which the difference from north is learned
  learnDrift: true, // also learn how fast that difference is growing: a gyroscope's wander is steady over minutes
  fastest: 0.2, // degrees a second: no wander faster than this is believed
  carry: 120, // seconds the difference is carried on by its rate when nothing new is learned, as at a long wait
  lostAfter: 30, // half a minute of running with every comparison far out: longer than anyone looks that far aside
};

/**
 * The heading with no compass at all.
 *
 * Phones and most glasses already blend their gyroscope and the pull of
 * gravity into one smooth, quick orientation. Left to itself that has two
 * faults: its idea of which way is north starts off arbitrary, and wanders
 * by a degree or so a minute. A compass fixes both and brings faults of its
 * own: it is thrown by cars, rails, bridges and the electronics beside it.
 *
 * A runner on a known route has a better reference. Over a minute, the
 * middle of where the head points is the way the route goes. So take the
 * orientation as it comes, moment to moment, and learn only the slow
 * difference between it and north, and how fast that difference is
 * growing, from the direction of travel.
 *
 * @param {Partial<typeof ANCHOR_DEFAULTS>} [options]
 */
export function createTravelAnchor(options) {
  const o = { ...ANCHOR_DEFAULTS, ...options };
  const learner = createLearner(o); // the orientation's yaw minus the true bearing
  let latest = null;
  let slow = null; // the yaw smoothed over a second, for comparing with travel
  let slowAt = null;
  let travelBefore = null;

  return {
    /** The device's own yaw, in degrees clockwise, measured from wherever it measures from. Call on every reading. */
    orientation(yaw, t) {
      const dt = slowAt == null ? 0 : Math.max(0, t - slowAt);
      slow = slow == null ? yaw : wrap(slow + turn(slow, yaw) * (1 - Math.exp(-dt / 1)));
      slowAt = t;
      latest = yaw;
    },

    /** Told outright: the wearer is facing this bearing now, at time `t`. For lining up before setting off. */
    set(bearing, t) {
      if (latest == null) return;
      learner.set(turn(bearing, latest), t ?? slowAt);
      slow = latest;
    },

    /** The direction of travel, as for the fuser above. */
    travel(bearing, speed, t) {
      const before = travelBefore;
      travelBefore = { bearing, t };
      const dt = travelStep(o, before, bearing, speed, t);
      if (slow == null || dt == null) return;
      learner.see(turn(bearing, slow), dt, t);
    },

    /**
     * @param {number} [t] the time now, if later than the last reading
     * @returns {{yaw:number, offset:number, corrected:boolean}|null} yaw: the
     *   bearing faced. offset: what has been taken off the device's own yaw
     *   to get it. corrected: whether that has been learned or told yet;
     *   until then yaw is the device's own.
     */
    at(t = slowAt) {
      if (latest == null) return null;
      const offset = learner.at(t);
      return { yaw: wrap(latest - offset), offset: turn(0, offset), corrected: learner.known };
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
