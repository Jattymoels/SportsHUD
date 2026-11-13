// The way someone is going, when there is no route to say.
//
// On a known route, the direction of travel is the direction of the route.
// With none, as when racing a ghost that only holds a pace, it has to come
// from GPS: the receiver's own reading of it where it gives one, which is
// good while moving and meaningless while standing; or else the line from
// where the runner was a few seconds ago to where they are now, which needs
// a few metres of movement before a fix being 3 m out stops mattering.
//
// Bearings are degrees clockwise from north.

import { haversine, createProjection } from './geo.js';
import { buildRoute } from './route.js';

export const TRAVEL_DEFAULTS = {
  minSpeed: 0.8, // m/s: slower than this is standing or shuffling, and says nothing about direction
  baseline: 12, // metres back to the fix the line of travel is drawn from, when the receiver gives no heading
  within: 20, // seconds: a fix older than this is too old to draw that line from
  over: 2.5, // seconds the bearing is smoothed over
  settle: 4, // seconds of steady movement before the bearing is called settled
  steady: 15, // degrees: readings within this of the smoothed bearing count as steady
};

const DEG = 180 / Math.PI;
const turn = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;
const wrap = (bearing) => ((bearing % 360) + 360) % 360;

/** The bearing from one place to another close by. */
function bearingBetween(a, b) {
  const north = b.lat - a.lat;
  const east = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  return wrap(Math.atan2(east, north) * DEG);
}

/**
 * @param {Partial<typeof TRAVEL_DEFAULTS>} [options]
 * @returns an object fed fixes as they arrive and asked which way the runner is going.
 */
export function createWayOfTravel(options) {
  const o = { ...TRAVEL_DEFAULTS, ...options };
  let recent = []; // fixes from the last `within` seconds
  let bearing = null;
  let seenAt = null; // when the bearing was last brought up to date
  let steadySince = null; // since when readings have agreed with the smoothed bearing
  let moving = false;
  let speed = 0;

  return {
    /**
     * @param {{t:number, lat:number, lon:number, gpsHeading?:number|null, gpsSpeed?:number|null}} fix
     *   `gpsHeading` and `gpsSpeed`: the receiver's own, where it gives them
     */
    update(fix) {
      const last = recent[recent.length - 1];
      if (last && !(fix.t > last.t)) return;
      const own = Number.isFinite(fix.gpsSpeed) ? fix.gpsSpeed : null;
      recent.push(fix);
      recent = recent.filter((f) => fix.t - f.t <= o.within);
      // The fix far enough back to draw a line from, newest first.
      let from = null;
      for (let i = recent.length - 2; i >= 0 && !from; i--) {
        if (haversine(recent[i].lat, recent[i].lon, fix.lat, fix.lon) >= o.baseline) from = recent[i];
      }
      speed = own ?? (from ? haversine(from.lat, from.lon, fix.lat, fix.lon) / (fix.t - from.t) : 0);
      moving = speed >= o.minSpeed;
      const reading = !moving ? null : Number.isFinite(fix.gpsHeading) ? wrap(fix.gpsHeading) : from ? bearingBetween(from, fix) : null;
      if (reading == null) {
        steadySince = null;
        return;
      }
      const dt = seenAt == null ? 0 : Math.max(0, fix.t - seenAt);
      if (bearing == null || Math.abs(turn(bearing, reading)) > o.steady) steadySince = fix.t;
      else steadySince ??= fix.t;
      bearing = bearing == null ? reading : wrap(bearing + turn(bearing, reading) * (1 - Math.exp(-dt / o.over)));
      seenAt = fix.t;
    },

    /**
     * @param {number} [t] the time now
     * @returns {{bearing:number|null, speed:number, moving:boolean, settled:boolean}}
     *   bearing: the way of travel, kept as it last was while standing; null
     *   until there has been any. moving: whether the runner is under way.
     *   settled: under way and going one way for a few seconds, which is
     *   when the bearing can be trusted to line something up by.
     */
    at(t = seenAt) {
      return { bearing, speed, moving, settled: moving && steadySince != null && t - steadySince >= o.settle };
    },
  };
}

/**
 * A stand-in for a route where there is none: a straight line through a
 * place, along a bearing. It lets everything that draws along a route (the
 * ghost on the road, the line to it, the gates) draw along the way the
 * runner is going instead.
 *
 * @param {{lat:number, lon:number}} here
 * @param {number} bearing degrees clockwise from north
 * @param {{behind?: number, ahead?: number}} [reach] metres of line each way
 * @returns {{route: object, at: number}} a route as buildRoute makes them,
 *   and how far along it `here` is
 */
export function straightAhead(here, bearing, { behind = 30, ahead = 400 } = {}) {
  const proj = createProjection(here.lat, here.lon);
  const east = Math.sin(bearing / DEG);
  const north = Math.cos(bearing / DEG);
  const place = (metres) => {
    const [lat, lon] = proj.toLatLon(east * metres, north * metres);
    return { lat, lon };
  };
  return { route: buildRoute([place(-behind), place(ahead)]), at: behind };
}
