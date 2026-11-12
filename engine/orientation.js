// Which way a device is looking.
//
// A phone or a pair of glasses reports its orientation as three angles. This
// turns them into what placing things in the world needs: the compass
// bearing the camera (or the wearer) is facing, how far it is tilted up or
// down, and how far it is rolled to one side.

const RAD = Math.PI / 180;

/** The difference between two angles in radians, as the short way round: -π to π. */
export function angleBetween(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * The pose of a device's rear camera from a browser `deviceorientation`
 * reading. Use the absolute kind (`deviceorientationabsolute`, or one with
 * `absolute: true`), where alpha is measured from north.
 *
 * @param {number} alpha degrees, rotation about the axis out of the screen
 * @param {number} beta degrees, front-to-back tilt
 * @param {number} gamma degrees, left-to-right tilt
 * @param {number} [screenAngle] degrees the page is rotated from the
 *   device's natural way up: `screen.orientation.angle`
 * @returns {{yaw:number, pitch:number, roll:number}} radians. yaw: compass
 *   bearing faced, clockwise from north. pitch: above the horizon is
 *   positive. roll: tilted clockwise, as seen from behind, is positive.
 */
export function cameraPose(alpha, beta, gamma, screenAngle = 0) {
  const a = alpha * RAD;
  const b = beta * RAD;
  const g = gamma * RAD;
  const [sa, ca, sb, cb, sg, cg] = [Math.sin(a), Math.cos(a), Math.sin(b), Math.cos(b), Math.sin(g), Math.cos(g)];
  // The device's own axes, written in east, north, up (the W3C convention).
  const x = [ca * cg - sa * sb * sg, cg * sa + ca * sb * sg, -cb * sg]; // to the right of the screen
  const y = [-cb * sa, ca * cb, sb]; // to the top of the screen
  const z = [cg * sa * sb + ca * sg, sa * sg - ca * cg * sb, cb * cg]; // out of the screen, towards you
  const look = z.map((c) => -c); // the rear camera looks the other way
  const s = screenAngle * RAD;
  const top = x.map((c, i) => c * Math.sin(s) + y[i] * Math.cos(s)); // the top of the page as shown

  const yaw = Math.atan2(look[0], look[1]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, look[2])));
  // Level "right" and "up" for this direction of view, to measure roll against.
  const flat = Math.hypot(look[0], look[1]) || 1e-9;
  const right = [look[1] / flat, -look[0] / flat, 0];
  const up = [right[1] * look[2] - right[2] * look[1], right[2] * look[0] - right[0] * look[2], right[0] * look[1] - right[1] * look[0]];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  return { yaw, pitch, roll: Math.atan2(dot(top, right), dot(top, up)) };
}
