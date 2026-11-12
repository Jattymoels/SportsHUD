// Route guide: what past runs of a route say about it.
//
// Nothing here needs a map. One recording gives the line of the route, its
// turns and, if the watch saved elevation, its climbs. Every further
// recording of the same route adds evidence of where the runner tends to
// have to wait, which on a city run is mostly traffic lights.
//
// Everything is placed in metres along the route, like the rest of the
// engine, so a display can ask "what is coming up from here?".

import { toFixes } from './gpx.js';
import { haversine } from './geo.js';
import { buildRoute, snapToRoute, pointAtDistance } from './route.js';
import { projectRecording, monotone } from './progress.js';
import { findStops } from './gap.js';

export const GUIDE_DEFAULTS = {
  sampleEvery: 10, // metres between elevation samples along the route
  smoothOver: 100, // metres the elevation is averaged over, to steady a watch's readings
  climbStep: 2, // metres a rise or fall must reach before it counts toward the totals
  climbGain: 8, // metres a climb must gain to be called out
  climbGrade: 0.02, // and it must average at least this steep (0.02 = 2%)
  climbDip: 3, // metres a climb may dip on the way up and still be one climb
  turnAngle: 45, // degrees of change of direction that make a turn
  turnBaseline: 20, // metres either side over which the direction is taken
  pauseSeconds: 5, // standing at least this long is a wait
  pauseWithin: 40, // metres along the route within which waits on different runs are the same place
  standWithin: 40, // metres a runner may shift about on the ground and still be standing
  endZone: 30, // metres at each end of the route where standing is just starting or finishing
  offRoute: 25, // metres: a recording typically further than this from the route is not a run of it
  cover: 0.8, // and it must travel at least this share of the route, in the route's direction
  turnWithin: 30, // metres along the route within which turns on different runs are the same turn
  markerEvery: 500, // metres between distance markers
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Is this recording a run of the route? It must keep close to the route's
 * line, and travel most of it in the route's own direction: the same streets
 * run the other way are a different route.
 */
function follows(route, fixes, options) {
  const o = { ...GUIDE_DEFAULTS, ...options };
  const offsets = [];
  const every = Math.max(1, Math.floor(fixes.length / 60));
  for (let i = 0; i < fixes.length; i += every) offsets.push(snapToRoute(route, fixes[i].lat, fixes[i].lon, { near: 0, window: Infinity, nearSigma: 1e12 }).offset);
  if (median(offsets) > o.offRoute) return false;
  const { dist } = projectRecording(route, fixes, options);
  return dist[dist.length - 1] - dist[0] >= o.cover * route.length;
}

/**
 * Sort recordings into routes: recordings that run the same line the same
 * way belong together. A commute out and the same commute home are two
 * routes.
 *
 * @param {Array} recordings from parseGpx, in any order
 * @returns {Array<Array<number>>} one list per route of indexes into
 *   `recordings`, the route with the most runs first. Within a route the
 *   most typical run, the one of middling length, comes first, so that it
 *   is the one to draw the route's line.
 */
export function groupRuns(recordings, options) {
  return groupFixes(recordings.map((recording) => toFixes(recording)), options);
}

/** groupRuns for runs already in hand as fixes, as an app keeps the runs it recorded. */
export function groupFixes(all, options) {
  const groups = [];
  all.forEach((fixes, i) => {
    const home = groups.find((g) => follows(g.route, fixes, options));
    if (home) home.members.push(i);
    else groups.push({ route: buildRoute(fixes, options), members: [i] });
  });
  const lengths = all.map((fixes) => buildRoute(fixes, options).length);
  return groups
    .sort((a, b) => b.members.length - a.members.length)
    .map(({ members }) => {
      const typical = [...members].sort((a, b) => lengths[a] - lengths[b])[(members.length - 1) >> 1];
      return [typical, ...members.filter((i) => i !== typical)];
    });
}

// ------------------------------------------------------------ elevation --

/**
 * Elevation along the route, from the recordings that carry it.
 *
 * Each recording's readings are placed by distance along the route and
 * averaged in `sampleEvery`-metre steps; the recordings are then averaged
 * together and the result smoothed over `smoothOver` metres. Watches report
 * elevation in small steps with some wander, and adding up every step
 * over-counts climb the same way adding up every GPS fix over-counts
 * distance. So a rise or fall only counts toward the totals once it has
 * reached `climbStep` metres.
 *
 * @param route from buildRoute
 * @param {Array<Array<{t:number, lat:number, lon:number, ele?:number}>>} runs fixes of each recording, from toFixes
 * @returns {{gain:number, loss:number, lowest:number, highest:number,
 *   profile:{dist:Float64Array, ele:Float64Array},
 *   climbs:Array<{from:number, to:number, gain:number, length:number, grade:number}>}|null}
 *   null if no recording carries elevation. `climbs` are the stretches worth
 *   calling out, in metres along the route.
 */
export function elevationAlong(route, runs, options) {
  const o = { ...GUIDE_DEFAULTS, ...options };
  const n = Math.max(2, Math.round(route.length / o.sampleEvery) + 1);
  const step = route.length / (n - 1);
  // Each recording's own readings, averaged in each step along the route.
  const series = [];
  for (const fixes of runs) {
    const withEle = fixes.filter((f) => f.ele != null);
    if (withEle.length < 2) continue;
    const { dist, off } = projectRecording(route, withEle, options);
    const total = new Float64Array(n);
    const hits = new Float64Array(n);
    for (let i = 0; i < withEle.length; i++) {
      if (off[i]) continue; // a reading taken on some other street says nothing about this one
      const k = Math.min(n - 1, Math.max(0, Math.round(dist[i] / step)));
      total[k] += withEle[i].ele;
      hits[k]++;
    }
    series.push(Float64Array.from(total, (sum, k) => (hits[k] ? sum / hits[k] : NaN)));
  }
  if (!series.length) return null;

  // A barometer starts each day a few metres out. Shift every later
  // recording by its typical difference from the first, then average.
  for (const own of series.slice(1)) {
    const apart = [];
    for (let k = 0; k < n; k++) if (!Number.isNaN(own[k]) && !Number.isNaN(series[0][k])) apart.push(own[k] - series[0][k]);
    const shift = apart.length ? median(apart) : 0;
    for (let k = 0; k < n; k++) own[k] -= shift;
  }
  const raw = new Float64Array(n);
  let known = -1; // the last sample some recording gave a reading for
  for (let k = 0; k < n; k++) {
    const readings = series.map((own) => own[k]).filter((e) => !Number.isNaN(e));
    if (!readings.length) continue;
    raw[k] = readings.reduce((sum, e) => sum + e, 0) / readings.length;
    // Fill any samples skipped since the last reading, on a straight line.
    for (let j = known + 1; j < k; j++) raw[j] = known < 0 ? raw[k] : raw[known] + ((j - known) / (k - known)) * (raw[k] - raw[known]);
    known = k;
  }
  if (known < 1) return null;
  for (let j = known + 1; j < n; j++) raw[j] = raw[known];

  // Smooth with a running average `smoothOver` metres wide.
  const half = Math.max(0, Math.round(o.smoothOver / step / 2));
  const ele = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let total = 0;
    let used = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(n - 1, k + half); j++) {
      total += raw[j];
      used++;
    }
    ele[k] = total / used;
  }
  const dist = Float64Array.from({ length: n }, (_, k) => k * step);

  const { gain, loss } = upsAndDowns(ele, o.climbStep);
  let lowest = ele[0];
  let highest = ele[0];
  for (let k = 1; k < n; k++) {
    lowest = Math.min(lowest, ele[k]);
    highest = Math.max(highest, ele[k]);
  }

  // Climbs: stretches where the ground rises at `climbGrade` or more, taken
  // over about 100 m, that gain at least `climbGain` in all. Two such
  // stretches with a short, shallow break between them are one climb.
  const reach = Math.max(1, Math.round(50 / step));
  const steep = (k) => {
    const a = Math.max(0, k - reach);
    const b = Math.min(n - 1, k + reach);
    return (ele[b] - ele[a]) / (dist[b] - dist[a]) >= o.climbGrade;
  };
  const stretches = [];
  for (let k = 0, from = -1; k <= n; k++) {
    if (k < n && steep(k)) {
      if (from < 0) from = k;
    } else if (from >= 0) {
      const last = stretches[stretches.length - 1];
      let dip = 0;
      if (last) for (let j = last[1]; j <= from; j++) dip = Math.max(dip, ele[last[1]] - ele[j]);
      if (last && dist[from] - dist[last[1]] <= 150 && dip <= o.climbDip) last[1] = k - 1;
      else stretches.push([from, k - 1]);
      from = -1;
    }
  }
  const climbs = stretches
    .map(([a, b]) => ({ from: dist[a], to: dist[b], gain: ele[b] - ele[a], length: dist[b] - dist[a], grade: (ele[b] - ele[a]) / (dist[b] - dist[a]) }))
    .filter((c) => c.gain >= o.climbGain);

  return { gain, loss, lowest, highest, profile: { dist, ele }, climbs };
}

/**
 * Total rise and fall along a series of heights, counting only between
 * turning points: a change of direction is one only once the height has
 * come back `step` metres from its highest or lowest. Wobble smaller than
 * that adds nothing.
 * @param {ArrayLike<number>} ele heights in order along the route, metres
 * @param {number} [step]
 * @returns {{gain:number, loss:number}}
 */
export function upsAndDowns(ele, step = GUIDE_DEFAULTS.climbStep) {
  let gain = 0;
  let loss = 0;
  let from = ele[0]; // height at the last turning point
  let extreme = ele[0]; // highest (climbing) or lowest (descending) since then
  let way = 0; // 1 climbing, -1 descending, 0 not yet known
  for (let k = 1; k < ele.length; k++) {
    const e = ele[k];
    if (way === 0) {
      if (Math.abs(e - from) >= step) {
        way = e > from ? 1 : -1;
        extreme = e;
      }
    } else if ((e - extreme) * way > 0) {
      extreme = e;
    } else if ((extreme - e) * way >= step) {
      if (way > 0) gain += extreme - from;
      else loss += from - extreme;
      from = extreme;
      extreme = e;
      way = -way;
    }
  }
  if (way > 0) gain += extreme - from;
  if (way < 0) loss += from - extreme;
  return { gain, loss };
}

// ---------------------------------------------------------------- turns --

/**
 * Where the route turns.
 *
 * The direction of the route is taken over `turnBaseline` metres before and
 * after each point, so the wobble of a GPS line and a gentle bend do not
 * count, and a turn is where the two differ by `turnAngle` degrees or more.
 *
 * @param route from buildRoute
 * @returns {Array<{dist:number, angle:number, side:'left'|'right', shape:'turn'|'sharp'|'back'}>}
 *   dist: metres along the route to the corner. angle: degrees turned
 *   through, always positive. shape: 'sharp' from 100 degrees, 'back' (the
 *   route doubles back on itself) from 150.
 */
export function findTurns(route, options) {
  const o = { ...GUIDE_DEFAULTS, ...options };
  const B = o.turnBaseline;
  const inner = B / 4; // the corner itself is left out, since a recorded line rounds it off
  const step = 2;
  const candidates = [];
  for (let d = B; d <= route.length - B; d += step) {
    const a0 = pointAtDistance(route, d - B);
    const a1 = pointAtDistance(route, d - inner);
    const b0 = pointAtDistance(route, d + inner);
    const b1 = pointAtDistance(route, d + B);
    const ax = a1.x - a0.x;
    const ay = a1.y - a0.y;
    const bx = b1.x - b0.x;
    const by = b1.y - b0.y;
    const angle = (Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * 180) / Math.PI; // + is anticlockwise: a left turn
    if (Math.abs(angle) >= o.turnAngle) candidates.push({ dist: d, angle });
  }
  // One turn per run of candidates, placed at the middle of where the change is greatest.
  const turns = [];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const size = Math.max(...group.map((c) => Math.abs(c.angle)));
    const top = group.filter((c) => Math.abs(c.angle) >= size - 5);
    const lefts = top.filter((c) => c.angle > 0).length;
    turns.push({
      dist: (top[0].dist + top[top.length - 1].dist) / 2,
      angle: size,
      // Doubling straight back has no side; it is given as whichever the line leans to.
      side: lefts * 2 >= top.length ? 'left' : 'right',
      shape: size >= 150 ? 'back' : size >= 100 ? 'sharp' : 'turn',
    });
    group = [];
  };
  for (const c of candidates) {
    if (group.length && c.dist - group[group.length - 1].dist > B) flush();
    group.push(c);
  }
  flush();
  return turns;
}

/**
 * The turns several runs of a route agree on.
 *
 * One recording's line has that day's quirks in it: a crossing taken a
 * little further along, a step round something. So with three or more runs,
 * each run's own turns are found, placed on the route, and a turn is kept
 * only where at least half the runs made it.
 *
 * @param route from buildRoute, the line everything is placed on
 * @param {Array<Array<{lat:number, lon:number}>>} runs fixes of each recording
 * @returns turns as from findTurns, each with `runs` and `of`: how many of
 *   the runs made it. With fewer than three runs, the route's own turns.
 */
export function agreedTurns(route, runs, options) {
  const o = { ...GUIDE_DEFAULTS, ...options };
  if (runs.length < 3) return findTurns(route, options).map((turn) => ({ ...turn, runs: 1, of: 1 }));
  const seen = [];
  runs.forEach((fixes, run) => {
    const own = buildRoute(fixes, options);
    for (const turn of findTurns(own, options)) {
      const where = pointAtDistance(own, turn.dist);
      const snap = snapToRoute(route, where.lat, where.lon, { near: (turn.dist / own.length) * route.length, window: 300, nearSigma: 150 });
      if (snap.offset <= o.offRoute) seen.push({ ...turn, dist: snap.dist, run });
    }
  });
  seen.sort((a, b) => a.dist - b.dist);
  const places = [];
  for (const turn of seen) {
    const last = places[places.length - 1];
    if (last && turn.dist - last[last.length - 1].dist <= o.turnWithin) last.push(turn);
    else places.push([turn]);
  }
  const turns = [];
  for (const place of places) {
    const made = new Set(place.map((t) => t.run)).size;
    if (made * 2 < runs.length) continue;
    // Most runs' side wins; among those, the middling angle and place.
    const lefts = place.filter((t) => t.side === 'left').length;
    const side = lefts * 2 >= place.length ? 'left' : 'right';
    const agreeing = place.filter((t) => t.side === side);
    const angle = median(agreeing.map((t) => t.angle));
    turns.push({ dist: median(agreeing.map((t) => t.dist)), angle, side, shape: angle >= 150 ? 'back' : angle >= 100 ? 'sharp' : 'turn', runs: made, of: runs.length });
  }
  return turns;
}

// ---------------------------------------------------------------- waits --

/**
 * Where runs of this route have had to wait.
 *
 * Each recording is laid along the route and searched for places it stood
 * still, or where the watch was paused. Waits on different runs within
 * `pauseWithin` metres of each other are taken to be the same place.
 *
 * @param route from buildRoute
 * @param {Array<Array<{t:number, lat:number, lon:number}>>} runs fixes of each recording, from toFixes
 * @returns {Array<{dist:number, runs:number, of:number, share:number, typical:number, longest:number, waits:number[], likely:boolean, elsewhere?:object}>}
 *   dist: metres along the route. runs: how many of the `of` recordings
 *   waited there. share: runs / of. typical, longest: seconds waited, the
 *   median and the most. waits: every wait, one per run that waited.
 *   likely: at least two runs in all waited there, and at least half of
 *   those that passed (with fewer than three runs to go on, any wait).
 *   elsewhere, from buildGuide's `others`: `{runs, of, typical, longest}`
 *   for runs of other routes that cover this ground.
 *   A wait by a paused watch is timed exactly; one where the watch kept
 *   running reads a few seconds short, the time taken to slow and set off.
 */
export function findPausePoints(route, runs, options) {
  const o = { ...GUIDE_DEFAULTS, ...options };
  const places = gatherWaits(route, runs.map((fixes) => standingIn(route, fixes, options)), options);
  return addElsewhere(places, { seen: [], passes: () => 0 }, runs.length, route.length, o);
}

/** Where one recording stood still along the route, ends of the route aside. */
function standingIn(route, fixes, options) {
  const o = { ...GUIDE_DEFAULTS, ...options };
  const profile = monotone(projectRecording(route, fixes, options));
  // Progress along the route also stands still while a run is off it on
  // some other street. A wait is standing: hardly moving on the ground.
  const stoodStill = (stop) => {
    const during = fixes.filter((f) => f.t >= stop.arrive - 1 && f.t <= stop.depart + 1);
    return during.every((f) => haversine(during[0].lat, during[0].lon, f.lat, f.lon) <= o.standWithin);
  };
  return findStops(profile, { ...options, stopSeconds: o.pauseSeconds })
    .filter(stoodStill)
    .map((stop) => ({ dist: (stop.lo + stop.hi) / 2, wait: stop.depart - stop.arrive }))
    .filter((stop) => stop.dist >= o.endZone && stop.dist <= route.length - o.endZone);
}

/**
 * Where runs of other routes stood still on ground this route covers, placed
 * along this route, and a way to ask how many of them pass a given place.
 */
function standingElsewhere(route, others, options) {
  const o = { ...GUIDE_DEFAULTS, ...options };
  const whole = { near: 0, window: Infinity, nearSigma: 1e12 };
  const lines = [];
  const seen = [];
  others.forEach((fixes, run) => {
    let own;
    try {
      own = buildRoute(fixes, options);
    } catch {
      return; // too short to be a run of anything
    }
    lines.push(own);
    for (const stop of standingIn(own, fixes, options)) {
      const where = pointAtDistance(own, stop.dist);
      const snap = snapToRoute(route, where.lat, where.lon, whole);
      if (snap.offset <= o.offRoute) seen.push({ dist: snap.dist, wait: stop.wait, run });
    }
  });
  const passes = (dist) => {
    const where = pointAtDistance(route, dist);
    return lines.filter((own) => snapToRoute(own, where.lat, where.lon, whole).offset <= o.offRoute).length;
  };
  return { seen, passes };
}

/**
 * Add what runs of other routes saw to the places runs of this route waited,
 * and say for each place whether a wait there is likely: at least two runs
 * waited, and at least half of those that passed it, counting either this
 * route's runs alone or all runs together.
 */
function addElsewhere(places, { seen, passes }, runsOfRoute, routeLength, o) {
  const sum = (stops, dist) => {
    const byRun = new Map();
    for (const s of stops) byRun.set(s.run, (byRun.get(s.run) ?? 0) + s.wait);
    const waits = [...byRun.values()];
    return { runs: waits.length, of: Math.max(passes(dist), waits.length), typical: median(waits), longest: Math.max(...waits) };
  };
  let left = [...seen].sort((a, b) => a.dist - b.dist);
  for (const place of places) {
    const here = left.filter((s) => Math.abs(s.dist - place.dist) <= o.pauseWithin);
    if (!here.length) continue;
    place.elsewhere = sum(here, place.dist);
    left = left.filter((s) => !here.includes(s));
  }
  // Places only the other routes' runs waited at.
  const groups = [];
  for (const stop of left) {
    const last = groups[groups.length - 1];
    if (last && stop.dist - last[last.length - 1].dist <= o.pauseWithin) last.push(stop);
    else groups.push([stop]);
  }
  for (const stops of groups) {
    const dist = stops.reduce((total, s) => total + s.dist, 0) / stops.length;
    if (dist < o.endZone || dist > routeLength - o.endZone) continue;
    const elsewhere = sum(stops, dist);
    places.push({ dist, runs: 0, of: runsOfRoute, share: 0, typical: elsewhere.typical, longest: elsewhere.longest, waits: [], elsewhere });
  }
  for (const place of places) {
    // Runs of other routes that passed here without waiting count against it too.
    if (!place.elsewhere) {
      const passed = passes(place.dist);
      if (passed) place.elsewhere = { runs: 0, of: passed, typical: 0, longest: 0 };
    }
    const waited = place.runs + (place.elsewhere?.runs ?? 0);
    const passed = place.of + (place.elsewhere?.of ?? 0);
    // Likely on this route's own runs, or on every run that passed taken
    // together. Runs the other way can add to a wait but not take one away:
    // at a wide crossing each direction waits on its own side.
    const enough = (n, of) => n >= 2 && n / of >= 0.5;
    // With one or two runs in all there is nothing to judge by: a wait seen is a wait shown.
    place.likely = passed < 3 ? waited > 0 : enough(place.runs, place.of) || enough(waited, passed);
  }
  return places.sort((a, b) => a.dist - b.dist);
}

/** Group the places each run stood into places along the route. */
function gatherWaits(route, perRun, options) {
  const o = { ...GUIDE_DEFAULTS, ...options };
  const found = perRun.flatMap((stops, run) => stops.map((stop) => ({ ...stop, run }))).sort((a, b) => a.dist - b.dist);
  const places = [];
  for (const stop of found) {
    const last = places[places.length - 1];
    if (last && stop.dist - last[last.length - 1].dist <= o.pauseWithin) last.push(stop);
    else places.push([stop]);
  }
  return places.map((stops) => {
    // A run that stopped twice at one place waited there once, for the total.
    const byRun = new Map();
    for (const s of stops) byRun.set(s.run, (byRun.get(s.run) ?? 0) + s.wait);
    const waits = [...byRun.values()];
    return {
      dist: stops.reduce((sum, s) => sum + s.dist, 0) / stops.length,
      runs: waits.length,
      of: perRun.length,
      share: waits.length / perRun.length,
      typical: median(waits),
      longest: Math.max(...waits),
      waits,
    };
  });
}

// ---------------------------------------------------------------- guide --

/**
 * Everything past runs say about a route.
 *
 * @param {Array} recordings from parseGpx, all of the same route. The first
 *   one draws the route; recordings that do not follow it, or run it the
 *   other way, are left out and counted in `leftOut`. groupRuns sorts a
 *   mixed pile into routes and puts the best one to draw each first.
 * @param {Partial<typeof GUIDE_DEFAULTS>} [options]
 * @returns {{route:object, length:number, runs:number, leftOut:number,
 *   climb:object|null, turns:Array, pausePoints:Array, usualWait:number,
 *   times:{moving:number, elapsed:number}, features:Array}}
 *   climb: from elevationAlong. usualWait: seconds of waiting to expect, each
 *   place counted by how often runs wait there. times: the median run, in
 *   seconds, with and without waits. features: turns, waits, climbs,
 *   distance markers and the finish in one list, in order along the route,
 *   each `{kind, dist, ...}` with kind 'turn' | 'wait' | 'climb' | 'marker' | 'finish'.
 */
export function buildGuide(recordings, options) {
  const others = (options?.others ?? []).map((recording) => toFixes(recording));
  return guideFromRuns(recordings.map((recording) => toFixes(recording)), { ...options, others });
}

/**
 * buildGuide for runs already in hand as fixes, as an app keeps the runs it
 * recorded. The first run draws the route.
 * @param {Array<Array<{t:number, lat:number, lon:number, ele?:number}>>} all
 * @param {object} [options] `others`: runs of other routes (the same streets
 *   the other way, or a route that shares some of them), as fixes. Where one
 *   of them stood still on ground this route covers, that counts towards
 *   the wait there: a crossing is a crossing from either side.
 */
export function guideFromRuns(all, { others = [], ...options } = {}) {
  const o = { ...GUIDE_DEFAULTS, ...options };
  if (!all.length) throw new Error('A route guide needs at least one recording of the route');
  const route = buildRoute(all[0], options);
  const runs = all.filter((fixes, i) => i === 0 || follows(route, fixes, options));

  const climb = elevationAlong(route, runs, options);
  const turns = agreedTurns(route, runs, options);
  const stood = runs.map((fixes) => standingIn(route, fixes, options));
  const pausePoints = addElsewhere(gatherWaits(route, stood, options), standingElsewhere(route, others, options), runs.length, route.length, o);
  const usualWait = pausePoints.reduce((sum, p) => sum + p.share * p.typical, 0);
  const elapsed = runs.map((fixes) => fixes[fixes.length - 1].t);
  // Time on the move: the whole run less the waits found in it.
  const moving = elapsed.map((whole, run) => whole - stood[run].reduce((sum, stop) => sum + stop.wait, 0));

  const features = [
    ...turns.map((t) => ({ kind: 'turn', ...t })),
    ...pausePoints.map((p) => ({ kind: 'wait', ...p })),
    ...(climb?.climbs ?? []).map((c) => ({ kind: 'climb', dist: c.from, ...c })),
    ...distanceMarkers(route.length, o.markerEvery).map((m) => ({ kind: 'marker', ...m })),
    { kind: 'finish', dist: route.length },
  ].sort((a, b) => a.dist - b.dist);

  return {
    route,
    length: route.length,
    runs: runs.length,
    leftOut: all.length - runs.length,
    climb,
    turns,
    pausePoints,
    usualWait,
    times: { moving: median(moving), elapsed: median(elapsed) },
    features,
  };
}

/** Distance markers every `every` metres. One within 60 m of the finish is left to the finish. */
export function distanceMarkers(length, every = GUIDE_DEFAULTS.markerEvery) {
  const markers = [];
  for (let d = every; d <= length - 60; d += every) markers.push({ dist: d, label: d % 1000 === 0 ? `${d / 1000} km` : d < 1000 ? `${d} m` : `${(d / 1000).toFixed(1)} km` });
  return markers;
}

/**
 * What is coming up: the features within `ahead` metres in front of someone
 * `dist` metres along the route, nearest first, each with `in`, the metres
 * to go to it. A climb the runner is already on is included with `in: 0`
 * and `left`, the metres of it still to go.
 *
 * @param guide from buildGuide
 * @param {number} dist metres along the route
 * @param {{ahead?: number, kinds?: string[]}} [options]
 */
export function upcoming(guide, dist, { ahead = 400, kinds = null } = {}) {
  const out = [];
  for (const f of guide.features) {
    if (kinds && !kinds.includes(f.kind)) continue;
    if (f.kind === 'climb' && dist >= f.from && dist < f.to) out.push({ ...f, in: 0, left: f.to - dist });
    else if (f.dist > dist && f.dist - dist <= ahead) out.push({ ...f, in: f.dist - dist });
  }
  return out.sort((a, b) => a.in - b.in);
}

const ACT_ON = ['turn', 'wait', 'climb', 'finish'];
/** Worth a cue: everything to act on, but a wait only where one is likely. */
const actOn = (f) => ACT_ON.includes(f.kind) && !(f.kind === 'wait' && f.likely === false);
const PASSING = ['marker', 'water', 'toilets'];

/**
 * The cue for a display to show someone `dist` metres along the route.
 *
 * `now` is the nearest thing ahead to act on: a turn, a place where a wait
 * is likely, the foot of a climb, or the finish. A distance marker takes its
 * place only when it is within `markerWithin` metres and there is nothing
 * to act on within `actWithin`: a turn 150 m off matters more than a marker.
 * A water point or toilets beside the route is mentioned the same way.
 * `then` is the thing to act on after that. `climb` is the climb the runner
 * is on, if any, with `left`, the metres to its top. Each carries `in`, the
 * metres to go.
 *
 * @param guide from buildGuide
 * @param {number} dist metres along the route
 * @returns {{now:object|null, then:object|null, climb:object|null}}
 */
export function nextCue(guide, dist, { markerWithin = 150, actWithin = 200 } = {}) {
  const all = upcoming(guide, dist, { ahead: Infinity });
  const climb = all.find((f) => f.kind === 'climb' && f.in === 0) ?? null;
  const ahead = all.filter((f) => f.in > 0);
  const act = ahead.filter(actOn);
  // Things worth a mention in passing: a distance marker, a water point, toilets.
  const marker = ahead.find((f) => PASSING.includes(f.kind) && f.in <= markerWithin);
  if (marker && (!act.length || act[0].in > actWithin)) return { now: marker, then: act[0] ?? null, climb };
  return { now: act[0] ?? null, then: act[1] ?? null, climb };
}

// ---------------------------------------------------- water and toilets --

export const AMENITY_DEFAULTS = {
  within: 100, // metres from the route that a water point or toilets may be and still be shown
  same: 20, // metres within which two map entries of the same kind are one place
};

/** What OpenStreetMap calls the two things runners ask for. */
function amenityKind(tags = {}) {
  if (tags.amenity === 'toilets') return 'toilets';
  if (tags.amenity === 'drinking_water' || tags.amenity === 'water_point') return 'water';
  if (tags.drinking_water === 'yes' && (tags.man_made === 'water_tap' || tags.amenity === 'fountain')) return 'water';
  return null;
}

/**
 * The question to put to OpenStreetMap's Overpass service for the water
 * points and toilets around a route: everything of those kinds in the box
 * the route fits in, with `margin` metres to spare.
 * @returns {string} Overpass QL, for its `data` parameter
 */
export function amenityQuery(route, margin = 150) {
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (let i = 0; i < route.lat.length; i++) {
    south = Math.min(south, route.lat[i]);
    north = Math.max(north, route.lat[i]);
    west = Math.min(west, route.lon[i]);
    east = Math.max(east, route.lon[i]);
  }
  const dLat = margin / 111195;
  const dLon = margin / (111195 * Math.cos((((south + north) / 2) * Math.PI) / 180));
  const box = [south - dLat, west - dLon, north + dLat, east + dLon].map((v) => v.toFixed(5)).join(',');
  return `[out:json][timeout:25];(nwr["amenity"~"^(drinking_water|water_point|toilets)$"](${box});nwr["drinking_water"="yes"]["man_made"="water_tap"](${box});nwr["drinking_water"="yes"]["amenity"="fountain"](${box}););out center tags;`;
}

/**
 * Water points and toilets beside a route, from OpenStreetMap data.
 *
 * @param route from buildRoute
 * @param {{elements:Array}} osm what Overpass returns for amenityQuery, or
 *   any OpenStreetMap JSON: nodes with lat and lon, ways and relations with
 *   a `center`
 * @param {Partial<typeof AMENITY_DEFAULTS>} [options]
 * @returns {Array<{kind:'water'|'toilets', dist:number, off:number, side:'left'|'right', name:string|null, lat:number, lon:number}>}
 *   in order along the route. dist: metres along the route to where it is
 *   passed. off: metres from the route. side: which side it is on, the way
 *   the route runs.
 */
export function amenitiesAlong(route, osm, options) {
  const o = { ...AMENITY_DEFAULTS, ...options };
  const found = [];
  for (const e of osm.elements ?? []) {
    const kind = amenityKind(e.tags);
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!kind || lat == null || lon == null) continue;
    const [x, y] = route.proj.toXY(lat, lon);
    // A route can pass the same place more than once: out and back, or lap
    // after lap. Each pass within reach is its own entry, found by walking
    // the route and noting where it comes nearest.
    const away = (d) => {
      const p = pointAtDistance(route, d);
      return Math.hypot(p.x - x, p.y - y);
    };
    const step = 10;
    const passes = [];
    let last = Infinity;
    let falling = false;
    for (let d = 0; d <= route.length + step; d += step) {
      const now = away(Math.min(d, route.length));
      if (now > last && falling && last <= o.within + step) passes.push(d - step);
      falling = now < last;
      last = now;
    }
    if (falling && last <= o.within + step) passes.push(route.length);
    for (const about of passes) {
      const snap = snapToRoute(route, lat, lon, { near: about, window: 2 * step, nearSigma: 1e12 });
      if (snap.offset > o.within) continue;
      if (found.some((f) => f.lat === lat && f.lon === lon && f.kind === kind && Math.abs(f.dist - snap.dist) < 2 * o.within)) continue;
      const on = pointAtDistance(route, snap.dist);
      // Positive: to the left of the way the route runs there.
      const cross = snap.dir[0] * (y - on.y) - snap.dir[1] * (x - on.x);
      found.push({ kind, dist: snap.dist, off: snap.offset, side: cross > 0 ? 'left' : 'right', name: e.tags.name ?? null, lat, lon });
    }
  }
  found.sort((a, b) => a.dist - b.dist);
  // A toilet block is often mapped twice, as a point and as a building.
  const kept = [];
  for (const f of found) {
    const apart = (k) => Math.hypot((k.lat - f.lat) * 111195, (k.lon - f.lon) * 111195 * Math.cos((f.lat * Math.PI) / 180));
    const twin = kept.find((k) => k.kind === f.kind && (k.lat !== f.lat || k.lon !== f.lon) && apart(k) <= o.same && Math.abs(k.dist - f.dist) < 2 * o.within);
    if (!twin) kept.push(f);
  }
  return kept;
}

/**
 * A guide with water points and toilets added to what it lists and cues.
 * @param guide from buildGuide
 * @param {Array} amenities from amenitiesAlong, for the guide's own route
 */
export function withAmenities(guide, amenities) {
  const features = [...guide.features.filter((f) => !PASSING.includes(f.kind) || f.kind === 'marker'), ...amenities].sort((a, b) => a.dist - b.dist);
  return { ...guide, amenities, features };
}
