// Synthetic GPS recordings, used until real ones are added.
//
//   node fixtures/generate.mjs      rewrites fixtures/synthetic/*.gpx
//
// Each scenario is a path on the ground and two efforts along it: `a` (the
// earlier one, used as the ghost) and `b` (the later one, replayed against
// it). Because the true position of each effort is known at every instant,
// tests can check the engine against the truth, which real recordings never
// allow. Output is deterministic: the same code always writes the same files.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ORIGIN = { lat: -34.92, lon: 138.6 };
const M_PER_DEG_LAT = 111194.93;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/**
 * GPS error model, in metres. Each fix is off by a slowly wandering offset
 * (`drift` is its typical size on each axis; it takes a minute or more to
 * wander that far) plus a small independent `jitter`. Each recording gets its
 * own offset, as two outings on different days would.
 */
export const GPS_NOISE = { drift: 2.5, jitter: 0.5 };
export const NO_NOISE = { drift: 0, jitter: 0 };
const DRIFT_PERIODS = [75, 170, 410]; // seconds

// ---------------------------------------------------------------- paths --

/** Smooth curve through waypoints (Catmull-Rom), as points about 1 m apart. */
function curve(waypoints, closed = false) {
  const n = waypoints.length;
  const at = (i) => (closed ? waypoints[((i % n) + n) % n] : waypoints[Math.max(0, Math.min(n - 1, i))]);
  const out = [];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      const blend = (a, b, c, d) =>
        0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u ** 3);
      out.push([blend(p0[0], p1[0], p2[0], p3[0]), blend(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(closed ? waypoints[0] : waypoints[n - 1]);
  return out;
}

/** An out-and-back leg, then a loop that crosses it and returns to the start. */
function runPath() {
  const out = curve([[0, 0], [120, 10], [250, -20], [380, 15], [500, 0]]);
  const back = [...out].reverse().slice(1);
  const loop = curve([[0, 0], [-50, 150], [50, 330], [250, 380], [400, 250], [300, 80], [260, -80], [120, -150], [-30, -80], [0, 0]]).slice(1);
  return [...out, ...back, ...loop];
}

/** Three laps of one circuit: every lap lies exactly on top of the others. */
function ridePath() {
  const lap = curve([[0, 0], [600, 0], [800, 150], [800, 500], [600, 650], [200, 600], [0, 400], [-50, 150]], true);
  return [...lap, ...lap.slice(1), ...lap.slice(1)];
}

/** A trail of switchbacks 18 m apart, then a straight run-out. */
function walkPath() {
  const pts = [[0, 0]];
  for (let i = 0; i < 7; i++) {
    const y = 18 * i;
    const [from, to] = i % 2 === 0 ? [0, 150] : [150, 0];
    pts.push([from + (to - from) * 0.1, y], [from + (to - from) * 0.9, y]);
    pts.push([to + (to > from ? 8 : -8), y + 9]);
  }
  pts.push([135, 126], [40, 135], [-40, 170], [-60, 300]);
  return curve(pts);
}

function measure(xy) {
  const cum = [0];
  for (let i = 1; i < xy.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  }
  return { xy, cum, length: cum[cum.length - 1] };
}

function positionAt(path, s) {
  const { xy, cum } = path;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const f = cum[hi] > cum[lo] ? (s - cum[lo]) / (cum[hi] - cum[lo]) : 0;
  return [xy[lo][0] + f * (xy[hi][0] - xy[lo][0]), xy[lo][1] + f * (xy[hi][1] - xy[lo][1])];
}

// ------------------------------------------------------------ scenarios --
//
// An effort is: a cruising speed (m/s), slow swings around it, places where
// it stops (metres along the path, seconds stopped), and stretches where it
// surges. Nothing below is tuned to the engine.

export const SCENARIOS = [
  {
    id: 'run',
    label: 'Run',
    gpxType: 'running',
    path: measure(runPath()),
    efforts: {
      a: { start: '2026-10-03T21:30:00Z', speed: 3.0, swing: 0.06, stops: [{ at: 1010, for: 20 }], seed: 11 },
      b: { start: '2026-10-10T21:32:00Z', speed: 3.12, swing: 0.08, slowStart: 300, surges: [{ from: 1900, to: 2300, by: 1.12 }], seed: 12 },
    },
  },
  {
    id: 'ride',
    label: 'Ride',
    gpxType: 'cycling',
    path: measure(ridePath()),
    efforts: {
      a: { start: '2026-10-04T20:00:00Z', speed: 8.0, swing: 0.1, stops: [{ at: 2600, for: 25 }], seed: 21 },
      b: { start: '2026-10-11T20:05:00Z', speed: 8.3, swing: 0.12, stops: [{ at: 5100, for: 15 }], seed: 22 },
    },
  },
  {
    id: 'walk',
    label: 'Walk',
    gpxType: 'walking',
    path: measure(walkPath()),
    efforts: {
      a: { start: '2026-10-05T22:00:00Z', speed: 1.4, swing: 0.05, stops: [{ at: 700, for: 40 }], seed: 31 },
      b: { start: '2026-10-12T22:10:00Z', speed: 1.36, swing: 0.07, surges: [{ from: 900, to: 1200, by: 1.15 }], seed: 32 },
    },
  },
];

// ----------------------------------------------------------- simulation --

function random(seed) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
  return { uniform, normal };
}

const STEP = 0.1; // seconds
const MAX_ACCEL = 1.2; // m/s²

/** True distance along the path every STEP seconds, from start to finish. */
function truthFor(path, effort) {
  const s = [0];
  let v = 0;
  let stopIndex = 0;
  let stoppedUntil = -1;
  const stops = effort.stops ?? [];
  for (let i = 1; s[i - 1] < path.length; i++) {
    const t = i * STEP;
    const here = s[i - 1];
    let target = effort.speed * (1 + effort.swing * Math.sin(t / 47 + effort.seed) + 0.5 * effort.swing * Math.sin(t / 13));
    if (effort.slowStart && here < effort.slowStart) target *= 0.9;
    for (const surge of effort.surges ?? []) if (here >= surge.from && here < surge.to) target *= surge.by;
    if (stopIndex < stops.length && here >= stops[stopIndex].at) {
      stoppedUntil = t + stops[stopIndex].for;
      stopIndex++;
    }
    if (t < stoppedUntil) target = 0;
    v += Math.max(-MAX_ACCEL * STEP, Math.min(MAX_ACCEL * STEP, target - v));
    s.push(Math.min(path.length, here + v * STEP));
  }
  return s;
}

/**
 * One effort as a GPS recording.
 * @returns {{fixes: Array<{t:number, lat:number, lon:number}>, truth: number[], step: number}}
 *   `truth[i]` is the true distance along the path at `i * step` seconds.
 */
export function simulate(scenario, who, noise = GPS_NOISE) {
  const effort = scenario.efforts[who];
  const { path } = scenario;
  const truth = truthFor(path, effort);
  const duration = (truth.length - 1) * STEP;
  const rng = random(effort.seed);
  // The wandering offset: three slow waves per axis with random phases.
  const wave = () => {
    const phases = DRIFT_PERIODS.map(() => 2 * Math.PI * rng.uniform());
    const amp = noise.drift * Math.sqrt(2 / DRIFT_PERIODS.length);
    return (t) => DRIFT_PERIODS.reduce((sum, period, i) => sum + amp * Math.sin((2 * Math.PI * t) / period + phases[i]), 0);
  };
  const driftX = wave();
  const driftY = wave();
  const fixes = [];
  for (let t = 0; ; t = Math.min(Math.ceil(duration), t + 1)) {
    const [x, y] = positionAt(path, truth[Math.min(truth.length - 1, Math.round(t / STEP))]);
    fixes.push({
      t,
      lat: ORIGIN.lat + (y + driftY(t) + noise.jitter * rng.normal()) / M_PER_DEG_LAT,
      lon: ORIGIN.lon + (x + driftX(t) + noise.jitter * rng.normal()) / M_PER_DEG_LON,
    });
    if (t >= duration) break;
  }
  return { fixes, truth, step: STEP };
}

/**
 * The same recording as many watches would save it: a fix kept only every
 * 1 to 6 seconds. The first and last fixes are always kept.
 */
export function thin(fixes, seed = 1) {
  const rng = random(seed);
  const kept = [];
  for (let i = 0; i < fixes.length - 1; i += 1 + Math.floor(rng.uniform() * 6)) kept.push(fixes[i]);
  kept.push(fixes[fixes.length - 1]);
  return kept;
}

/** True gap of effort `b` against effort `a` at `t` seconds, in the engine's sign convention. */
export function trueGap(a, b, t) {
  const distAt = (run, time) => run.truth[Math.min(run.truth.length - 1, Math.round(time / run.step))];
  const dist = distAt(b, t);
  return {
    dist,
    distGap: dist - distAt(a, t),
    timeGap: a.truth.findIndex((s) => s >= dist) * a.step - t,
  };
}

export function toGpx(scenario, who, fixes) {
  const effort = scenario.efforts[who];
  const t0 = Date.parse(effort.start);
  const stamp = (t) => new Date(t0 + t * 1000).toISOString().replace('.000Z', 'Z');
  const name = `Synthetic ${scenario.label.toLowerCase()} ${who.toUpperCase()}`;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="SportsHUD fixtures/generate.mjs" xmlns="http://www.topografix.com/GPX/1/1">',
    ` <metadata><name>${name}</name><time>${stamp(0)}</time></metadata>`,
    ` <trk><name>${name}</name><type>${scenario.gpxType}</type><trkseg>`,
    ...fixes.map((f) => `  <trkpt lat="${f.lat.toFixed(6)}" lon="${f.lon.toFixed(6)}"><time>${stamp(f.t)}</time></trkpt>`),
    ' </trkseg></trk>',
    '</gpx>',
    '',
  ];
  return lines.join('\n');
}

export const fixturePath = (scenario, who) => `synthetic/${scenario.id}-${who}.gpx`;

/** Every fixture file as { path: GPX text }, plus the list the harness and tests read. */
export function buildFixtures() {
  const files = {};
  const pairs = [];
  for (const scenario of SCENARIOS) {
    for (const who of ['a', 'b']) {
      files[fixturePath(scenario, who)] = toGpx(scenario, who, simulate(scenario, who).fixes);
    }
    pairs.push({
      id: scenario.id,
      label: `${scenario.label} (synthetic)`,
      ghost: fixturePath(scenario, 'a'),
      runner: fixturePath(scenario, 'b'),
      synthetic: true,
    });
  }
  // Stress case, kept apart from the three pairs above: the walk again, with
  // the replayed recording thinned to a fix every 1 to 6 seconds.
  const walk = SCENARIOS.find((s) => s.id === 'walk');
  files['synthetic/walk-b-sparse.gpx'] = toGpx(walk, 'b', thin(simulate(walk, 'b').fixes));
  pairs.push({
    id: 'walk-sparse',
    label: 'Walk, a fix every 1 to 6 s (synthetic)',
    ghost: fixturePath(walk, 'a'),
    runner: 'synthetic/walk-b-sparse.gpx',
    synthetic: true,
    stress: true,
  });
  files['index.json'] = JSON.stringify({ pairs }, null, 2) + '\n';
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  mkdirSync(join(here, 'synthetic'), { recursive: true });
  for (const [path, text] of Object.entries(buildFixtures())) {
    writeFileSync(join(here, path), text);
    console.log(`wrote fixtures/${path}`);
  }
}
