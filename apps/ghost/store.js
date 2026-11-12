// Runs saved on this device, shared by the apps: a finished run in one is a
// ghost, or a route, in another. They live in the browser's own storage and
// go nowhere else.

import { parseGpx, toFixes, findPauses, fillGaps, measureDistance, movingTime } from '../../engine/index.js';

const RUNS_KEY = 'sportshud.runs.v1';
const SETTINGS_KEY = 'sportshud.settings.v1';
const PROGRESS_KEY = 'sportshud.progress.v1';
const KEEP_RUNS = 12;
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

/**
 * A run in progress, kept so that a page that reloads or a phone that drops
 * the tab does not lose it: when it began, what it was racing, and every
 * position so far.
 */
export function saveProgress(progress) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...progress, fixes: progress.fixes.map((f) => [Math.round(f.t * 10) / 10, Number(f.lat.toFixed(6)), Number(f.lon.toFixed(6)), Math.round(f.accuracy ?? 0)]) }));
  } catch {
    // No room: the run carries on, it just cannot be picked up after a reload.
  }
}

/** The run in progress, if one was left less than `maxAgeMs` ago. */
export function loadProgress(maxAgeMs = 30 * 60 * 1000) {
  const p = load(PROGRESS_KEY, null);
  if (!p || !Array.isArray(p.fixes) || p.fixes.length < 5 || Date.now() - p.savedAt > maxAgeMs) return null;
  return { ...p, fixes: p.fixes.map(([t, lat, lon, accuracy]) => ({ t, lat, lon, accuracy })) };
}

export function clearProgress() {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch {
    // Nothing to clear.
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

/**
 * A sample pair from the fixtures: `mine` to replay, `theirs` as the ghost.
 * "shared" is a run that only shares part of the ghost's route.
 */
export async function loadSample(name) {
  const files = name === 'shared' ? ['run-shared.gpx', 'run-a.gpx'] : [`${name}-b.gpx`, `${name}-a.gpx`];
  const [mine, theirs] = await Promise.all(
    files.map(async (file) => {
      const response = await fetch(new URL(file, FIXTURES));
      if (!response.ok) throw new Error(`no sample called "${name}"`);
      return runFromGpx(await response.text(), true);
    }),
  );
  return { mine, theirs };
}
