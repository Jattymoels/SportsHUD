// Runs saved on this device, shared by the apps: a finished run in one is a
// ghost, or a route, in another. They live in the browser's own storage and
// go nowhere else.

import { parseGpx, toFixes, findPauses, fillGaps, measureDistance, movingTime } from '../../engine/index.js';

const RUNS_KEY = 'sportshud.runs.v1';
const SETTINGS_KEY = 'sportshud.settings.v1';
const KEEP_RUNS = 8;
const FIXTURES = new URL('../../fixtures/synthetic/', import.meta.url);

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Saved runs, newest first. */
export const loadRuns = () => load(RUNS_KEY, []);

/** Save, dropping the oldest runs if the browser's storage is full. Sample runs are never saved. */
export function saveRuns(runs) {
  const mine = runs.filter((r) => !r.demo);
  for (let keep = Math.min(mine.length, KEEP_RUNS); keep >= 0; keep--) {
    try {
      localStorage.setItem(RUNS_KEY, JSON.stringify(mine.slice(0, keep)));
      return;
    } catch {
      // Too big: try again with one fewer.
    }
  }
}

/** One app's settings, kept under its own name. */
export const loadSettings = (app) => load(SETTINGS_KEY, {})[app] ?? {};

export function saveSettings(app, settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...load(SETTINGS_KEY, {}), [app]: settings }));
  } catch {
    // Settings are a convenience; carry on without them.
  }
}

/** A run in the shape it is stored in: fixes as [t, lat, lon] to keep it small. */
export function storedRun({ startedAt, distance, time, fixes, pauses, demo = false }) {
  return {
    id: String(startedAt),
    startedAt,
    distance: Math.round(distance),
    time: Math.round(time),
    secondsPerKm: distance > 50 ? time / (distance / 1000) : null,
    fixes: fixes.map((f) => [Math.round(f.t * 10) / 10, Number(f.lat.toFixed(6)), Number(f.lon.toFixed(6))]),
    pauses: pauses.map((p) => ({ start: Math.round(p.start * 10) / 10, end: Math.round(p.end * 10) / 10 })),
    demo,
  };
}

export const fixesOf = (run) => run.fixes.map(([t, lat, lon]) => ({ t, lat, lon }));

/** A GPX file as a stored run: its pauses found, and the holes they left filled. */
export function runFromGpx(text, demo = false) {
  const recording = parseGpx(text);
  const saved = toFixes(recording);
  const pauses = findPauses(saved);
  const fixes = fillGaps(saved);
  const profile = measureDistance(fixes);
  return storedRun({
    startedAt: recording.points.find((p) => p.time != null).time,
    distance: profile.dist[profile.dist.length - 1],
    time: movingTime(pauses, fixes[fixes.length - 1].t),
    fixes,
    pauses,
    demo,
  });
}

/** A sample pair from the fixtures: `mine` to replay, `theirs` as the ghost. */
export async function loadSample(name) {
  const [mine, theirs] = await Promise.all(
    ['b', 'a'].map(async (who) => {
      const response = await fetch(new URL(`${name}-${who}.gpx`, FIXTURES));
      if (!response.ok) throw new Error(`no sample called "${name}"`);
      return runFromGpx(await response.text(), true);
    }),
  );
  return { mine, theirs };
}
