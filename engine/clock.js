// The runner's clock.
//
// Elapsed time is every second since the first fix. Moving time leaves out
// the time spent paused, as the time shown on a watch does.

/**
 * What a paused watch would show at elapsed time `t`: the seconds of `t`
 * that fall outside the pauses.
 * @param {Array<{start:number, end:number}>} pauses in time order
 */
export function movingTime(pauses, t) {
  let paused = 0;
  for (const pause of pauses) {
    if (pause.start >= t) break;
    paused += Math.min(t, pause.end) - pause.start;
  }
  return t - paused;
}

/** A clock that can be paused and resumed as it goes, for live use. */
export function createClock() {
  let pausedTotal = 0;
  let pausedSince = null;
  return {
    /** Stop the clock at elapsed time `t`. */
    pause(t) {
      if (pausedSince == null) pausedSince = t;
    },
    /** Start it again at elapsed time `t`. */
    resume(t) {
      if (pausedSince == null) return;
      pausedTotal += Math.max(0, t - pausedSince);
      pausedSince = null;
    },
    /** @returns {{time:number, paused:boolean}} the clock's reading at elapsed time `t` */
    read(t) {
      const paused = pausedSince != null;
      return { time: t - pausedTotal - (paused ? Math.max(0, t - pausedSince) : 0), paused };
    },
  };
}
