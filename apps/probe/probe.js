// Anchoring probe: the route, its markers and the ghost placed over the
// phone's camera picture, using only GPS and the compass. It is the nearest
// thing to glasses that place things in the world, and it measures how far
// off that placing is.
//
// Position along the route comes from the engine, as everywhere else. The
// one new live input is which way the phone is facing.

import { ghostFromFixes, paceProfile, createProgressTracker, createRunSession, cameraPose, angleBetween } from '../../engine/index.js';
import { drawScene, steady } from '../preview/scene.js';
import { clock, km, pace } from '../ghost/hud.js';
import { loadRuns, saveRuns, loadSettings, saveSettings, fixesOf, runFromGpx, loadSample } from '../ghost/store.js';
import { liveSource, demoSource } from '../ghost/sources.js';

const RAD = Math.PI / 180;
const RUNNING = 2.2; // m/s: at or above this counts as running, below as walking
const TARGET = { walking: 5, running: 10 }; // degrees: B4's proposed targets
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];

const state = {
  runs: loadRuns(),
  settings: { offset: 0, fov: 55, ...loadSettings('probe') },
  course: null, // { route, profile, label }: the chosen route and the ghost on it
  tracker: null, // progress along the route while lining up
  session: null, // the run, once the ghost is started
  source: null,
  demo: null, // { fixes, speed } when replaying a sample run
  pose: null, // { yaw, pitch, roll } from the device's sensors, smoothed; null if it has none
  gaze: null, // without sensors: the way the path goes, followed smoothly
  look: 0, // without sensors: how far the view is turned from that, radians
  camera: false, // a camera picture is showing behind the overlay
  lastFix: null,
  gpsError: null,
  readings: [], // { t, speed, error }: compass minus direction of travel, degrees
};

function parsePace(text) {
  const match = /^\s*(\d{1,2})(?::([0-5]\d))?\s*$/.exec(text);
  const seconds = match ? Number(match[1]) * 60 + Number(match[2] ?? 0) : 0;
  return seconds >= 60 && seconds <= 1800 ? seconds : null;
}
const dateLabel = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

// ----------------------------------------------------------------- course --

function listRuns() {
  const select = $('run');
  const chosen = select.value;
  select.replaceChildren();
  for (const run of state.runs) {
    select.add(new Option(`${run.demo ? 'Sample run' : dateLabel(run.startedAt)} · ${km(run.distance)} km · ${pace(run.secondsPerKm)} /km`, run.id));
  }
  if (!state.runs.length) select.add(new Option('No routes yet: add a GPX below', ''));
  if (state.runs.some((r) => r.id === chosen)) select.value = chosen;
}

/** Set up the chosen route and ghost, back at lining up. */
function setCourse() {
  const run = state.runs.find((r) => r.id === $('run').value);
  $('paceBox').hidden = $('ghostKind').value !== 'pace';
  state.session = null;
  state.readings = [];
  state.gaze = null;
  if (!run) {
    state.course = null;
    return;
  }
  const { route, ghost } = ghostFromFixes(fixesOf(run), run.pauses);
  const secondsPerKm = parsePace($('ghostPace').value);
  const setPace = $('ghostKind').value === 'pace' && secondsPerKm;
  state.course = {
    route,
    profile: setPace ? paceProfile(route.length, secondsPerKm) : ghost,
    label: setPace ? `ghost ${clock(secondsPerKm)} /km` : 'ghost: that run',
  };
  state.tracker = createProgressTracker(route);
  openSource();
}

// ---------------------------------------------------------------- sensors --

function onFix(fix) {
  state.gpsError = null;
  state.lastFix = { ...fix, at: performance.now() };
  if (!state.course) return;
  if (state.session) state.session.update({ ...fix, t: fix.t ?? state.source.elapsed() });
  else state.tracker.update({ ...fix, t: performance.now() / 1000 });
  checkHeading();
}

function openSource() {
  state.source?.close();
  state.source = state.demo
    ? demoSource(state.demo.fixes, state.demo.speed, onFix)
    : liveSource(onFix, (error) => (state.gpsError = error.code === 1 ? 'Location is blocked for this site' : error.message || 'No position yet'));
  state.source.open();
}

/** Where we are on the route right now, from the run or from lining up. */
function position() {
  if (state.session) {
    const r = state.session.at(state.source.elapsed());
    return r && { dist: r.routeDist, speed: r.speed, offRoute: r.offRoute, reading: r };
  }
  const p = state.tracker?.at(performance.now() / 1000);
  return p && { dist: p.dist, speed: Math.max(0, p.speed), offRoute: p.offRoute, reading: null };
}

function onOrientation(event) {
  // Use readings measured from north: Android's absolute event, or iOS's compass heading.
  const alpha = event.webkitCompassHeading != null ? 360 - event.webkitCompassHeading : event.absolute ? event.alpha : null;
  if (alpha == null || event.beta == null || event.gamma == null) return;
  const raw = cameraPose(alpha, event.beta, event.gamma, screen.orientation?.angle ?? 0);
  if (!state.pose) {
    state.pose = raw;
    return;
  }
  // Steady it a little: the sensors jitter, and a bobbing phone more so.
  state.pose = {
    yaw: state.pose.yaw + angleBetween(state.pose.yaw, raw.yaw) * 0.25,
    pitch: state.pose.pitch + (raw.pitch - state.pose.pitch) * 0.25,
    roll: state.pose.roll + angleBetween(state.pose.roll, raw.roll) * 0.25,
  };
}

async function openCamera() {
  if (state.demo || !navigator.mediaDevices?.getUserMedia) return;
  try {
    $('camera').srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    state.camera = true;
  } catch {
    state.camera = false;
  }
}

// ---------------------------------------------------------- heading check --

/** The compass bearing of the route at `dist`, radians clockwise from north. */
function routeBearing(route, dist) {
  const from = steady(route, Math.min(dist, route.length - 2));
  const to = steady(route, Math.min(route.length, dist + 10));
  return Math.atan2(to.x - from.x, to.y - from.y);
}

/** On each fix while moving along the route: how far the compass is from the way we are going. */
function checkHeading() {
  if (!state.pose) return;
  const here = position();
  if (!here || here.offRoute || here.speed < 1) return;
  const facing = state.pose.yaw + state.settings.offset * RAD;
  const error = angleBetween(routeBearing(state.course.route, here.dist), facing) / RAD;
  state.readings.push({ t: Math.round(performance.now() / 100) / 10, speed: here.speed, error });
  showResults();
}

function showResults() {
  const table = $('results');
  table.replaceChildren();
  const head = table.insertRow();
  for (const title of ['', 'Readings', 'Typical error', 'Leans', 'Target']) {
    const th = document.createElement('th');
    th.textContent = title;
    head.append(th);
  }
  const rows = [
    ['Walking', state.readings.filter((r) => r.speed < RUNNING), TARGET.walking],
    ['Running', state.readings.filter((r) => r.speed >= RUNNING), TARGET.running],
  ];
  for (const [label, readings, target] of rows) {
    const tr = table.insertRow();
    const typical = readings.length ? median(readings.map((r) => Math.abs(r.error))) : null;
    const lean = readings.length ? median(readings.map((r) => r.error)) : null;
    const cells = [
      label,
      String(readings.length),
      typical == null ? '–' : `${typical.toFixed(1)}°`,
      lean == null ? '–' : Math.abs(lean) < 0.5 ? 'neither way' : `${Math.abs(lean).toFixed(1)}° ${lean > 0 ? 'right' : 'left'}`,
      typical == null ? `under ${target}°` : `under ${target}°: ${typical < target ? 'met' : 'not met'}`,
    ];
    for (const text of cells) tr.insertCell().textContent = text;
  }
  $('csv').disabled = !state.readings.length;
  $('match').disabled = state.readings.length < 5;
}

/** Take out whatever steady lean the compass has had over the last readings. */
function matchCompass() {
  const recent = state.readings.slice(-30);
  if (recent.length < 5) return;
  setOffset(state.settings.offset - median(recent.map((r) => r.error)));
  state.readings = [];
  showResults();
}

function downloadCsv() {
  const lines = ['t_s,speed_mps,compass_minus_travel_deg', ...state.readings.map((r) => `${r.t},${r.speed.toFixed(2)},${r.error.toFixed(1)}`)];
  const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sportshud-heading.csv';
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- drawing --

const canvas = $('overlay');
const ctx = canvas.getContext('2d');

function notice(text) {
  $('notice').textContent = text ?? '';
  $('notice').hidden = !text;
}

function frame() {
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(canvas.clientWidth * scale);
  const H = Math.round(canvas.clientHeight * scale);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const here = state.course && position();
  if (!state.course) {
    ctx.clearRect(0, 0, W, H);
    notice('Choose a route, or add a GPX of a past run.');
  } else if (!here) {
    ctx.clearRect(0, 0, W, H);
    notice(state.gpsError ?? 'Waiting for GPS…');
  } else {
    const { route } = state.course;
    // With no sensors (a desk, or the sample run) look along the path instead.
    const along = routeBearing(route, here.dist);
    state.gaze = state.gaze == null ? along : state.gaze + angleBetween(state.gaze, along) * 0.1;
    const r = here.reading;
    drawScene(ctx, W, H, route, {
      dist: here.dist,
      yaw: state.pose ? state.pose.yaw + state.settings.offset * RAD : state.gaze + state.look,
      pitch: state.pose?.pitch,
      roll: state.pose?.roll ?? 0,
      fov: state.settings.fov,
      unit: scale * 0.95,
      world: !state.camera,
      ghostDist: r ? r.ghostDist : null,
      timeGap: r ? r.timeGap : 0,
      speed: here.speed,
      time: r ? r.time : 0,
      distance: r ? r.distance : 0,
      paused: r ? r.paused : false,
      ghostLabel: state.course.label,
      style: 'anchored',
      display: null,
      markerEvery: 500,
      readouts: Boolean(r),
    });
    const tips = [];
    if (here.offRoute) tips.push('You are off this route: progress is held until you rejoin it.');
    if (!state.session) tips.push('Stand on the route facing along it. The blue line should lie on the path.');
    if (!state.pose && !state.demo) tips.push('This device reports no compass, so the view follows the path. Drag to look around.');
    notice(tips.join(' ') || null);
  }
  showStatus(here);
  requestAnimationFrame(frame);
}

function showStatus(here) {
  const parts = [];
  if (state.demo) parts.push(`Sample run at ${state.demo.speed}× speed.`);
  else if (state.gpsError) parts.push(state.gpsError + '.');
  else if (state.lastFix) parts.push(`GPS good to ${Math.round(state.lastFix.accuracy)} m.`);
  if (state.pose) parts.push(`Facing ${Math.round((((state.pose.yaw / RAD + state.settings.offset) % 360) + 360) % 360)}°.`);
  if (here) parts.push(`${Math.round(here.dist)} m along the route.`);
  const r = here?.reading;
  if (r) parts.push(Math.abs(r.timeGap) < 0.5 ? 'Level with the ghost.' : `${Math.round(Math.abs(r.timeGap))} s ${r.timeGap > 0 ? 'ahead of' : 'behind'} the ghost.`);
  const text = parts.join(' ');
  if ($('status').textContent !== text) $('status').textContent = text;
}

// ---------------------------------------------------------------- wiring --

function setOffset(degrees) {
  state.settings.offset = clamp(Math.round(degrees), -45, 45);
  $('offset').value = String(state.settings.offset);
  $('offsetValue').textContent = `${state.settings.offset > 0 ? '+' : ''}${state.settings.offset}°`;
  saveSettings('probe', state.settings);
}

function setFov(degrees) {
  state.settings.fov = clamp(Math.round(degrees), 35, 90);
  $('fov').value = String(state.settings.fov);
  $('fovValue').textContent = `${state.settings.fov}°`;
  saveSettings('probe', state.settings);
}

let wakeLock = null;
async function toggleGhost() {
  if (!state.course) return;
  if (state.session) {
    // Back to lining up.
    wakeLock?.release().catch(() => {});
    setCourse();
  } else {
    state.session = createRunSession({ ghost: { kind: 'track', route: state.course.route, profile: state.course.profile } });
    state.source.begin();
    if (!state.demo && state.lastFix && performance.now() - state.lastFix.at < 3000) {
      state.session.update({ lat: state.lastFix.lat, lon: state.lastFix.lon, accuracy: state.lastFix.accuracy, t: 0 });
    }
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      wakeLock = null;
    }
  }
  $('go').textContent = state.session ? 'Stop, and line up again' : 'Start the ghost';
}

async function importGpx(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const run = runFromGpx(await file.text());
    state.runs = [run, ...state.runs.filter((r) => r.id !== run.id)];
    saveRuns(state.runs);
    listRuns();
    $('run').value = run.id;
    setCourse();
  } catch (error) {
    notice(`${file.name}: ${error.message}`);
  }
}

async function init() {
  const params = new URLSearchParams(location.search);
  const sample = ['run', 'ride', 'walk'].includes(params.get('demo')) ? params.get('demo') : null;
  if (sample) {
    try {
      const { mine, theirs } = await loadSample(sample);
      state.demo = { fixes: fixesOf(mine), speed: clamp(Number(params.get('speed')) || 5, 1, 30) };
      state.runs = [theirs, ...state.runs];
    } catch (error) {
      notice(`Could not load the sample run: ${error.message}`);
    }
  }
  if (params.get('ghost') === 'pace') $('ghostKind').value = 'pace';
  if (parsePace(params.get('pace') ?? '')) $('ghostPace').value = params.get('pace');
  setOffset(state.settings.offset);
  setFov(state.settings.fov);
  listRuns();
  setCourse();
  showResults();
  $('recentre').hidden = !state.demo;

  $('go').addEventListener('click', toggleGhost);
  $('recentre').addEventListener('click', () => (state.look = 0));
  $('run').addEventListener('change', setCourse);
  $('ghostKind').addEventListener('change', setCourse);
  $('ghostPace').addEventListener('change', setCourse);
  $('import').addEventListener('change', (event) => importGpx(event.target));
  $('offset').addEventListener('input', (event) => setOffset(Number(event.target.value)));
  $('fov').addEventListener('input', (event) => setFov(Number(event.target.value)));
  $('match').addEventListener('click', matchCompass);
  $('csv').addEventListener('click', downloadCsv);

  window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);
  // Without sensors, drag to look around.
  let drag = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (state.pose) return;
    drag = { x: event.clientX, look: state.look };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (drag) state.look = clamp(drag.look - ((event.clientX - drag.x) * state.settings.fov * RAD) / canvas.clientWidth, -Math.PI, Math.PI);
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('pointercancel', () => (drag = null));
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !state.session) return;
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      wakeLock = null;
    }
  });

  await openCamera();
  requestAnimationFrame(frame);
}

// For tests and for poking at from the console.
window.sportshud = state;

init();
