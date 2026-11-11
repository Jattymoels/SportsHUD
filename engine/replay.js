// Replay: play a recording back as if it were happening now.
//
// The runner's fixes are handed to the live gap tracker at the times they
// were recorded, and the gap is read on a fixed tick (once a second by
// default), exactly as a display would read it. Tests run a replay instantly;
// the desk harness runs the same replay against the wall clock.

import { toFixes } from './gpx.js';
import {
  prepareGhost,
  createGapTracker,
  gapSeriesAfterwards,
  compareGapSeries,
} from './gap.js';

/**
 * @param route from prepareGhost
 * @param ghost from prepareGhost
 * @param {Array<{t:number, lat:number, lon:number}>} runnerFixes from toFixes
 * @param {{tickS?: number}} [options] also passed on to the tracker
 */
export function createReplay(route, ghost, runnerFixes, options = {}) {
  const tickS = options.tickS ?? 1;
  const duration = runnerFixes[runnerFixes.length - 1].t;
  let tracker, nextFix, nextTick;

  function reset() {
    tracker = createGapTracker(route, ghost, options);
    nextFix = 0;
    nextTick = 0;
  }
  function feedUntil(t) {
    while (nextFix < runnerFixes.length && runnerFixes[nextFix].t <= t) {
      tracker.update(runnerFixes[nextFix++]);
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

/**
 * The B1 check for one pair of recordings: replay the runner against the
 * ghost, then compare every live reading with the gap computed afterwards.
 *
 * @param ghostRecording from parseGpx
 * @param runnerRecording from parseGpx
 */
export function checkB1(ghostRecording, runnerRecording, options = {}) {
  const { route, ghost } = prepareGhost(ghostRecording, options);
  const runnerFixes = toFixes(runnerRecording);
  const replay = createReplay(route, ghost, runnerFixes, options);
  const live = replay.advanceTo(replay.duration);
  const afterwards = gapSeriesAfterwards(route, ghost, runnerFixes, live.map((s) => s.t), options);
  const stats = compareGapSeries(live, afterwards, options);
  stats.tickS = replay.tickS;
  stats.maxFixAge = live.slice(0, stats.samples).reduce((oldest, s) => Math.max(oldest, s.fixAge), 0);
  return { route, ghost, runnerFixes, live, afterwards, stats };
}
