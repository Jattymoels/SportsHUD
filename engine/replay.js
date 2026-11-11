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
 * @param {{fillGaps?: boolean}} [options] `fillGaps: false` replays the
 *   runner's recording exactly as saved, holes and all. Other options are
 *   passed on to the engine.
 */
export function checkB1(ghostRecording, runnerRecording, options = {}) {
  const { route, ghost } = prepareGhost(ghostRecording, options);
  const saved = toFixes(runnerRecording);
  const runnerFixes = options.fillGaps === false ? saved : fillGaps(saved);
  const replay = createReplay(route, ghost, runnerFixes, options);
  const live = replay.advanceTo(replay.duration);
  const afterwards = gapSeriesAfterwards(route, ghost, runnerFixes, live.map((s) => s.t), options);
  const stats = compareGapSeries(live, afterwards, options);
  const scored = live.slice(0, stats.samples);
  stats.tickS = replay.tickS;
  stats.maxFixAge = scored.reduce((oldest, s) => Math.max(oldest, s.fixAge), 0);
  // What the recordings were like, for reading the result.
  stats.offRouteS = scored.filter((s) => s.offRoute).length * replay.tickS;
  stats.holes = { count: 0, longestS: 0, filled: options.fillGaps !== false };
  for (let i = 1; i < saved.length; i++) {
    const hole = saved[i].t - saved[i - 1].t;
    if (hole <= 2) continue;
    stats.holes.count++;
    stats.holes.longestS = Math.max(stats.holes.longestS, hole);
  }
  stats.ghostStops = { count: ghost.stops.length, longestS: ghost.stops.reduce((longest, s) => Math.max(longest, s.depart - s.arrive), 0) };
  return { route, ghost, runnerFixes, live, afterwards, stats };
}
