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
// Both clocks start at each recording's first fix.

import { buildRoute } from './route.js';
import { toFixes } from './gpx.js';
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

/**
 * Turn a ghost recording into what a race needs: the route it drew and its
 * own progress along that route.
 *
 * @param recording from parseGpx
 * @returns {{route: object, ghost: {t:Float64Array, dist:Float64Array}}}
 */
export function prepareGhost(recording, options) {
  const fixes = toFixes(recording);
  const route = buildRoute(fixes, options);
  const ghost = monotone(projectRecording(route, fixes, options));
  return { route, ghost };
}

/** Gap for a runner who is `dist` metres along the route at elapsed time `t`. */
export function gapAt(ghost, t, dist) {
  const ghostDist = distAtTime(ghost, t);
  return {
    timeGap: timeAtDist(ghost, dist) - t,
    distGap: dist - ghostDist,
    ghostDist,
  };
}

/**
 * Live gap. Feed it the runner's fixes as they arrive and read the gap at
 * any moment, including between fixes.
 *
 * Once the runner is within a few metres of the end of the route the result
 * is frozen: that is the finishing gap.
 */
export function createGapTracker(route, ghost, options) {
  const progress = createProgressTracker(route, options);
  const finishLine = route.length - FINISH_TOLERANCE;
  let finish = null;
  return {
    /** @param {{t:number, lat:number, lon:number, accuracy?:number}} fix */
    update(fix) {
      if (!finish) progress.update(fix);
    },
    /**
     * @returns {{t:number, dist:number, speed:number, offset:number, fixAge:number,
     *   timeGap:number, distGap:number, ghostDist:number, finished:boolean}|null}
     */
    at(t) {
      if (finish) return { ...finish, t };
      const p = progress.at(t);
      if (!p) return null;
      const sample = { ...p, ...gapAt(ghost, t, p.dist), finished: p.dist >= finishLine };
      if (sample.finished) finish = sample;
      return sample;
    },
  };
}

/**
 * The gap computed afterwards, from the runner's whole recording, at the
 * given elapsed times. Stops at the runner's finish.
 */
export function gapSeriesAfterwards(route, ghost, runnerFixes, times, options) {
  const profile = projectRecording(route, runnerFixes, options);
  const finishLine = route.length - FINISH_TOLERANCE;
  const series = [];
  for (const t of times) {
    const dist = distAtTime(profile, t);
    const finished = dist >= finishLine;
    series.push({ t, dist, ...gapAt(ghost, t, dist), finished });
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
