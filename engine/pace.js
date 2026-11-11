// A ghost that holds a pace, on whatever route is being run.
//
// There is no recorded route here, so nothing to snap to: the runner's
// progress is simply distance covered, and the ghost's is its speed times
// the time on the runner's clock.
//
// Sign convention as everywhere: positive means the runner is AHEAD.
//
//   distance gap = distance covered - distance the ghost has covered. Metres.
//   time gap     = time the ghost needs to cover the runner's distance
//                  - time on the runner's clock. Seconds.

import { toFixes, findPauses } from './gpx.js';
import { createOdometer, measureDistance } from './odometer.js';
import { createClock, movingTime } from './clock.js';
import { distAtTime } from './progress.js';

/** Metres per second for a pace given as seconds per kilometre. */
export function speedOfPace(secondsPerKm) {
  return 1000 / secondsPerKm;
}

/**
 * The average pace of a recording. This is the pace to give a ghost when a
 * past run is carried onto a different route, where its ups and downs no
 * longer line up with anything.
 *
 * @param recording from parseGpx
 * @param {{clock?: 'moving'|'elapsed'}} [options] 'moving' (default) leaves paused time out
 * @returns {{secondsPerKm:number, distance:number, time:number}} distance in metres, time in seconds
 */
export function paceOf(recording, options) {
  const fixes = toFixes(recording);
  const pauses = options?.clock === 'elapsed' ? [] : findPauses(fixes, options);
  const { dist } = measureDistance(fixes, options);
  const distance = dist[dist.length - 1];
  const time = movingTime(pauses, fixes[fixes.length - 1].t);
  return { secondsPerKm: time / (distance / 1000), distance, time };
}

/** Gap to a ghost moving at `speed` m/s, for a runner `dist` metres in at `time` on their clock. */
export function paceGapAt(speed, time, dist) {
  const ghostDist = speed * time;
  return { timeGap: dist / speed - time, distGap: dist - ghostDist, ghostDist };
}

/**
 * Live gap to a ghost holding a pace. Feed it the runner's fixes as they
 * arrive and read the gap at any moment, including between fixes.
 *
 * Call pause() and resume() to leave paused time out, as with a watch. The
 * ghost waits while the runner's clock is stopped.
 *
 * @param {number} speed the ghost's speed in m/s; see speedOfPace
 */
export function createPaceTracker(speed, options) {
  const odometer = createOdometer(options);
  const clock = createClock();
  return {
    /** @param {{t:number, lat:number, lon:number, accuracy?:number}} fix */
    update(fix) {
      odometer.update(fix);
    },
    pause: clock.pause,
    resume: clock.resume,
    /**
     * @param {number} t elapsed seconds since the runner's first fix
     * @returns {{t:number, time:number, paused:boolean, dist:number, speed:number, fixAge:number,
     *   timeGap:number, distGap:number, ghostDist:number, finished:boolean}|null}
     */
    at(t) {
      const progress = odometer.at(t);
      if (!progress) return null;
      const { time, paused } = clock.read(t);
      return { ...progress, time, paused, ...paceGapAt(speed, time, progress.dist), finished: false };
    },
  };
}

/**
 * The gap to a pace ghost computed afterwards, from the runner's whole
 * recording, at the given elapsed times.
 * @param {{pauses?: Array<{start:number, end:number}>}} [options] the runner's pauses
 */
export function paceSeriesAfterwards(speed, runnerFixes, times, options) {
  const profile = measureDistance(runnerFixes, options);
  const pauses = options?.pauses ?? [];
  return times.map((t) => {
    const dist = distAtTime(profile, t);
    const time = movingTime(pauses, t);
    return { t, time, dist, ...paceGapAt(speed, time, dist), finished: false };
  });
}
