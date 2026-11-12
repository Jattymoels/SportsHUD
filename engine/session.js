// A run in progress. This is what an app feeds GPS fixes to and reads its
// display from. It ties together the ghost, the clock, auto-pause, the
// runner's own distance, the kilometre splits and the recording of the run.

import { createOdometer } from './odometer.js';
import { createClock } from './clock.js';
import { createAutoPause } from './autopause.js';
import { createGapTracker } from './gap.js';
import { createPaceTracker, speedOfPace } from './pace.js';
import { createSegmentTracker } from './segments.js';

const AWAY_SECONDS = 6; // off the recording this long before a display need say so

/**
 * @param {object} setup
 * @param {{kind:'pace', secondsPerKm:number, tracks?:Array<{route:object, profile:object}>} | {kind:'track', route:object, profile:object, fallback?:number}} setup.ghost
 *   a pace to hold, or a route and profile from prepareGhost. A pace ghost
 *   given `tracks`, recorded ghosts from prepareGhost, hands over to one of
 *   them wherever the runner's way joins its route, and takes over again
 *   when they leave it: live segments. With
 *   `fallback`, a pace in seconds per km, the recording is raced as a live
 *   segment: wherever the runner is off its route (another street, a start
 *   part-way along, a different finish) a ghost holding that pace stands in,
 *   and the gap carries on when the recording takes over again. Without it,
 *   progress is held while off the route and the gap runs away.
 * @param {'moving'|'elapsed'} [setup.clock] 'moving' (default) stops the clock
 *   while the runner stands still; 'elapsed' never stops it
 * @param {number} [setup.splitEvery] metres between splits; 1000 by default
 * @param {object} [setup.options] passed on to the engine
 */
export function createRunSession({ ghost, clock = 'moving', splitEvery = 1000, options } = {}) {
  const standIn = ghost.kind === 'track' && ghost.fallback > 0;
  const carrying = ghost.kind === 'pace' && ghost.tracks?.length > 0;
  const tracker =
    carrying
      ? createSegmentTracker({ secondsPerKm: ghost.secondsPerKm, tracks: ghost.tracks }, options)
      : ghost.kind === 'pace'
      ? createPaceTracker(speedOfPace(ghost.secondsPerKm), options)
      : standIn
        ? createSegmentTracker({ secondsPerKm: ghost.fallback, tracks: [{ route: ghost.route, profile: ghost.profile }] }, options)
        : createGapTracker(ghost.route, ghost.profile, options);
  let onRecordingAt = null; // when the recording was last the ghost, or the run began
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

  /** The tracker's reading in one shape, whichever kind of ghost it is. */
  function gapAt(t) {
    const gap = tracker.at(t);
    if (!gap) return null;
    // A pace ghost carrying recordings: whichever is in charge, on any route, with no finish.
    if (carrying) return { ...gap, racing: gap.ghost, offRoute: false, finished: false, ghostDist: gap.ghostDist ?? gap.dist - gap.distGap };
    if (ghost.kind === 'pace') return { ...gap, racing: 'pace', track: null, offRoute: false, routeDist: null };
    if (!standIn) return { ...gap, racing: 'recording', track: 0, offRoute: gap.offRoute ?? false, routeDist: gap.dist };
    // A recording with a pace ghost standing in wherever the runner is off it.
    if (gap.reached) {
      // Followed to its end: the race is over and the gap stays as it stood there.
      return { ...gap, ...gap.reached, time: gap.time, racing: 'recording', track: 0, offRoute: false, finished: true, routeDist: ghost.route.length, ghostDist: ghost.route.length - gap.reached.distGap };
    }
    const racing = gap.ghost;
    return { ...gap, racing, offRoute: racing === 'pace' && t - (onRecordingAt ?? t) >= AWAY_SECONDS, ghostDist: gap.ghostDist ?? gap.dist - gap.distGap };
  }

  function at(t) {
    const gap = gapAt(t);
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
      racing: gap.racing, // which ghost the gap is to right now: 'recording' or 'pace'
      track: gap.racing === 'recording' ? (gap.track ?? 0) : null, // which recording, by its place in the ghost's tracks
      offRoute: gap.offRoute, // racing a recording, and away from its route
      finished: gap.finished, // racing a recording, and reached its end
      routeDist: gap.routeDist, // metres along the ghost's route, when on it
      ghostDist: gap.ghostDist, // metres the ghost has covered (along its route, if it has one)
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
      if (standIn && (onRecordingAt == null || tracker.at(fix.t).ghost === 'recording')) onRecordingAt = fix.t;
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
    /** Every position taken so far, for an app to keep in case the run is interrupted. */
    fixes: () => fixes,
    /**
     * The reading for a display at elapsed time `t`; null before the first fix.
     * @returns {{t:number, time:number, paused:boolean, distance:number, speed:number, timeGap:number,
     *   distGap:number, racing:'recording'|'pace', track:number|null, offRoute:boolean, finished:boolean,
     *   routeDist:number|null, ghostDist:number, fixAge:number, accuracy:number|null, splits:Array}|null}
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
