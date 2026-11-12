// Ghost run: race a pace, or a past run, live. This file is the app around
// the display: choosing a ghost, reading GPS, running the session, saving the
// run. All the numbers come from engine/; all the drawing is in hud.js.
//
// Everything is driven by five keys, as on the glasses: the four arrows and
// Enter. On a phone, a swipe is an arrow and a tap is Enter.

import { toGpx, haversine, ghostFromFixes, createRunSession, groupFixes, guideFromRuns, nextCue } from '../../engine/index.js';
import { describe, metres, wait } from '../route/screen.js';
import { SIZE, drawRun, drawList, drawMenu, drawCard, clock, pace, km } from './hud.js';
import { loadRuns, saveRuns, loadSettings, saveSettings, storedRun, fixesOf, runFromGpx, loadSample, saveProgress, loadProgress, clearProgress } from './store.js';
import { liveSource, demoSource } from './sources.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------------ state --

const state = {
  screen: 'home', // home | ready | run | menu | done
  runs: loadRuns(), // newest first
  settings: { secondsPerKm: 330, clock: 'moving', ...loadSettings('ghost') },
  selected: 0, // highlighted row on the home screen
  ghost: null, // the chosen ghost, ready for a session
  source: null, // where positions come from: GPS, or a replay in demo mode
  session: null,
  startedAt: null, // wall-clock time the run began, ms
  reading: null, // the session's latest reading
  shown: null, // what is on screen, eased towards the reading
  history: [], // recent { time, timeGap }, for the trend
  banner: null, // { text, until }
  side: 0, // 1 while clearly ahead of the ghost, -1 while clearly behind
  menu: 0,
  summary: null,
  lastFix: null, // latest position, with `at` (ms) when it arrived
  gpsError: null,
  demo: null, // { fixes, speed } when replaying a sample run
  progress: null, // a run left in progress by a reload, offered on the home screen
  row: null, // which home row the ghost was chosen from, to choose it again when carrying on
  savedAt: 0, // when the run in progress was last written down, ms
  racing: null, // which ghost was in charge at the last reading: 'pace', or a recording's place in the list
};

const dateLabel = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

// ---------------------------------------------------------------- sources --

function onFix(fix) {
  state.gpsError = null;
  state.lastFix = { ...fix, at: performance.now() };
  if (state.session) state.session.update({ ...fix, t: fix.t ?? state.source.elapsed() });
}

function onGpsError(error) {
  state.gpsError = error.code === 1 ? 'Location is blocked for this site' : error.message || 'No position yet';
}

function openSource() {
  state.source?.close();
  state.source = state.demo ? demoSource(state.demo.fixes, state.demo.speed, onFix) : liveSource(onFix, onGpsError);
  state.source.open();
}

// Keep the screen on during a run: a phone that sleeps stops reporting GPS.
let wakeLock = null;
async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    wakeLock = null;
  }
  showStatus();
}

// ------------------------------------------------------------ home screen --

function homeRows() {
  const rows = [];
  if (state.progress) {
    const p = state.progress;
    const ago = Math.max(0, Math.round((Date.now() - p.savedAt) / 60000));
    rows.push({ id: 'resume', main: 'Carry on the run in progress', detail: `${clock(p.elapsed)} in, left ${ago < 1 ? 'a moment' : `${ago} min`} ago · starting another run drops it` });
  }
  const others = state.runs.length;
  rows.push({
    id: 'pace',
    main: `Pace  ${pace(state.settings.secondsPerKm)} /km`,
    detail: others ? `On any route · your ${others === 1 ? 'saved run takes' : `${others} saved runs take`} over on their own routes` : 'A ghost holding this pace, on any route',
    adjustable: true,
  });
  for (const run of state.runs) {
    rows.push({
      id: run.id,
      main: `${km(run.distance)} km in ${clock(run.time)}`,
      detail: `${run.demo ? 'Sample run' : dateLabel(run.startedAt)} · ${pace(run.secondsPerKm)} /km · race it on its route`,
    });
  }
  rows.push({
    id: 'clock',
    main: state.settings.clock === 'moving' ? 'Clock stops when you stop' : 'Clock never stops',
    detail: state.settings.clock === 'moving' ? 'For everyday runs: waiting at lights costs nothing' : 'For races: every second counts',
    adjustable: true,
  });
  return rows;
}

function chooseGhost(row) {
  state.row = row.id;
  if (row.id === 'pace') {
    const label = `${pace(state.settings.secondsPerKm)} /km`;
    // Every saved run comes along: where today's way joins one of their
    // routes, that run's ghost takes over until the routes part.
    const carried = [];
    for (const run of state.runs) {
      try {
        const { route, ghost } = ghostFromFixes(fixesOf(run), state.settings.clock === 'moving' ? run.pauses : []);
        carried.push({ route, profile: ghost, run, label: `ghost ${run.demo ? 'sample run' : dateLabel(run.startedAt)}`, guide: undefined });
      } catch {
        // A saved run that cannot be laid out is left behind.
      }
    }
    state.ghost = { kind: 'pace', secondsPerKm: state.settings.secondsPerKm, tracks: carried, label: `ghost ${label}`, title: `A ghost holding ${label}` };
  } else {
    const run = state.runs.find((r) => r.id === row.id);
    const fixes = fixesOf(run);
    const { route, ghost } = ghostFromFixes(fixes, state.settings.clock === 'moving' ? run.pauses : []);
    const when = run.demo ? 'the sample run' : `your run of ${dateLabel(run.startedAt)}`;
    // Off its route (another street, a start part-way along) a ghost at the
    // run's own average pace stands in, so the gap never runs away.
    const fallback = run.secondsPerKm ?? state.settings.secondsPerKm;
    state.ghost = {
      kind: 'track', route, profile: ghost, fallback, start: fixes[0],
      label: `ghost ${run.demo ? 'sample run' : dateLabel(run.startedAt)}`,
      standInLabel: `ghost ${pace(fallback)} /km`,
      title: `Racing ${when}`,
      guide: routeGuide(run),
    };
  }
  state.screen = 'ready';
}

/** The route guide for whichever recording is the ghost right now; built the first time it is needed. */
function guideNow(r) {
  if (state.ghost.kind === 'track') return state.ghost.guide;
  const carried = r.track == null ? null : state.ghost.tracks?.[r.track];
  if (!carried) return null;
  if (carried.guide === undefined) carried.guide = routeGuide(carried.run);
  return carried.guide;
}

/** What to call the ghost in charge right now. */
function ghostLabelNow(r) {
  if (state.ghost.kind === 'track') return r.racing === 'pace' ? state.ghost.standInLabel : state.ghost.label;
  return r.racing === 'recording' ? (state.ghost.tracks?.[r.track]?.label ?? state.ghost.label) : state.ghost.label;
}

/**
 * What the saved runs say about this run's route: its turns, and where runs
 * of it have waited. The chosen run draws the route, as it does for the
 * ghost; other saved runs of the same route, the same way, add to it.
 */
function routeGuide(run) {
  try {
    const all = state.runs.map(fixesOf);
    const mine = state.runs.indexOf(run);
    const same = groupFixes(all).find((members) => members.includes(mine)) ?? [mine];
    // Saved runs of other routes count too, where they cover the same ground.
    const others = all.filter((_, i) => !same.includes(i));
    return guideFromRuns([all[mine], ...same.filter((i) => i !== mine).map((i) => all[i])], { others });
  } catch {
    return null; // the race goes ahead without cues
  }
}

// ---------------------------------------------------------------- the run --

function startRun() {
  state.session = createRunSession({ ghost: state.ghost, clock: state.settings.clock });
  state.startedAt = Date.now();
  state.reading = null;
  state.shown = null;
  state.history = [];
  state.banner = null;
  state.side = 0;
  state.racing = null;
  state.progress = null;
  state.savedAt = 0;
  clearProgress();
  state.source.begin();
  // Start from where we already know we are, if that is fresh.
  if (!state.demo && state.lastFix && performance.now() - state.lastFix.at < 3000) {
    state.session.update({ lat: state.lastFix.lat, lon: state.lastFix.lon, accuracy: state.lastFix.accuracy, t: 0 });
  }
  state.screen = 'run';
  keepAwake();
}

/** Write the run in progress down, so a reload can carry it on. */
function noteProgress() {
  const fixes = state.session?.fixes();
  if (!fixes || fixes.length < 5) return;
  state.savedAt = Date.now();
  saveProgress({ savedAt: state.savedAt, startedAt: state.startedAt, row: state.row, settings: state.settings, elapsed: state.source.elapsed(), demo: state.demo?.name ?? null, fixes });
}

/** Carry on a run that a reload interrupted: the same ghost, the same clock, every position replayed. */
function resumeRun() {
  const p = state.progress;
  const row = homeRows().find((r) => r.id === p.row);
  if (!row) {
    // The run it was racing has gone: nothing to carry on against.
    state.progress = null;
    clearProgress();
    return;
  }
  state.settings = { ...state.settings, ...p.settings };
  chooseGhost(row);
  state.session = createRunSession({ ghost: state.ghost, clock: state.settings.clock });
  for (const fix of p.fixes) state.session.update(fix);
  state.startedAt = p.startedAt;
  state.reading = null;
  state.shown = null;
  state.history = [];
  state.banner = null;
  state.side = 0;
  state.racing = null;
  // The time away counts: the clock on a live run kept going. A sample run picks up where it stopped.
  state.source.begin(p.demo ? p.elapsed : p.elapsed + (Date.now() - p.savedAt) / 1000);
  state.progress = null;
  state.screen = 'run';
  keepAwake();
}

function finishRun() {
  const summary = state.session.finish(state.source.elapsed());
  state.summary = summary;
  state.session = null;
  clearProgress();
  if (summary.distance > 200) {
    const run = storedRun({ ...summary, startedAt: state.startedAt, demo: Boolean(state.demo) });
    state.runs = [run, ...state.runs.filter((r) => r.id !== run.id)];
    saveRuns(state.runs);
    summary.saved = true;
  }
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  state.screen = 'done';
  showStatus();
}

/** Seconds of gap gained per minute over the last half minute. */
function trend() {
  const recent = state.history;
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  return last.time - first.time >= 10 ? ((last.timeGap - first.timeGap) / (last.time - first.time)) * 60 : 0;
}

/** Once a moment: take a fresh reading from the session. */
function tick() {
  if (!state.session) return;
  const reading = state.session.at(state.source.elapsed());
  if (!reading) return;
  const splitsBefore = state.reading?.splitCount ?? 0;
  state.reading = { ...reading, splitCount: reading.splits.length };
  if (reading.splits.length > splitsBefore) {
    const split = reading.splits[reading.splits.length - 1];
    const gap = Math.abs(split.timeGap) < 0.5 ? 'level' : `${split.timeGap > 0 ? '+' : '−'}${Math.round(Math.abs(split.timeGap))} s`;
    state.banner = { text: `${Math.round(split.distance / 1000)} km   ${clock(split.lap)}   ${gap}`, until: performance.now() + 7000 };
  }
  // The moment of a pass is the point of racing a ghost: say so.
  const side = reading.distGap > 2 ? 1 : reading.distGap < -2 ? -1 : 0;
  if (side && state.side && side !== state.side && reading.distance > 100) {
    state.banner = { text: side > 0 ? 'You passed the ghost' : 'The ghost passed you', until: performance.now() + 5000 };
  }
  if (side) state.side = side;
  // A pace ghost carrying saved runs: say so when one of them takes over, and when it hands back.
  if (state.ghost.tracks?.length) {
    const racing = reading.racing === 'recording' ? reading.track : 'pace';
    if (state.racing != null && racing !== state.racing) {
      const text = racing === 'pace' ? `Back to the ${pace(state.ghost.secondsPerKm)} ghost` : `${state.ghost.tracks[racing].run.demo ? 'The sample run' : `Your run of ${dateLabel(state.ghost.tracks[racing].run.startedAt)}`} takes over`;
      state.banner = { text, until: performance.now() + 5000 };
    }
    state.racing = racing;
  }
  if (Date.now() - state.savedAt > 10000) noteProgress();
  if (!reading.paused) {
    state.history.push({ time: reading.time, timeGap: reading.timeGap });
    while (state.history.length && reading.time - state.history[0].time > 30) state.history.shift();
  }
  if (state.source.ended?.() && state.screen === 'run') finishRun();
}

// ------------------------------------------------------------------ input --

function key(name) {
  const move = name === 'ArrowUp' ? -1 : name === 'ArrowDown' ? 1 : 0;
  const turn = name === 'ArrowLeft' ? -1 : name === 'ArrowRight' ? 1 : 0;
  const enter = name === 'Enter';

  if (state.screen === 'home') {
    const rows = homeRows();
    const row = rows[state.selected];
    if (move) state.selected = clamp(state.selected + move, 0, rows.length - 1);
    else if (row.id === 'pace' && turn) {
      state.settings.secondsPerKm = clamp(state.settings.secondsPerKm + turn * 5, 120, 900);
      saveSettings('ghost', state.settings);
    } else if (row.id === 'clock' && (turn || enter)) {
      state.settings.clock = state.settings.clock === 'moving' ? 'elapsed' : 'moving';
      saveSettings('ghost', state.settings);
    } else if (enter && row.id === 'resume') resumeRun();
    else if (enter) chooseGhost(row);
  } else if (state.screen === 'ready') {
    if (enter) startRun();
    else if (turn < 0 || move < 0) state.screen = 'home';
  } else if (state.screen === 'run') {
    if (enter) {
      state.menu = 0;
      state.screen = 'menu';
    }
  } else if (state.screen === 'menu') {
    if (move) state.menu = clamp(state.menu + move, 0, 1);
    else if (turn < 0) state.screen = 'run';
    else if (enter && state.menu === 0) state.screen = 'run';
    else if (enter) finishRun();
  } else if (state.screen === 'done') {
    if (enter) {
      state.selected = 0;
      state.screen = 'home';
      if (state.demo) openSource(); // rewind the sample run
    }
  }
}

// ---------------------------------------------------------------- drawing --

const canvas = $('hud');
const ctx = canvas.getContext('2d');

function fit() {
  const scale = Math.min(3, window.devicePixelRatio || 1);
  const pixels = Math.max(300, Math.round(canvas.clientWidth * scale));
  if (canvas.width !== pixels) {
    canvas.width = pixels;
    canvas.height = pixels;
  }
  ctx.setTransform(pixels / SIZE, 0, 0, pixels / SIZE, 0, 0);
}

function gpsLine() {
  if (state.demo) return { text: 'Sample run: no GPS needed', tone: 'dim' };
  if (state.gpsError) return { text: state.gpsError, tone: 'warn' };
  if (!state.lastFix || performance.now() - state.lastFix.at > 10000) return { text: 'Waiting for GPS…', tone: 'warn' };
  const accuracy = Math.round(state.lastFix.accuracy);
  return { text: `GPS good to ${accuracy} m`, tone: accuracy <= 20 ? 'good' : 'warn' };
}

function draw() {
  fit();
  if (state.screen === 'home') {
    drawList(ctx, { title: 'GHOST RUN', rows: homeRows(), selected: state.selected, hint: '▲▼ choose    ◀▶ change    tap or Enter to go' });
  } else if (state.screen === 'ready') {
    const lines = [{ text: state.ghost.title }, gpsLine()];
    if (state.ghost.kind === 'track' && state.lastFix) {
      const away = haversine(state.lastFix.lat, state.lastFix.lon, state.ghost.start.lat, state.ghost.start.lon);
      lines.push(away > 60 ? { text: `That run started ${away < 1000 ? `${Math.round(away)} m` : `${km(away)} km`} from here`, tone: 'warn', size: 26 } : { text: 'You are at its start', tone: 'good', size: 26 });
    }
    if (state.ghost.tracks?.length) {
      const n = state.ghost.tracks.length;
      lines.push({ text: `${n === 1 ? 'Your saved run takes' : `Your ${n} saved runs take`} over on their routes`, tone: 'dim', size: 24 });
    }
    const guide = state.ghost.guide;
    if (guide) {
      const waits = guide.pausePoints.filter((p) => p.likely).length;
      const waiting = waits ? `${waits} likely wait${waits === 1 ? '' : 's'}, about ${wait(guide.usualWait)}` : 'no waits on record';
      lines.push({ text: `${km(guide.length)} km · ${waiting}`, tone: 'dim', size: 24 });
    }
    lines.push({ text: state.settings.clock === 'moving' ? 'The clock stops when you stop' : 'The clock never stops', tone: 'dim', size: 24 });
    drawCard(ctx, { title: 'READY', lines, hint: 'tap or Enter as you set off    ◀ back' });
  } else if (state.screen === 'run' || state.screen === 'menu') {
    const r = state.reading;
    if (!r) {
      drawCard(ctx, { title: 'GO', lines: [gpsLine(), { text: 'The gap appears with the first position', tone: 'dim', size: 24 }], hint: 'tap or Enter for the menu' });
    } else {
      // Ease what is shown towards the latest reading, so nothing jumps.
      const s = (state.shown ??= { timeGap: r.timeGap, distGap: r.distGap });
      s.timeGap += (r.timeGap - s.timeGap) * 0.12;
      s.distGap += (r.distGap - s.distGap) * 0.12;
      const now = performance.now();
      const notice = r.fixAge > 5 ? 'GPS?' : r.offRoute ? 'OFF ROUTE' : r.finished ? 'FINISHED' : r.accuracy > 30 ? 'GPS WEAK' : null;
      // The next turn or likely wait, while on the ghost's route and within 200 m of it.
      const guide = guideNow(r);
      const next = guide && r.routeDist != null && !r.finished ? nextCue(guide, r.routeDist).now : null;
      const cue = next && next.in <= 200 && next.kind !== 'finish' ? { title: describe(next).title, distance: metres(next.in), in: next.in, side: next.kind === 'turn' ? next.side : null } : null;
      drawRun(ctx, {
        time: r.time,
        distance: r.distance,
        speed: r.speed,
        timeGap: s.timeGap,
        distGap: s.distGap,
        trend: r.paused ? 0 : trend(),
        ghostLabel: ghostLabelNow(r),
        paused: r.paused,
        notice,
        cue,
        banner: state.banner && now < state.banner.until ? state.banner.text : null,
        float: now / 1000,
      });
    }
    if (state.screen === 'menu') drawMenu(ctx, { options: ['Keep going', 'Finish the run'], selected: state.menu, hint: '▲▼ choose    tap or Enter    ◀ back' });
  } else if (state.screen === 'done') {
    const s = state.summary;
    const lines = [
      { text: `${km(s.distance)} km`, size: 64 },
      { text: `${clock(s.time)}   ·   ${pace(s.secondsPerKm)} /km` },
    ];
    if (s.timeGap != null && s.distance > 50) {
      const size = Math.abs(s.timeGap);
      lines.push(size < 0.5 ? { text: 'Level with the ghost' } : { text: `${size < 100 ? `${Math.round(size)} s` : clock(size)} ${s.timeGap > 0 ? 'ahead of' : 'behind'} the ghost`, tone: s.timeGap > 0 ? 'good' : 'warn' });
    }
    lines.push({ text: s.saved ? 'Saved: race this run next time' : 'Too short to save', tone: 'dim', size: 24 });
    drawCard(ctx, { title: 'DONE', lines, hint: 'tap or Enter' });
  }
  requestAnimationFrame(draw);
}

// ------------------------------------------------------------------ setup --

function showStatus(message) {
  const parts = [];
  if (state.demo) parts.push(`Sample run playing at ${state.demo.speed}× speed.`);
  if (state.screen === 'run' || state.screen === 'menu') parts.push(wakeLock ? 'Keeping the screen on.' : 'This browser will not keep the screen on: stop it sleeping in your phone\'s settings.');
  if (message) parts.push(message);
  parts.push(`${state.runs.filter((r) => !r.demo).length} saved run(s) on this device.`);
  $('status').textContent = parts.join(' ');
  $('export').disabled = !state.runs.some((r) => !r.demo);
}

async function importGpx(input) {
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  const added = [];
  const failed = [];
  for (const file of files) {
    try {
      const run = runFromGpx(await file.text());
      state.runs = [run, ...state.runs.filter((r) => r.id !== run.id)];
      added.push(file.name);
    } catch (error) {
      failed.push(`${file.name}: ${error.message}`);
    }
  }
  // Newest first, whatever order the files came in: the newest are the ones kept, and the ones that win a shared stretch.
  state.runs.sort((a, b) => b.startedAt - a.startedAt);
  saveRuns(state.runs);
  state.runs = [...state.runs.filter((r) => r.demo), ...loadRuns()];
  const kept = added.length ? `Added ${added.length === 1 ? added[0] : `${added.length} runs`} as ${added.length === 1 ? 'a ghost' : 'ghosts'}.` : '';
  showStatus([kept, ...failed].filter(Boolean).join(' '));
}

function exportLatest() {
  const run = state.runs.find((r) => !r.demo);
  if (!run) return;
  const url = URL.createObjectURL(new Blob([toGpx(fixesOf(run), { name: `SportsHUD run ${dateLabel(run.startedAt)}`, startedAt: run.startedAt })], { type: 'application/gpx+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `sportshud-${new Date(run.startedAt).toISOString().slice(0, 10)}.gpx`;
  link.click();
  URL.revokeObjectURL(url);
}

async function init() {
  const params = new URLSearchParams(location.search);
  const sample = ['run', 'ride', 'walk', 'shared'].includes(params.get('demo')) ? params.get('demo') : null;
  if (sample) {
    try {
      const { mine, theirs } = await loadSample(sample);
      state.demo = { name: sample, fixes: fixesOf(mine), speed: clamp(Number(params.get('speed')) || 10, 1, 60) };
      state.runs = [theirs, ...state.runs];
    } catch (error) {
      showStatus(`Could not load the sample run: ${error.message}`);
    }
  }
  openSource();
  // A run a reload interrupted, if it is recent and of the same kind (live, or this sample).
  const left = loadProgress();
  if (left && (left.demo ?? null) === (state.demo?.name ?? null)) state.progress = left;

  document.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) return;
    if (event.target.closest('#setup')) return; // leave the controls below the display alone
    event.preventDefault();
    key(event.key);
  });
  // Touch: a swipe is an arrow, a tap is Enter.
  let down = null;
  canvas.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!down) return;
    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    down = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) key('Enter');
    else if (Math.abs(dx) > Math.abs(dy)) key(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    else key(dy > 0 ? 'ArrowDown' : 'ArrowUp');
  });
  for (const button of document.querySelectorAll('[data-key]')) button.addEventListener('click', () => key(button.dataset.key));
  $('import').addEventListener('change', (event) => importGpx(event.target));
  $('export').addEventListener('click', exportLatest);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.session) keepAwake();
  });

  setInterval(tick, 200);
  showStatus();
  requestAnimationFrame(draw);
}

// For tests and for poking at from the console.
window.sportshud = state;

init();
