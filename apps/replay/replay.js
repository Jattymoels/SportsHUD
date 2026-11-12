// Desk replay harness. Every number shown here comes from engine/; this file
// only loads recordings, runs the clock and draws.

import {
  parseGpx,
  buildRoute,
  pointAtDistance,
  createGapTracker,
  createPaceTracker,
  createSegmentTracker,
  paceOf,
  createReplay,
  checkB1,
  checkPace,
  checkSegments,
} from '../../engine/index.js';

const FIXTURES = new URL('../../fixtures/', import.meta.url);
const SPEEDS = [1, 2, 5, 10, 30, 60];
const SVG = 'http://www.w3.org/2000/svg';
const MINUS = '−';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function svgEl(name, attrs = {}, parent = null, text = null) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

const state = {
  pairs: [],
  custom: { ghost: null, runner: null },
  pair: null, // the fixture pair on screen, if it is one
  loaded: null, // the recordings on screen, kept so the clock or the ghost can be switched
  check: null, // the engine's check for what is loaded (route, whole-recording series, stats)
  replay: null,
  live: [], // one-second readings produced so far by the replay on screen
  time: 0, // seconds into the replayed recording
  playing: false,
  speed: 10,
  lastFrame: null,
  map: null,
  chart: null,
  tableBuilt: false,
};

// ------------------------------------------------------------ formatting --

function clock(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
const signed = (value, digits) => (value < 0 ? MINUS : '+') + Math.abs(value).toFixed(digits);
const percent = (share) => (100 * share).toFixed(1) + '%';

/** "5:30" (or "5") as seconds per km; null if it is not a pace. */
function parsePace(text) {
  const match = /^\s*(\d{1,2})(?::([0-5]\d))?\s*$/.exec(text);
  const seconds = match ? Number(match[1]) * 60 + Number(match[2] ?? 0) : 0;
  return seconds >= 60 && seconds <= 1800 ? seconds : null;
}
const formatPace = (secondsPerKm) => clock(Math.round(secondsPerKm));

// --------------------------------------------------------------- loading --

function showMessage(text) {
  $('message').textContent = text ?? '';
  $('message').hidden = !text;
}

async function fetchRecording(path) {
  const response = await fetch(new URL(path, FIXTURES));
  if (!response.ok) throw new Error(`Could not load fixtures/${path} (${response.status})`);
  return parseGpx(await response.text());
}

async function loadPair(id) {
  const pair = state.pairs.find((p) => p.id === id);
  if (!pair) return;
  if (pair.segments) {
    // Two runs that share only part of a route: only live segments makes sense of them.
    $('ghostMode').value = 'segments';
    $('ghostPace').value = formatPace(pair.secondsPerKm);
    showGhostMode();
  }
  state.pair = pair;
  try {
    const [ghost, runner] = await Promise.all([fetchRecording(pair.ghost), fetchRecording(pair.runner)]);
    start(ghost, runner);
  } catch (error) {
    showMessage(error.message);
  }
}

function start(ghostRecording, runnerRecording) {
  const mode = $('ghostMode').value;
  const options = { clock: $('clockMode').value };
  let makeTracker;
  try {
    const secondsPerKm = mode === 'track' ? null : parsePace($('ghostPace').value);
    if (mode !== 'track' && !secondsPerKm) throw new Error('Enter the ghost\'s pace as minutes:seconds per km, for example 5:30.');
    if (mode !== 'pace' && !ghostRecording) throw new Error('Choose a Ghost GPX to race, or switch the ghost to a set pace.');
    if (mode === 'segments') {
      const result = checkSegments([ghostRecording], runnerRecording, secondsPerKm, options);
      // Drawn on the runner's own track, with the ghost's route laid under it.
      state.check = { ...result, mode, afterwards: [], route: buildRoute(result.runnerFixes) };
      makeTracker = () => createSegmentTracker({ secondsPerKm, tracks: result.tracks });
    } else if (mode === 'pace') {
      const result = checkPace(runnerRecording, secondsPerKm, options);
      // No ghost route here: draw the runner's own track and put the ghost on it.
      state.check = { ...result, mode, secondsPerKm, route: buildRoute(result.runnerFixes) };
      makeTracker = () => createPaceTracker(result.speed);
    } else {
      const result = checkB1(ghostRecording, runnerRecording, options);
      state.check = { ...result, mode };
      makeTracker = () => createGapTracker(result.route, result.ghost);
    }
  } catch (error) {
    showMessage(error.message);
    return;
  }
  state.loaded = { ghost: ghostRecording, runner: runnerRecording };
  const { runnerFixes, live } = state.check;
  let warning = null;
  if (mode === 'track') {
    // Two recordings of different routes still produce numbers; say so.
    const offsets = live.map((s) => s.offset).sort((a, b) => a - b);
    const typical = offsets[Math.floor(offsets.length / 2)];
    if (typical > 25) warning = `These two recordings are typically ${Math.round(typical)} m apart, so they may not follow the same route. The gap below will not mean much.`;
  }
  showMessage(warning);
  state.replay = createReplay(runnerFixes, makeTracker, { pauses: state.check.pauses });
  state.live = [];
  state.time = 0;
  state.playing = false;
  state.tableBuilt = false;
  $('scrub').max = Math.floor(state.replay.duration);
  $('youKey').textContent = mode === 'track' ? 'You, snapped to the route' : 'You';
  $('trackKey').hidden = mode !== 'segments';
  $('stretchKey').hidden = mode !== 'segments';
  for (const key of document.querySelectorAll('.afterKey')) key.hidden = mode === 'segments';
  $('offsetLabel').textContent = mode === 'segments' ? 'Ghost right now' : 'GPS fix to route';
  buildMap();
  buildChart();
  renderB1();
  if ($('tableBox').open) buildTable();
  seek(0);
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
  const needsGhost = $('ghostMode').value !== 'pace';
  if (!state.custom.runner) {
    showMessage(`Loaded ${file.name}. Now choose your recording.`);
    return;
  }
  if (needsGhost && !state.custom.ghost) {
    showMessage(`Loaded ${file.name}. Now choose the ghost recording.`);
    return;
  }
  const select = $('pair');
  if (![...select.options].some((o) => o.value === 'custom')) select.add(new Option('Your files', 'custom'));
  select.value = 'custom';
  state.pair = null;
  start(state.custom.ghost, state.custom.runner);
}

/** Show the pace controls only when the ghost holds a set pace somewhere. */
function showGhostMode() {
  const pace = $('ghostMode').value !== 'track';
  $('paceBox').hidden = !pace;
  $('usePace').hidden = !pace;
}

function useGhostPace() {
  const recording = state.loaded?.ghost ?? state.custom.ghost;
  if (!recording) {
    showMessage('Choose a Ghost GPX first; its average pace will be used.');
    return;
  }
  try {
    $('ghostPace').value = formatPace(paceOf(recording, { clock: $('clockMode').value }).secondsPerKm);
  } catch (error) {
    showMessage(error.message);
    return;
  }
  restart();
}

/** Run again with the same recordings, after a setting has changed. */
function restart() {
  const recordings = state.loaded ?? state.custom;
  if (recordings.runner) start(recordings.ghost, recordings.runner);
}

// ------------------------------------------------------------------- map --

function buildMap() {
  const { route } = state.check;
  const box = $('map');
  box.replaceChildren();
  const W = Math.max(260, box.clientWidth);
  const H = Math.round(clamp(W * 0.7, 220, 380));
  const pad = 26;
  // Live segments: the routes the recorded ghosts ran, in the map's own frame.
  const under = (state.check.tracks ?? []).map((track) => {
    const xy = [];
    for (let i = 0; i < track.route.x.length; i++) xy.push(route.proj.toXY(...track.route.proj.toLatLon(track.route.x[i], track.route.y[i])));
    return xy;
  });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const include = (x, y) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (let i = 0; i < route.x.length; i++) include(route.x[i], route.y[i]);
  for (const xy of under) for (const [x, y] of xy) include(x, y);
  const scale = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxY - minY || 1));
  const left = (W - (maxX - minX) * scale) / 2;
  const bottom = (H - (maxY - minY) * scale) / 2;
  const toPx = (x, y) => [left + (x - minX) * scale, H - bottom - (y - minY) * scale];

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Map of the route with your position and the ghost' }, box);
  const line = (xy) => xy.map(([x, y]) => toPx(x, y).map((v) => v.toFixed(1)).join(',')).join(' ');
  for (const xy of under) svgEl('polyline', { class: 'route track', points: line(xy) }, svg);
  svgEl('polyline', { class: 'route', points: line(Array.from(route.x, (x, i) => [x, route.y[i]])) }, svg);

  const [sx, sy] = toPx(route.x[0], route.y[0]);
  const [fx, fy] = toPx(route.x[route.x.length - 1], route.y[route.y.length - 1]);
  const together = Math.hypot(fx - sx, fy - sy) < 40;
  const endLabel = (x, y, text) => {
    svgEl('circle', { class: 'end', cx: x, cy: y, r: 4 }, svg);
    const onLeft = x > W - 110;
    svgEl('text', { class: 'label', x: x + (onLeft ? -8 : 8), y: y - 8, 'text-anchor': onLeft ? 'end' : 'start' }, svg, text);
  };
  endLabel(sx, sy, together ? 'Start and finish' : 'Start');
  if (together) svgEl('circle', { class: 'end', cx: fx, cy: fy, r: 4 }, svg);
  else endLabel(fx, fy, 'Finish');

  const scaleBar = niceStep((W / scale) * 0.25);
  svgEl('line', { class: 'zero', x1: 10, x2: 10 + scaleBar * scale, y1: H - 10, y2: H - 10 }, svg);
  svgEl('text', { x: 10, y: H - 15 }, svg, scaleBar >= 1000 ? `${scaleBar / 1000} km` : `${scaleBar} m`);

  state.map = {
    toPx,
    tether: svgEl('line', { class: 'tether' }, svg),
    raw: svgEl('circle', { class: 'marker raw', r: 3.5 }, svg),
    ghost: svgEl('circle', { class: 'marker ghost', r: 6 }, svg),
    you: svgEl('circle', { class: 'marker you', r: 6 }, svg),
  };
}

function drawMap(now) {
  const { route } = state.check;
  const { toPx, tether, raw, ghost, you } = state.map;
  const place = (node, x, y) => {
    const [px, py] = toPx(x, y);
    node.setAttribute('cx', px.toFixed(1));
    node.setAttribute('cy', py.toFixed(1));
    return [px, py];
  };
  const y = pointAtDistance(route, now.dist);
  if (now.ghost === 'recording') {
    // The recorded ghost is on its own route, which may be leaving the runner's.
    const there = pointAtDistance(state.check.tracks[now.track].route, now.ghostDist);
    place(ghost, ...route.proj.toXY(there.lat, there.lon));
  } else {
    const g = pointAtDistance(route, now.ghostDist ?? now.dist - now.distGap);
    place(ghost, g.x, g.y);
  }
  const [yx, yy] = place(you, y.x, y.y);
  const fix = state.replay.lastFix();
  if (fix) {
    const [rx, ry] = place(raw, ...route.proj.toXY(fix.lat, fix.lon));
    tether.setAttribute('x1', rx.toFixed(1));
    tether.setAttribute('y1', ry.toFixed(1));
    tether.setAttribute('x2', yx.toFixed(1));
    tether.setAttribute('y2', yy.toFixed(1));
  }
}

// ----------------------------------------------------------------- chart --

/** A round number near `rough`: 1, 2 or 5 times a power of ten. */
function niceStep(rough) {
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power;
}

function buildChart() {
  const { live, afterwards, stats } = state.check;
  const duration = state.replay.duration;
  const box = $('chart');
  box.replaceChildren();
  const W = Math.max(300, box.clientWidth);
  const H = 280;
  const m = { left: 46, right: 12, top: 10, bottom: 26 };

  let lo = 0;
  let hi = 0;
  for (const s of live) {
    lo = Math.min(lo, s.timeGap);
    hi = Math.max(hi, s.timeGap);
  }
  for (const s of afterwards) {
    lo = Math.min(lo, s.timeGap - stats.targetS);
    hi = Math.max(hi, s.timeGap + stats.targetS);
  }
  const room = 0.06 * (hi - lo || 1);
  lo -= room;
  hi += room;
  const x = (t) => m.left + (t / duration) * (W - m.left - m.right);
  const y = (gap) => m.top + ((hi - gap) / (hi - lo)) * (H - m.top - m.bottom);

  const about = state.check.mode === 'segments' ? 'live readings, shaded where the recorded ghost was being raced' : 'live readings and the gap computed afterwards';
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Time gap to the ghost over the recording: ${about}` }, box);

  const yStep = niceStep((hi - lo) / 5);
  for (let v = Math.ceil(lo / yStep) * yStep; v <= hi; v += yStep) {
    const value = Math.round(v / yStep) * yStep;
    svgEl('line', { class: value === 0 ? 'zero' : 'gridline', x1: m.left, x2: W - m.right, y1: y(value), y2: y(value) }, svg);
    svgEl('text', { x: m.left - 6, y: y(value) + 4, 'text-anchor': 'end' }, svg, value === 0 ? '0' : signed(value, 0));
  }
  const mostLabels = clamp(Math.floor((W - m.left - m.right) / 56), 2, 8);
  const xStep = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200].find((s) => duration / s <= mostLabels) ?? 14400;
  for (let t = 0; t <= duration; t += xStep) {
    const anchor = t === 0 ? 'start' : x(t) > W - m.right - 24 ? 'end' : 'middle';
    svgEl('text', { x: x(t), y: H - 8, 'text-anchor': anchor }, svg, clock(t));
  }

  for (const stretch of state.check.stretches ?? []) {
    svgEl('rect', { class: 'stretch', x: x(stretch.from).toFixed(1), y: m.top, width: Math.max(1, x(stretch.to) - x(stretch.from)).toFixed(1), height: H - m.top - m.bottom }, svg);
  }
  const xy = (s, shift = 0) => `${x(s.t).toFixed(1)},${y(s.timeGap + shift).toFixed(1)}`;
  if (afterwards.length > 1) {
    const upper = afterwards.map((s) => xy(s, stats.targetS));
    const lower = afterwards.map((s) => xy(s, -stats.targetS)).reverse();
    svgEl('polygon', { class: 'band', points: [...upper, ...lower].join(' ') }, svg);
    svgEl('polyline', { class: 'series after', points: afterwards.map((s) => xy(s)).join(' ') }, svg);
  }
  const livePath = svgEl('polyline', { class: 'series you' }, svg);
  const playhead = svgEl('line', { class: 'playhead', y1: m.top, y2: H - m.bottom }, svg);
  const cross = svgEl('line', { class: 'cross', y1: m.top, y2: H - m.bottom, visibility: 'hidden' }, svg);

  const timeAt = (event) => {
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    return clamp(Math.round(((px - m.left) / (W - m.left - m.right)) * duration), 0, Math.floor(duration));
  };
  svg.addEventListener('pointermove', (event) => showTip(event, timeAt(event)));
  svg.addEventListener('pointerleave', hideTip);
  svg.addEventListener('click', (event) => seek(timeAt(event)));

  state.chart = { x, xy, livePath, playhead, cross, drawn: -1 };
}

function drawChart() {
  const chart = state.chart;
  if (chart.drawn !== state.live.length) {
    chart.livePath.setAttribute('points', state.live.map((s) => chart.xy(s)).join(' '));
    chart.drawn = state.live.length;
  }
  const px = chart.x(state.time).toFixed(1);
  chart.playhead.setAttribute('x1', px);
  chart.playhead.setAttribute('x2', px);
}

function showTip(event, t) {
  const { afterwards } = state.check;
  const live = state.live[t];
  const after = afterwards[t];
  const px = state.chart.x(t).toFixed(1);
  state.chart.cross.setAttribute('x1', px);
  state.chart.cross.setAttribute('x2', px);
  state.chart.cross.setAttribute('visibility', 'visible');

  const tip = $('tip');
  tip.replaceChildren();
  const row = (keyClass, value, label) => {
    const div = document.createElement('div');
    div.className = 'row';
    if (keyClass) {
      const key = document.createElement('span');
      key.className = `key line ${keyClass}`;
      div.append(key);
    }
    const strong = document.createElement('b');
    strong.textContent = value;
    div.append(strong, ` ${label}`);
    tip.append(div);
  };
  row(null, clock(t), 'into the recording');
  row('you', live ? `${signed(live.timeGap, 1)} s` : 'not played yet', 'live');
  if (state.check.mode === 'segments') {
    const then = state.check.live[t];
    if (then) row(null, then.ghost === 'recording' ? 'The recording' : 'The set pace', 'is the ghost here');
  } else {
    row('after', after ? `${signed(after.timeGap, 1)} s` : 'finished', 'computed afterwards');
    if (live && after) row(null, `${Math.abs(live.timeGap - after.timeGap).toFixed(1)} s`, 'apart');
  }

  tip.hidden = false;
  const card = tip.parentElement.getBoundingClientRect();
  const left = clamp(event.clientX - card.left + 14, 4, card.width - tip.offsetWidth - 4);
  tip.style.left = `${left}px`;
  tip.style.top = `${event.clientY - card.top + 14}px`;
}

function hideTip() {
  $('tip').hidden = true;
  state.chart?.cross.setAttribute('visibility', 'hidden');
}

// ------------------------------------------------------ readout, B1, table --

function drawReadout(reading) {
  const { route } = state.check;
  const gap = reading.timeGap;
  const size = Math.abs(gap);
  $('timeGap').textContent = size < 0.05 ? '0.0 s' : size < 100 ? `${signed(gap, 1)} s` : `${gap < 0 ? MINUS : '+'}${clock(size)}`;
  const side = size < 0.05 ? 'level' : gap > 0 ? 'ahead' : 'behind';
  $('timeGapSide').textContent = reading.finished ? `${side} at the finish` : side;
  $('distGap').textContent = `${signed(reading.distGap, 0)} m`;
  const done = (reading.dist / 1000).toFixed(2);
  $('dist').textContent = state.check.mode === 'track' ? `${done} of ${(route.length / 1000).toFixed(2)} km` : `${done} km`;
  $('speedNow').textContent = `${(Math.max(0, reading.speed) * 3.6).toFixed(1)} km/h`;
  $('pace').textContent = reading.speed > 0.3 ? `${clock(1000 / reading.speed)} /km` : '–';
  if (state.check.mode === 'segments') $('offset').textContent = reading.ghost === 'recording' ? `the recording, ${(reading.routeDist / 1000).toFixed(2)} km along it` : 'the set pace';
  else $('offset').textContent = reading.offset == null ? 'no route' : `${reading.offset.toFixed(1)} m${reading.offRoute ? ' (off route)' : ''}`;
  $('time').textContent = `${clock(reading.time)}${reading.paused ? ' (paused)' : ''}`;
}

const km = (metres) => `${(metres / 1000).toFixed(2)} km`;

function showCheck(title, note, pass, rows) {
  $('checkTitle').textContent = title;
  $('checkNote').textContent = note;
  const chip = $('verdict');
  chip.className = `chip ${pass ? 'pass' : 'fail'}`;
  chip.replaceChildren(pass ? '✓ ' : '✕ ');
  const word = document.createElement('span');
  word.textContent = pass ? 'Pass' : 'Fail';
  chip.append(word);
  const table = $('b1');
  table.replaceChildren();
  for (const [label, value] of rows) {
    const tr = table.insertRow();
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = label;
    tr.append(th);
    tr.insertCell().textContent = value;
  }
}

/** The live segments check (B12): when the ghost changed, and whether the gap jumped. */
function renderSegments() {
  const { stats, switches, stretches, live, secondsPerKm } = state.check;
  const truth = state.pair?.shared;
  const late = (t, trueT, did) => `${Math.abs(t - trueT)} s ${t >= trueT ? 'after' : 'before'} truly ${did} (${clock(trueT)}); `;
  const rows = [
    ['Ghost', `${formatPace(secondsPerKm)} per km, and the Ghost GPX where routes overlap`],
    ['Clock', stats.clock === 'moving' ? `paused time not counted (you ${clock(stats.pausedS.runner)})` : 'never stops'],
    ['Time racing the recording', `${clock(stats.onRecordingS)} of ${clock(live.length * stats.tickS)}, in ${stretches.length} ${stretches.length === 1 ? 'stretch' : 'stretches'}`],
    ['Changes of ghost', String(switches.length)],
    [`Largest jump in the gap at a change of ghost (target: within ${stats.jumpS} s)`, switches.length ? `${stats.maxSwitchJump.toFixed(2)} s` : 'no changes'],
    ['Largest change in the gap in any one second', `${stats.maxStep.toFixed(2)} s`],
    ...switches.slice(0, 12).map((s, i) => {
      const known = truth && switches.length === 2;
      const timing = !known ? '' : i === 0 ? late(s.t, truth.joinS, 'joining') : late(s.t, truth.leaveS, 'leaving');
      const what = s.to === 'recording' ? 'The recording took over' : 'The set pace took over';
      return [`${what} at ${clock(s.t)}, ${km(s.dist)} in`, `${timing}gap ${signed(s.timeGap, 1)} s`];
    }),
    ...(switches.length > 12 ? [['Further changes of ghost', `${switches.length - 12} more; see the readings table`]] : []),
    ['Distance measured', km(stats.distance)],
    ['Holes in your recording (watch paused), filled in for the replay', stats.holes.count ? `${stats.holes.count}, longest ${stats.holes.longestS.toFixed(0)} s` : 'none'],
  ];
  const note = truth
    ? 'The whole recording is replayed in an instant when it loads. This one is made up, so the moments it truly joins and leaves the shared stretch are known; the target is a change of ghost within 5 s of each, with no jump in the gap.'
    : 'The whole recording is replayed in an instant when it loads. The gap must not jump when the ghost changes. Whether each change came soon enough cannot be told from real recordings: nothing says when you truly joined or left the shared ground.';
  showCheck('Live segments check (B12)', note, stats.pass, rows);
}

function renderB1() {
  if (state.check.mode === 'segments') return renderSegments();
  const { stats, live, afterwards, route } = state.check;

  let worstAt = 0;
  for (let i = 0; i < stats.samples; i++) {
    const error = Math.abs(live[i].timeGap - afterwards[i].timeGap);
    if (error > Math.abs(live[worstAt].timeGap - afterwards[worstAt].timeGap)) worstAt = i;
  }
  const count = (n) => `${n.toLocaleString('en')} of ${stats.samples.toLocaleString('en')}`;
  const paceGhost = state.check.mode === 'pace';
  const paused = paceGhost ? `you ${clock(stats.pausedS.runner)}` : `you ${clock(stats.pausedS.runner)}, ghost ${clock(stats.pausedS.ghost)}`;
  const rows = [
    ...(paceGhost ? [['Ghost', `holds ${formatPace(state.check.secondsPerKm)} per km on your route`]] : []),
    ['Clock', stats.clock === 'moving' ? `paused time not counted (${paused})` : 'never stops'],
    [`Live readings within ${stats.targetS} s of the gap computed afterwards, allowing a jump in the gap to land up to ${stats.slackS} s early or late`, `${percent(stats.within)} (${count(stats.samples - stats.misses.length)})`],
    [`Live readings within ${stats.targetS} s at exactly the same instant`, `${percent(stats.withinSameInstant)} (${count(stats.samples - stats.sameInstantMisses.length)})`],
    ['Largest difference at the same instant', `${stats.maxTimeError.toFixed(2)} s, at ${clock(live[worstAt]?.t ?? 0)}`],
    ['Difference that 95% of readings stay under', `${stats.p95TimeError.toFixed(2)} s`],
    ['Largest difference in the distance gap', `${stats.maxDistError.toFixed(1)} m`],
    ['How often a reading is produced', `every ${stats.tickS} s`],
    ['Oldest GPS fix a reading had to work from', `${stats.maxFixAge.toFixed(0)} s`],
    ['Holes in your recording (watch paused), filled in for the replay', stats.holes.count ? `${stats.holes.count}, longest ${stats.holes.longestS.toFixed(0)} s` : 'none'],
    ...(paceGhost
      ? [['Distance measured, live and afterwards', `${km(stats.distance.live)} and ${km(stats.distance.afterwards)}`]]
      : [
          ['Places the ghost stood still', stats.ghostStops.count ? `${stats.ghostStops.count}, longest ${stats.ghostStops.longestS.toFixed(0)} s` : 'none'],
          ["Time you were off the ghost's route, with progress held", `${stats.offRouteS} s`],
          ['Route length, from the ghost recording', km(route.length)],
        ]),
  ];
  showCheck(
    paceGhost ? 'Pace ghost check for this recording' : 'B1 check for this pair',
    'The whole recording is replayed in an instant when it loads. Each one-second live reading is compared with the gap computed afterwards from the complete recording.',
    stats.pass,
    rows,
  );
}

function readingRows() {
  const { live, afterwards } = state.check;
  return live.map((s, i) => {
    const after = afterwards[i];
    return [s.t, s.timeGap, after?.timeGap, s.distGap, after?.distGap, s.dist, s.speed, s.offset, s.fixAge];
  });
}

function buildTable() {
  if (state.tableBuilt || !state.check) return;
  state.tableBuilt = true;
  const table = $('table');
  table.replaceChildren();
  const segments = state.check.mode === 'segments';
  const head = table.createTHead().insertRow();
  for (const title of segments ? ['Time', 'Gap (s)', 'Gap (m)', 'Ghost'] : ['Time', 'Live (s)', 'Afterwards (s)', 'Apart (s)', 'Live (m)', 'Afterwards (m)']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = title;
    head.append(th);
  }
  const body = table.createTBody();
  const cell = (value, digits) => (value == null ? '' : signed(value, digits));
  if (segments) {
    for (const s of state.check.live) {
      const tr = body.insertRow();
      for (const text of [clock(s.t), cell(s.timeGap, 1), cell(s.distGap, 0), s.ghost === 'recording' ? 'recording' : 'set pace']) tr.insertCell().textContent = text;
    }
    return;
  }
  for (const [t, liveGap, afterGap, liveDist, afterDist] of readingRows()) {
    const tr = body.insertRow();
    const cells = [clock(t), cell(liveGap, 1), cell(afterGap, 1), afterGap == null ? '' : Math.abs(liveGap - afterGap).toFixed(1), cell(liveDist, 0), cell(afterDist, 0)];
    for (const text of cells) tr.insertCell().textContent = text;
  }
}

function downloadCsv() {
  const segments = state.check.mode === 'segments';
  const header = segments
    ? 't_s,live_time_gap_s,live_dist_gap_m,dist_m,speed_mps,on_recording,dist_along_recorded_route_m,fix_age_s'
    : 't_s,live_time_gap_s,afterwards_time_gap_s,live_dist_gap_m,afterwards_dist_gap_m,dist_along_route_m,speed_mps,gps_offset_m,fix_age_s';
  const rows = segments
    ? state.check.live.map((s) => [s.t, s.timeGap, s.distGap, s.dist, s.speed, s.ghost === 'recording' ? 1 : 0, s.routeDist, s.fixAge])
    : readingRows();
  const lines = rows.map((row) => row.map((v) => (v == null ? '' : Number(v.toFixed(3)))).join(','));
  const url = URL.createObjectURL(new Blob([[header, ...lines].join('\n') + '\n'], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sportshud-readings.csv';
  link.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------- playback --

function render() {
  if (!state.check) return;
  // The readout shows the latest one-second reading, as a display would.
  const reading = state.live[state.live.length - 1];
  if (reading) drawReadout(reading);
  // Markers move every frame, using the tracker's position between readings.
  const now = state.replay.at(state.time);
  if (now) drawMap(now);
  drawChart();
  $('scrub').value = Math.floor(state.time);
  $('clock').textContent = `${clock(state.time)} / ${clock(state.replay.duration)}`;
  $('play').textContent = state.playing ? 'Pause' : 'Play';
}

function seek(t) {
  if (!state.replay) return;
  const target = clamp(t, 0, state.replay.duration);
  if (target < state.time || state.live.length === 0) {
    state.replay.reset();
    state.live = [];
  }
  state.live.push(...state.replay.advanceTo(target));
  state.time = target;
  render();
}

function setPlaying(playing) {
  if (!state.replay) return;
  if (playing && state.time >= state.replay.duration) seek(0);
  state.playing = playing;
  render();
}

function setSpeed(speed) {
  state.speed = speed;
  $('speed').value = String(speed);
}

function frame(now) {
  if (state.playing && state.lastFrame != null) {
    const wall = Math.min(0.25, (now - state.lastFrame) / 1000);
    seek(state.time + wall * state.speed);
    if (state.time >= state.replay.duration) setPlaying(false);
  }
  state.lastFrame = now;
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- wiring --

function onKey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  // Leave typing controls alone, and let Enter or Space press a focused button.
  if (event.target.closest('input, select, textarea')) return;
  const activates = event.key === 'Enter' || event.key === ' ';
  if (activates && event.target.closest('button, summary, a')) return;
  const step = SPEEDS.indexOf(state.speed);
  if (activates) setPlaying(!state.playing);
  else if (event.key === 'ArrowLeft') seek(state.time - 10);
  else if (event.key === 'ArrowRight') seek(state.time + 10);
  else if (event.key === 'ArrowUp') setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, step + 1)]);
  else if (event.key === 'ArrowDown') setSpeed(SPEEDS[Math.max(0, step - 1)]);
  else return;
  event.preventDefault();
}

async function init() {
  const params = new URLSearchParams(location.search);
  for (const speed of SPEEDS) $('speed').add(new Option(speed === 1 ? '1× (real time)' : `${speed}×`, String(speed)));
  setSpeed(SPEEDS.includes(Number(params.get('speed'))) ? Number(params.get('speed')) : 10);

  $('play').addEventListener('click', () => setPlaying(!state.playing));
  $('restart').addEventListener('click', () => seek(0));
  $('speed').addEventListener('change', (event) => setSpeed(Number(event.target.value)));
  if (params.get('clock') === 'elapsed') $('clockMode').value = 'elapsed';
  $('clockMode').addEventListener('change', restart);
  if (['pace', 'segments'].includes(params.get('ghost'))) $('ghostMode').value = params.get('ghost');
  if (parsePace(params.get('pace') ?? '')) $('ghostPace').value = params.get('pace');
  showGhostMode();
  $('ghostMode').addEventListener('change', () => {
    showGhostMode();
    restart();
  });
  $('ghostPace').addEventListener('change', restart);
  $('usePace').addEventListener('click', useGhostPace);
  $('scrub').addEventListener('input', (event) => seek(Number(event.target.value)));
  $('pair').addEventListener('change', (event) => {
    if (event.target.value === 'custom') {
      state.pair = null;
      start(state.custom.ghost, state.custom.runner);
    } else loadPair(event.target.value);
  });
  $('ghostFile').addEventListener('change', (event) => chooseFile('ghost', event.target));
  $('runnerFile').addEventListener('change', (event) => chooseFile('runner', event.target));
  $('tableBox').addEventListener('toggle', buildTable);
  $('csv').addEventListener('click', downloadCsv);
  document.addEventListener('keydown', onKey);

  let resizing = null;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizing);
    resizing = requestAnimationFrame(() => {
      if (!state.check) return;
      buildMap();
      buildChart();
      render();
    });
  }).observe($('chart'));
  requestAnimationFrame(frame);

  try {
    const response = await fetch(new URL('index.json', FIXTURES));
    if (!response.ok) throw new Error(`Could not load fixtures/index.json (${response.status})`);
    state.pairs = (await response.json()).pairs;
  } catch (error) {
    showMessage(`${error.message}. You can still load two GPX files of your own.`);
    return;
  }
  for (const pair of state.pairs) $('pair').add(new Option(pair.label, pair.id));
  const wanted = state.pairs.some((p) => p.id === params.get('pair')) ? params.get('pair') : state.pairs[0]?.id;
  if (wanted) {
    $('pair').value = wanted;
    await loadPair(wanted);
  }
}

init();
