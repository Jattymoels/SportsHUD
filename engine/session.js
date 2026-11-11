// A run in progress. This is what an app feeds GPS fixes to and reads its
// display from. It ties together the ghost, the clock, auto-pause, the
// runner's own distance, the kilometre splits and the recording of the run.

import { createOdometer } from './odometer.js';
import { createClock } from './clock.js';
import { createAutoPause } from './autopause.js';
import { createGapTracker } from './gap.js';
import { createPaceTracker, speedOfPace } from './pace.js';

/**
 * @param {object} setup
 * @param {{kind:'pace', secondsPerKm:number} | {kind:'track', route:object, profile:object}} setup.ghost
 *   a pace to hold, or a route and profile from prepareGhost
 * @param {'moving'|'elapsed'} [setup.clock] 'moving' (default) stops the clock
 *   while the runner stands still; 'elapsed' never stops it
 * @param {number} [setup.splitEvery] metres between splits; 1000 by default
 * @param {object} [setup.options] passed on to the engine
 */
export function createRunSession({ ghost, clock = 'moving', splitEvery = 1000, options } = {}) {
  const tracker =
    ghost.kind === 'pace'
      ? createPaceTracker(speedOfPace(ghost.secondsPerKm), options)
      : createGapTracker(ghost.route, ghost.profile, options);
  const odometer = createOdometer(options); // the runner's own distance, whatever the ghost is
  const ownClock = createClock();
  const autoPause = clock === 'moving' ? createAutoPause(options) : null;
  const fixes = [];
  const pauses = [];
  const splits = [];
  let pausedSince = null;
  let heldByHand = false;

  function setPaused(paused, t) {
    if (paused === (pausedSince != null)) return;
    if (paused) {
      tracker.pause(t);
      ownClock.pause(t);
      pausedSince = t;
    } else {
      tracker.resume(t);
      ownClock.resume(t);
      pauses.push({ start: pausedSince, end: t });
      pausedSince = null;
    }
  }

  function at(t) {
    const gap = tracker.at(t);
    const own = odometer.at(t);
    if (!gap || !own) return null;
    return {
      t,
      time: gap.time, // on the runner's clock
      paused: gap.paused,
      distance: own.dist, // metres the runner has covered
      speed: Math.max(0, own.speed), // m/s
      timeGap: gap.timeGap, // seconds; positive is ahead of the ghost
      distGap: gap.distGap, // metres; positive is ahead of the ghost
      offRoute: gap.offRoute ?? false, // racing a recording, and away from its route
      finished: gap.finished, // racing a recording, and reached its end
      fixAge: own.fixAge,
      accuracy: fixes[fixes.length - 1].accuracy ?? null,
      splits,
    };
  }

  return {
    /** @param {{t:number, lat:number, lon:number, accuracy?:number}} fix `t` in seconds since the run began */
    update(fix) {
      if (fixes.length && !(fix.t > fixes[fixes.length - 1].t)) return;
      fixes.push(fix);
      tracker.update(fix);
      odometer.update(fix);
      const own = odometer.at(fix.t);
      const change = autoPause?.update(fix);
      if (change && !heldByHand) setPaused(change.paused, change.at);
      while (own.dist >= (splits.length + 1) * splitEvery) {
        const now = at(fix.t);
        const before = splits.length ? splits[splits.length - 1].time : 0;
        splits.push({ distance: (splits.length + 1) * splitEvery, time: now.time, lap: now.time - before, timeGap: now.timeGap });
      }
    },
    /** Pause by hand at elapsed time `t`. Auto-pause stands down until resume(). */
    pause(t) {
      heldByHand = true;
      setPaused(true, t);
    },
    /** Resume by hand at elapsed time `t`. */
    resume(t) {
      heldByHand = false;
      setPaused(false, t);
    },
    /**
     * The reading for a display at elapsed time `t`; null before the first fix.
     * @returns {{t:number, time:number, paused:boolean, distance:number, speed:number, timeGap:number,
     *   distGap:number, offRoute:boolean, finished:boolean, fixAge:number, accuracy:number|null, splits:Array}|null}
     */
    at,
    /**
     * End the run at elapsed time `t`.
     * @returns {{distance:number, time:number, elapsed:number, secondsPerKm:number|null, timeGap:number|null,
     *   fixes:Array, pauses:Array<{start:number, end:number}>, splits:Array}}
     */
    finish(t) {
      const last = at(t);
      const closed = pausedSince == null ? pauses : [...pauses, { start: pausedSince, end: t }];
      return {
        distance: last?.distance ?? 0,
        time: last?.time ?? 0,
        elapsed: t,
        secondsPerKm: last && last.distance > 50 ? last.time / (last.distance / 1000) : null,
        timeGap: last?.timeGap ?? null,
        fixes,
        pauses: closed,
        splits,
      };
    },
  };
}
