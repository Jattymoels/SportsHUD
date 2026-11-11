// Auto-pause: notice when the runner has stopped and when they set off
// again, so the clock can stop for a red light without anyone pressing
// anything.
//
// It works from positions, not from a smoothed speed, which takes several
// seconds to admit that someone has stopped. Each change is dated back to
// when it really happened, so a stop costs nothing against the ghost.

import { haversine } from './geo.js';

export const AUTOPAUSE_DEFAULTS = {
  pauseWithin: 2.5, // metres: staying inside this is standing...
  pauseAfter: 3, // ...once it has lasted this many seconds
  resumeBeyond: 3, // metres: moving more than this...
  resumeOver: 3, // ...within this many seconds is setting off again
};

/**
 * Feed it each GPS fix. It reports each stop and each restart once.
 * @param {Partial<typeof AUTOPAUSE_DEFAULTS>} [options]
 */
export function createAutoPause(options) {
  const o = { ...AUTOPAUSE_DEFAULTS, ...options };
  const keep = Math.max(o.pauseAfter, o.resumeOver) + 5;
  const trail = []; // recent fixes, newest last
  const apart = (a, b) => haversine(a.lat, a.lon, b.lat, b.lon);
  let paused = false;
  return {
    /**
     * @param {{t:number, lat:number, lon:number}} fix
     * @returns {{paused:boolean, at:number}|null} a change and the time it
     *   took effect, or null if nothing changed
     */
    update(fix) {
      trail.push(fix);
      while (fix.t - trail[0].t > keep) trail.shift();
      if (paused) {
        // Setting off: look back resumeOver seconds and see how far we have come.
        const start = trail.findIndex((f) => fix.t - f.t <= o.resumeOver);
        const from = trail[start];
        if (apart(from, fix) <= o.resumeBeyond) return null;
        paused = false;
        // The moving began at the last fix still at the standing spot.
        let at = from.t;
        for (let i = start + 1; i < trail.length && apart(from, trail[i]) <= o.pauseWithin; i++) at = trail[i].t;
        return { paused: false, at };
      }
      // Standing: how long has every fix been within reach of this one?
      let since = fix.t;
      for (let i = trail.length - 2; i >= 0 && apart(trail[i], fix) <= o.pauseWithin; i--) since = trail[i].t;
      if (fix.t - since < o.pauseAfter) return null;
      paused = true;
      return { paused: true, at: since };
    },
  };
}
