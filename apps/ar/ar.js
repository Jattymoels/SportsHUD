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
//
// The ghost may be a saved run on its own route, or one that only holds a
// pace, on any route at all. For that one there is no route to draw along:
// the ghost is placed ahead on a straight line the way the runner is going,
// by GPS, until their way joins the route of a saved run, whose ghost then
// takes over on its own route for as long as they stay on it.

import { ghostFromFixes, paceProfile, createProgressTracker, createRunSession, deviceAxes, mountFrom, headPose, angleBetween, createTravelAnchor, bearingAlong, createWayOfTravel, straightAhead } from '../../engine/index.js';
import { drawScene } from '../preview/scene.js';
import { clock, km, pace } from '../ghost/hud.js';
import { loadRuns, saveRuns, loadSettings, saveSettings, fixesOf, runFromGpx, runFromLink, loadSample } from '../ghost/store.js';
import { liveSource, demoSource } from '../ghost/sources.js';

const RAD = Math.PI / 180;
const EYES_APART = 0.063; // metres between a pair of eyes, near enough
const LOG_LIMIT = 3600; // seconds of sensor readings kept at most
const HOLD = 2000; // milliseconds two fingers must stay down to stop wearing, when touches are otherwise ignored
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = (degrees) => ((degrees % 360) + 360) % 360;
const turnTo = (from, to) => ((((to - from) % 360) + 540) % 360) - 180; // the short way round, degrees
const seconds = () => performance.now() / 1000;

const state = {
  runs: loadRuns(),
  settings: { layout: 'single', fov: 30, lift: 0, trim: 0, spread: 0, mirror: false, upturn: false, ...loadSettings('ar') },
  course: null, // the ghost chosen: { route, profile, label } on a route, or { any, secondsPerKm, tracks, label } for a pace on any route
  tracker: null, // progress along the route before the ghost starts
  way: createWayOfTravel(), // which way the runner is going, by GPS: all there is to go by with no route
  wayShown: null, // that bearing as drawn, eased so that the picture does not jerk at each fix
  session: null, // the run, once the ghost is started
  source: null,
  demo: null, // { fixes, speed } when replaying a sample run
  axes: null, // the device's own axes at its latest reading; null if it reports none
  relative: false, // readings not tied to a compass have been seen, and are the ones used
  north: null, // { axes, at, written }: the device's axes by its latest compass-tied reading, where it gives one
  mount: null, // how the device sits on the head, known once lined up
  anchor: createTravelAnchor(), // keeps the heading true from the way of travel
  head: null, // { yaw, pitch, roll } of the head by the device's own reckoning, radians
  gaze: null, // without sensors: the way the path goes, followed smoothly
  look: 0, // without sensors: how far the view is turned from that, radians
  worn: false,
  lastFix: null,
  gpsError: null,
  log: null, // { began, rows, written } once the sensors have been recorded in this visit
  kept: 0, // readings from an earlier visit still held in the browser's storage
  test: null, // { began } during a head test: recording only, no route and nothing drawn
  hold: null, // when two fingers went down, while touches are otherwise ignored
  here: null, // where the last picture was drawn from
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

/** Set up the chosen ghost, back at lining up. */
function setCourse() {
  const kind = $('ghostKind').value;
  const run = state.runs.find((r) => r.id === $('run').value);
  $('paceBox').hidden = kind === 'run';
  $('runBox').hidden = kind === 'any';
  state.session = null;
  state.gaze = null;
  $('go').textContent = kind === 'any' ? 'Start the ghost' : 'Line up and start the ghost';
  const secondsPerKm = parsePace($('ghostPace').value);
  if (kind === 'any') {
    // A pace, on any route. Every saved run comes along: where today's way
    // joins one of their routes, that run's ghost takes over until they part.
    const tracks = [];
    for (const saved of state.runs) {
      try {
        const { route, ghost } = ghostFromFixes(fixesOf(saved), saved.pauses);
        tracks.push({ route, profile: ghost, label: `ghost: ${saved.demo ? 'the sample run' : saved.from != null ? `${saved.from || 'a friend'}'s run` : `your run of ${dateLabel(saved.startedAt)}`}` });
      } catch {
        // A saved run that cannot be laid out is left behind.
      }
    }
    state.course = { any: true, secondsPerKm: secondsPerKm ?? 300, tracks, label: `ghost ${clock(secondsPerKm ?? 300)} /km` };
    state.tracker = null;
    openSource();
    return;
  }
  if (!run) {
    state.course = null;
    return;
  }
  const { route, ghost } = ghostFromFixes(fixesOf(run), run.pauses);
  const setPace = kind === 'along' && secondsPerKm;
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
  state.way.update({ ...fix, t: seconds() });
  record('g', [fix.lat, 6], [fix.lon, 6], [fix.accuracy, 1], [fix.gpsHeading, 1], [fix.gpsSpeed, 2], [fix.altitude, 1], [fix.stamp ? Date.now() - fix.stamp : null, 0]);
  if (!state.course) return;
  if (state.session) state.session.update({ ...fix, t: fix.t ?? state.source.elapsed() });
  else state.tracker?.update({ ...fix, t: seconds() });
  learnFromTravel();
  // With no route there was nothing to line up to at the start. A few
  // seconds after setting off there is: the way the runner is going.
  if (state.session && state.course.any && state.axes && !state.mount && state.way.at(seconds()).settled) lineUpTo(state.way.at().bearing);
}

function openSource() {
  state.source?.close();
  state.source = state.demo
    ? demoSource(state.demo.fixes, state.demo.speed, onFix)
    : liveSource(onFix, (error) => (state.gpsError = error.code === 1 ? 'Location is blocked for this site' : error.message || 'No position yet'));
  state.source.open();
}

/** The bearing of a route at a place along it, degrees. */
const bearingOn = (route, dist) => bearingAlong(route, Math.min(dist, route.length - 2), Math.min(route.length, dist + 10));

/**
 * Where we are right now, and what there is to draw along: the route and how
 * far along it we and the ghost are, the way it runs here, and the reading
 * from the run once the ghost has started. With a pace ghost on no route,
 * `standIn` says the route is only a straight line the way we are going.
 */
function position() {
  const c = state.course;
  if (!c.any) {
    if (state.session) {
      const r = state.session.at(state.source.elapsed());
      return r && { route: c.route, dist: r.routeDist, ghostDist: r.ghostDist, speed: r.speed, offRoute: r.offRoute, reading: r, bearing: bearingOn(c.route, r.routeDist), label: c.label, standIn: false };
    }
    const p = state.tracker?.at(seconds());
    return p && { route: c.route, dist: p.dist, ghostDist: null, speed: Math.max(0, p.speed), offRoute: p.offRoute, reading: null, bearing: bearingOn(c.route, p.dist), label: c.label, standIn: false };
  }
  const r = state.session ? state.session.at(state.source.elapsed()) : null;
  if (!state.lastFix || (state.session && !r)) return null;
  const taken = r && r.racing === 'recording' && r.routeDist != null ? c.tracks[r.track] : null;
  if (taken) {
    // On the route of a saved run: its ghost has taken over, and there is a real route to draw along.
    return { route: taken.route, dist: r.routeDist, ghostDist: r.ghostDist, speed: r.speed, offRoute: false, reading: r, bearing: bearingOn(taken.route, r.routeDist), label: taken.label, standIn: false };
  }
  const bearing = state.wayShown ?? state.way.at().bearing ?? 0;
  const lead = r ? -r.distGap : 0; // metres the ghost is ahead
  const { route, at } = straightAhead(state.lastFix, bearing, { behind: 30, ahead: Math.max(400, lead + 60) });
  return { route, dist: at, ghostDist: r ? at + lead : null, speed: r ? r.speed : 0, offRoute: false, reading: r, bearing, label: c.label, standIn: true };
}

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
  // the way of travel supplies north; so once seen, it is the one the
  // heading is kept by. The compass-tied kind is kept for one thing: it
  // alone says which way round the device is (see lineUp). It is written
  // down too, ten times a second, so that a recording shows how good the
  // compass was.
  const compass = event.absolute ? event.alpha : event.webkitCompassHeading != null ? 360 - event.webkitCompassHeading : null;
  if (compass != null) {
    const now = seconds();
    const written = state.north && now - state.north.written < 0.1 ? state.north.written : now;
    if (written === now) record('a', [compass, 2], [event.beta, 2], [event.gamma, 2]);
    state.north = { axes: deviceAxes(compass, event.beta, event.gamma), at: now, written };
  }
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

/** On each fix while moving: the way we are going says where north is. */
function learnFromTravel() {
  const here = position();
  if (!here) return;
  // On a route, the route says which way we are going. On none, GPS does, while we are under way.
  const way = state.way.at(seconds());
  const going = here.standIn ? (way.moving ? way.bearing : null) : here.offRoute ? null : here.bearing;
  if (state.axes && going != null) state.anchor.travel(going, here.speed, seconds());
  const kept = state.anchor.at(seconds());
  record('h', [kept?.yaw, 2], [kept?.offset, 2], [going ?? here.bearing, 2], [here.reading ? here.reading.distance : here.dist, 1], [here.speed, 2], [here.ghostDist == null ? null : here.ghostDist - here.dist, 1]);
}

/**
 * The wearer is looking level along the way they are going, and says so.
 * That fixes how the device sits on the head and which way is which, both
 * at once. On a route it can be done standing at the start. With no route
 * there is nothing to line up to until the runner is under way, so a tap
 * before then only starts the ghost, and the lining up follows by itself.
 */
async function lineUp() {
  await askForSensors();
  const here = state.course && position();
  if (!here) return;
  if (!here.standIn) lineUpTo(here.bearing);
  else if (state.way.at(seconds()).settled) lineUpTo(state.way.at().bearing);
  if (!state.session) startGhost();
}

function lineUpTo(bearing) {
  if (state.axes) {
    // How the device sits is two things. Which way is up, any reading gives.
    // Which way round it is, only a compass-tied reading gives: the other
    // kind measures heading from wherever it happened to start, so "facing
    // 20 degrees" would pick out the wrong part of the device, and a nod of
    // the head would be drawn as part nod, part tilt. A compass some degrees
    // out does little harm to that. With no compass-tied reading at all, the
    // heading is still kept rightly; only nods and tilts are mixed.
    const northed = state.north && seconds() - state.north.at < 2;
    state.mount = mountFrom(northed ? state.north.axes : state.axes, bearing);
    state.head = headPose(state.axes, state.mount);
    state.anchor = createTravelAnchor();
    state.anchor.orientation(wrap(state.head.yaw / RAD), seconds());
    state.anchor.set(bearing, seconds());
  }
  state.look = 0;
  set('trim', 0);
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
  // With no route, the sensors are not believed until they have been lined up: there is nothing else to say which way round the device is.
  if (state.axes && state.head && (state.mount || !here.standIn)) {
    const kept = state.anchor.at(seconds());
    return { yaw: (kept.yaw + state.settings.trim) * RAD, pitch: state.head.pitch + state.settings.lift * RAD, roll: state.head.roll };
  }
  // No sensors (a desk, or the sample run): look along the path, and let a drag turn the head.
  const along = here.bearing * RAD;
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
  const c = state.course;
  if (!c || state.session) return;
  state.session = createRunSession({ ghost: c.any ? { kind: 'pace', secondsPerKm: c.secondsPerKm, tracks: c.tracks } : { kind: 'track', route: c.route, profile: c.profile } });
  state.source.begin();
  if (!state.demo && state.lastFix && performance.now() - state.lastFix.at < 3000) {
    state.session.update({ lat: state.lastFix.lat, lon: state.lastFix.lon, accuracy: state.lastFix.accuracy, t: 0 });
  }
  if ($('record').checked) beginLog('ghost run');
  $('go').textContent = 'Stop the ghost';
  keepAwake();
}

function stopGhost() {
  wakeLock?.release().catch(() => {});
  setCourse();
  keepLog();
  showLog();
}

// -------------------------------------------------------------- recording --

// What the motion sensors and GPS report, written down as it arrives, to
// test the heading work against a real head. It is kept in the page and,
// every few seconds, copied into the browser's storage, so that a reload or
// a dropped tab part-way through a run loses a few seconds and not the run.

const HEADER = '# kind,seconds,then by kind: o alpha,beta,gamma,absolute | a alpha,beta,gamma by the compass | m ax,ay,az (gravity included, m/s2),turn rates alpha,beta,gamma (deg/s) | g lat,lon,accuracy,heading by GPS,speed by GPS,altitude,age of fix (ms) | h heading shown,offset taken off,route bearing,metres along,speed,ghost lead';

/** Start writing down, or carry on from where an earlier start in this visit left off. */
function beginLog(why) {
  state.log ??= { began: seconds(), rows: [HEADER], written: 0 };
  state.log.rows.push(`# ${why} started ${new Date().toISOString()} on ${navigator.userAgent}`);
  showLog();
}

/** One line of the recording: a kind, then values each with the decimal places worth keeping. */
function record(kind, ...values) {
  const log = state.log;
  if (!log || !(state.session || state.test)) return;
  const t = seconds() - log.began;
  if (t > LOG_LIMIT) return;
  log.rows.push(`${kind},${t.toFixed(3)},${values.map(([v, places]) => (v == null || Number.isNaN(v) ? '' : Number(v).toFixed(places))).join(',')}`);
}

/** The browser's own store for the recording: one entry for each few seconds written down. */
let opened = null;
async function store(mode) {
  opened ??= new Promise((resolve, reject) => {
    const open = indexedDB.open('sportshud-head', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('rows', { autoIncrement: true });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
  return (await opened).transaction('rows', mode).objectStore('rows');
}
const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** Copy what has been written down since last time into the browser's storage. */
async function keepLog() {
  const log = state.log;
  if (!log || log.written >= log.rows.length) return;
  const fresh = log.rows.slice(log.written);
  try {
    await done((await store('readwrite')).add(fresh.join('\n')));
    log.written += fresh.length;
  } catch {
    // No storage here: the recording lives in the page alone, and a reload would lose it.
  }
}

/** Everything written down: this visit's, or failing that what an earlier visit left in storage. */
async function wholeLog() {
  await keepLog();
  try {
    const parts = await done((await store('readonly')).getAll());
    if (parts.length) return parts.join('\n') + '\n';
  } catch {
    // Fall through to what the page holds.
  }
  return state.log ? state.log.rows.join('\n') + '\n' : '';
}

async function saveLog() {
  const text = await wholeLog();
  if (!text) return;
  // Squeezed where the browser can: a ten-minute run is a few megabytes otherwise.
  let blob = new Blob([text], { type: 'text/csv' });
  let name = `sportshud-head-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  if (window.CompressionStream) {
    blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    name += '.gz';
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

async function clearLog() {
  if (state.session || state.test) return;
  state.log = null;
  state.kept = 0;
  try {
    await done((await store('readwrite')).clear());
  } catch {
    // Nothing was stored.
  }
  showLog();
}

function showLog() {
  const readings = state.log ? state.log.rows.filter((row) => row[0] !== '#').length : state.kept;
  const busy = Boolean(state.session || state.test);
  $('saveLog').disabled = !readings;
  $('clearLog').disabled = !readings || busy;
  $('test').disabled = Boolean(state.session);
  const note = !readings ? '' : state.log ? `${readings.toLocaleString()} readings written down${busy ? ' so far' : ''}.` : 'A recording from an earlier visit is kept here. Download it; a new one would be added to the end of it.';
  if ($('logNote').textContent !== note) $('logNote').textContent = note;
}

/** A head test: record and nothing else, with the screen dark and deaf to touches until two fingers hold it. */
async function startTest(why = 'head test') {
  if (state.session || state.test) return;
  await askForSensors();
  if (!state.source) openSource();
  beginLog(why);
  state.test = { began: seconds() };
  stillTesting();
  wear(true);
  showLog();
}

function endTest() {
  if (!state.test) return;
  state.test = null;
  stillTesting();
  keepLog();
  wear(false);
  showLog();
}

// A note of when a head test was last seen running. If the page comes back
// within a few minutes of one, the browser dropped it mid-run with nobody
// able to see: it carries on by itself.
const TESTING_KEY = 'sportshud.headtest';
function stillTesting() {
  try {
    if (state.test) localStorage.setItem(TESTING_KEY, String(Date.now()));
    else localStorage.removeItem(TESTING_KEY);
  } catch {
    // No storage: a dropped page then has to be started again by hand.
  }
}
function wasTesting() {
  try {
    return Date.now() - Number(localStorage.getItem(TESTING_KEY)) < 3 * 60 * 1000;
  } catch {
    return false;
  }
}

/** Touches are ignored while worn if asked, and always during a head test: a strap or a wet forehead taps too. */
const guarded = () => state.worn && (Boolean(state.test) || state.settings.guard);

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
  if (state.test) {
    // Nobody is looking at it: a few dim words for whoever picks it up.
    const holding = state.hold ? Math.min(1, (performance.now() - state.hold) / HOLD) : 0;
    ctx.fillStyle = '#555';
    ctx.textAlign = 'center';
    ctx.font = `500 ${22 * scale}px system-ui, sans-serif`;
    ctx.fillText(`Head test · ${clock(seconds() - state.test.began)} · ${(state.log.rows.length - 1).toLocaleString()} readings`, W / 2, H / 2 - 16 * scale);
    ctx.font = `400 ${15 * scale}px system-ui, sans-serif`;
    ctx.fillText(state.gpsError ?? (state.lastFix ? `GPS good to ${Math.round(state.lastFix.accuracy)} m` : 'Waiting for GPS…') + (state.axes ? '' : ' · no motion readings yet'), W / 2, H / 2 + 14 * scale);
    ctx.fillText(holding ? 'Keep holding…' : 'To finish: hold two fingers here for two seconds', W / 2, H / 2 + 40 * scale);
    if (holding) ctx.fillRect(W * 0.3, H / 2 + 54 * scale, W * 0.4 * holding, 4 * scale);
    if (holding >= 1) {
      state.hold = null;
      endTest();
    }
    notice(null);
    requestAnimationFrame(frame);
    return;
  }
  if (state.hold && performance.now() - state.hold >= HOLD) {
    state.hold = null;
    wear(false);
  }
  // The way of travel as drawn follows the way of travel as measured a little behind, smoothly.
  const way = state.way.at(seconds());
  if (way.bearing != null) state.wayShown = state.wayShown == null ? way.bearing : wrap(state.wayShown + turnTo(state.wayShown, way.bearing) * 0.1);
  const here = state.course && position();
  state.here = here; // for tests and the console: what was drawn from
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
    const lead = here.ghostDist == null ? 0 : here.ghostDist - here.dist;
    for (const side of pair ? [-1, 1] : [0]) {
      drawScene(eyeCtx, w, H, here.route, {
        dist: here.dist,
        ...pose,
        fov: settings.fov,
        unit: w / 520,
        world: false,
        eye: (side * EYES_APART) / 2,
        ghostDist: here.ghostDist,
        timeGap: r ? r.timeGap : 0,
        speed: here.speed,
        time: r ? r.time : 0,
        distance: r ? r.distance : 0,
        paused: r ? r.paused : false,
        ghostLabel: here.label,
        style: 'anchored',
        display: null,
        markerEvery: 500,
        // A pace ghost has no route of its own to mark: the gates count the runner's own distance.
        gates: state.course.any ? ownGates(here) : undefined,
        // And on no route at all, the line is only the way the runner is going: draw it as far as the ghost, not as if it knew the road.
        lineTo: here.standIn ? clamp(lead, 15, 60) : undefined,
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
    if (!state.session) tips.push(!state.axes ? 'Tap to start the ghost.' : state.course.any ? 'Tap to start the ghost, then set off looking where you are going: it lines up by itself after a few seconds.' : 'Stand on the route and look level along it, then tap.');
    else if (state.axes && !state.mount) tips.push(state.course.any ? 'Lining up as you set off: look where you are going.' : 'Look level along the route, then tap.');
    notice(tips.join(' ') || null);
  }
  showStatus(here);
  requestAnimationFrame(frame);
}

/**
 * Gates for a ghost that has no route of its own: one at each half kilometre
 * of the runner's own distance, placed that far ahead. On a straight
 * stand-in only the near ones are shown, since the road may not go that way.
 */
function ownGates(here) {
  const r = here.reading;
  if (!r) return [];
  const gates = [];
  for (let mark = Math.ceil((r.distance + 2) / 500) * 500, n = 0; n < 2; mark += 500, n++) {
    const away = mark - r.distance;
    if (here.standIn && away > 150) break;
    gates.push({ d: here.dist + away, label: mark % 1000 === 0 ? `${mark / 1000} km` : `${(mark / 1000).toFixed(1)} km`, major: mark % 1000 === 0 });
  }
  return gates;
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
  const r = here?.reading;
  if (here && !state.course.any) parts.push(`${Math.round(here.dist)} m along the route.`);
  else if (r) parts.push(`${km(r.distance)} km run. ${here.standIn ? 'On no saved route: the ghost is placed the way you are going.' : `On the route of a saved run: ${here.label} has taken over.`}`);
  if (r) parts.push(Math.abs(r.timeGap) < 0.5 ? 'Level with the ghost.' : `${Math.round(Math.abs(r.timeGap))} s ${r.timeGap > 0 ? 'ahead of' : 'behind'} the ghost.`);
  if (state.log && state.session) parts.push(`Recording: ${(state.log.rows.length - 1).toLocaleString()} readings.`);
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
  if (name === 'mirror' || name === 'upturn' || name === 'guard') $(name).checked = Boolean(value);
  saveSettings('ar', state.settings);
}

async function wear(on) {
  state.worn = on;
  state.hold = null;
  document.body.classList.toggle('worn', on);
  $('leave').hidden = !on || guarded();
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
  const sample = ['run', 'ride', 'walk', 'shared'].includes(params.get('demo')) ? params.get('demo') : null;
  // "ghost=pace" is the pace ghost on any route; "ghost=along" a pace along a saved run's route.
  const asked = { pace: 'any', along: 'along', run: 'run' }[params.get('ghost')] ?? null;
  if (sample) {
    try {
      const { mine, theirs } = await loadSample(sample);
      state.demo = { fixes: fixesOf(mine), speed: clamp(Number(params.get('speed')) || 5, 1, 30) };
      // A plain sample with the pace ghost stands for a first run, anywhere: nothing saved to go by.
      // The "shared" sample has a saved run whose route today's run joins and leaves.
      if (asked !== 'any' || sample === 'shared') state.runs = [theirs, ...state.runs];
    } catch (error) {
      notice(`Could not load the sample run: ${error.message}`);
    }
  }
  // With nothing saved, the pace ghost is the one that works anywhere, at once.
  $('ghostKind').value = asked ?? (sample === 'shared' || !state.runs.length ? 'any' : 'run');
  if (parsePace(params.get('pace') ?? '')) $('ghostPace').value = params.get('pace');
  for (const name of Object.keys(RANGES)) set(name, state.settings[name]);
  for (const name of ['layout', 'mirror', 'upturn', 'guard']) set(name, state.settings[name]);
  listRuns();
  setCourse();
  openLink();
  // A recording left by an earlier visit, a reload part-way through a run say, is still there to download.
  try {
    state.kept = (await done((await store('readonly')).getAll())).reduce((sum, part) => sum + part.split('\n').filter((row) => row[0] !== '#').length, 0);
  } catch {
    state.kept = 0;
  }
  showLog();
  setInterval(() => {
    keepLog();
    showLog();
    if (state.test) stillTesting();
  }, 5000);
  if (wasTesting()) startTest('head test carried on after the page was dropped');

  $('wear').addEventListener('click', () => wear(true));
  $('leave').addEventListener('click', () => wear(false));
  $('go').addEventListener('click', () => (state.session ? stopGhost() : lineUp()));
  $('run').addEventListener('change', setCourse);
  $('ghostKind').addEventListener('change', setCourse);
  $('ghostPace').addEventListener('change', setCourse);
  $('import').addEventListener('change', (event) => importGpx(event.target));
  for (const name of Object.keys(RANGES)) $(name).addEventListener('input', (event) => set(name, Number(event.target.value)));
  $('layout').addEventListener('change', (event) => set('layout', event.target.value));
  for (const name of ['mirror', 'upturn', 'guard']) $(name).addEventListener('change', (event) => set(name, event.target.checked));
  $('saveLog').addEventListener('click', saveLog);
  $('clearLog').addEventListener('click', clearLog);
  $('test').addEventListener('click', () => startTest());
  window.addEventListener('hashchange', openLink);
  document.addEventListener('fullscreenchange', () => {
    // Leaving full screen stops the wearing, except in a head test, which only two fingers end.
    if (!document.fullscreenElement && state.worn && !state.test) wear(false);
  });
  window.addEventListener('pagehide', keepLog);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (state.session || state.worn)) keepAwake();
  });

  window.addEventListener('deviceorientation', onOrientation);
  window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('devicemotion', onMotion);

  // Five keys, as glasses or a small remote have: Enter lines up, the arrows nudge the picture.
  document.addEventListener('keydown', (event) => {
    if (event.target.closest('#controls') && !state.worn) return;
    if (state.test) return;
    const nudge = { ArrowLeft: ['trim', -1], ArrowRight: ['trim', 1], ArrowUp: ['lift', 1], ArrowDown: ['lift', -1] }[event.key];
    if (event.key === 'Enter') lineUp();
    else if (nudge) set(nudge[0], state.settings[nudge[0]] + nudge[1]);
    else return;
    event.preventDefault();
  });
  // A tap lines up. With no sensors, a drag turns the head instead.
  let down = null;
  const fingers = new Set();
  const lifted = (event) => {
    fingers.delete(event.pointerId);
    state.hold = null;
  };
  canvas.addEventListener('pointerdown', (event) => {
    fingers.add(event.pointerId);
    if (guarded()) {
      // Deaf to touches, but for two fingers held down.
      state.hold = fingers.size === 2 ? performance.now() : null;
      return;
    }
    down = { x: event.clientX, y: event.clientY, look: state.look, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', lifted);
  canvas.addEventListener('pointercancel', lifted);
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
