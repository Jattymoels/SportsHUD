// What a head test says.
//
//   node tools/head.mjs sportshud-head-2026-11-13-07-10.csv.gz
//   npm run head -- recording.csv
//
// Reads a recording made by "Start a head test" in apps/ar/ (a phone fixed
// to the head, its motion sensors and GPS written down during a run) and
// answers the questions the ghost glasses rest on:
//
//   - how fast does the device's own heading wander?
//   - replayed over this run, how far out would the heading kept with no
//     compass (createTravelAnchor) have been, against the 3 degree target?
//   - when the runner looked to one side, how far was it pulled?
//   - does the direction of travel felt in the stride (engine/stride.js)
//     see that look aside, and would it have held the heading through it?
//
// Nothing here knows which way the head truly faced. What it has instead is
// the benefit of hindsight: over the whole run, leaving out any long look
// aside, the middle of where the head pointed was the way of travel, so the
// slow difference between the device's heading and the GPS's can be drawn
// as a smooth line after the fact. The live method is scored against that
// line. The answers are only as good as that assumption and the GPS.

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createProjection } from '../engine/geo.js';
import { deviceAxes, mountFrom, headPose } from '../engine/orientation.js';
import { createTravelAnchor } from '../engine/heading.js';
import { createStrideDirection, headFrame, STRIDE_DEFAULTS } from '../engine/stride.js';

const RAD = Math.PI / 180;
const TARGET = 3; // degrees: B14's proposed target for 19 readings in 20
const ASIDE = { angle: 12, seconds: 20 }; // a head this far from the way of travel, for this long, is a look aside
const turn = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;
const wrap = (degrees) => ((degrees % 360) + 360) % 360;
const sorted = (values) => [...values].sort((a, b) => a - b);
const median = (values) => (values.length ? sorted(values)[values.length >> 1] : NaN);
const share = (values, part) => (values.length ? sorted(values)[Math.min(values.length - 1, Math.floor(values.length * part))] : NaN);
/** The middle of some bearings, which may straddle north. */
function middle(bearings) {
  if (!bearings.length) return NaN;
  const from = bearings[0];
  return wrap(from + median(bearings.map((b) => turn(from, b))));
}

// ---------------------------------------------------------------- reading --

/**
 * A recording as its parts: a new part each time the page's clock started
 * again, which is whenever the page was opened afresh.
 */
export function parseHeadTest(text) {
  const parts = [];
  let part = null;
  const number = (v) => (v === '' || v == null ? null : Number(v));
  for (const line of text.split('\n')) {
    if (!line) continue;
    if (line.startsWith('# kind,')) {
      part = { startedAt: null, notes: [], o: [], a: [], m: [], g: [], h: [] };
      parts.push(part);
      continue;
    }
    if (!part) {
      part = { startedAt: null, notes: [], o: [], a: [], m: [], g: [], h: [] };
      parts.push(part);
    }
    if (line[0] === '#') {
      const when = / started (\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(line);
      if (when && part.startedAt == null) part.startedAt = Date.parse(when[1]);
      part.notes.push(line.slice(2));
      continue;
    }
    const cells = line.split(',');
    const t = Number(cells[1]);
    if (!Number.isFinite(t)) continue;
    const v = cells.slice(2).map(number);
    if (cells[0] === 'o' && v[0] != null && v[1] != null && v[2] != null) part.o.push({ t, alpha: v[0], beta: v[1], gamma: v[2], absolute: v[3] === 1 });
    else if (cells[0] === 'a' && v[0] != null && v[1] != null && v[2] != null) part.a.push({ t, alpha: v[0], beta: v[1], gamma: v[2] });
    else if (cells[0] === 'm' && v[0] != null) part.m.push({ t, x: v[0], y: v[1], z: v[2] });
    else if (cells[0] === 'g' && v[0] != null) part.g.push({ t: t - Math.max(0, Math.min(3000, v[6] ?? 0)) / 1000, lat: v[0], lon: v[1], accuracy: v[2], heading: v[3], speed: v[4], altitude: v[5], age: v[6] });
    else if (cells[0] === 'h') part.h.push({ t, shown: v[0], offset: v[1], route: v[2], dist: v[3], speed: v[4], lead: v[5] });
  }
  return parts.filter((p) => p.o.length + p.m.length + p.g.length > 0);
}

// ----------------------------------------------------------------- travel --

/**
 * Which way and how fast the runner was going at each GPS fix: the
 * receiver's own word for it where it gives one, otherwise worked out from
 * one position to the next.
 */
function travelOf(fixes) {
  if (fixes.length < 3) return { travel: [], from: 'none' };
  const moving = fixes.filter((f) => f.speed != null && f.speed > 1);
  const own = moving.length >= 5 && moving.filter((f) => f.heading != null).length >= 0.8 * moving.length;
  if (own) return { travel: fixes.filter((f) => f.speed != null).map((f) => ({ t: f.t, course: f.heading, speed: f.speed })), from: 'receiver' };
  // From positions: across enough ground that a few metres of error is a small angle.
  const proj = createProjection(fixes[0].lat, fixes[0].lon);
  const at = fixes.map((f) => proj.toXY(f.lat, f.lon));
  const travel = [];
  for (let i = 0; i < fixes.length; i++) {
    let a = i;
    let b = i;
    while ((a > 0 || b < fixes.length - 1) && Math.hypot(at[b][0] - at[a][0], at[b][1] - at[a][1]) < 12 && fixes[b].t - fixes[a].t < 8) {
      if (a > 0) a--;
      if (b < fixes.length - 1) b++;
    }
    const gone = Math.hypot(at[b][0] - at[a][0], at[b][1] - at[a][1]);
    const took = fixes[b].t - fixes[a].t;
    if (!(took > 0)) continue;
    const speed = gone / took;
    if (gone >= 6) travel.push({ t: fixes[i].t, course: wrap(Math.atan2(at[b][0] - at[a][0], at[b][1] - at[a][1]) / RAD), speed });
    else travel.push({ t: fixes[i].t, course: null, speed });
  }
  return { travel, from: 'positions' };
}

// ------------------------------------------------------------------ mount --

const average = (vectors) => vectors.reduce((sum, v) => sum.map((c, i) => c + v[i] / vectors.length), [0, 0, 0]);
const unit = (v) => v.map((c) => c / (Math.hypot(...v) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The device's axes averaged over some readings, squared up again afterwards. */
function steadyAxes(readings) {
  const all = readings.map((r) => deviceAxes(r.alpha, r.beta, r.gamma));
  const x = unit(average(all.map((a) => a.x)));
  const z = unit(cross(x, average(all.map((a) => a.y))));
  return { x, y: cross(z, x), z };
}

/**
 * How the device sat on the head, as far as standing still can say. A head
 * test has no tap to line up by, so this is worked out: the wearer stood
 * still facing the way they then set off, so the head faced, level, the
 * bearing the GPS gave over the first seconds of moving.
 *
 * That fixes which way is up in the device's own axes, exactly. It does not
 * fix which way round the device is. Readings not tied to a compass measure
 * heading from wherever they happened to start, so "the head faced 20
 * degrees" picks out a direction in the device that is right only by luck.
 * For keeping the heading that does not matter, since any fixed direction
 * turns as the head turns. For telling a nod from a tilt, and for the
 * stride, it does: squareUp below puts it right.
 */
function findMount(part, travel) {
  const firstMove = travel.find((s, i) => s.speed >= 1 && travel[i + 1]?.speed >= 1);
  if (!firstMove) return null;
  const setOff = travel.filter((s) => s.course != null && s.speed >= 1 && s.t >= firstMove.t + 1.5 && s.t <= firstMove.t + 10);
  if (setOff.length < 2) return null;
  const bearing = middle(setOff.map((s) => s.course));
  const stood = part.o.filter((r) => r.t <= firstMove.t - 1.5 && r.t >= firstMove.t - 12);
  const standing = stood.length >= 60 && stood[stood.length - 1].t - stood[0].t >= 3;
  // Without a standing start, the first seconds of steady movement have to do, head bob and all.
  const readings = standing ? stood : part.o.filter((r) => r.t >= firstMove.t + 2 && r.t <= firstMove.t + 8);
  if (readings.length < 30) return null;
  const mount = mountFrom(steadyAxes(readings), bearing);
  // Where a compass was written down too, what it says about the same thing, to compare.
  const northed = part.a.filter((r) => r.t >= readings[0].t && r.t <= readings[readings.length - 1].t);
  const byCompass = northed.length >= 10 ? mountFrom(steadyAxes(northed), bearing) : null;
  return { mount, byCompass, bearing, standing, linedUpAt: standing ? stood[stood.length - 1].t : null, movedAt: firstMove.t };
}

/** A direction in the device's axes turned about "up" by `degrees`, clockwise seen from above. */
function turnedAbout(up, v, degrees) {
  const c = Math.cos(-degrees * RAD);
  const k = Math.sin(-degrees * RAD);
  const side = cross(up, v);
  const along = up[0] * v[0] + up[1] * v[1] + up[2] * v[2];
  return v.map((vi, i) => vi * c + side[i] * k + up[i] * along * (1 - c));
}

/** How far round, clockwise seen from above, direction `b` is from direction `a`, both level in the device's axes. */
function roundFrom(up, a, b) {
  const side = cross(a, up); // to the right of a
  return Math.atan2(b[0] * side[0] + b[1] * side[1] + b[2] * side[2], b[0] * a[0] + b[1] * a[1] + b[2] * a[2]) / RAD;
}

/** Every motion reading put in the head's level frame, with the stride's answers and a mean for each second. */
function feel(part, mount, way) {
  const stride = createStrideDirection();
  const answers = [];
  const each = new Map(); // second -> sums
  let o = 0;
  for (const m of part.m) {
    while (o < part.o.length - 1 && part.o[o + 1].t <= m.t) o++;
    const axes = deviceAxes(part.o[o].alpha, part.o[o].beta, part.o[o].gamma);
    const f = headFrame(axes, mount, { x: way * m.x, y: way * m.y, z: way * m.z });
    const answer = stride.add(m.t, f.forward, f.right, f.up);
    if (answer) answers.push(answer);
    const second = Math.floor(m.t);
    const sum = each.get(second) ?? { forward: 0, right: 0, n: 0 };
    sum.forward += f.forward;
    sum.right += f.right;
    sum.n++;
    each.set(second, sum);
  }
  return { answers, each };
}

/**
 * Which way round the device is, from the movement itself: the line the
 * stride runs along is the way the body goes, and over ordinary running
 * that is the way the head faces. Which end of the line is ahead is settled
 * by the GPS: speeding up pushes forwards, slowing pulls back.
 *
 * @returns {{mount, round:number, sure:boolean}|null} the mount with its
 *   forward direction put right, how far round it was moved, and whether
 *   ahead could be told from behind
 */
function squareUp(part, travel, mount, way, steadyThrough) {
  const { answers, each } = feel(part, mount, way);
  const steady = answers.filter((a) => steadyThrough(a.t - STRIDE_DEFAULTS.window, a.t) && a.confidence >= 0.5);
  if (steady.length < 10) return null;
  // The middle of many lines: a line has two ends, so work with twice its angle.
  let east = 0;
  let north = 0;
  for (const a of steady) {
    east += a.confidence * Math.sin(2 * a.right * RAD);
    north += a.confidence * Math.cos(2 * a.right * RAD);
  }
  const roughly = (0.5 * Math.atan2(east, north)) / RAD;
  // Then the middle one, measured from that, so that a minute of looking aside does not pull it.
  let round = roughly + median(steady.map((a) => turn(0, 2 * (a.right - roughly)) / 2));
  // Speeding up and slowing down, by GPS, against the push felt along that line over the same seconds.
  let agree = 0;
  let weight = 0;
  for (let i = 1; i < travel.length - 1; i++) {
    const took = travel[i + 1].t - travel[i - 1].t;
    if (!(took > 0.5 && took < 5)) continue;
    const gained = (travel[i + 1].speed - travel[i - 1].speed) / took;
    let forward = 0;
    let right = 0;
    let n = 0;
    for (let second = Math.floor(travel[i - 1].t); second <= Math.floor(travel[i + 1].t); second++) {
      const sum = each.get(second);
      if (!sum) continue;
      forward += sum.forward;
      right += sum.right;
      n += sum.n;
    }
    if (!n) continue;
    const felt = (forward * Math.cos(round * RAD) + right * Math.sin(round * RAD)) / n;
    agree += gained * felt;
    weight += Math.abs(gained * felt);
  }
  const sure = weight > 0 && Math.abs(agree) / weight > 0.3;
  if (sure && agree < 0) round += 180;
  round = turn(0, round);
  return { mount: { forward: turnedAbout(mount.up, mount.forward, round), up: mount.up }, round, sure };
}

/** Which side of the device a direction in its own axes is nearest, and how far off. */
function nearestSide([x, y, z]) {
  const sides = [['right edge', [1, 0, 0]], ['left edge', [-1, 0, 0]], ['top edge', [0, 1, 0]], ['bottom edge', [0, -1, 0]], ['screen', [0, 0, 1]], ['back', [0, 0, -1]]];
  let best = null;
  for (const [name, v] of sides) {
    const off = Math.acos(Math.max(-1, Math.min(1, x * v[0] + y * v[1] + z * v[2]))) / RAD;
    if (!best || off < best.off) best = { name, off };
  }
  return best;
}

// --------------------------------------------------------------- analysis --

/** The slope and height of a line through points, taking the middle of every pair's slope: outliers do not drag it. */
function sturdyLine(points) {
  if (points.length < 2) return { slope: 0, at: (t) => points[0]?.[1] ?? 0 };
  // Enough pairs to be sure of, without counting every one on a long run.
  const stride = Math.max(1, Math.floor(points.length / 300));
  const thin = points.filter((_, i) => i % stride === 0);
  const slopes = [];
  for (let i = 0; i < thin.length; i++) {
    for (let j = i + 1; j < thin.length; j++) {
      if (thin[j][0] - thin[i][0] > 20) slopes.push((thin[j][1] - thin[i][1]) / (thin[j][0] - thin[i][0]));
    }
  }
  const slope = slopes.length ? median(slopes) : 0;
  const height = median(points.map(([t, y]) => y - slope * t));
  return { slope, at: (t) => height + slope * t };
}

/**
 * One part of a recording, analysed.
 * @param part from parseHeadTest
 * @param {object|null} fitted the mount found in an earlier part, if this is a later one: the device has not moved on the head
 */
function analysePart(part, fitted) {
  const times = [...part.o, ...part.m, ...part.g].map((r) => r.t);
  const [from, to] = [Math.min(...times), Math.max(...times)];
  const seconds = to - from;
  const rate = (rows) => (rows.length > 1 ? (rows.length - 1) / (rows[rows.length - 1].t - rows[0].t) : 0);
  const gaps = part.o.slice(1).map((r, i) => r.t - part.o[i].t);
  const out = {
    seconds,
    counts: { orientation: part.o.length, motion: part.m.length, gps: part.g.length },
    rates: { orientation: rate(part.o), motion: rate(part.m), gps: rate(part.g) },
    longestSilence: gaps.length ? Math.max(...gaps) : null,
    absolute: part.o.length ? part.o.filter((r) => r.absolute).length / part.o.length : null,
    gps: { accuracy: median(part.g.map((f) => f.accuracy)), worst: share(part.g.map((f) => f.accuracy), 0.9), age: median(part.g.filter((f) => f.age != null).map((f) => f.age)) },
    notes: part.notes,
    problems: [],
  };
  if (part.o.length < 100) out.problems.push('Almost no orientation readings: the browser may not have been allowed the motion sensors.');
  if (part.m.length < 100) out.problems.push('Almost no motion readings: the stride cannot be looked at.');
  if (part.g.length < 10) out.problems.push('Almost no GPS fixes: nothing can be checked against the way of travel.');
  const { travel, from: travelFrom } = travelOf(part.g);
  out.gps.travelFrom = travelFrom;
  const going = travel.filter((s) => s.speed >= 1);
  out.speed = median(going.map((s) => s.speed));
  out.distance = travel.slice(1).reduce((sum, s, i) => sum + s.speed * Math.min(5, s.t - travel[i].t), 0);
  if (part.o.length < 100 || going.length < 20) {
    if (!out.problems.length) out.problems.push('Too little movement in this part to say more: under twenty seconds of it.');
    return { out, fitted };
  }

  // ---- how the device sat
  const found = fitted ? null : findMount(part, travel);
  const mounting = fitted ?? found;
  if (!mounting) {
    out.problems.push('Could not work out how the device sat on the head: no steady start to the movement was found.');
    return { out, fitted };
  }
  const steadySpeed = Math.max(1, 0.5 * out.speed);
  const steadyThrough = (a, b) => {
    const inside = travel.filter((s) => s.t >= a && s.t <= b);
    if (inside.length < 3 || inside.some((s) => s.course == null || s.speed < steadySpeed)) return false;
    return Math.abs(turn(inside[0].course, inside[inside.length - 1].course)) < 15;
  };
  // Some browsers give gravity the other way up. Over a run, the reading should point up on the whole.
  let way = 1;
  if (part.m.length >= 100) {
    const sample = part.m.filter((_, i) => i % 20 === 0);
    let o = 0;
    const ups = sample.map((m) => {
      while (o < part.o.length - 1 && part.o[o + 1].t <= m.t) o++;
      return headFrame(deviceAxes(part.o[o].alpha, part.o[o].beta, part.o[o].gamma), mounting.mount, m).up;
    });
    // The mean, not the middle: a running step is not even, and its middle sits below its mean.
    const mean = ups.reduce((sum, v) => sum + v, 0) / ups.length;
    way = mean < 0 ? -1 : 1;
    out.gravity = { size: Math.abs(mean), flipped: way < 0 };
  }
  // Which way round the device is: from the movement, the first time through.
  if (!fitted && part.m.length >= 100) {
    const squared = squareUp(part, travel, mounting.mount, way, steadyThrough);
    if (squared) {
      mounting.byCompassRound = mounting.byCompass ? roundFrom(mounting.mount.up, squared.mount.forward, mounting.byCompass.forward) : null;
      mounting.mount = squared.mount;
      mounting.squared = { sure: squared.sure };
    }
  }
  const { mount } = mounting;
  out.mount = { faces: nearestSide(mount.forward), top: nearestSide(mount.up), forward: mount.forward, up: mount.up, standing: mounting.standing, bearing: mounting.bearing, carried: Boolean(fitted), squared: mounting.squared ?? null, byCompassRound: mounting.byCompassRound ?? null };
  if (!mounting.squared) out.problems.push('Which way round the device sat could not be found from the movement: how far the head nods and tilts, and the lean of the stride, are not to be trusted.');
  else if (!mounting.squared.sure) out.problems.push('The device was found to lie along the line of travel, but not which end of it faces forwards: speeding up and slowing down by GPS did not settle it.');

  // ---- the head, by the device's own reckoning
  const heads = part.o.map((r) => {
    const pose = headPose(deviceAxes(r.alpha, r.beta, r.gamma), mount);
    return { t: r.t, yaw: wrap(pose.yaw / RAD), pitch: pose.pitch / RAD, roll: pose.roll / RAD };
  });
  out.head = { pitch: median(heads.map((h) => h.pitch)), roll: median(heads.map((h) => h.roll)) };
  /** The middle of the device's yaw between two times. */
  let cursor = 0;
  const yawBetween = (a, b) => {
    while (cursor > 0 && heads[cursor].t > a) cursor--;
    while (cursor < heads.length - 1 && heads[cursor].t < a) cursor++;
    let east = 0;
    let north = 0;
    for (let i = cursor; i < heads.length && heads[i].t <= b; i++) {
      east += Math.sin(heads[i].yaw * RAD);
      north += Math.cos(heads[i].yaw * RAD);
    }
    return east || north ? wrap(Math.atan2(east, north) / RAD) : null;
  };

  // ---- each second of steady going: the device's heading against the GPS's
  const seen = [];
  for (let i = 1; i < travel.length - 1; i++) {
    const s = travel[i];
    if (s.course == null || s.speed < steadySpeed) continue;
    const [before, after] = [travel[i - 1], travel[i + 1]];
    if (before.course == null || after.course == null) continue;
    if (Math.abs(turn(before.course, after.course)) / Math.max(0.5, after.t - before.t) > 6) continue; // rounding a corner
    const yaw = yawBetween(s.t - 0.5, s.t + 0.5);
    if (yaw != null) seen.push({ t: s.t, course: s.course, speed: s.speed, yaw, differs: turn(s.course, yaw) });
  }
  if (seen.length < 20) {
    out.problems.push('Too little steady movement to say anything about the heading.');
    return { out, fitted: mounting };
  }
  // Laid out along a line without wrapping round, from the middle of them all.
  const centre = middle(seen.map((s) => wrap(s.differs)));
  for (const s of seen) s.y = turn(centre, s.differs);

  // ---- hindsight: the slow line through that, leaving out any long look aside
  let aside = [];
  let line = sturdyLine(seen.map((s) => [s.t, s.y]));
  let truth = line.at;
  for (let pass = 0; pass < 3; pass++) {
    // Smooth out glances and stride, then find where the head stayed off the line.
    for (let i = 0; i < seen.length; i++) {
      const nearby = seen.filter((s) => Math.abs(s.t - seen[i].t) <= 5).map((s) => s.y - truth(s.t));
      seen[i].off = median(nearby);
    }
    aside = [];
    let run = null;
    for (const s of seen) {
      const away = Math.abs(s.off) >= ASIDE.angle;
      if (away && run && s.t - run.to <= 8 && Math.sign(s.off) === Math.sign(run.sum)) {
        run.to = s.t;
        run.sum += s.off;
        run.n++;
      } else if (away) {
        run = { from: s.t, to: s.t, sum: s.off, n: 1 };
        aside.push(run);
      }
    }
    aside = aside.filter((r) => r.to - r.from >= ASIDE.seconds).map((r) => ({ from: r.from, to: r.to, angle: r.sum / r.n }));
    const inAside = (t) => aside.some((r) => t >= r.from - 4 && t <= r.to + 4);
    const ordinary = seen.filter((s) => !inAside(s.t));
    line = sturdyLine(ordinary.map((s) => [s.t, s.y]));
    // A knot every half minute at the middle of what was seen around it; straight between knots, and across a look aside.
    // Each knot sits at the middle time of what it was made from, which near either end is not the time it was asked for.
    const knots = [];
    for (let t = seen[0].t; t <= seen[seen.length - 1].t + 30; t += 30) {
      const around = ordinary.filter((s) => Math.abs(s.t - t) <= 30);
      const when = median(around.map((s) => s.t));
      if (around.length >= 12 && !(knots.length && when - knots[knots.length - 1][0] < 10)) knots.push([when, median(around.map((s) => s.y))]);
    }
    truth = (t) => {
      if (knots.length < 2) return line.at(t);
      // Past either end, carry on at the slope of the last stretch, for at most half a minute.
      let k = 1;
      while (k < knots.length - 1 && t > knots[k][0]) k++;
      const [[t0, y0], [t1, y1]] = [knots[k - 1], knots[k]];
      const at = Math.max(knots[0][0] - 30, Math.min(knots[knots.length - 1][0] + 30, t));
      return y0 + ((y1 - y0) * (at - t0)) / (t1 - t0);
    };
    for (const s of seen) s.ordinary = !inAside(s.t);
  }
  const asideAt = (t) => aside.find((r) => t >= r.from && t <= r.to);
  out.wander = { perMinute: line.slope * 60, from: truth(seen[0].t), to: truth(seen[seen.length - 1].t), scatter: share(seen.filter((s) => s.ordinary).map((s) => Math.abs(s.y - truth(s.t))), 0.5) };
  // Positive: the head was turned to the right of the way of travel.
  out.aside = aside.map((r) => ({ from: r.from, to: r.to, seconds: r.to - r.from, angle: median(seen.filter((s) => s.t >= r.from + 3 && s.t <= r.to - 3).map((s) => s.y - truth(s.t))) }));

  // ---- the stride: which way the body was going, felt from the head
  const strides = part.m.length >= 100 ? feel(part, mount, way).answers : [];
  // The same angle by hindsight: the way of travel against the head's true heading, over the stretch the stride looked at.
  const courseBetween = (a, b) => {
    const inside = travel.filter((s) => s.course != null && s.t >= a && s.t <= b && s.speed >= steadySpeed);
    return inside.length >= 3 ? middle(inside.map((s) => s.course)) : null;
  };
  const pairs = [];
  for (const s of strides) {
    const [a, b] = [s.t - STRIDE_DEFAULTS.window, s.t];
    if (!steadyThrough(a, b)) continue;
    const yaw = yawBetween(a, b);
    const course = courseBetween(a, b);
    if (yaw == null || course == null) continue;
    const headTrue = yaw - centre - truth((a + b) / 2);
    const partly = aside.some((r) => (a < r.from && b > r.from) || (a < r.to && b > r.to));
    pairs.push({ t: s.t, stride: s.right, hindsight: turn(headTrue, course), confidence: s.confidence, phase: s.phase, steps: s.steps, aside: Boolean(asideAt((a + b) / 2)), partly });
  }
  const plain = pairs.filter((p) => !p.aside && !p.partly);
  if (plain.length >= 10) {
    const lean = median(plain.map((p) => p.stride - p.hindsight));
    const phases = plain.map((p) => p.phase);
    const usual = middle(phases.map(wrap));
    out.stride = {
      answers: strides.length,
      steps: median(plain.map((p) => p.steps)),
      confidence: median(plain.map((p) => p.confidence)),
      lean,
      scatter: median(plain.map((p) => Math.abs(p.stride - p.hindsight - lean))),
      phase: turn(0, usual),
      phaseHolds: phases.filter((p) => Math.abs(turn(usual, p)) <= 45).length / phases.length,
      aside: out.aside.map((r) => {
        const during = pairs.filter((p) => p.aside && !p.partly && p.t >= r.from && p.t <= r.to + STRIDE_DEFAULTS.window);
        return during.length >= 5 ? { hindsight: median(during.map((p) => p.hindsight)), stride: median(during.map((p) => p.stride - lean)), answers: during.length } : null;
      }),
    };
  } else if (part.m.length >= 100) out.problems.push('The stride gave too few answers on steady stretches to compare.');

  // ---- the heading kept live with no compass, replayed, and again with the stride's help
  const replay = (useStride) => {
    const anchor = createTravelAnchor();
    const errors = [];
    let h = 0;
    let s = 0;
    let lined = mounting.linedUpAt == null || fitted;
    for (const step of travel) {
      while (h < heads.length && heads[h].t <= step.t) {
        anchor.orientation(heads[h].yaw, heads[h].t);
        if (!lined && heads[h].t >= mounting.linedUpAt) {
          anchor.set(mounting.bearing, heads[h].t); // as a tap would have, standing at the start
          lined = true;
        }
        h++;
      }
      if (step.course == null) continue;
      let bearing = step.course;
      if (useStride && out.stride) {
        // The stride says where the body is going from the head; so compare the way of travel with that, not with the head.
        while (s < strides.length - 1 && strides[s + 1].t <= step.t) s++;
        const felt = strides[s];
        if (felt && step.t - felt.t >= 0 && step.t - felt.t < 2 && felt.confidence >= 0.5) bearing = wrap(step.course - (felt.right - out.stride.lean));
      }
      anchor.travel(bearing, step.speed, step.t);
      const kept = anchor.at(step.t);
      if (kept?.corrected && step.speed >= steadySpeed) errors.push({ t: step.t, error: turn(centre + truth(step.t), kept.offset), aside: Boolean(asideAt(step.t)) });
    }
    return errors;
  };
  const score = (errors) => {
    // Give it half a minute from first moving, as B14 is measured.
    const counted = errors.filter((e) => e.t >= mounting.movedAt + 30 || fitted);
    // Ordinary running is everything but a look aside and the two minutes after one, which are scored apart.
    const plainOnes = counted.filter((e) => !e.aside && !aside.some((r) => e.t > r.to && e.t < r.to + 120)).map((e) => Math.abs(e.error));
    return {
      typical: median(plainOnes),
      most: share(plainOnes, 0.95),
      aside: out.aside.map((r) => {
        const late = counted.filter((e) => e.t >= r.from + 0.5 * (r.to - r.from) && e.t <= r.to).map((e) => Math.abs(e.error));
        const after = counted.filter((e) => e.t >= r.to + 90 && e.t <= r.to + 150).map((e) => Math.abs(e.error));
        return { late: median(late), worst: Math.max(...counted.filter((e) => e.t >= r.from && e.t <= r.to + 10).map((e) => Math.abs(e.error)), 0), after: median(after) };
      }),
      series: errors,
    };
  };
  out.kept = score(replay(false));
  if (out.stride) out.withStride = score(replay(true));
  out.target = { degrees: TARGET, met: out.kept.most <= TARGET };

  // ---- the compass, where it was written down: how far out, against hindsight
  if (part.a.length >= 50) {
    let h = 0;
    const out_ = [];
    for (const r of part.a) {
      while (h < heads.length - 1 && heads[h + 1].t <= r.t) h++;
      const step = seen.find((s) => Math.abs(s.t - r.t) <= 0.5);
      if (!step || !step.ordinary) continue;
      const compass = wrap(headPose(deviceAxes(r.alpha, r.beta, r.gamma), mount).yaw / RAD);
      out_.push(turn(wrap(heads[h].yaw - centre - truth(r.t)), compass));
    }
    if (out_.length >= 20) {
      const steadily = median(out_);
      out.compass = { readings: part.a.length, steadily, scatter: share(out_.map((v) => Math.abs(v - steadily)), 0.95) };
    }
  }

  // ---- every half minute, for reading down
  out.table = [];
  for (let t = Math.ceil(seen[0].t / 30) * 30; t <= seen[seen.length - 1].t; t += 30) {
    const near = (rows, key) => median(rows.filter((r) => Math.abs(r.t - t) <= 8).map(key));
    out.table.push({
      t,
      speed: near(seen, (s) => s.speed),
      head: near(seen, (s) => s.y - truth(s.t)),
      stride: out.stride ? -near(pairs, (p) => p.stride - out.stride.lean) : NaN,
      kept: near(out.kept.series, (e) => e.error),
      withStride: out.withStride ? near(out.withStride.series, (e) => e.error) : NaN,
    });
  }
  return { out, fitted: mounting };
}

/** A whole recording, analysed: one result for each part of it. */
export function analyseHeadTest(text) {
  let fitted = null;
  return parseHeadTest(text).map((part) => {
    const done = analysePart(part, fitted);
    fitted = done.fitted;
    return done.out;
  });
}

// --------------------------------------------------------------- in words --

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const deg = (v, places = 1) => (Number.isFinite(v) ? `${v.toFixed(places)}°` : 'n/a');
const side = (v, right = 'right', left = 'left') => (Number.isFinite(v) ? `${Math.abs(v).toFixed(0)}° to the ${v >= 0 ? right : left}` : 'n/a');

export function describeHeadTest(results) {
  const lines = [];
  const say = (text = '') => lines.push(text);
  if (!results.length) return 'No readings in this file.\n';
  results.forEach((r, index) => {
    if (results.length > 1) say(`PART ${index + 1} of ${results.length}${index ? ': after the page was opened afresh' : ''}`);
    say(`${clock(r.seconds)} of recording${Number.isFinite(r.speed) ? `, about ${(r.distance / 1000).toFixed(2)} km at ${r.speed.toFixed(1)} m/s when moving` : ''}.`);
    say(`  Orientation: ${r.counts.orientation.toLocaleString()} readings, ${r.rates.orientation.toFixed(0)} a second${r.longestSilence > 0.5 ? `, with a silence of ${r.longestSilence.toFixed(1)} s` : ''}${r.absolute > 0.5 ? '; tied to the compass (no compass-free kind was offered)' : '; the compass-free kind'}.`);
    say(`  Motion: ${r.counts.motion.toLocaleString()} readings, ${r.rates.motion.toFixed(0)} a second${r.gravity?.flipped ? '; gravity reported the other way up, and turned over here' : ''}.`);
    say(`  GPS: ${r.counts.gps.toLocaleString()} fixes, ${r.rates.gps.toFixed(1)} a second, typically good to ${Number.isFinite(r.gps.accuracy) ? r.gps.accuracy.toFixed(0) : '?'} m (1 in 10 worse than ${Number.isFinite(r.gps.worst) ? r.gps.worst.toFixed(0) : '?'} m). The way of travel is taken from ${r.gps.travelFrom === 'receiver' ? "the receiver's own heading" : r.gps.travelFrom === 'positions' ? 'one position to the next, since the receiver gave no heading of its own' : 'nothing: there were too few fixes'}.`);
    for (const problem of r.problems) say(`  PROBLEM: ${problem}`);
    if (!r.mount) return say();

    say();
    say('How the device sat on the head');
    say(`  Facing forwards: its ${r.mount.faces.name} (${deg(r.mount.faces.off, 0)} off). Pointing up: its ${r.mount.top.name} (${deg(r.mount.top.off, 0)} off).`);
    say(r.mount.carried ? '  Taken from the first part: it has not moved on the head.' : r.mount.standing ? `  Which way is up: from the standing start, taking the head to have been level.` : `  There was no standing start, so which way is up is from the first seconds of running, head bob and all. It is rougher.`);
    if (!r.mount.carried && r.mount.squared) say(`  Which way round: from the line the stride runs along over the whole run${r.mount.squared.sure ? ', with speeding up and slowing down by GPS to say which end is ahead' : ''}.`);
    if (r.mount.byCompassRound != null) say(`  A compass reading at the start would have put it ${side(r.mount.byCompassRound)} of that.`);
    say(`  With that, the head was carried tipped ${side(r.head.pitch, 'up', 'down').replace(' to the', '')} and tilted ${side(r.head.roll)}, typically.`);
    if (!r.wander) return say();

    say();
    say("How fast the device's own heading wanders");
    say(`  ${deg(Math.abs(r.wander.perMinute))} a minute ${r.wander.perMinute >= 0 ? 'clockwise' : 'anticlockwise'}, ${deg(Math.abs(r.wander.to - r.wander.from))} over the run. Second to second the head sat ${deg(r.wander.scatter)} from the way of travel, typically.`);
    say(`  The design assumed 1.5° a minute and tested up to 5°.`);

    say();
    say('Looks to one side');
    if (!r.aside.length) say(`  None found: the head never stayed ${ASIDE.angle}° or more from the way of travel for ${ASIDE.seconds} s.`);
    for (const a of r.aside) say(`  From ${clock(a.from)} to ${clock(a.to)} (${a.seconds.toFixed(0)} s) the head was turned ${side(a.angle)} of the way of travel.`);

    say();
    say('The heading kept with no compass, replayed over this run');
    say(`  Ordinary running: typically ${deg(r.kept.typical)} out, 19 readings in 20 within ${deg(r.kept.most)}. Target: within ${TARGET}° for 19 in 20. ${r.target.met ? 'MET.' : 'NOT MET.'}`);
    r.aside.forEach((a, i) => {
      const k = r.kept.aside[i];
      say(`  During the look aside at ${clock(a.from)}: ${deg(k.late)} out in its second half, ${deg(k.worst)} at worst${Number.isFinite(k.after) ? `; ${deg(k.after)} out two minutes after it ended` : ''}.`);
    });

    say();
    say('The stride: which way the body is going, felt from the head');
    if (!r.stride) say('  Not enough to go on.');
    else {
      say(`  ${r.stride.answers} answers, ${r.stride.steps.toFixed(2)} steps a second. On ordinary stretches it sits ${deg(Math.abs(r.stride.lean))} from hindsight and scatters ${deg(r.stride.scatter)} about that.`);
      say('  (Which way round the device sits was itself taken from the stride, so the two agree on ordinary stretches by construction. The test is whether they move together when the head turns.)');
      say(`  How clearly the movement runs along one line: ${r.stride.confidence.toFixed(2)} (1 is a clean line, 0 is none).`);
      r.aside.forEach((a, i) => {
        const s = r.stride.aside[i];
        if (!s) return say(`  During the look aside at ${clock(a.from)}: too few answers.`);
        const part = Math.abs(s.hindsight) > 1 ? Math.round((100 * s.stride) / s.hindsight) : null;
        say(`  During the look aside at ${clock(a.from)}: by hindsight the body was going ${side(s.hindsight)} of the head; the stride read ${side(s.stride)}${part == null ? '' : `: ${part}% of it`}.`);
      });
      say(`  The push comes ${deg(Math.abs(r.stride.phase), 0)} ${r.stride.phase < 0 ? 'after' : 'before'} the bounce, on ${Math.round(100 * r.stride.phaseHolds)}% of answers. ${r.stride.phaseHolds >= 0.9 ? 'That is steady enough to tell ahead from behind by.' : 'That is not steady enough to tell ahead from behind by.'}`);
      if (r.withStride) {
        say(`  The heading kept with the stride's help: ordinary running typically ${deg(r.withStride.typical)} out, 19 in 20 within ${deg(r.withStride.most)}.`);
        r.aside.forEach((a, i) => say(`  During the look aside at ${clock(a.from)}: ${deg(r.withStride.aside[i].late)} out in its second half, against ${deg(r.kept.aside[i].late)} without.`));
      }
    }

    if (r.compass) {
      say();
      say('The compass, for comparison');
      say(`  ${r.compass.readings.toLocaleString()} readings. On ordinary stretches it read ${side(r.compass.steadily)} of the head's heading by hindsight, steadily, and 19 in 20 were within ${deg(r.compass.scatter)} of that.`);
    }

    say();
    say('Every half minute (degrees; head and stride are how far the head is turned to the right of the way of travel)');
    say('   time  speed   head by hindsight   head by stride   heading error   with stride');
    const cell = (v, width) => (Number.isFinite(v) ? v.toFixed(1) : '–').padStart(width);
    for (const row of r.table) say(`  ${clock(row.t).padStart(5)}  ${cell(row.speed, 5)}  ${cell(row.head, 18)}  ${cell(row.stride, 15)}  ${cell(row.kept, 14)}  ${cell(row.withStride, 12)}`);
    say();
  });
  return lines.join('\n') + '\n';
}

/** A recording file, squeezed or not, as text. */
export async function readHeadTest(path) {
  const raw = await readFile(path);
  return raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('Say which recording: node tools/head.mjs sportshud-head-....csv.gz');
    process.exit(1);
  }
  for (const file of files) {
    if (files.length > 1) console.log(`${file}\n`);
    const results = analyseHeadTest(await readHeadTest(file));
    console.log(process.argv.includes('--json') ? JSON.stringify(results, (key, value) => (key === 'series' ? undefined : value), 1) : describeHeadTest(results));
  }
}
