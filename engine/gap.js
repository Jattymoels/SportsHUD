// The gap between a runner and a ghost on the same route.
//
// Sign convention, used everywhere: positive means the runner is AHEAD of
// the ghost, negative means behind.
//
//   distance gap = runner's distance along the route - ghost's, at the same
//                  elapsed time. Metres.
//   time gap     = the elapsed time at which the ghost reached the runner's
//                  current spot - the runner's elapsed time. Seconds.
//
// Both clocks start at each recording's first fix. There are two ways to
// run them, chosen with the `clock` option:
//
//   'moving'  (default) - paused time does not count, as on a watch: where a
//             recording was paused its clock stops, and the runner's clock
//             stops whenever pause() has been called. For everyday runs.
//   'elapsed' - the clocks never stop. For races.
//
// Where the ghost stood still (a traffic light, say) it was at one spot for
// a while, not an instant. Around each such stop the time gap is measured
// against that whole stay: ahead until the ghost arrived there, behind once
// it had left, and level in between. Without this the reading would flip by
// the length of the stop with every metre of GPS wobble while the runner
// waits at the same light.

import { buildRoute } from './route.js';
import { toFixes, findPauses } from './gpx.js';
import { createClock, movingTime } from './clock.js';
import {
  createProgressTracker,
  projectRecording,
  monotone,
  distAtTime,
  timeAtDist,
} from './progress.js';

/**
 * Metres from the end of the route at which the runner counts as finished.
 * Two recordings of one route rarely stop on exactly the same spot.
 */
const FINISH_TOLERANCE = 10;

export const STOP_DEFAULTS = {
  stopSpeed: 0.5, // m/s: slower than this (or a quarter of the usual speed, if that is less) is standing
  stopSeconds: 8, // a stop lasts at least this long
  holeSeconds: 5, // a hole this long in the recording is a pause, if it was not crossed at near-normal speed
  stopZone: 15, // metres either side of a stop that are treated as the same spot
};

/**
 * Find where a profile stood still.
 *
 * Standing is moving slower than `stopSpeed`, or a quarter of the profile's
 * usual speed if that is less, so a slow walker is not mistaken for someone
 * standing. A hole in the recording counts too, unless it was crossed at
 * more than half the usual speed: the watch was paused, but the clock ran on.
 *
 * @param {{t:Float64Array, dist:Float64Array}} profile monotone
 * @returns {Array<{lo:number, hi:number, arrive:number, depart:number}>}
 *   zones of the route (metres) with the time the profile arrived and left.
 */
export function findStops(profile, options) {
  const o = { ...STOP_DEFAULTS, ...options };
  const { t, dist } = profile;
  const n = t.length;
  const speed = (k) => (dist[k + 1] - dist[k]) / (t[k + 1] - t[k]);
  const speeds = [];
  for (let k = 0; k < n - 1; k++) speeds.push(speed(k));
  speeds.sort((a, b) => a - b);
  const usual = speeds[speeds.length >> 1] || 0;
  const crawl = Math.min(o.stopSpeed, usual / 4);
  const standing = (k) => speed(k) < crawl || (t[k + 1] - t[k] >= o.holeSeconds && speed(k) < usual / 2);

  // Runs of standing, as [first sample, last sample]. A blip of movement
  // shorter than 2 s does not end a run.
  const runs = [];
  for (let k = 0; k < n - 1; k++) {
    if (!standing(k)) continue;
    const last = runs[runs.length - 1];
    if (last && t[k] - t[last[1]] <= 2) last[1] = k + 1;
    else runs.push([k, k + 1]);
  }

  const stops = [];
  for (const [a, b] of runs) {
    if (t[b] - t[a] < o.stopSeconds) continue;
    const zone = { lo: dist[a] - o.stopZone, hi: dist[b] + o.stopZone, arrive: t[a], depart: t[b] };
    const last = stops[stops.length - 1];
    if (last && zone.lo <= last.hi) {
      last.hi = zone.hi;
      last.depart = zone.depart;
    } else {
      stops.push(zone);
    }
  }
  return stops;
}

/**
 * Turn a ghost recording into what a race needs: the route it drew, its own
 * progress along that route, and where it stood still.
 *
 * @param recording from parseGpx
 * @param {{clock?: 'moving'|'elapsed'}} [options] other options go to the engine
 * @returns {{route: object, ghost: {t:Float64Array, dist:Float64Array, stops:Array}, pauses:Array}}
 *   `ghost.t` is on the chosen clock. `pauses` are the pauses taken out of
 *   it: none on the elapsed clock.
 */
export function prepareGhost(recording, options) {
  const fixes = toFixes(recording);
  const pauses = options?.clock === 'elapsed' ? [] : findPauses(fixes, options);
  const route = buildRoute(fixes, options);
  const profile = projectRecording(route, fixes, options);
  profile.t = profile.t.map((t) => movingTime(pauses, t));
  const ghost = monotone(profile);
  ghost.stops = findStops(ghost, options);
  return { route, ghost, pauses };
}

/**
 * Gap for a runner who is `dist` metres along the route at elapsed time `t`.
 * @param ghost a monotone profile, with `stops` from findStops if it has any
 */
export function gapAt(ghost, t, dist) {
  const ghostDist = distAtTime(ghost, t);
  let arrive = timeAtDist(ghost, dist);
  let depart = arrive;
  const stop = ghost.stops?.find((s) => dist >= s.lo && dist <= s.hi);
  if (stop) {
    arrive = Math.min(arrive, stop.arrive);
    depart = Math.max(depart, stop.depart);
  }
  return {
    timeGap: t < arrive ? arrive - t : t > depart ? depart - t : 0,
    distGap: dist - ghostDist,
    ghostDist,
  };
}

/**
 * Live gap. Feed it the runner's fixes as they arrive and read the gap at
 * any moment, including between fixes.
 *
 * To leave paused time out, call pause() when the runner pauses and resume()
 * when they carry on, as the button on a watch would. Position keeps being
 * tracked while paused; only the clock stops.
 *
 * Once the runner is within a few metres of the end of the route the result
 * is frozen: that is the finishing gap.
 */
export function createGapTracker(route, ghost, options) {
  const progress = createProgressTracker(route, options);
  const finishLine = route.length - FINISH_TOLERANCE;
  const clock = createClock();
  let finish = null;
  return {
    /** @param {{t:number, lat:number, lon:number, accuracy?:number}} fix */
    update(fix) {
      if (!finish) progress.update(fix);
    },
    /** Stop the runner's clock at elapsed time `t`. */
    pause: clock.pause,
    /** Start the runner's clock again at elapsed time `t`. */
    resume: clock.resume,
    /**
     * @param {number} t elapsed seconds since the runner's first fix
     * @returns {{t:number, time:number, paused:boolean, dist:number, speed:number, offset:number,
     *   fixAge:number, offRoute:boolean, timeGap:number, distGap:number, ghostDist:number, finished:boolean}|null}
     *   `time` is the runner's clock: `t` less any paused time.
     */
    at(t) {
      if (finish) return { ...finish, t };
      const p = progress.at(t);
      if (!p) return null;
      const { time, paused } = clock.read(t);
      const sample = { ...p, time, paused, ...gapAt(ghost, time, p.dist), finished: p.dist >= finishLine };
      if (sample.finished) finish = sample;
      return sample;
    },
  };
}

/**
 * The gap computed afterwards, from the runner's whole recording, at the
 * given elapsed times. Stops at the runner's finish.
 *
 * @param {{pauses?: Array<{start:number, end:number}>}} [options] the
 *   runner's pauses, to leave paused time out; other options go to the engine
 */
export function gapSeriesAfterwards(route, ghost, runnerFixes, times, options) {
  const profile = projectRecording(route, runnerFixes, options);
  const pauses = options?.pauses ?? [];
  const finishLine = route.length - FINISH_TOLERANCE;
  const series = [];
  for (const t of times) {
    const dist = distAtTime(profile, t);
    const time = movingTime(pauses, t);
    const finished = dist >= finishLine;
    series.push({ t, time, dist, ...gapAt(ghost, time, dist), finished });
    if (finished) break;
  }
  return series;
}

/**
 * Compare a live gap series with the one computed afterwards, reading by
 * reading, up to the finish.
 *
 * Each reading is scored twice:
 *   same instant - against the afterwards gap for the very same second.
 *   with slack   - against the afterwards gap anywhere within `slackS`
 *                  seconds of it.
 *
 * The slack exists because of one situation. Where the ghost stood still,
 * the time gap jumps by the length of the stop as the runner goes past that
 * spot. Live and afterwards both make the jump, but can place it a second
 * apart, and for that second they differ by the whole jump. Away from such
 * jumps the gap changes slowly, so the slack makes almost no difference.
 *
 * @param {{targetS?: number, slackS?: number}} [options]
 *   targetS: largest acceptable time-gap error, seconds.
 */
export function compareGapSeries(live, afterwards, { targetS = 3, slackS = 2 } = {}) {
  let n = 0;
  while (n < live.length && n < afterwards.length && !live[n].finished && !afterwards[n].finished) n++;

  const errors = []; // same instant
  const slackErrors = [];
  const misses = []; // times of readings outside the target even with slack
  const sameInstantMisses = []; // times of readings outside the target at the same instant
  let maxDistError = 0;
  let maxSlackError = 0;
  let from = 0; // first afterwards sample inside the slack window
  for (let i = 0; i < n; i++) {
    const { t, timeGap: gap } = live[i];
    errors.push(Math.abs(gap - afterwards[i].timeGap));
    if (errors[i] > targetS) sameInstantMisses.push(t);
    while (afterwards[from].t < t - slackS) from++;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = from; j < n && afterwards[j].t <= t + slackS; j++) {
      lo = Math.min(lo, afterwards[j].timeGap);
      hi = Math.max(hi, afterwards[j].timeGap);
    }
    const slackError = Math.max(0, lo - gap, gap - hi);
    slackErrors.push(slackError);
    if (slackError > targetS) misses.push(t);
    maxSlackError = Math.max(maxSlackError, slackError);
    maxDistError = Math.max(maxDistError, Math.abs(live[i].distGap - afterwards[i].distGap));
  }

  const sorted = [...errors].sort((a, b) => a - b);
  const share = (list) => (n ? list.filter((e) => e <= targetS).length / n : NaN);
  return {
    samples: n,
    targetS,
    slackS,
    // Same instant:
    maxTimeError: n ? sorted[n - 1] : NaN,
    p95TimeError: n ? sorted[Math.min(n - 1, Math.floor(0.95 * n))] : NaN,
    meanTimeError: n ? errors.reduce((a, b) => a + b, 0) / n : NaN,
    withinSameInstant: share(errors),
    sameInstantMisses,
    // With slack:
    maxTimeErrorWithSlack: n ? maxSlackError : NaN,
    within: share(slackErrors),
    misses,
    maxDistError: n ? maxDistError : NaN,
    pass: n > 0 && misses.length === 0,
  };
}
