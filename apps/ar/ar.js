// AR ghost: only what glasses would add to the view, for something worn on
// the head. The ghost stands on the road where it is, a line runs along the
// route, a gate stands at each marker; everything else is black, which a
// see-through display shows as nothing.
//
// It is one page for three kinds of device: glasses that run web pages
// themselves, a phone in a see-through visor, and a desk. They differ only
// in how the picture is laid out and in how the device sits on the head,
// and both of those are settings here rather than code.
//
// Where the runner is along the route comes from the engine, as everywhere
// else. Which way the head faces comes from the device's motion sensors with
// no compass: the engine keeps it true from the way the runner is going.

import { ghostFromFixes, paceProfile, createProgressTracker, createRunSession, deviceAxes, mountFrom, headPose, angleBetween, createTravelAnchor, bearingAlong } from '../../engine/index.js';
import { drawScene } from '../preview/scene.js';
import { clock, km, pace } from '../ghost/hud.js';
import { loadRuns, saveRuns, loadSettings, saveSettings, fixesOf, runFromGpx, runFromLink, loadSample } from '../ghost/store.js';
import { liveSource, demoSource } from '../ghost/sources.js';

const RAD = Math.PI / 180;
const EYES_APART = 0.063; // metres between a pair of eyes, near enough
const LOG_LIMIT = 3600; // seconds of sensor readings kept at most
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = (degrees) => ((degrees % 360) + 360) % 360;
const seconds = () => performance.now() / 1000;

const state = {
  runs: loadRuns(),
  settings: { layout: 'single', fov: 30, lift: 0, trim: 0, spread: 0, mirror: false, upturn: false, ...loadSettings('ar') },
  course: null, // { route, profile, label }: the chosen route and the ghost on it
  tracker: null, // progress along the route before the ghost starts
  session: null, // the run, once the ghost is started
  source: null,
  demo: null, // { fixes, speed } when replaying a sample run
  axes: null, // the device's own axes at its latest reading; null if it reports none
  relative: false, // readings not tied to a compass have been seen, and are the ones used
  mount: null, // how the device sits on the head, known once lined up
  anchor: createTravelAnchor(), // keeps the heading true from the way of travel
  head: null, // { yaw, pitch, roll } of the head by the device's own reckoning, radians
  gaze: null, // without sensors: the way the path goes, followed smoothly
  look: 0, // without sensors: how far the view is turned from that, radians
  worn: false,
  lastFix: null,
  gpsError: null,
  log: null, // { began, rows } while the sensors are being recorded
};

function parsePace(text) {
  const match = /^\s*(\d{1,2})(?::([0-5]\d))?\s*$/.exec(text);
  const total = match ? Number(match[1]) * 60 + Number(match[2] ?? 0) : 0;
  return total >= 60 && total <= 1800 ? total : null;
}
const dateLabel = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

// ----------------------------------------------------------------- course --

function listRuns() {
  const select = $('run');
  const chosen = select.value;
  select.replaceChildren();
  for (const run of state.runs) {
    const whose = run.demo ? 'Sample run' : run.from != null ? `${run.from || 'A friend'}, ${dateLabel(run.startedAt)}` : dateLabel(run.startedAt);
    select.add(new Option(`${whose} · ${km(run.distance)} km · ${pace(run.secondsPerKm)} /km`, run.id));
  }
  if (!state.runs.length) select.add(new Option('No routes yet: add a GPX below', ''));
  if (state.runs.some((r) => r.id === chosen)) select.value = chosen;
}

/** Set up the chosen route and ghost, back at lining up. */
function setCourse() {
  const run = state.runs.find((r) => r.id === $('run').value);
  $('paceBox').hidden = $('ghostKind').value !== 'pace';
  state.session = null;
  state.gaze = null;
  $('go').textContent = 'Line up and start the ghost';
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

// --------------------------------------------------------------- position --

function onFix(fix) {
  state.gpsError = null;
  state.lastFix = { ...fix, at: performance.now() };
  record('g', [fix.lat, 6], [fix.lon, 6], [fix.accuracy, 1]);
  if (!state.course) return;
  if (state.session) state.session.update({ ...fix, t: fix.t ?? state.source.elapsed() });
  else state.tracker.update({ ...fix, t: seconds() });
  learnFromTravel();
}

function openSource() {
  state.source?.close();
  state.source = state.demo
    ? demoSource(state.demo.fixes, state.demo.speed, onFix)
    : liveSource(onFix, (error) => (state.gpsError = error.code === 1 ? 'Location is blocked for this site' : error.message || 'No position yet'));
  state.source.open();
}

/** Where we are on the route right now, from the run or from before it. */
function position() {
  if (state.session) {
    const r = state.session.at(state.source.elapsed());
    return r && { dist: r.routeDist, speed: r.speed, offRoute: r.offRoute, reading: r };
  }
  const p = state.tracker?.at(seconds());
  return p && { dist: p.dist, speed: Math.max(0, p.speed), offRoute: p.offRoute, reading: null };
}

/** The bearing of the route where we are, degrees. */
const routeBearing = (here) => bearingAlong(state.course.route, Math.min(here.dist, state.course.route.length - 2), Math.min(state.course.route.length, here.dist + 10));

// ------------------------------------------------------------------- head --

// Until the wearer has lined up, take the device to be held like a camera:
// looking out of its back, the top of the page upwards.
function heldLikeACamera() {
  const s = (screen.orientation?.angle ?? 0) * RAD;
  return { forward: [0, 0, -1], up: [Math.sin(s), Math.cos(s), 0] };
}

function onOrientation(event) {
  if (event.alpha == null || event.beta == null || event.gamma == null) return;
  // Two kinds of reading may arrive: one tied to the compass and one not.
  // The one that is not is smoother and nothing nearby can throw it, and
  // the way of travel supplies north; so once seen, it is the one used.
  if (event.absolute && state.relative) return;
  if (!event.absolute) state.relative = true;
  state.axes = deviceAxes(event.alpha, event.beta, event.gamma);
  state.head = headPose(state.axes, state.mount ?? heldLikeACamera());
  state.anchor.orientation(wrap(state.head.yaw / RAD), seconds());
  record('o', [event.alpha, 2], [event.beta, 2], [event.gamma, 2], [event.absolute ? 1 : 0, 0]);
}

function onMotion(event) {
  const a = event.accelerationIncludingGravity;
  const r = event.rotationRate;
  if (!a || !r) return;
  record('m', [a.x, 3], [a.y, 3], [a.z, 3], [r.alpha, 2], [r.beta, 2], [r.gamma, 2]);
}

/** On each fix while moving along the route: the way we are going says where north is. */
function learnFromTravel() {
  const here = position();
  if (!here) return;
  const bearing = routeBearing(here);
  if (state.axes && !here.offRoute) state.anchor.travel(bearing, here.speed, seconds());
  const kept = state.anchor.at(seconds());
  record('h', [kept?.yaw, 2], [kept?.offset, 2], [bearing, 2], [here.dist, 1], [here.speed, 2], [here.reading ? here.reading.ghostDist - here.dist : null, 1]);
}

/**
 * The wearer is looking level along the route, and says so. That fixes how
 * the device sits on the head and which way the route runs, both at once.
 */
async function lineUp() {
  await askForSensors();
  const here = state.course && position();
  if (!here) return;
  const bearing = routeBearing(here);
  if (state.axes) {
    state.mount = mountFrom(state.axes, bearing);
    state.head = headPose(state.axes, state.mount);
    state.anchor = createTravelAnchor();
    state.anchor.orientation(wrap(state.head.yaw / RAD), seconds());
    state.anchor.set(bearing, seconds());
  }
  state.look = 0;
  set('trim', 0);
  if (!state.session) startGhost();
}

/** iPhones hand over motion readings only when asked for from a tap. */
async function askForSensors() {
  for (const kind of [window.DeviceOrientationEvent, window.DeviceMotionEvent]) {
    try {
      await kind?.requestPermission?.();
    } catch {
      // Refused, or not a tap: the picture then follows the path instead.
    }
  }
}

/** Which way to draw for: the head as the sensors have it, kept true by travel, with the wearer's own adjustments. */
function facing(here) {
  if (state.axes && state.head) {
    const kept = state.anchor.at(seconds());
    return { yaw: (kept.yaw + state.settings.trim) * RAD, pitch: state.head.pitch + state.settings.lift * RAD, roll: state.head.roll };
  }
  // No sensors (a desk, or the sample run): look along the path, and let a drag turn the head.
  const along = routeBearing(here) * RAD;
  state.gaze = state.gaze == null ? along : state.gaze + angleBetween(state.gaze, along) * 0.1;
  return { yaw: state.gaze + state.look + state.settings.trim * RAD, pitch: (-5 + state.settings.lift) * RAD, roll: 0 };
}

// -------------------------------------------------------------- the ghost --

let wakeLock = null;
async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    wakeLock = null;
  }
}

function startGhost() {
  if (!state.course || state.session) return;
  state.session = createRunSession({ ghost: { kind: 'track', route: state.course.route, profile: state.course.profile } });
  state.source.begin();
  if (!state.demo && state.lastFix && performance.now() - state.lastFix.at < 3000) {
    state.session.update({ lat: state.lastFix.lat, lon: state.lastFix.lon, accuracy: state.lastFix.accuracy, t: 0 });
  }
  if ($('record').checked) state.log = { began: seconds(), rows: ['# kind,seconds,then by kind: o alpha,beta,gamma,absolute | m ax,ay,az (gravity included, m/s2),turn rates alpha,beta,gamma (deg/s) | g lat,lon,accuracy | h heading shown,offset taken off,route bearing,metres along,speed,ghost lead'] };
  $('saveLog').disabled = !state.log;
  $('go').textContent = 'Stop the ghost';
  keepAwake();
}

function stopGhost() {
  wakeLock?.release().catch(() => {});
  setCourse();
}

// -------------------------------------------------------------- recording --

/** One line of the sensor recording: a kind, then values each with the decimal places worth keeping. */
function record(kind, ...values) {
  const log = state.log;
  if (!log || !state.session) return;
  const t = seconds() - log.began;
  if (t > LOG_LIMIT) return;
  log.rows.push(`${kind},${t.toFixed(3)},${values.map(([v, places]) => (v == null || Number.isNaN(v) ? '' : Number(v).toFixed(places))).join(',')}`);
}

function saveLog() {
  if (!state.log) return;
  const url = URL.createObjectURL(new Blob([state.log.rows.join('\n') + '\n'], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `sportshud-head-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- drawing --

const canvas = $('display');
const ctx = canvas.getContext('2d');
const eye = document.createElement('canvas'); // one eye's picture, drawn here and then placed
const eyeCtx = eye.getContext('2d');

function notice(text) {
  if ($('notice').textContent !== (text ?? '')) $('notice').textContent = text ?? '';
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
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const here = state.course && position();
  if (!state.course) notice('Choose a route, or add a GPX of a past run.');
  else if (!here) notice(state.gpsError ?? 'Waiting for GPS…');
  else {
    const { settings } = state;
    const pair = settings.layout === 'pair';
    const w = pair ? Math.floor(W / 2) : W;
    if (eye.width !== w || eye.height !== H) {
      eye.width = w;
      eye.height = H;
    }
    const pose = facing(here);
    const r = here.reading;
    for (const side of pair ? [-1, 1] : [0]) {
      drawScene(eyeCtx, w, H, state.course.route, {
        dist: here.dist,
        ...pose,
        fov: settings.fov,
        unit: w / 520,
        world: false,
        eye: (side * EYES_APART) / 2,
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
      // Seen in a mirror, the left of the screen is on the right: the pictures change places as well as turning over.
      const onLeft = settings.mirror ? side > 0 : side < 0;
      const x = pair ? (onLeft ? 0 : w) : 0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, w, H);
      ctx.clip();
      ctx.translate(x + w / 2 + (pair ? ((onLeft ? -1 : 1) * settings.spread * w) / 200 : 0), H / 2);
      ctx.scale(settings.mirror ? -1 : 1, settings.upturn ? -1 : 1);
      ctx.drawImage(eye, -w / 2, -H / 2);
      ctx.restore();
    }
    const tips = [];
    if (here.offRoute) tips.push('You are off this route: progress is held until you rejoin it.');
    if (!state.session) tips.push(state.axes ? 'Stand on the route and look level along it, then tap.' : 'Tap to start the ghost.');
    else if (state.axes && !state.mount) tips.push('Look level along the route, then tap.');
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
  if (!state.axes) parts.push(state.demo ? 'No motion sensors here: the view follows the path. Drag to turn your head.' : 'This device reports no motion sensors yet: the view follows the path.');
  else {
    const kept = state.anchor.at(seconds());
    const taken = Math.abs(kept.offset) < 0.5 ? 'nothing taken off yet' : `${Math.abs(kept.offset).toFixed(0)}° taken off for wander`;
    parts.push(`Head by motion sensors${state.relative ? ', no compass' : ''}: ${state.mount ? `lined up; facing ${Math.round(wrap(kept.yaw + state.settings.trim))}°, ${taken}.` : 'not lined up yet.'}`);
  }
  if (here) parts.push(`${Math.round(here.dist)} m along the route.`);
  const r = here?.reading;
  if (r) parts.push(Math.abs(r.timeGap) < 0.5 ? 'Level with the ghost.' : `${Math.round(Math.abs(r.timeGap))} s ${r.timeGap > 0 ? 'ahead of' : 'behind'} the ghost.`);
  if (state.log) parts.push(`Recording: ${(state.log.rows.length - 1).toLocaleString()} readings.`);
  const text = parts.join(' ');
  if ($('status').textContent !== text) $('status').textContent = text;
}

// ---------------------------------------------------------------- wiring --

const RANGES = { fov: [10, 90, '°'], lift: [-20, 20, '°'], trim: [-20, 20, '°'], spread: [-30, 30, '%'] };

/** Change one setting, wherever the change came from, and keep it. */
function set(name, value) {
  if (RANGES[name]) {
    const [lo, hi, unit] = RANGES[name];
    state.settings[name] = clamp(Math.round(value), lo, hi);
    $(name).value = String(state.settings[name]);
    $(`${name}Value`).textContent = `${name !== 'fov' && state.settings[name] > 0 ? '+' : ''}${state.settings[name]}${unit}`;
  } else state.settings[name] = value;
  if (name === 'layout') {
    $('layout').value = value;
    $('spreadBox').hidden = value !== 'pair';
  }
  if (name === 'mirror' || name === 'upturn') $(name).checked = value;
  saveSettings('ar', state.settings);
}

async function wear(on) {
  state.worn = on;
  document.body.classList.toggle('worn', on);
  $('leave').hidden = !on;
  if (on) {
    await askForSensors();
    keepAwake();
    try {
      await $('stage').requestFullscreen?.({ navigationUI: 'hide' });
    } catch {
      // No full screen here (an iPhone, say): the picture still covers the page.
    }
  } else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

async function importGpx(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    addRun(runFromGpx(await file.text()));
  } catch (error) {
    notice(`${file.name}: ${error.message}`);
  }
}

function addRun(run) {
  state.runs = [run, ...state.runs.filter((r) => r.id !== run.id)];
  if (!run.demo) saveRuns(state.runs);
  listRuns();
  $('run').value = run.id;
  setCourse();
}

/** A run that arrived in the address, as a link someone sent: the way to get a route onto glasses that have no files. */
function openLink() {
  const match = /^#ghost=(.+)$/.exec(location.hash);
  if (!match) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    addRun(runFromLink(match[1]));
  } catch (error) {
    notice(error.message);
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
  for (const name of Object.keys(RANGES)) set(name, state.settings[name]);
  for (const name of ['layout', 'mirror', 'upturn']) set(name, state.settings[name]);
  listRuns();
  setCourse();
  openLink();

  $('wear').addEventListener('click', () => wear(true));
  $('leave').addEventListener('click', () => wear(false));
  $('go').addEventListener('click', () => (state.session ? stopGhost() : lineUp()));
  $('run').addEventListener('change', setCourse);
  $('ghostKind').addEventListener('change', setCourse);
  $('ghostPace').addEventListener('change', setCourse);
  $('import').addEventListener('change', (event) => importGpx(event.target));
  for (const name of Object.keys(RANGES)) $(name).addEventListener('input', (event) => set(name, Number(event.target.value)));
  $('layout').addEventListener('change', (event) => set('layout', event.target.value));
  for (const name of ['mirror', 'upturn']) $(name).addEventListener('change', (event) => set(name, event.target.checked));
  $('saveLog').addEventListener('click', saveLog);
  window.addEventListener('hashchange', openLink);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && state.worn) wear(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (state.session || state.worn)) keepAwake();
  });

  window.addEventListener('deviceorientation', onOrientation);
  window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('devicemotion', onMotion);

  // Five keys, as glasses or a small remote have: Enter lines up, the arrows nudge the picture.
  document.addEventListener('keydown', (event) => {
    if (event.target.closest('#controls') && !state.worn) return;
    const nudge = { ArrowLeft: ['trim', -1], ArrowRight: ['trim', 1], ArrowUp: ['lift', 1], ArrowDown: ['lift', -1] }[event.key];
    if (event.key === 'Enter') lineUp();
    else if (nudge) set(nudge[0], state.settings[nudge[0]] + nudge[1]);
    else return;
    event.preventDefault();
  });
  // A tap lines up. With no sensors, a drag turns the head instead.
  let down = null;
  canvas.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY, look: state.look, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!down) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 12) down.moved = true;
    const pictures = state.settings.layout === 'pair' ? 2 : 1;
    if (!state.axes && down.moved) state.look = clamp(down.look - ((event.clientX - down.x) * state.settings.fov * RAD * pictures) / canvas.clientWidth, -Math.PI, Math.PI);
  });
  canvas.addEventListener('pointerup', () => {
    if (down && !down.moved) lineUp();
    down = null;
  });
  canvas.addEventListener('pointercancel', () => (down = null));

  requestAnimationFrame(frame);
}

// For tests and for poking at from the console.
window.sportshud = state;

init();
