// Anchoring probe: the route, its markers and the ghost placed over the
// phone's camera picture, using only GPS and the compass. It is the nearest
// thing to glasses that place things in the world, and it measures how far
// off that placing is.
//
// Position along the route comes from the engine, as everywhere else. The
// one new live input is which way the phone is facing.
//
// There are two ways of knowing that. The compass, steadied and corrected by
// the engine. Or, where the browser can track the phone's own movement
// through its camera, that tracking: far steadier than any compass, but with
// no idea where north is until the engine has lined its path up with GPS.

import { ghostFromFixes, paceProfile, createProgressTracker, createRunSession, cameraPose, trackedPose, angleBetween, createHeadingFuser, turnRate, createAligner } from '../../engine/index.js';
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
  pairWithTracking(fix);
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

// The heading is kept by the engine: the gyroscope from moment to moment,
// the compass over seconds, and the compass's steady error learned from the
// way we are moving along the route.
const fuser = createHeadingFuser();
const seconds = () => performance.now() / 1000;

function onOrientation(event) {
  // Use readings measured from north: Android's absolute event, or iOS's compass heading.
  const alpha = event.webkitCompassHeading != null ? 360 - event.webkitCompassHeading : event.absolute ? event.alpha : null;
  if (alpha == null || event.beta == null || event.gamma == null) return;
  const raw = cameraPose(alpha, event.beta, event.gamma, screen.orientation?.angle ?? 0);
  fuser.compass(raw.yaw / RAD, seconds());
  const fused = fuser.at(seconds());
  // With the correction switched off, the compass as it comes, steadied a little.
  const plain = (state.compass ?? raw.yaw) + angleBetween(state.compass ?? raw.yaw, raw.yaw) * 0.25;
  state.compass = plain;
  if (tracking.session) return; // the camera's tracking says how the phone is held; the compass is only a first guess at north
  const before = state.pose ?? raw;
  state.pose = {
    yaw: $('correct').checked ? fused.yaw * RAD : plain,
    pitch: before.pitch + (raw.pitch - before.pitch) * 0.25,
    roll: before.roll + angleBetween(before.roll, raw.roll) * 0.25,
  };
}

function onMotion(event) {
  if (!event.rotationRate || !event.accelerationIncludingGravity) return;
  const rate = turnRate(event.rotationRate, event.accelerationIncludingGravity);
  if (rate != null) fuser.gyro(rate, seconds());
}

function closeCamera() {
  for (const track of $('camera').srcObject?.getTracks() ?? []) track.stop();
  $('camera').srcObject = null;
  state.camera = false;
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

// ------------------------------------------------- the camera's tracking --

// Where the browser offers it (Chrome on an Android phone; glasses running
// Android XR), the device follows its own movement through its camera, to
// centimetres, in a frame of its own. The browser shows the camera picture
// and this page is laid over it.
const tracking = {
  session: null,
  space: null,
  gl: null,
  aligner: null, // lines the tracked path up with GPS to find north
  own: null, // { yaw, pitch, roll } in the tracking's own frame
  place: null, // { x, z }: where the phone is in that frame
  trail: [], // { at, x, z }: where it has just been, to match a GPS fix to the moment it was taken
  lost: false, // the tracking has lost its footing for the moment
  guess: null, // degrees: the bearing of the frame as first guessed, from the compass or from facing along the route
  bearing: null, // degrees: the bearing of the frame in use, eased towards the best answer so far
  fov: null, // degrees the camera picture spans, left to right
  at: null,
};
const turnTo = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;

async function offerTracking() {
  let offered = false;
  try {
    offered = Boolean(await navigator.xr?.isSessionSupported('immersive-ar'));
  } catch {
    offered = false;
  }
  $('trackBox').hidden = !offered;
}

async function startTracking() {
  if (tracking.session) return;
  try {
    const gl = document.createElement('canvas').getContext('webgl', { xrCompatible: true });
    if (!gl) throw new Error('This browser could not start its graphics for tracking.');
    closeCamera(); // the tracking needs the camera to itself
    const session = await navigator.xr.requestSession('immersive-ar', { optionalFeatures: ['dom-overlay'], domOverlay: { root: $('stage') } });
    if (!session.domOverlayState) {
      await session.end();
      throw new Error('This browser tracks, but cannot lay a page over the camera picture.');
    }
    // Nothing of ours is drawn in the tracked layer: it stays clear so the camera picture shows.
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    const space = await session.requestReferenceSpace('local');
    Object.assign(tracking, { session, space, gl, aligner: createAligner(), own: null, place: null, trail: [], lost: false, guess: null, bearing: null, fov: null, at: null });
    // If the tracking starts over from a new origin, what was learned about north goes with it.
    space.addEventListener('reset', () => Object.assign(tracking, { aligner: createAligner(), guess: null, bearing: null, trail: [] }));
    session.addEventListener('end', stopTracking);
    $('stage').classList.add('tracking');
    $('trackBar').hidden = false;
    state.camera = true;
    session.requestAnimationFrame(onTracked);
  } catch (error) {
    notice(error.message || 'The camera\'s tracking could not be started.');
    if (!tracking.session) openCamera();
  }
}

function stopTracking() {
  if (!tracking.session) return;
  tracking.session = null;
  $('stage').classList.remove('tracking');
  $('trackBar').hidden = true;
  state.pose = null;
  state.camera = false;
  openCamera();
  requestAnimationFrame(frame);
}

/** Each picture the tracking produces: where the phone is and how it is held, then draw. */
function onTracked(time, xrFrame) {
  const t = tracking;
  if (!t.session) return;
  t.session.requestAnimationFrame(onTracked);
  t.gl.bindFramebuffer(t.gl.FRAMEBUFFER, t.session.renderState.baseLayer.framebuffer);
  t.gl.clearColor(0, 0, 0, 0);
  t.gl.clear(t.gl.COLOR_BUFFER_BIT);
  const viewer = xrFrame.getViewerPose(t.space);
  t.lost = !viewer || viewer.emulatedPosition;
  if (viewer) {
    const where = viewer.transform.position;
    t.own = trackedPose(viewer.transform.orientation);
    t.place = { x: where.x, z: where.z };
    const now = performance.now();
    t.trail.push({ at: now, ...t.place });
    while (t.trail.length && now - t.trail[0].at > 3000) t.trail.shift();
    const across = viewer.views[0]?.projectionMatrix[0];
    if (across > 0) t.fov = (2 * Math.atan(1 / across)) / RAD;

    // Which way the tracking's frame points. First a guess: from the compass
    // if there is one, or else taking it that the phone began facing along
    // the route. Then, once the phone has moved, from its path against GPS.
    if (t.guess == null) {
      const here = state.course && position();
      const facing = state.compass != null ? state.compass : here ? routeBearing(state.course.route, here.dist) : null;
      if (facing != null) t.guess = (((facing - t.own.yaw) / RAD) % 360 + 360) % 360;
    }
    const found = t.aligner.state();
    const best = found.bearing ?? (t.guess == null ? null : t.guess + state.settings.offset);
    if (best != null) {
      const dt = t.at == null ? 0 : Math.min(1, (now - t.at) / 1000);
      t.bearing = t.bearing == null ? best : t.bearing + turnTo(t.bearing, best) * (1 - Math.exp(-dt / 1.5));
    }
    t.at = now;
    if (t.bearing != null) state.pose = { yaw: t.bearing * RAD + t.own.yaw, pitch: t.own.pitch, roll: t.own.roll };
  }
  draw();
}

/** A GPS fix and where the tracking had the phone when that fix was taken: one more pair for finding north. */
function pairWithTracking(fix) {
  const t = tracking;
  if (!t.session || t.lost || !t.trail.length) return;
  // A fix arrives a little after it was taken; look back along the trail by that much.
  const age = fix.stamp ? clamp(Date.now() - fix.stamp, 0, 2000) : 0;
  const when = performance.now() - age;
  let then = t.trail[t.trail.length - 1];
  for (const point of t.trail) {
    if (Math.abs(point.at - when) < Math.abs(then.at - when)) then = point;
  }
  t.aligner.add({ x: then.x, z: then.z, lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy });
}

// ---------------------------------------------------------- heading check --

/** The compass bearing of the route at `dist`, radians clockwise from north. */
function routeBearing(route, dist) {
  const from = steady(route, Math.min(dist, route.length - 2));
  const to = steady(route, Math.min(route.length, dist + 10));
  return Math.atan2(to.x - from.x, to.y - from.y);
}

/** The bearing the picture is drawn for, radians. The hand-set turn applies to the compass only: the tracking finds north for itself. */
const facingNow = () => (tracking.session ? state.pose.yaw : state.pose.yaw + state.settings.offset * RAD);

/** On each fix while moving along the route: how far the heading shown is from the way we are going. */
function checkHeading() {
  if (!state.pose) return;
  const here = position();
  if (!here || here.offRoute || here.speed < 1) return;
  const along = routeBearing(state.course.route, here.dist);
  // Teach the heading what the compass's steady error is, from the way we are going.
  fuser.travel((((along / RAD) % 360) + 360) % 360, here.speed, seconds());
  const error = angleBetween(along, facingNow()) / RAD;
  // With the camera's tracking on there may be no compass at all to compare with.
  const alone = state.compass == null ? error : angleBetween(along, state.compass + state.settings.offset * RAD) / RAD;
  state.readings.push({ t: Math.round(performance.now() / 100) / 10, speed: here.speed, error, alone });
  showResults();
}

function showResults() {
  const table = $('results');
  table.replaceChildren();
  const head = table.insertRow();
  for (const title of ['', 'Readings', 'Compass alone', 'Typical error', 'Leans', 'Target']) {
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
    const alone = readings.length ? median(readings.map((r) => Math.abs(r.alone ?? r.error))) : null;
    const lean = readings.length ? median(readings.map((r) => r.error)) : null;
    const cells = [
      label,
      String(readings.length),
      alone == null ? '–' : `${alone.toFixed(1)}°`,
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
  const lines = ['t_s,speed_mps,shown_minus_travel_deg,compass_alone_minus_travel_deg', ...state.readings.map((r) => `${r.t},${r.speed.toFixed(2)},${r.error.toFixed(1)},${(r.alone ?? r.error).toFixed(1)}`)];
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

/** The page's own clock for drawing. While the camera's tracking is on, its pictures set the pace instead. */
function frame() {
  if (tracking.session) return;
  draw();
  requestAnimationFrame(frame);
}

function draw() {
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
      yaw: state.pose ? facingNow() : state.gaze + state.look,
      pitch: state.pose?.pitch,
      roll: state.pose?.roll ?? 0,
      fov: (tracking.session && tracking.fov) || state.settings.fov,
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
    if (tracking.session && tracking.lost) tips.push('The camera has lost track of where it is. Point it at the ground a few metres ahead.');
    else if (tracking.session && tracking.aligner.state().quality === 'none') tips.push('Finding north: walk along the route. Until then the line is placed by ' + (state.compass != null ? 'the compass.' : 'the way you were facing when you began.'));
    else if (!state.session) tips.push('Stand on the route facing along it. The blue line should lie on the path.');
    if (!state.pose && !state.demo && !tracking.session) tips.push('This device reports no compass, so the view follows the path. Drag to look around.');
    notice(tips.join(' ') || null);
  }
  showStatus(here);
}

function showStatus(here) {
  const parts = [];
  if (state.demo) parts.push(`Sample run at ${state.demo.speed}× speed.`);
  else if (state.gpsError) parts.push(state.gpsError + '.');
  else if (state.lastFix) parts.push(`GPS good to ${Math.round(state.lastFix.accuracy)} m.`);
  if (state.pose) parts.push(`Facing ${Math.round((((facingNow() / RAD) % 360) + 360) % 360)}°.`);
  const learned = fuser.at(seconds());
  let north = null;
  if (tracking.session) {
    const found = tracking.aligner.state();
    north = found.quality === 'none' ? 'Camera tracking on; north not found yet.' : `North found from ${Math.round(found.span)} m of movement${found.quality === 'good' ? '' : ': rough so far'}; GPS and tracking agree to ${found.residual.toFixed(1)} m.`;
    parts.push(north);
  } else if (state.pose && $('correct').checked) parts.push(learned?.corrected ? `Compass found to be ${Math.abs(learned.error).toFixed(0)}° ${learned.error > 0 ? 'right' : 'left'} of the way you move; taken off.` : 'Learning the compass: move along the route for a few seconds.');
  if (here) parts.push(`${Math.round(here.dist)} m along the route.`);
  const r = here?.reading;
  if (r) parts.push(Math.abs(r.timeGap) < 0.5 ? 'Level with the ghost.' : `${Math.round(Math.abs(r.timeGap))} s ${r.timeGap > 0 ? 'ahead of' : 'behind'} the ghost.`);
  const text = parts.join(' ');
  if ($('status').textContent !== text) $('status').textContent = text;
  // Over the camera picture only the stage shows, and there is little room: just how the tracking is doing.
  if (north && $('trackStatus').textContent !== north) $('trackStatus').textContent = north;
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
  $('trackGo').textContent = state.session ? 'Stop' : 'Start the ghost';
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
  $('trackGo').addEventListener('click', toggleGhost);
  $('track').addEventListener('click', startTracking);
  $('trackLeave').addEventListener('click', () => tracking.session?.end());
  offerTracking();
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
  window.addEventListener('devicemotion', onMotion);
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
window.sportshudTracking = tracking;

init();
