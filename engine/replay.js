// Replay: play a recording back as if it were happening now.
//
// The runner's fixes are handed to a live tracker at the times they were
// recorded, and the gap is read on a fixed tick (once a second by default),
// exactly as a display would read it. Tests run a replay instantly; the desk
// harness runs the same replay against the wall clock.

import { toFixes, findPauses } from './gpx.js';
import {
  prepareGhost,
  createGapTracker,
  gapSeriesAfterwards,
  compareGapSeries,
} from './gap.js';
import { speedOfPace, createPaceTracker, paceSeriesAfterwards } from './pace.js';

/**
 * Fill the holes in a recording so it can stand in for live GPS.
 *
 * A recording has holes wherever the watch was paused (typically while
 * standing at a crossing) or was saving a fix only every few seconds. A
 * phone in live use reports about once a second regardless. So for a replay,
 * any hole longer than `step` seconds is filled with positions on the
 * straight line between the fixes either side of it.
 *
 * @param {Array<{t:number, lat:number, lon:number}>} fixes from toFixes
 * @param {number} [step] seconds between fixes after filling
 */
export function fillGaps(fixes, step = 1) {
  const out = [fixes[0]];
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1];
    const b = fixes[i];
    const pieces = Math.ceil((b.t - a.t) / step - 1e-9);
    for (let k = 1; k < pieces; k++) {
      const f = k / pieces;
      out.push({ t: a.t + f * (b.t - a.t), lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon) });
    }
    out.push(b);
  }
  return out;
}

/**
 * @param {Array<{t:number, lat:number, lon:number}>} runnerFixes from toFixes
 * @param {() => object} makeTracker makes a fresh live tracker, such as
 *   `() => createGapTracker(route, ghost)` or `() => createPaceTracker(speed)`
 * @param {{tickS?: number, pauses?: Array<{start:number, end:number}>}} [options]
 *   `pauses`: when the runner's watch was paused. The replay pauses and
 *   resumes the tracker's clock at those moments, as the watch's button or
 *   its auto-pause did.
 */
export function createReplay(runnerFixes, makeTracker, options = {}) {
  const tickS = options.tickS ?? 1;
  const duration = runnerFixes[runnerFixes.length - 1].t;
  const clockEvents = (options.pauses ?? []).flatMap((p) => [
    { t: p.start, paused: true },
    { t: p.end, paused: false },
  ]);
  let tracker, nextFix, nextTick, nextEvent;

  function reset() {
    tracker = makeTracker();
    nextFix = 0;
    nextTick = 0;
    nextEvent = 0;
  }
  function feedUntil(t) {
    while (nextFix < runnerFixes.length && runnerFixes[nextFix].t <= t) {
      tracker.update(runnerFixes[nextFix++]);
    }
    while (nextEvent < clockEvents.length && clockEvents[nextEvent].t <= t) {
      const event = clockEvents[nextEvent++];
      if (event.paused) tracker.pause(event.t);
      else tracker.resume(event.t);
    }
  }
  reset();

  return {
    duration,
    tickS,
    reset,
    /** Play forward to elapsed time `t`. Returns the tick samples produced on the way. */
    advanceTo(t) {
      const end = Math.min(t, duration);
      const ticks = [];
      while (nextTick * tickS <= end) {
        const tickT = nextTick * tickS;
        feedUntil(tickT);
        ticks.push(tracker.at(tickT));
        nextTick++;
      }
      feedUntil(end);
      return ticks;
    },
    /** The tracker's reading at `t`; call after advanceTo(t). */
    at: (t) => tracker.at(t),
    /** The most recent raw fix handed to the tracker. */
    lastFix: () => (nextFix > 0 ? runnerFixes[nextFix - 1] : null),
  };
}

/** Replay `saved` through a tracker and score the live readings against the afterwards ones. */
function check(saved, makeTracker, afterwardsAt, options) {
  const clock = options.clock ?? 'moving';
  const pauses = clock === 'elapsed' ? [] : findPauses(saved, options);
  const runnerFixes = options.fillGaps === false ? saved : fillGaps(saved);
  const replay = createReplay(runnerFixes, makeTracker, { ...options, pauses });
  const live = replay.advanceTo(replay.duration);
  const afterwards = afterwardsAt(runnerFixes, live.map((s) => s.t), { ...options, pauses });
  const stats = compareGapSeries(live, afterwards, options);
  const scored = live.slice(0, stats.samples);
  stats.tickS = replay.tickS;
  stats.maxFixAge = scored.reduce((oldest, s) => Math.max(oldest, s.fixAge), 0);
  // What the recording was like, for reading the result.
  stats.clock = clock;
  stats.pausedS = { runner: pauses.reduce((sum, p) => sum + p.end - p.start, 0) };
  stats.holes = { count: 0, longestS: 0, filled: options.fillGaps !== false };
  for (let i = 1; i < saved.length; i++) {
    const hole = saved[i].t - saved[i - 1].t;
    if (hole <= 2) continue;
    stats.holes.count++;
    stats.holes.longestS = Math.max(stats.holes.longestS, hole);
  }
  return { runnerFixes, pauses, live, afterwards, stats, scored };
}

/**
 * The B1 check for one pair of recordings: replay the runner against the
 * ghost, then compare every live reading with the gap computed afterwards.
 *
 * @param ghostRecording from parseGpx
 * @param runnerRecording from parseGpx
 * @param {{clock?: 'moving'|'elapsed', fillGaps?: boolean}} [options]
 *   `clock`: 'moving' (default) leaves out the time either recording was
 *   paused; 'elapsed' never stops the clocks. `fillGaps: false` replays the
 *   runner's recording exactly as saved, holes and all. Other options are
 *   passed on to the engine.
 */
export function checkB1(ghostRecording, runnerRecording, options = {}) {
  const { route, ghost, pauses: ghostPauses } = prepareGhost(ghostRecording, options);
  const { scored, ...result } = check(
    toFixes(runnerRecording),
    () => createGapTracker(route, ghost, options),
    (fixes, times, opts) => gapSeriesAfterwards(route, ghost, fixes, times, opts),
    options,
  );
  const { stats } = result;
  stats.pausedS.ghost = ghostPauses.reduce((sum, p) => sum + p.end - p.start, 0);
  stats.offRouteS = scored.filter((s) => s.offRoute).length * stats.tickS;
  stats.ghostStops = { count: ghost.stops.length, longestS: ghost.stops.reduce((longest, s) => Math.max(longest, s.depart - s.arrive), 0) };
  return { route, ghost, ...result };
}

/**
 * The same check for a pace ghost: replay a recording against a ghost
 * holding `secondsPerKm`, on whatever route the recording took, then compare
 * every live reading with the gap computed afterwards.
 *
 * @param recording from parseGpx
 * @param {number} secondsPerKm the ghost's pace
 * @param {{clock?: 'moving'|'elapsed', fillGaps?: boolean}} [options] as for checkB1
 */
export function checkPace(recording, secondsPerKm, options = {}) {
  const speed = speedOfPace(secondsPerKm);
  const { scored, ...result } = check(
    toFixes(recording),
    () => createPaceTracker(speed, options),
    (fixes, times, opts) => paceSeriesAfterwards(speed, fixes, times, opts),
    options,
  );
  // Distance is all a pace ghost is measured against, so report how the
  // live figure compares with the one worked out afterwards.
  const last = scored.length - 1;
  result.stats.distance = { live: scored[last].dist, afterwards: result.afterwards[last].dist };
  return { speed, ...result };
}
