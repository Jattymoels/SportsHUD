// Route guide. Everything shown comes from engine/guide.js; this file loads
// recordings, keeps track of where along the route you are looking, and draws.

import { parseGpx, toFixes, buildRoute, buildGuide, groupRuns, nextCue, amenityQuery, amenitiesAlong, withAmenities } from '../../engine/index.js';
import { clock } from '../ghost/hud.js';
import { drawPreview, drawComing, describe, metres, wait, places } from './screen.js';

const FIXTURES = new URL('../../fixtures/', import.meta.url);
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const SVG = 'http://www.w3.org/2000/svg';
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
  own: [], // routes found in the files you chose: [{ recordings, name, label }]
  guide: null,
  name: '',
  view: 'preview', // 'preview' before the start, 'coming' on the way
  along: 0, // metres along the route
  playing: false,
  lastFrame: null,
  chart: null,
};

const km = (m, digits = 2) => `${(m / 1000).toFixed(digits)} km`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function showMessage(text) {
  $('message').textContent = text ?? '';
  $('message').hidden = !text;
}

// --------------------------------------------------------------- loading --

async function fetchRecording(path) {
  const response = await fetch(new URL(path, FIXTURES));
  if (!response.ok) throw new Error(`Could not load fixtures/${path} (${response.status})`);
  return parseGpx(await response.text());
}

async function loadPair(id) {
  const pair = state.pairs.find((p) => p.id === id);
  if (!pair) return;
  try {
    const recordings = await Promise.all([fetchRecording(pair.ghost), fetchRecording(pair.runner)]);
    start(recordings, pair.label.replace(/\s*\(synthetic\)/, ''));
  } catch (error) {
    showMessage(error.message);
  }
}

async function chooseFiles(input) {
  const files = [...input.files].sort((a, b) => a.name.localeCompare(b.name));
  if (!files.length) return;
  const recordings = [];
  for (const file of files) {
    try {
      recordings.push(parseGpx(await file.text()));
    } catch (error) {
      showMessage(`${file.name}: ${error.message}`);
      return;
    }
  }
  // Sort them into routes: the same line the same way. Out and home are two.
  let routes;
  try {
    routes = groupRuns(recordings);
  } catch (error) {
    showMessage(error.message);
    return;
  }
  state.own = routes.map((members) => {
    const runs = members.map((i) => recordings[i]);
    // Runs of the other routes found: where they cover the same ground, their waits count too.
    const others = recordings.filter((_, i) => !members.includes(i));
    const name = runs[0].name ?? 'Your route';
    const length = buildRoute(toFixes(runs[0])).length;
    return { recordings: runs, others, name, label: `${name}: ${km(length, 1)}, ${plural(runs.length, 'run')}` };
  });
  const select = $('pick');
  for (const option of [...select.options]) if (option.value.startsWith('own:')) option.remove();
  state.own.forEach((route, k) => select.add(new Option(`Yours · ${route.label}`, `own:${k}`)));
  select.value = 'own:0';
  startOwn(0);
  if (state.own.length > 1) showMessage(`${plural(files.length, 'file')} sorted into ${state.own.length} routes; the one with most runs is shown. Pick another under "Route".`);
}

function startOwn(k) {
  const route = state.own[k];
  if (route) start(route.recordings, route.name, route.others);
}

function start(recordings, name, others = []) {
  let guide;
  try {
    guide = buildGuide(recordings, { others });
  } catch (error) {
    showMessage(error.message);
    return;
  }
  showMessage(guide.leftOut ? `${plural(guide.leftOut, 'recording')} left out: not a run of this route. The first file sets the route.` : null);
  state.guide = guide;
  state.name = name;
  state.view = 'preview';
  state.along = 0;
  state.playing = false;
  $('along').max = Math.floor(guide.length);
  $('lookupNote').textContent = "Asks OpenStreetMap's public query service, which is sent the area the route covers. Nothing is asked until you press this.";
  renderSummary();
  buildChart();
  buildTable();
  render();
}

/** Ask OpenStreetMap for the water points and toilets around the route, and add them to the guide. */
async function lookUp() {
  if (!state.guide) return;
  const button = $('lookup');
  button.disabled = true;
  $('lookupNote').textContent = 'Asking OpenStreetMap…';
  try {
    const response = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: amenityQuery(state.guide.route) }) });
    if (!response.ok) throw new Error(`The map service answered ${response.status}`);
    const found = amenitiesAlong(state.guide.route, await response.json());
    state.guide = withAmenities(state.guide, found);
    const water = places(found, 'water');
    const toilets = places(found, 'toilets');
    $('lookupNote').textContent = found.length
      ? `Within 100 m of the route: ${plural(water, 'water point')} and ${toilets === 1 ? '1 toilet block' : `${toilets} toilet blocks`}, as mapped. Not checked against the ground.`
      : 'Nothing is mapped within 100 m of the route. That may mean there is none, or that nobody has mapped it.';
    renderSummary();
    buildChart();
    buildTable();
    render();
  } catch (error) {
    $('lookupNote').textContent = `Could not look them up: ${error.message}. Nothing has changed.`;
  } finally {
    button.disabled = false;
  }
}

// --------------------------------------------------------------- summary --

function renderSummary() {
  const g = state.guide;
  $('basis').textContent = `from ${plural(g.runs, 'run')}`;
  $('distance').textContent = km(g.length);
  if (g.climb) {
    $('climb').textContent = `+${Math.round(g.climb.gain)} m`;
    $('climbSub').textContent = `${Math.round(g.climb.loss)} m down; from ${Math.round(g.climb.lowest)} to ${Math.round(g.climb.highest)} m`;
    const climbs = g.climb.climbs;
    $('climbs').textContent = String(climbs.length);
    $('climbsSub').textContent = climbs.length ? climbs.map((c) => `${Math.round(c.gain)} m at ${km(c.from, 1)}`).join(', ') : 'nothing as steep as 2% for long';
  } else {
    $('climb').textContent = '–';
    $('climbSub').textContent = 'these recordings carry no elevation';
    $('climbs').textContent = '–';
    $('climbsSub').textContent = '';
  }
  $('timeLabel').textContent = g.runs > 1 ? 'Usual time' : 'Time';
  $('time').textContent = clock(g.times.moving);
  $('timeSub').textContent = `on the move; ${clock(g.times.elapsed)} with waits`;
  const places = g.pausePoints;
  const likely = places.filter((p) => p.likely).length;
  $('waits').textContent = places.length ? `about ${wait(g.usualWait)}` : 'none';
  $('waitsSub').textContent = places.length ? `${likely} likely, of ${plural(places.length, 'place')} a run has waited at` : 'no run stood still for 5 s or more';
  const sharp = g.turns.filter((t) => t.shape !== 'turn').length;
  $('turns').textContent = String(g.turns.length);
  const agreed = g.runs >= 3 ? '; made on at least half the runs' : '';
  $('turnsSub').textContent = g.turns.length ? `${g.turns.filter((t) => t.side === 'left').length} left, ${g.turns.filter((t) => t.side === 'right').length} right${sharp ? `, ${sharp} sharp` : ''}${agreed}` : 'no corners of 45° or more';
  const elsewhere = places.some((p) => p.elsewhere);
  $('caveat').textContent =
    g.runs < 3 && !elsewhere
      ? `From ${plural(g.runs, 'run')}, a wait is only known to have happened, not how likely it is. More runs of the same route sharpen it.`
      : `A wait is likely where at least two runs waited, and at least half of those that passed.${elsewhere ? ' Runs of your other routes count where they cover the same ground: a crossing is a crossing from either side.' : ''}`;
}

// ----------------------------------------------------------------- chart --

function niceStep(rough) {
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power;
}

/** Height at `dist` metres along, from the profile; null without elevation. */
function heightAt(dist) {
  const profile = state.guide.climb?.profile;
  if (!profile) return null;
  const step = profile.dist[1] - profile.dist[0];
  return profile.ele[clamp(Math.round(dist / step), 0, profile.ele.length - 1)];
}

function buildChart() {
  const g = state.guide;
  const box = $('chart');
  box.replaceChildren();
  const W = Math.max(300, box.clientWidth);
  const H = g.climb ? 250 : 110;
  const m = { left: 44, right: 14, top: 22, bottom: 30 };
  const x = (d) => m.left + (d / g.length) * (W - m.left - m.right);

  let lo = 0;
  let hi = 1;
  let yStep = 1;
  if (g.climb) {
    yStep = niceStep(Math.max(10, g.climb.highest - g.climb.lowest) / 4);
    lo = Math.floor(g.climb.lowest / yStep) * yStep;
    hi = Math.max(lo + yStep, Math.ceil(g.climb.highest / yStep) * yStep);
  }
  const y = (e) => m.top + ((hi - e) / (hi - lo)) * (H - m.top - m.bottom);
  const floor = H - m.bottom;
  const onLine = (d) => (g.climb ? y(heightAt(d)) : floor);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Height along the route, with the places past runs waited, the turns and the climbs marked' }, box);

  if (g.climb) {
    for (let v = lo; v <= hi + 1e-9; v += yStep) {
      svgEl('line', { class: v === lo ? 'base' : 'gridline', x1: m.left, x2: W - m.right, y1: y(v), y2: y(v) }, svg);
      svgEl('text', { x: m.left - 6, y: y(v) + 4, 'text-anchor': 'end' }, svg, `${Math.round(v)} m`);
    }
  } else {
    svgEl('line', { class: 'base', x1: m.left, x2: W - m.right, y1: floor, y2: floor }, svg);
    svgEl('text', { class: 'label', x: m.left, y: m.top + 10 }, svg, 'These recordings carry no elevation, so there is no height to draw.');
  }
  const mostLabels = clamp(Math.floor((W - m.left - m.right) / 76), 2, 12);
  const xStep = niceStep(g.length / mostLabels);
  for (let d = 0; d <= g.length; d += xStep) {
    // Leave out a label that would run off the end of the axis.
    if (d > 0 && x(d) > W - m.right - 22) continue;
    svgEl('text', { x: x(d), y: H - 8, 'text-anchor': d === 0 ? 'start' : 'middle' }, svg, d === 0 ? '0' : `${Number((d / 1000).toFixed(2))} km`);
  }

  if (g.climb) {
    const { dist, ele } = g.climb.profile;
    const points = Array.from(dist, (d, k) => `${x(d).toFixed(1)},${y(ele[k]).toFixed(1)}`);
    svgEl('polygon', { class: 'wash', points: [`${x(0).toFixed(1)},${floor}`, ...points, `${x(g.length).toFixed(1)},${floor}`].join(' ') }, svg);
    // Each climb to know about: a stronger wash under the line, and its gain above it.
    for (const climb of g.climb.climbs) {
      const part = [];
      dist.forEach((d, k) => {
        if (d >= climb.from && d <= climb.to) part.push(`${x(d).toFixed(1)},${y(ele[k]).toFixed(1)}`);
      });
      if (part.length < 2) continue;
      svgEl('polygon', { class: 'climb', points: [`${x(climb.from).toFixed(1)},${floor}`, ...part, `${x(climb.to).toFixed(1)},${floor}`].join(' ') }, svg);
      // Its gain, beside the slope on the uphill side.
      const mid = (climb.from + climb.to) / 2;
      svgEl('text', { class: 'label', x: x(mid) - 8, y: Math.max(12, y(heightAt(mid)) - 4), 'text-anchor': 'end' }, svg, `+${Math.round(climb.gain)} m`);
    }
    svgEl('polyline', { class: 'height', points: points.join(' ') }, svg);
  }
  for (const turn of g.turns) svgEl('line', { class: 'turn', x1: x(turn.dist), x2: x(turn.dist), y1: floor - 7, y2: floor - 1 }, svg);
  for (const place of g.pausePoints) svgEl('circle', { class: place.likely ? 'wait' : 'wait once', cx: x(place.dist), cy: onLine(place.dist), r: place.likely ? 5 : 4 }, svg);
  // Water (a ring) and toilets (a square), in a row across the top.
  for (const a of g.amenities ?? []) {
    if (a.kind === 'water') svgEl('circle', { class: 'amenity', cx: x(a.dist), cy: m.top - 9, r: 4.5 }, svg);
    else svgEl('rect', { class: 'amenity', x: x(a.dist) - 4.5, y: m.top - 13.5, width: 9, height: 9, rx: 1 }, svg);
  }

  const here = svgEl('line', { class: 'here', y1: m.top - 6, y2: floor }, svg);
  const cross = svgEl('line', { class: 'cross', y1: m.top - 6, y2: floor, visibility: 'hidden' }, svg);

  const distAt = (event) => {
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    return clamp(((px - m.left) / (W - m.left - m.right)) * g.length, 0, g.length);
  };
  // What is within reach of the pointer: a mark is small, so aim only has to be close.
  const reach = (14 / (W - m.left - m.right)) * g.length;
  svg.addEventListener('pointermove', (event) => showTip(event, distAt(event), reach));
  svg.addEventListener('pointerleave', hideTip);
  svg.addEventListener('click', (event) => goTo(distAt(event), 'coming'));

  state.chart = { x, here, cross };
}

function showTip(event, dist, reach) {
  const g = state.guide;
  const px = state.chart.x(dist).toFixed(1);
  state.chart.cross.setAttribute('x1', px);
  state.chart.cross.setAttribute('x2', px);
  state.chart.cross.setAttribute('visibility', 'visible');

  const tip = $('tip');
  tip.replaceChildren();
  const row = (value, label, keyClass = null) => {
    const div = document.createElement('div');
    div.className = 'row';
    if (keyClass) {
      const key = document.createElement('span');
      key.className = `key ${keyClass}`;
      div.append(key);
    }
    const strong = document.createElement('b');
    strong.textContent = value;
    div.append(strong, ` ${label}`);
    tip.append(div);
  };
  row(km(dist), 'along the route');
  const height = heightAt(dist);
  if (height != null) row(`${Math.round(height)} m`, 'above sea level');
  for (const f of g.features) {
    if (f.kind === 'marker' || f.kind === 'finish') continue;
    const within = f.kind === 'climb' ? dist >= f.from - reach && dist <= f.to + reach : Math.abs(f.dist - dist) <= reach;
    if (!within) continue;
    const words = inWords(f);
    row(words.what, words.detail, f.kind === 'wait' ? 'dot wait' : f.kind === 'climb' ? 'band climb' : f.kind === 'water' ? 'square water' : f.kind === 'toilets' ? 'square toilets' : 'tick');
  }

  tip.hidden = false;
  const card = tip.parentElement.getBoundingClientRect();
  tip.style.left = `${clamp(event.clientX - card.left + 14, 4, card.width - tip.offsetWidth - 4)}px`;
  tip.style.top = `${event.clientY - card.top + 14}px`;
}

function hideTip() {
  $('tip').hidden = true;
  state.chart?.cross.setAttribute('visibility', 'hidden');
}

// ----------------------------------------------------------------- table --

/** A feature in sentence case, for the table and the tooltip. */
function inWords(f) {
  if (f.kind === 'turn') {
    if (f.shape === 'back') return { what: 'Turn back', detail: `round to the ${f.side}` };
    return { what: `${f.shape === 'sharp' ? 'Sharp ' : ''}${f.side} turn`.replace(/^./, (c) => c.toUpperCase()), detail: `${Math.round(f.angle)}°${f.of > 1 ? `; on ${f.runs} of ${f.of} runs` : ''}` };
  }
  if (f.kind === 'wait') {
    const often = f.of > 1 || f.elsewhere ? `${f.runs} of ${f.of} runs waited` : 'the run waited';
    const too = f.elsewhere ? `, and ${f.elsewhere.runs} of ${f.elsewhere.of} on other routes past here` : '';
    return { what: f.likely ? 'Likely wait' : 'A wait, once', detail: `${often}${too}; usually ${wait(f.typical)}${f.runs > 1 ? `, at most ${wait(f.longest)}` : ''}` };
  }
  if (f.kind === 'climb') return { what: 'Climb', detail: `${Math.round(f.gain)} m up over ${metres(f.length)}, ${(100 * f.grade).toFixed(1)}%` };
  if (f.kind === 'marker') return { what: `${f.label} marker`, detail: '' };
  if (f.kind === 'water' || f.kind === 'toilets') {
    const where = f.off < 15 ? 'beside the route' : `${metres(f.off)} to the ${f.side}`;
    return { what: f.kind === 'water' ? 'Water' : 'Toilets', detail: f.name ? `${f.name}; ${where}` : where };
  }
  return { what: 'Finish', detail: '' };
}

function buildTable() {
  const g = state.guide;
  const table = $('table');
  table.replaceChildren();
  const head = table.createTHead().insertRow();
  for (const [title, numeric] of [['At', true], ['What', false], ['Detail', false], ...(g.climb ? [['Height', true]] : [])]) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = title;
    if (numeric) th.className = 'num';
    head.append(th);
  }
  const body = table.createTBody();
  g.features.forEach((f) => {
    const tr = body.insertRow();
    tr.tabIndex = 0;
    tr.dataset.dist = String(f.dist);
    const words = inWords(f);
    const cells = [[km(f.dist), true], [words.what, false], [words.detail, false], ...(g.climb ? [[`${Math.round(heightAt(f.dist))} m`, true]] : [])];
    for (const [text, numeric] of cells) {
      const td = tr.insertCell();
      td.textContent = text;
      if (numeric) td.className = 'num';
    }
    // Stand 120 m before it, where the glasses would be cueing it.
    const stand = () => goTo(Math.max(0, f.dist - 120), 'coming');
    tr.addEventListener('click', stand);
    tr.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      stand();
    });
  });
}

// ---------------------------------------------------------------- screen --

function render() {
  const g = state.guide;
  if (!g) return;
  const ctx = $('screen').getContext('2d');
  const cue = nextCue(g, state.along);
  if (state.view === 'preview') drawPreview(ctx, g, state.name);
  else drawComing(ctx, g, state.along, cue);
  $('viewName').textContent = state.view === 'preview' ? 'before the start' : `on the way, ${km(state.along)} in`;
  $('toggle').textContent = state.view === 'preview' ? 'What is coming up' : 'Back to the preview';
  $('play').textContent = state.playing ? 'Stop' : 'Run it through';
  $('along').value = Math.floor(state.along);

  const px = state.chart.x(state.along).toFixed(1);
  state.chart.here.setAttribute('x1', px);
  state.chart.here.setAttribute('x2', px);
  for (const tr of $('table').tBodies[0].rows) {
    const dist = Number(tr.dataset.dist);
    tr.classList.toggle('passed', dist <= state.along);
    tr.classList.toggle('next', cue.now != null && dist === cue.now.dist);
  }
}

function goTo(dist, view = state.view) {
  if (!state.guide) return;
  state.along = clamp(dist, 0, state.guide.length);
  state.view = view;
  render();
}

/** Jump to just before the next thing on the route, or back to the one before. */
function jump(direction) {
  const dists = state.guide.features.filter((f) => f.kind !== 'marker').map((f) => f.dist);
  const lead = 120;
  if (direction > 0) {
    const next = dists.find((d) => d - lead > state.along + 1);
    goTo(next == null ? state.guide.length : next - lead, 'coming');
  } else {
    const before = dists.filter((d) => d - lead < state.along - 1).pop();
    goTo(before == null ? 0 : Math.max(0, before - lead), 'coming');
  }
}

function setPlaying(playing) {
  if (!state.guide) return;
  if (playing && state.along >= state.guide.length) state.along = 0;
  state.playing = playing;
  if (playing) state.view = 'coming';
  render();
}

function frame(now) {
  if (state.playing && state.lastFrame != null) {
    // A run at 3 m/s, played back twenty times as fast.
    goTo(state.along + Math.min(0.25, (now - state.lastFrame) / 1000) * 60);
    if (state.along >= state.guide.length) setPlaying(false);
  }
  state.lastFrame = now;
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- wiring --

function onKey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey || !state.guide) return;
  if (event.target.closest('input, select, textarea')) return;
  const activates = event.key === 'Enter' || event.key === ' ';
  if (activates && event.target.closest('button, a, tr')) return;
  if (activates) goTo(state.along, state.view === 'preview' ? 'coming' : 'preview');
  else if (event.key === 'ArrowLeft') goTo(state.along - 50, 'coming');
  else if (event.key === 'ArrowRight') goTo(state.along + 50, 'coming');
  else if (event.key === 'ArrowUp') jump(1);
  else if (event.key === 'ArrowDown') jump(-1);
  else return;
  event.preventDefault();
}

async function init() {
  const params = new URLSearchParams(location.search);
  $('toggle').addEventListener('click', () => goTo(state.along, state.view === 'preview' ? 'coming' : 'preview'));
  $('play').addEventListener('click', () => setPlaying(!state.playing));
  $('screen').addEventListener('click', () => goTo(state.along, state.view === 'preview' ? 'coming' : 'preview'));
  $('along').addEventListener('input', (event) => goTo(Number(event.target.value), 'coming'));
  $('pick').addEventListener('change', (event) => {
    const { value } = event.target;
    if (value.startsWith('own:')) startOwn(Number(value.slice(4)));
    else loadPair(value);
  });
  $('files').addEventListener('change', (event) => chooseFiles(event.target));
  $('lookup').addEventListener('click', lookUp);
  document.addEventListener('keydown', onKey);

  let resizing = null;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizing);
    resizing = requestAnimationFrame(() => {
      if (!state.guide) return;
      buildChart();
      render();
    });
  }).observe($('chart'));
  requestAnimationFrame(frame);

  try {
    const response = await fetch(new URL('index.json', FIXTURES));
    if (!response.ok) throw new Error(`Could not load fixtures/index.json (${response.status})`);
    // A route needs runs of the same route; a pair that shares only part of one is not that.
    state.pairs = (await response.json()).pairs.filter((p) => !p.segments);
  } catch (error) {
    showMessage(`${error.message}. You can still load GPX files of your own.`);
    return;
  }
  for (const pair of state.pairs) $('pick').add(new Option(pair.label, pair.id));
  const wanted = state.pairs.some((p) => p.id === params.get('route')) ? params.get('route') : state.pairs[0]?.id;
  if (wanted) {
    $('pick').value = wanted;
    await loadPair(wanted);
    const at = Number(params.get('at'));
    if (params.has('at') && Number.isFinite(at)) goTo(at, 'coming');
  }
}

init();
