// Live segments: a ghost for any route.
//
// The runner goes wherever they like, against a ghost holding a set pace.
// Wherever their way joins a stretch that a recorded ghost ran, in the same
// direction, that recording takes over for as long as they stay on it: the
// gap then moves by the recording's own pacing there, hills and all. When
// they leave it, the set pace takes over again.
//
// The gap carries on through every change. Joining a recording never jumps
// it: the recording's clock is slid so that, at the moment of joining, the
// recorded ghost is exactly as far ahead or behind as the pace ghost was.
//
// Leaving takes a few seconds to be sure of, and for those seconds the
// runner's place on the recording's route has stopped moving. So that the
// clock does not run on against them meanwhile, their place on the route is
// carried forward by the distance they have actually covered. If it turns
// out they only stepped aside (to a kerb, round an obstacle) their place
// then waits where it was carried to until they have really reached it.

import { createOdometer } from './odometer.js';
import { createClock } from './clock.js';
import { createProgressTracker } from './progress.js';
import { snapToRoute } from './route.js';
import { gapAt, passAt } from './gap.js';
import { speedOfPace } from './pace.js';

export const SEGMENT_DEFAULTS = {
  joinWithin: 12, // metres from a recorded route to count as on it
  joinAlong: 0.8, // how closely travel must follow its direction (1 = exactly)
  joinSeconds: 4, // on it for this long before its ghost takes over
  leaveSeconds: 8, // off it for this long before it is let go of altogether
  offRoute: 10, // metres off it, and not travelling along it, before the set pace takes over
  patience: 1, // seconds it must stay off before the set pace takes over: one stray fix is not leaving
};

const M_PER_DEG = 111195;
const SETTLE = 2; // metres the place may drop back in one go, as the tracker settles
const END_ZONE = 10; // metres from the end of a recording's route that count as having reached it

/**
 * @param {object} setup
 * @param {number} setup.secondsPerKm the pace the ghost holds away from any recording
 * @param {Array<{route:object, profile:object}>} setup.tracks recorded ghosts,
 *   each from prepareGhost or ghostFromFixes. Where more than one fits, the
 *   earliest in the list is used.
 * @param {object} [options] passed on to the engine
 */
export function createSegmentTracker({ secondsPerKm, tracks }, options) {
  const o = { ...SEGMENT_DEFAULTS, ...options };
  const speed = speedOfPace(secondsPerKm);
  const odometer = createOdometer(options);
  const clock = createClock();
  const trail = []; // recent fixes, for the direction of travel
  const fits = tracks.map(() => null); // per track: { since, dist } while the runner looks to be on it
  let live = null; // { index, tracker, lostSince, anchor, before }: the recording being followed, if any
  let onTrack = false; // its ghost is the one being raced right now
  let offset = 0; // set pace: gap = offset + distance / speed - time
  let shift = 0; // recording: its clock, slid so the gap carried over
  let reached = null; // the end of a recording's route, once the runner has followed it there

  /** Direction of travel as a unit [east, north]; null if barely moving. */
  function heading(fix) {
    while (trail.length && fix.t - trail[0].t > 15) trail.shift();
    let found = null;
    for (let i = trail.length - 1; i >= 0 && !found; i--) {
      const east = (fix.lon - trail[i].lon) * Math.cos((fix.lat * Math.PI) / 180) * M_PER_DEG;
      const north = (fix.lat - trail[i].lat) * M_PER_DEG;
      const moved = Math.hypot(east, north);
      if (moved >= 3) found = [east / moved, north / moved];
    }
    trail.push(fix);
    return found;
  }

  /** The runner's place on the followed recording's route, metres along it. */
  function place(own) {
    return Math.min(tracks[live.index].route.length, live.anchor.route + Math.max(0, own.dist - live.anchor.own));
  }

  /** The gap right now, by whichever ghost is being raced. */
  function gap(t) {
    const own = odometer.at(t);
    const { time, paused } = clock.read(t);
    if (onTrack) {
      const routeDist = place(own);
      return { own, time, paused, routeDist, ...gapAt(tracks[live.index].profile, time + shift, routeDist) };
    }
    const timeGap = offset + own.dist / speed - time;
    return { own, time, paused, routeDist: null, timeGap, distGap: timeGap * speed, ghostDist: null };
  }

  /** Change which ghost is raced, keeping the gap where it is. */
  function race(recording, t) {
    if (recording === onTrack) return;
    const now = gap(t);
    if (recording) {
      // Slide the recording's clock so its ghost is as far ahead or behind as the pace ghost was.
      const { arrive, depart } = passAt(tracks[live.index].profile, place(now.own));
      shift = (now.timeGap >= 0 ? arrive : depart) - now.timeGap - now.time;
    } else {
      offset = now.timeGap - (now.own.dist / speed - now.time);
    }
    onTrack = recording;
  }

  /**
   * Note where the runner is on the recording's route.
   *
   * Normally that is where the tracker puts them. While their progress along
   * the route has stalled although they kept moving, which is what leaving
   * it looks like before it is certain, the place is carried forward by the
   * distance they covered instead. Once the tracker is moving again, the
   * place waits for it to catch up rather than dropping back.
   */
  function follow(t) {
    const p = live.tracker.at(t);
    const own = odometer.at(t).dist;
    const stalled = live.before != null && p.dist - live.before.route < 0.5 * (own - live.before.own) - 0.5;
    let route = p.dist;
    if (onTrack && live.anchor) {
      const carried = live.anchor.route + Math.max(0, own - live.anchor.own);
      route = p.offRoute || stalled ? carried : p.dist >= live.anchor.route - SETTLE ? p.dist : live.anchor.route;
    }
    live.anchor = { route, own };
    live.before = { route: p.dist, own };
  }

  return {
    /** @param {{t:number, lat:number, lon:number, accuracy?:number}} fix */
    update(fix) {
      if (trail.length && !(fix.t > trail[trail.length - 1].t)) return;
      const toward = heading(fix);
      odometer.update(fix);

      if (live) {
        live.tracker.update(fix);
        follow(fix.t);
        const p = live.tracker.at(fix.t);
        // Standing somewhere off it with the clock stopped is not leaving it.
        if (!p.offRoute || clock.read(fix.t).paused) live.lostSince = null;
        else live.lostSince ??= fix.t;
        const atEnd = p.dist >= tracks[live.index].route.length - END_ZONE;
        if (atEnd && onTrack) {
          // Followed to its end: note the gap there before the set pace takes over.
          const g = gap(fix.t);
          reached = { track: live.index, time: g.time, timeGap: g.timeGap, distGap: g.distGap };
        }
        const gone = atEnd || (live.lostSince != null && fix.t - live.lostSince >= o.leaveSeconds);
        const away = live.lostSince != null && fix.t - live.lostSince >= o.patience;
        race(!away && !gone, fix.t);
        if (gone) live = null;
        if (onTrack) {
          fits.fill(null);
          return;
        }
      }

      // Not on a recording, or off the one being followed: see whether the
      // runner has joined one, or come back to this one somewhere else.
      for (let i = 0; i < tracks.length; i++) {
        const { route } = tracks[i];
        const snap = toward && snapToRoute(route, fix.lat, fix.lon, { near: 0, window: Infinity, nearSigma: 1e12, heading: toward });
        const fitsNow = snap && snap.offset <= o.joinWithin && toward[0] * snap.dir[0] + toward[1] * snap.dir[1] >= o.joinAlong && snap.dist < route.length - 20;
        if (!fitsNow) {
          fits[i] = null;
          continue;
        }
        fits[i] ??= { since: fix.t, dist: snap.dist };
        if (fix.t - fits[i].since < o.joinSeconds || snap.dist <= fits[i].dist) continue;
        live = { index: i, tracker: createProgressTracker(route, { ...options, offRoute: o.offRoute, startNear: snap.dist }), lostSince: null, anchor: null, before: null };
        live.tracker.update(fix);
        follow(fix.t);
        race(!live.tracker.at(fix.t).offRoute, fix.t);
        fits.fill(null);
        break;
      }
    },
    pause: clock.pause,
    resume: clock.resume,
    /**
     * @param {number} t elapsed seconds since the runner's first fix
     * @returns {{t:number, time:number, paused:boolean, dist:number, speed:number, fixAge:number,
     *   timeGap:number, distGap:number, ghost:'pace'|'recording', track:number|null,
     *   routeDist:number|null, ghostDist:number|null, finished:boolean,
     *   reached:{track:number, time:number, timeGap:number, distGap:number}|null}|null}
     *   ghost: which ghost is being raced. track: which recording, by its
     *   place in the list. routeDist, ghostDist: metres along that
     *   recording's route, for the runner and for its ghost. reached: the
     *   latest recording whose route the runner followed to its end, with
     *   the clock and the gap as they stood there.
     */
    at(t) {
      if (!odometer.at(t)) return null;
      const g = gap(t);
      return {
        t,
        time: g.time,
        paused: g.paused,
        dist: g.own.dist,
        speed: g.own.speed,
        fixAge: g.own.fixAge,
        timeGap: g.timeGap,
        distGap: g.distGap,
        ghost: onTrack ? 'recording' : 'pace',
        track: onTrack ? live.index : null,
        routeDist: g.routeDist,
        ghostDist: g.ghostDist,
        finished: false,
        reached,
      };
    },
  };
}
