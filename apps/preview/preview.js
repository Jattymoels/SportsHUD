// Through the glasses: replays a recording from the runner's eyes and draws
// what the glasses would add. All positions and gaps come from engine/; the
// picture is drawn in scene.js.

import {
  parseGpx,
  buildRoute,
  projectRecording,
  distAtTime,
  checkB1,
  checkPace,
  buildGuide,
  nextCue,
} from '../../engine/index.js';
import { drawScene, steady, VIEW_FOV } from './scene.js';
import { clock } from '../ghost/hud.js';

const FIXTURES = new URL('../../fixtures/', import.meta.url);
const SPEEDS = [1, 2, 5, 10, 20];
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, f) => a + (b - a) * f;

const state = {
  pairs: [],
  custom: { ghost: null, runner: null },
  loaded: null, // the recordings in use
  run: null, // { route, duration, ghostLabel, at(t) }
  time: 0,
  playing: false,
  speed: 5,
  lastFrame: null,
  gaze: null, // where the runner is looking, radians clockwise from north
  look: 0, // how far the head is turned from the path, radians
};

function parsePace(text) {
  const match = /^\s*(\d{1,2})(?::([0-5]\d))?\s*$/.exec(text);
  const seconds = match ? Number(match[1]) * 60 + Number(match[2] ?? 0) : 0;
  return seconds >= 60 && seconds <= 1800 ? seconds : null;
}

function showMessage(text) {
  $('message').textContent = text ?? '';
  $('message').hidden = !text;
}

// ------------------------------------------------------------------ a run --

/** One-second readings, read at any moment by blending the two either side. */
function between(live, t, fields) {
  const i = clamp(Math.floor(t), 0, live.length - 1);
  const j = Math.min(i + 1, live.length - 1);
  const f = clamp(t - i, 0, 1);
  const out = { ...live[i] };
  for (const field of fields) out[field] = lerp(live[i][field], live[j][field], f);
  return out;
}

function prepare(ghostRecording, runnerRecording) {
  if ($('ghostMode').value === 'pace') {
    const secondsPerKm = parsePace($('ghostPace').value);
    if (!secondsPerKm) throw new Error('Enter the ghost\'s pace as minutes:seconds per km, for example 5:30.');
    const check = checkPace(runnerRecording, secondsPerKm);
    // No ghost route: the runner's own track is the path, and the ghost is on it.
    const route = buildRoute(check.runnerFixes);
    const own = projectRecording(route, check.runnerFixes);
    return {
      route,
      duration: check.runnerFixes[check.runnerFixes.length - 1].t,
      ghostLabel: `ghost ${clock(secondsPerKm)} /km`,
      at(t) {
        const r = between(check.live, t, ['timeGap', 'distGap', 'speed', 'time', 'dist']);
        const dist = distAtTime(own, t);
        return { ...r, dist, distance: r.dist, ghostDist: clamp(dist - r.distGap, 0, route.length) };
      },
    };
  }
  if (!ghostRecording) throw new Error('Choose a Ghost GPX, or switch the ghost to a set pace.');
  const check = checkB1(ghostRecording, runnerRecording);
  return {
    route: check.route,
    duration: check.runnerFixes[check.runnerFixes.length - 1].t,
    ghostLabel: 'ghost: past run',
    at(t) {
      const r = between(check.live, t, ['timeGap', 'dist', 'ghostDist', 'speed', 'time']);
      return { ...r, distance: r.dist };
    },
  };
}

function start(ghostRecording, runnerRecording) {
  try {
    state.run = prepare(ghostRecording, runnerRecording);
  } catch (error) {
    showMessage(error.message);
    return;
  }
  showMessage(null);
  state.loaded = { ghost: ghostRecording, runner: runnerRecording };
  // What the two recordings say about the route: its turns, where they
  // waited, its climbs. The recording that draws the path goes first.
  const pathFirst = $('ghostMode').value === 'pace' ? [runnerRecording, ghostRecording] : [ghostRecording, runnerRecording];
  try {
    state.run.guide = buildGuide(pathFirst.filter(Boolean));
    state.run.features = state.run.guide.features.filter((f) => ['turn', 'wait', 'climb'].includes(f.kind));
  } catch {
    state.run.guide = null;
    state.run.features = [];
  }
  state.time = 0;
  state.gaze = null;
  state.look = 0;
  $('scrub').max = Math.floor(state.run.duration);
}

function restart() {
  const recordings = state.loaded ?? state.custom;
  if (recordings.runner) start(recordings.ghost, recordings.runner);
}

async function fetchRecording(path) {
  const response = await fetch(new URL(path, FIXTURES));
  if (!response.ok) throw new Error(`Could not load fixtures/${path} (${response.status})`);
  return parseGpx(await response.text());
}

async function loadPair(id) {
  const pair = state.pairs.find((p) => p.id === id);
  if (!pair) return;
  try {
    const [ghost, runner] = await Promise.all([fetchRecording(pair.ghost), fetchRecording(pair.runner)]);
    start(ghost, runner);
  } catch (error) {
    showMessage(error.message);
  }
}

async function chooseFile(role, input) {
  const file = input.files[0];
  if (!file) return;
  try {
    state.custom[role] = parseGpx(await file.text());
  } catch (error) {
    showMessage(`${file.name}: ${error.message}`);
    return;
  }
  if (!state.custom.runner) return showMessage(`Loaded ${file.name}. Now choose your recording.`);
  if ($('ghostMode').value === 'track' && !state.custom.ghost) return showMessage(`Loaded ${file.name}. Now choose the ghost recording.`);
  const select = $('pair');
  if (![...select.options].some((o) => o.value === 'custom')) select.add(new Option('Your files', 'custom'));
  select.value = 'custom';
  start(state.custom.ghost, state.custom.runner);
}

// ---------------------------------------------------------------- drawing --

const canvas = $('view');
const ctx = canvas.getContext('2d');

/** The direction of the path a little way ahead of `dist`, radians clockwise from north. */
function pathHeading(route, dist) {
  const from = steady(route, Math.min(dist, route.length - 2));
  const to = steady(route, Math.min(route.length, dist + 12));
  return Math.atan2(to.x - from.x, to.y - from.y);
}

function frame(now) {
  const wall = state.lastFrame == null ? 0 : Math.min(0.25, (now - state.lastFrame) / 1000);
  state.lastFrame = now;
  if (state.run) {
    if (state.playing) {
      state.time = Math.min(state.run.duration, state.time + wall * state.speed);
      if (state.time >= state.run.duration) state.playing = false;
    }
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(canvas.clientWidth * scale);
    const H = Math.round(canvas.clientHeight * scale);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const { route } = state.run;
    const r = state.run.at(state.time);
    // The runner looks where the path goes; the gaze follows smoothly.
    const heading = pathHeading(route, r.dist);
    if (state.gaze == null) state.gaze = heading;
    const turn = Math.atan2(Math.sin(heading - state.gaze), Math.cos(heading - state.gaze));
    state.gaze += turn * Math.min(1, wall * 5 + (state.playing ? 0 : 1));
    const display = $('display').value ? $('display').value.split(',').map(Number) : null;
    drawScene(ctx, W, H, route, {
      dist: r.dist,
      yaw: state.gaze + state.look,
      ghostDist: r.ghostDist,
      timeGap: r.timeGap,
      speed: Math.max(0, r.speed),
      time: r.time,
      distance: r.distance,
      paused: r.paused,
      ghostLabel: state.run.ghostLabel,
      style: $('style').value,
      display: display && { w: display[0], h: display[1] },
      markerEvery: 500,
      features: $('guide').checked ? state.run.features : [],
      cue: $('guide').checked && state.run.guide ? nextCue(state.run.guide, r.dist) : null,
    });
    $('scrub').value = Math.floor(state.time);
    $('clock').textContent = `${clock(state.time)} / ${clock(state.run.duration)}`;
    $('play').textContent = state.playing ? 'Pause' : 'Play';
  }
  requestAnimationFrame(frame);
}

function caption() {
  const anchored = $('style').value === 'anchored';
  const small = $('display').value === '14,14';
  $('caption').textContent = anchored
    ? `The ghost, the line, the distance gates and the signs for turns, waits and climbs are placed in the world: turn your head and they stay where they are. This is the direction, and needs glasses that know where the road is.${small ? ' At this size most of it falls outside the display, which is why the arrows at its edge matter.' : ''}`
    : 'A heads-up square: it stays fixed in your view as you turn your head. This is what today\'s Ray-Ban Display can show.';
}

// ---------------------------------------------------------------- wiring --

function setPlaying(playing) {
  if (!state.run) return;
  if (playing && state.time >= state.run.duration) state.time = 0;
  state.playing = playing;
}

function setSpeed(speed) {
  state.speed = speed;
  $('speed').value = String(speed);
}

async function init() {
  const params = new URLSearchParams(location.search);
  for (const speed of SPEEDS) $('speed').add(new Option(speed === 1 ? '1× (real time)' : `${speed}×`, String(speed)));
  setSpeed(SPEEDS.includes(Number(params.get('speed'))) ? Number(params.get('speed')) : 5);
  if (params.get('style') === 'square') $('style').value = 'square';
  if ([...$('display').options].some((o) => o.value === params.get('display'))) $('display').value = params.get('display');
  if (params.get('ghost') === 'pace') $('ghostMode').value = 'pace';
  if (parsePace(params.get('pace') ?? '')) $('ghostPace').value = params.get('pace');
  $('paceBox').hidden = $('ghostMode').value !== 'pace';
  caption();

  $('play').addEventListener('click', () => setPlaying(!state.playing));
  $('speed').addEventListener('change', (event) => setSpeed(Number(event.target.value)));
  $('scrub').addEventListener('input', (event) => {
    state.time = Number(event.target.value);
    state.gaze = null;
  });
  $('ahead').addEventListener('click', () => (state.look = 0));
  $('style').addEventListener('change', caption);
  $('display').addEventListener('change', caption);
  $('ghostMode').addEventListener('change', () => {
    $('paceBox').hidden = $('ghostMode').value !== 'pace';
    restart();
  });
  $('ghostPace').addEventListener('change', restart);
  $('pair').addEventListener('change', (event) => {
    if (event.target.value === 'custom') start(state.custom.ghost, state.custom.runner);
    else loadPair(event.target.value);
  });
  $('ghostFile').addEventListener('change', (event) => chooseFile('ghost', event.target));
  $('runnerFile').addEventListener('change', (event) => chooseFile('runner', event.target));

  // Turning your head: drag on the picture, or the left and right keys.
  let drag = null;
  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, look: state.look };
    canvas.setPointerCapture(event.pointerId);
    document.activeElement?.blur(); // so the arrow keys turn your head, not a menu
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const perPixel = (VIEW_FOV * Math.PI) / 180 / canvas.clientWidth;
    state.look = clamp(drag.look - (event.clientX - drag.x) * perPixel, -Math.PI, Math.PI);
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('pointercancel', () => (drag = null));
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target.closest('input, select, textarea')) return;
    const activates = event.key === 'Enter' || event.key === ' ';
    if (activates && event.target.closest('button, a')) return;
    if (activates) setPlaying(!state.playing);
    else if (event.key === 'ArrowLeft') state.look = clamp(state.look - (5 * Math.PI) / 180, -Math.PI, Math.PI);
    else if (event.key === 'ArrowRight') state.look = clamp(state.look + (5 * Math.PI) / 180, -Math.PI, Math.PI);
    else return;
    event.preventDefault();
  });

  requestAnimationFrame(frame);

  try {
    const response = await fetch(new URL('index.json', FIXTURES));
    if (!response.ok) throw new Error(`Could not load fixtures/index.json (${response.status})`);
    state.pairs = (await response.json()).pairs;
  } catch (error) {
    showMessage(`${error.message}. You can still load GPX files of your own.`);
    return;
  }
  for (const pair of state.pairs) $('pair').add(new Option(pair.label, pair.id));
  const wanted = state.pairs.some((p) => p.id === params.get('pair')) ? params.get('pair') : state.pairs[0]?.id;
  if (wanted) {
    $('pair').value = wanted;
    await loadPair(wanted);
    if (params.get('t')) state.time = clamp(Number(params.get('t')) || 0, 0, state.run?.duration ?? 0);
    if (params.get('play') === '1') setPlaying(true);
  }
}

// For tests and for poking at from the console.
window.sportshud = state;

init();
