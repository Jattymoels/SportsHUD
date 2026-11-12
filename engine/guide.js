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
  endZone: 30, // metres at each end of the route where standing is just starting or finishing
  offRoute: 25, // metres: a recording typically further than this from the route is not a run of it
  markerEvery: 500, // metres between distance markers
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Does this recording follow the route? Judged by how far its fixes typically are from it. */
function follows(route, fixes, limit) {
  const offsets = [];
  const every = Math.max(1, Math.floor(fixes.length / 60));
  for (let i = 0; i < fixes.length; i += every) offsets.push(snapToRoute(route, fixes[i].lat, fixes[i].lon, { near: 0, window: Infinity, nearSigma: 1e12 }).offset);
  return median(offsets) <= limit;
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
    const { dist } = projectRecording(route, withEle, options);
    const total = new Float64Array(n);
    const hits = new Float64Array(n);
    for (let i = 0; i < withEle.length; i++) {
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
 * @returns {Array<{dist:number, runs:number, of:number, share:number, typical:number, longest:number, waits:number[]}>}
 *   dist: metres along the route. runs: how many of the `of` recordings
 *   waited there. share: runs / of. typical, longest: seconds waited, the
 *   median and the most. waits: every wait, one per run that waited.
 *   A wait by a paused watch is timed exactly; one where the watch kept
 *   running reads a few seconds short, the time taken to slow and set off.
 */
export function findPausePoints(route, runs, options) {
  return gatherWaits(route, runs.map((fixes) => standingIn(route, fixes, options)), options);
}

/** Where one recording stood still along the route, ends of the route aside. */
function standingIn(route, fixes, options) {
  const o = { ...GUIDE_DEFAULTS, ...options };
  const profile = monotone(projectRecording(route, fixes, options));
  return findStops(profile, { ...options, stopSeconds: o.pauseSeconds })
    .map((stop) => ({ dist: (stop.lo + stop.hi) / 2, wait: stop.depart - stop.arrive }))
    .filter((stop) => stop.dist >= o.endZone && stop.dist <= route.length - o.endZone);
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
 *   one draws the route; recordings that do not follow it are left out and
 *   counted in `leftOut`.
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
  const o = { ...GUIDE_DEFAULTS, ...options };
  if (!recordings.length) throw new Error('A route guide needs at least one recording of the route');
  const all = recordings.map((recording) => toFixes(recording));
  const route = buildRoute(all[0], options);
  const runs = all.filter((fixes, i) => i === 0 || follows(route, fixes, o.offRoute));

  const climb = elevationAlong(route, runs, options);
  const turns = findTurns(route, options);
  const stood = runs.map((fixes) => standingIn(route, fixes, options));
  const pausePoints = gatherWaits(route, stood, options);
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

/**
 * The cue for a display to show someone `dist` metres along the route.
 *
 * `now` is the nearest thing ahead to act on: a turn, a place runs tend to
 * wait, the foot of a climb, or the finish. A distance marker takes its
 * place only when it is within `markerWithin` metres and there is nothing
 * to act on within `actWithin`: a turn 150 m off matters more than a marker.
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
  const act = ahead.filter((f) => ACT_ON.includes(f.kind));
  const marker = ahead.find((f) => f.kind === 'marker' && f.in <= markerWithin);
  if (marker && (!act.length || act[0].in > actWithin)) return { now: marker, then: act[0] ?? null, climb };
  return { now: act[0] ?? null, then: act[1] ?? null, climb };
}
