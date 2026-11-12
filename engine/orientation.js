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
  const { x, y, z } = deviceAxes(alpha, beta, gamma);
  const look = z.map((c) => -c); // the rear camera looks the other way
  const s = screenAngle * RAD;
  const top = x.map((c, i) => c * Math.sin(s) + y[i] * Math.cos(s)); // the top of the page as shown
  return poseOf(look, top);
}

/**
 * A device's own three axes from a `deviceorientation` reading, each written
 * as [east, north, up] (the W3C convention): x to the right of the screen,
 * y to its top, z out of it towards you. With readings that are not
 * measured from north, "north" here is wherever the device measures from.
 */
export function deviceAxes(alpha, beta, gamma) {
  const a = alpha * RAD;
  const b = beta * RAD;
  const g = gamma * RAD;
  const [sa, ca, sb, cb, sg, cg] = [Math.sin(a), Math.cos(a), Math.sin(b), Math.cos(b), Math.sin(g), Math.cos(g)];
  return {
    x: [ca * cg - sa * sb * sg, cg * sa + ca * sb * sg, -cb * sg],
    y: [-cb * sa, ca * cb, sb],
    z: [cg * sa * sb + ca * sg, sa * sg - ca * cg * sb, cb * cg],
  };
}

const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

/** Yaw, pitch and roll, in radians, of something looking along `look` with `top` its upward side, both as [east, north, up]. */
function poseOf(look, top) {
  const yaw = Math.atan2(look[0], look[1]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, look[2])));
  // Level "right" and "up" for this direction of view, to measure roll against.
  const flat = Math.hypot(look[0], look[1]) || 1e-9;
  const right = [look[1] / flat, -look[0] / flat, 0];
  const up = [right[1] * look[2] - right[2] * look[1], right[2] * look[0] - right[0] * look[2], right[0] * look[1] - right[1] * look[0]];
  return { yaw, pitch, roll: Math.atan2(dot(top, right), dot(top, up)) };
}

/**
 * How a device sits on a head: which way, in the device's own axes, the
 * wearer's face and the top of their head point.
 *
 * A phone in a visor may lie flat above the eyes, stand upright, or sit at
 * any angle; glasses report their orientation by conventions of their own.
 * Rather than be told, ask the wearer to look level along a known bearing
 * for a moment: that fixes it, however the device is fitted.
 *
 * @param {{x:number[], y:number[], z:number[]}} axes from deviceAxes, read at that moment
 * @param {number} bearing degrees clockwise from north that the wearer is facing, level
 * @returns {{forward:number[], up:number[]}} in the device's axes; pass to headPose
 */
export function mountFrom(axes, bearing) {
  const facing = [Math.sin(bearing * RAD), Math.cos(bearing * RAD), 0];
  const inDevice = (v) => [dot(v, axes.x), dot(v, axes.y), dot(v, axes.z)];
  return { forward: inDevice(facing), up: inDevice([0, 0, 1]) };
}

/**
 * Which way a head is facing, from the orientation of a device fixed to it.
 *
 * @param {{x:number[], y:number[], z:number[]}} axes from deviceAxes, now
 * @param {{forward:number[], up:number[]}} mount from mountFrom
 * @returns {{yaw:number, pitch:number, roll:number}} radians, as cameraPose gives them
 */
export function headPose(axes, mount) {
  const inWorld = (v) => [0, 1, 2].map((i) => v[0] * axes.x[i] + v[1] * axes.y[i] + v[2] * axes.z[i]);
  return poseOf(inWorld(mount.forward), inWorld(mount.up));
}

/**
 * The pose of a device that tracks its own movement, from the rotation its
 * tracking reports: a quaternion in a frame with y up and, when tracking
 * began, the device looking along -z with +x to its right. That is the
 * frame a browser's augmented-reality mode uses.
 *
 * @param {{x:number, y:number, z:number, w:number}} q
 * @returns {{yaw:number, pitch:number, roll:number}} radians, as cameraPose
 *   gives them, except that yaw is measured from the way the device faced
 *   when tracking began, not from north. Add the bearing of that direction
 *   (from createAligner) to get a compass bearing.
 */
export function trackedPose(q) {
  const turn = (v) => {
    // v + 2w(q × v) + 2 q × (q × v)
    const c1 = [q.y * v[2] - q.z * v[1], q.z * v[0] - q.x * v[2], q.x * v[1] - q.y * v[0]];
    const c2 = [q.y * c1[2] - q.z * c1[1], q.z * c1[0] - q.x * c1[2], q.x * c1[1] - q.y * c1[0]];
    return [v[0] + 2 * (q.w * c1[0] + c2[0]), v[1] + 2 * (q.w * c1[1] + c2[1]), v[2] + 2 * (q.w * c1[2] + c2[2])];
  };
  const look = turn([0, 0, -1]);
  const top = turn([0, 1, 0]);
  const flat = Math.hypot(look[0], look[2]) || 1e-9;
  const right = [-look[2] / flat, 0, look[0] / flat]; // level, to the right of the view
  const up = [right[1] * look[2] - right[2] * look[1], right[2] * look[0] - right[0] * look[2], right[0] * look[1] - right[1] * look[0]];
  return {
    yaw: Math.atan2(look[0], -look[2]),
    pitch: Math.asin(Math.max(-1, Math.min(1, look[1]))),
    roll: Math.atan2(dot(top, right), dot(top, up)),
  };
}
