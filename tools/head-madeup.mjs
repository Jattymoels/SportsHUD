// A made-up head-test recording, in the format apps/ar/ writes.
//
//   node tools/head-madeup.mjs > made-up.csv
//
// Someone stands for ten seconds, runs round some streets for about eight
// minutes with a phone fixed askew to their head, looks well to one side
// for a minute on the long straight, and stops. What the phone's motion
// sensors and GPS would report is worked out from that and written as the
// same rows the AR page records. Every part of it is an assumption: the
// wander of the phone's own heading, the shape of a running step, the
// noise. It exists so that tools/head.mjs can be tested against a
// recording whose truth is known, before a real one arrives.

import { pathToFileURL } from 'node:url';
import { createProjection } from '../engine/geo.js';
import { deviceAxes } from '../engine/orientation.js';

const RAD = Math.PI / 180;
const HEADER = '# kind,seconds,then by kind: o alpha,beta,gamma,absolute | a alpha,beta,gamma by the compass | m ax,ay,az (gravity included, m/s2),turn rates alpha,beta,gamma (deg/s) | g lat,lon,accuracy,heading by GPS,speed by GPS,altitude,age of fix (ms) | h heading shown,offset taken off,route bearing,metres along,speed,ghost lead';
const turn = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;

/** Repeatable pseudo-random numbers in [-1, 1). */
function noise(seed) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 2147483648 - 1;
  };
}

/**
 * @param {object} [how]
 * @param {number} [how.drift] degrees a minute the phone's own heading wanders
 * @param {number} [how.begins] degrees: where its idea of north happens to start
 * @param {number} [how.aside] degrees the head is turned to the right during the look aside (negative: left)
 * @param {number} [how.asideFrom] seconds in at which the look aside begins; it lasts `asideFor`
 * @param {number|null} [how.droppedAt] seconds in at which the browser drops the page; it comes back six seconds later
 * @param {boolean} [how.gpsHeading] whether the GPS reports a heading and speed of its own
 * @param {number} [how.nod] m/s2 a nodding head adds along the way it faces, once a step
 * @param {boolean} [how.upsideDown] whether the motion readings have gravity the other way up, as some browsers give them
 * @param {boolean} [how.compass] whether readings tied to the compass are written down as well, ten a second, as newer recordings have
 * @param {number} [how.speed] metres a second
 * @returns {{text:string, truth:object}} the recording, and what was put into it
 */
export function madeUpHeadTest({ drift = 1.5, begins = 137, aside = 35, asideFrom = 250, asideFor = 60, droppedAt = null, gpsHeading = true, nod = 0, upsideDown = false, compass = true, speed = 3, seed = 1 } = {}) {
  const rnd = noise(seed);
  const gauss = () => rnd() + rnd() + rnd();
  const still = 10;
  // The way of travel: a corner at each of these times after setting off, four seconds to get round it.
  const legs = [[0, 20], [80, 110], [150, 200], [330, 290], [410, 20]];
  const running = 480;
  const total = still + running + still;
  const courseAt = (t) => {
    const since = t - still;
    let from = legs[0][1];
    for (const [at, bearing] of legs) {
      if (since >= at + 4) from = bearing;
      else if (since >= at && at > 0) return from + (turn(from, bearing) * (since - at)) / 4;
    }
    return from;
  };
  const speedAt = (t) => speed * Math.max(0, Math.min(1, (t - still) / 3, (still + running - t) / 3));
  const asideAt = (t) => (t >= asideFrom && t < asideFrom + asideFor ? aside * Math.min(1, (t - asideFrom) / 1.5, (asideFrom + asideFor - t) / 1.5) : 0);
  // A glance of 35 degrees for two seconds every 37, to one side and then the other.
  const glanceAt = (t) => (speedAt(t) > 1 && t % 37 > 20 && t % 37 < 22 ? (Math.floor(t / 37) % 2 ? 35 : -35) : 0);
  const moving = (t) => speedAt(t) / speed;
  const STEPS = 2.8;
  const head = (t) => {
    const go = moving(t);
    return {
      yaw: courseAt(t) + asideAt(t) + glanceAt(t) + go * 3 * Math.sin(2 * Math.PI * (STEPS / 2) * t),
      pitch: -5 + go * 2 * Math.sin(2 * Math.PI * STEPS * t + 0.6),
      roll: go * 1.5 * Math.sin(2 * Math.PI * (STEPS / 2) * t + 1),
    };
  };

  // How the phone sits: its axes when the head faces north, level. Askew, on purpose.
  const fit = deviceAxes(33, 61, -17);
  /** The phone's axes in the world for a head at this yaw, pitch and roll. */
  const axesFor = (yaw, pitch, roll) => {
    const [sy, cy, sp, cp] = [Math.sin(yaw * RAD), Math.cos(yaw * RAD), Math.sin(pitch * RAD), Math.cos(pitch * RAD)];
    const forward = [sy * cp, cy * cp, sp];
    const level = [cy, -sy, 0]; // to the right, level
    const over = [level[1] * forward[2] - level[2] * forward[1], level[2] * forward[0] - level[0] * forward[2], level[0] * forward[1] - level[1] * forward[0]];
    const top = over.map((c, i) => c * Math.cos(roll * RAD) + level[i] * Math.sin(roll * RAD));
    const right = [forward[1] * top[2] - forward[2] * top[1], forward[2] * top[0] - forward[0] * top[2], forward[0] * top[1] - forward[1] * top[0]];
    const place = (v) => [0, 1, 2].map((i) => right[i] * v[0] + forward[i] * v[1] + top[i] * v[2]);
    return { x: place(fit.x), y: place(fit.y), z: place(fit.z), forward };
  };
  const angles = ({ x, y, z }) => ({
    alpha: ((Math.atan2(-y[0], y[1]) / RAD) % 360 + 360) % 360,
    beta: Math.asin(Math.max(-1, Math.min(1, y[2]))) / RAD,
    gamma: Math.atan2(-x[2], z[2]) / RAD,
  });

  // Where they are: add up the steps.
  const proj = createProjection(-34.92, 138.6);
  const places = [];
  let east = 0;
  let north = 0;
  for (let i = 0; i <= total * 10; i++) {
    const t = i / 10;
    places.push([east, north]);
    east += (speedAt(t) * Math.sin(courseAt(t) * RAD)) / 10;
    north += (speedAt(t) * Math.cos(courseAt(t) * RAD)) / 10;
  }
  const placeAt = (t) => {
    const i = Math.max(0, Math.min(places.length - 2, Math.floor(t * 10)));
    const f = t * 10 - i;
    return [places[i][0] + f * (places[i + 1][0] - places[i][0]), places[i][1] + f * (places[i + 1][1] - places[i][1])];
  };

  const rows = [];
  const began = Date.UTC(2026, 10, 12, 20, 0, 0);
  let zero = 0; // the page's own clock starts again when it is reloaded
  let own = begins; // and so does the phone's idea of north
  const start = (why, t) => {
    rows.push(HEADER);
    rows.push(`# ${why} started ${new Date(began + t * 1000).toISOString()} on a made-up phone`);
  };
  const n = (v, places_) => (v == null ? '' : Number(v).toFixed(places_));
  start('head test', 0);
  let wanderE = 0;
  let wanderN = 0;
  let nextFix = 0.2;
  for (let i = 0; i <= total * 60; i++) {
    const t = i / 60 + 0.002 * rnd();
    if (droppedAt != null && t >= droppedAt && t < droppedAt + 6) continue;
    if (droppedAt != null && zero === 0 && t >= droppedAt + 6) {
      zero = droppedAt + 6;
      own = begins + 73; // a fresh start, a fresh zero
      start('head test carried on after the page was dropped', zero);
    }
    const at = (t - zero).toFixed(3);
    const h = head(t);
    const go = moving(t);
    // Orientation: the head as it is, from where the phone's own heading has wandered to.
    const wandered = own + (drift * t) / 60 + 1.5 * Math.sin((2 * Math.PI * t) / 170);
    const seen = angles(axesFor(h.yaw + wandered + 0.15 * gauss(), h.pitch + 0.15 * gauss(), h.roll + 0.15 * gauss()));
    rows.push(`o,${at},${n(seen.alpha, 2)},${n(seen.beta, 2)},${n(seen.gamma, 2)},0`);
    if (compass && i % 6 === 0) {
      // The compass: 9 degrees out steadily, wandering 4 more over 40 seconds, and jittery.
      const north = angles(axesFor(h.yaw + 9 + 4 * Math.sin((2 * Math.PI * t) / 40) + 5 * gauss(), h.pitch, h.roll));
      rows.push(`a,${at},${n(north.alpha, 2)},${n(north.beta, 2)},${n(north.gamma, 2)}`);
    }
    // Motion: a bounce and a brake-and-push each step, a sway each two, and gravity.
    const step = 2 * Math.PI * STEPS * t;
    const c = courseAt(t) * RAD;
    // Besides the stride: speeding up and slowing down push along the way of travel, and a corner pulls to its inside.
    const gaining = (speedAt(t + 0.05) - speedAt(t - 0.05)) / 0.1;
    const turning = (turn(courseAt(t - 0.05), courseAt(t + 0.05)) / 0.1) * RAD;
    const along = go * 1.8 * Math.sin(step) + gaining;
    const across = go * (1.5 * Math.sin(step / 2 + 1) + 0.1 * Math.sin(step + 2)) + speedAt(t) * turning;
    const real = axesFor(h.yaw, h.pitch, h.roll);
    const flat = Math.hypot(real.forward[0], real.forward[1]);
    const nodding = go * nod * Math.sin(step + 0.6);
    const world = [
      along * Math.sin(c) + across * Math.cos(c) + (nodding * real.forward[0]) / flat + 0.4 * gauss(),
      along * Math.cos(c) - across * Math.sin(c) + (nodding * real.forward[1]) / flat + 0.4 * gauss(),
      9.81 + go * (8 * Math.cos(step) + 2 * Math.cos(2 * step + 0.5)) + 0.4 * gauss(),
    ];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const way = upsideDown ? -1 : 1;
    rows.push(`m,${(t - zero + 0.002).toFixed(3)},${n(way * dot(world, real.x), 3)},${n(way * dot(world, real.y), 3)},${n(way * dot(world, real.z), 3)},0.00,0.00,0.00`);
    // GPS: once a second, a little late, a few metres out in a way that wanders.
    if (t >= nextFix) {
      nextFix += 1;
      wanderE = 0.96 * wanderE + 0.56 * gauss();
      wanderN = 0.96 * wanderN + 0.56 * gauss();
      const [e, north_] = placeAt(Math.max(0, t - 0.15));
      const [lat, lon] = proj.toLatLon(e + wanderE, north_ + wanderN);
      const fast = speedAt(t - 0.15);
      const heading = gpsHeading && fast > 0.7 ? ((courseAt(t - 0.15) + 3 * gauss()) % 360 + 360) % 360 : null;
      rows.push(`g,${at},${n(lat, 6)},${n(lon, 6)},4.0,${n(heading, 1)},${gpsHeading ? n(Math.max(0, fast + 0.1 * gauss()), 2) : ''},21.0,150`);
    }
  }
  // Which way the head faces and which way is up, in the phone's own axes: what the analysis has to find.
  const sits = { forward: [fit.x[1], fit.y[1], fit.z[1]], up: [fit.x[2], fit.y[2], fit.z[2]] };
  return { text: rows.join('\n') + '\n', truth: { drift, aside, asideFrom, asideFor, droppedAt, still, running, steps: STEPS, sits } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.stdout.write(madeUpHeadTest().text);
