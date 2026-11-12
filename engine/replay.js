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
import { createSegmentTracker } from './segments.js';

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

/** Replay the whole of `saved` through a tracker, and note what the recording was like. */
function playThrough(saved, makeTracker, options) {
  const clock = options.clock ?? 'moving';
  const pauses = clock === 'elapsed' ? [] : findPauses(saved, options);
  const runnerFixes = options.fillGaps === false ? saved : fillGaps(saved);
  const replay = createReplay(runnerFixes, makeTracker, { ...options, pauses });
  const live = replay.advanceTo(replay.duration);
  const about = {
    tickS: replay.tickS,
    clock,
    pausedS: { runner: pauses.reduce((sum, p) => sum + p.end - p.start, 0) },
    holes: { count: 0, longestS: 0, filled: options.fillGaps !== false },
  };
  for (let i = 1; i < saved.length; i++) {
    const hole = saved[i].t - saved[i - 1].t;
    if (hole <= 2) continue;
    about.holes.count++;
    about.holes.longestS = Math.max(about.holes.longestS, hole);
  }
  return { runnerFixes, pauses, live, about };
}

/** Replay `saved` through a tracker and score the live readings against the afterwards ones. */
function check(saved, makeTracker, afterwardsAt, options) {
  const { runnerFixes, pauses, live, about } = playThrough(saved, makeTracker, options);
  const afterwards = afterwardsAt(runnerFixes, live.map((s) => s.t), { ...options, pauses });
  const stats = Object.assign(compareGapSeries(live, afterwards, options), about);
  const scored = live.slice(0, stats.samples);
  stats.maxFixAge = scored.reduce((oldest, s) => Math.max(oldest, s.fixAge), 0);
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

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : 0;
};

/**
 * The B12 check, live segments: replay a recording against a ghost holding
 * `secondsPerKm`, with recorded ghosts taking over wherever its route shares
 * theirs, and look at every change of ghost.
 *
 * There is no gap computed afterwards to compare with here. What is checked
 * is that the gap does not jump when the ghost changes: the change in the
 * gap over the second of the switch, beyond how it was changing in the
 * seconds either side, must be within `jumpS`. When each switch happened is
 * reported; whether that was soon enough needs to know when the runner
 * really joined and left, which only a made-up recording can say.
 *
 * @param {Array} ghostRecordings from parseGpx; where two fit, the earlier in the list is used
 * @param runnerRecording from parseGpx
 * @param {number} secondsPerKm the pace the ghost holds away from any recording
 * @param {{clock?: 'moving'|'elapsed', fillGaps?: boolean, jumpS?: number}} [options] as for checkB1
 * @returns `switches`: one per change of ghost, `{t, to, track, dist, routeDist, timeGap, jump}`.
 *   `stretches`: the spells on a recording, `{from, to, track}` in seconds.
 */
export function checkSegments(ghostRecordings, runnerRecording, secondsPerKm, options = {}) {
  const jumpS = options.jumpS ?? 1;
  const prepared = ghostRecordings.map((recording) => prepareGhost(recording, options));
  const tracks = prepared.map(({ route, ghost }) => ({ route, profile: ghost }));
  const { about, ...result } = playThrough(
    toFixes(runnerRecording),
    () => createSegmentTracker({ secondsPerKm, tracks }, options),
    options,
  );
  const { live } = result;

  const step = (i) => live[i].timeGap - live[i - 1].timeGap;
  const switched = (i) => i > 0 && i < live.length && (live[i].ghost !== live[i - 1].ghost || live[i].track !== live[i - 1].track);
  const switches = [];
  const stretches = [];
  let maxStep = 0;
  for (let i = 1; i < live.length; i++) {
    maxStep = Math.max(maxStep, Math.abs(step(i)));
    if (!switched(i)) continue;
    const around = [];
    for (let k = i - 3; k <= i + 3; k++) if (k !== i && k > 0 && k < live.length && !switched(k)) around.push(step(k));
    const r = live[i];
    switches.push({ t: r.t, to: r.ghost, track: r.track, dist: r.dist, routeDist: r.routeDist, timeGap: r.timeGap, jump: Math.abs(step(i) - median(around)) });
    if (stretches.length && stretches[stretches.length - 1].to == null) stretches[stretches.length - 1].to = r.t;
    if (r.ghost === 'recording') stretches.push({ from: r.t, to: null, track: r.track });
  }
  if (stretches.length && stretches[stretches.length - 1].to == null) stretches[stretches.length - 1].to = live[live.length - 1].t;

  const maxSwitchJump = switches.reduce((most, s) => Math.max(most, s.jump), 0);
  const stats = {
    ...about,
    samples: live.length,
    maxFixAge: live.reduce((oldest, s) => Math.max(oldest, s.fixAge), 0),
    jumpS,
    maxSwitchJump,
    maxStep,
    pass: maxSwitchJump <= jumpS,
    onRecordingS: live.filter((s) => s.ghost === 'recording').length * about.tickS,
    distance: live[live.length - 1].dist,
  };
  stats.pausedS.ghosts = prepared.map(({ pauses }) => pauses.reduce((sum, p) => sum + p.end - p.start, 0));
  return { tracks, secondsPerKm, ...result, switches, stretches, stats };
}
