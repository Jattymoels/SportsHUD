// Golf HUD. Every number comes from engine/golf.js and engine/course.js.
// This file says where the golfer is (sliders at the desk, the phone's GPS,
// compass and tilt on the course), keeps the bag, and draws.

import {
  bearingTo, distanceTo, pointAlong, centreOf, greenDistances, carryInWind, landingZone, clubFor, zoneTouches,
  hazardsInPlay, lookTarget, lookAround, featuresOf, createAddressHider, holeAt, nearestOnLine, cameraPose, angleBetween,
} from '../../engine/index.js';
import { HOLE } from '../../fixtures/golf.mjs';
import { loadSettings, saveSettings } from '../ghost/store.js';
import { BAG } from './bag.js';
import { initFieldTest } from './fieldtest.js';
import { drawGreen, drawClub, drawLook, drawHidden, compassPoint } from './screens.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const VIEWS = ['green', 'club', 'look'];
const DISPLAY_HALF = 10; // degrees either side of the gaze the display covers: 20 across, as on the glasses
const COURSES = { grange: new URL('../../fixtures/courses/grange.json', import.meta.url) };
const MADE_UP = { name: 'A made-up hole', holes: [HOLE] };

const state = {
  course: MADE_UP,
  hole: HOLE,
  clubs: BAG.map((c) => ({ ...c })),
  view: 'green',
  club: null, // index into clubs once chosen by hand; null follows the distance
  nudge: 0, // degrees the aim has been moved off the target by hand
  hider: createAddressHider(),
  hidden: false,
  fix: null, // the phone's latest position: { lat, lon, accuracy }
  pins: {}, // today's pin on each hole, where the golfer has stood at it: { "course:hole": { lat, lon, day } }
  last: null, // the latest working, for the course test to log from
  test: null,
  pose: null, // the phone's latest { heading, tilt } in degrees
  watch: null,
};

// ------------------------------------------------------------ the golfer --

/** The legs of the hole's line of play, and its length. */
function lineOf(hole) {
  const legs = hole.line.slice(1).map((p, i) => distanceTo(hole.line[i], p));
  return { legs, length: legs.reduce((sum, d) => sum + d, 0) };
}

/** The position `metres` along the line of play from the tee, `side` metres to its right. */
function positionAt(hole, metres, side) {
  const { legs } = lineOf(hole);
  let left = metres;
  for (let i = 0; i < legs.length; i++) {
    if (left <= legs[i] || i === legs.length - 1) {
      const bearing = bearingTo(hole.line[i], hole.line[i + 1]);
      return pointAlong(pointAlong(hole.line[i], bearing, left), bearing + 90, side);
    }
    left -= legs[i];
  }
  return hole.line[0];
}

const onPhone = () => $('gps').checked && state.fix;
const today = () => new Date().toISOString().slice(0, 10);
const pinKey = (hole) => `${state.course.name}:${hole.number}`;

/** Today's pin on this hole, if the golfer has stood at it today. */
function todaysPin(hole) {
  const pin = state.pins[pinKey(hole)];
  return pin && pin.day === today() ? { lat: pin.lat, lon: pin.lon } : null;
}

/** Everything the screens show, for where the golfer is. */
function work() {
  const { clubs } = state;
  const set = todaysPin(state.hole);
  const hole = set ? { ...state.hole, pin: set } : state.hole;
  const { length } = lineOf(hole);
  const position = onPhone() ? { lat: state.fix.lat, lon: state.fix.lon } : positionAt(hole, Number($('along').value) * length, Number($('side').value));
  const competition = $('competition').checked;
  const wind = { speed: Number($('wind').value), from: Number($('from').value) };
  const green = greenDistances(position, hole.green);
  const pin = hole.pin ? distanceTo(position, hole.pin) : null;
  const onLine = nearestOnLine(position, hole.line);

  // What to aim at: the pin if the green is in reach of the longest club,
  // otherwise the next point of the line of play that is still a way off.
  const longest = Math.max(...clubs.map((c) => c.carry));
  const shortest = clubs.reduce((least, c) => (c.carry < least.carry ? c : least));
  let target = { name: hole.pin ? 'the pin' : 'the green', at: hole.pin ?? centreOf(hole.green) };
  if (green.centre > longest + 20) {
    const greenCentre = centreOf(hole.green);
    const ahead = hole.line.slice(1, -1).find((p) => distanceTo(position, p) > 60 && distanceTo(p, greenCentre) < green.centre);
    if (ahead) target = { name: 'the next point on the line of play', at: ahead };
  }
  const toTarget = distanceTo(position, target.at);
  const aim = (bearingTo(position, target.at) + state.nudge + 360) % 360;

  const hazards = hole.hazards ?? [];
  let suggest = clubFor(toTarget, aim, clubs, competition ? null : wind);
  let why = 'nearest to the distance';
  if (target.at !== (hole.pin ?? null) && green.centre > longest + 20 && !competition) {
    // The green is out of reach, so distance is the aim: the longest club
    // whose landing zone stays out of trouble. The driver only off the tee.
    const onTee = distanceTo(position, hole.tee) <= 25;
    const byLength = [...clubs].sort((a, b) => b.carry - a.carry).filter((c) => onTee || !/driver/i.test(c.name));
    const clear = byLength.find((c) => !hazards.some((h) => zoneTouches(landingZone(position, aim, c, wind), h.shape)));
    if (clear) {
      suggest = { club: clear, carry: carryInWind(clear.carry, wind, aim).carry };
      why = 'the longest that stays out of trouble';
    }
  }
  let club = clubs[state.club ?? clubs.indexOf(suggest.club)];
  // Nearer than a full swing of the shortest club: a part shot of the length needed.
  const partShot = state.club == null && toTarget < shortest.carry - 5;
  if (partShot) club = { name: `${shortest.name}, part shot`, carry: toTarget };
  const zone = competition ? null : landingZone(position, aim, club, wind);
  const flight = carryInWind(club.carry, wind, aim);
  const inPlay = hazardsInPlay(position, aim, hazards);
  const trouble = zone ? (hazards.find((h) => zoneTouches(zone, h.shape))?.name ?? null) : null;

  const heading = state.pose && $('sensors').checked ? state.pose.heading : $('follow').checked ? aim : Number($('heading').value);
  const features = featuresOf(hole);
  const around = lookAround(position, heading, features);
  const look = lookTarget(position, heading, features);
  return { hole, position, competition, wind, green, pin, pinSet: Boolean(set), accuracy: onPhone() ? state.fix.accuracy : null, onLine, target, toTarget, aim, suggest: partShot ? { club } : suggest, why, club, zone, flight, inPlay, trouble, heading, around, look, length };
}

// --------------------------------------------------------------- drawing --

function render() {
  const w = work();
  state.last = w;
  state.test?.show(w);
  const tilt = state.pose && $('sensors').checked ? state.pose.tilt : Number($('tilt').value);
  state.hidden = state.hider.update(tilt, performance.now() / 1000);
  const ctx = $('screen').getContext('2d');
  if (state.hidden) drawHidden(ctx);
  else if (state.view === 'green') drawGreen(ctx, { hole: w.hole, green: w.green, pin: w.pin, wind: w.wind, aim: w.aim, competition: w.competition, suggest: w.competition ? null : w.suggest });
  else if (state.view === 'club') drawClub(ctx, { hole: w.hole, position: w.position, aim: w.aim, club: w.club, zone: w.zone, inPlay: w.inPlay, trouble: w.trouble, toGreen: w.green.centre, wind: w.wind, competition: w.competition });
  else drawLook(ctx, { heading: w.heading, target: w.look, around: w.around, half: DISPLAY_HALF });

  const names = { green: 'the green', club: 'the club and its landing zone', look: 'look to range' };
  $('viewName').textContent = state.hidden ? 'hidden: looking down at the ball' : names[state.view];
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === state.view));

  // The controls' own read-outs, and which of them the phone has taken over.
  const phone = Boolean(onPhone());
  const sensing = Boolean(state.pose && $('sensors').checked);
  for (const id of ['along', 'side']) $(id).disabled = phone;
  for (const button of document.querySelectorAll('#spots button')) button.disabled = phone;
  $('holeNo').disabled = phone && state.course.holes.length > 1;
  $('alongOut').textContent = `${Math.round(w.onLine.along)} m from the tee`;
  const side = Math.round(w.onLine.distance * w.onLine.side);
  $('sideOut').textContent = side === 0 ? 'on it' : `${Math.abs(side)} m ${side > 0 ? 'right' : 'left'}`;
  $('heading').disabled = sensing || $('follow').checked;
  $('tilt').disabled = sensing;
  $('follow').disabled = sensing;
  if (sensing || $('follow').checked) $('heading').value = Math.round(w.heading) % 360;
  if (sensing) $('tilt').value = clamp(Math.round(tilt), -80, 20);
  $('headingOut').textContent = `${String(Math.round(w.heading) % 360).padStart(3, '0')}° ${compassPoint(w.heading)}`;
  $('tiltOut').textContent = Math.round(tilt) === 0 ? 'level' : `${Math.abs(Math.round(tilt))}° ${tilt < 0 ? 'down' : 'up'}`;
  $('windOut').textContent = w.wind.speed ? `${w.wind.speed} km/h` : 'calm';
  $('fromOut').textContent = `from the ${compassPoint(w.wind.from)} (${String(w.wind.from).padStart(3, '0')}°)`;

  numbers(w);
}

function numbers(w) {
  const m = (v) => `${v.toFixed(1)} m`;
  const rows = [
    ['Hole', `${state.course.name}, hole ${w.hole.number}${w.hole.par ? `: par ${w.hole.par}` : ''}${w.hole.index ? `, stroke index ${w.hole.index}` : ''}, ${Math.round(w.length)} m along its line of play`],
    ['Green, along the line from you through its middle', `front ${m(w.green.front)} · centre ${m(w.green.centre)} · back ${m(w.green.back)}${w.green.onGreen ? ' (you are on it)' : ''}`],
    [w.pinSet ? 'Pin, where you stood at it today' : 'Pin, as mapped', w.pin == null ? 'not mapped' : m(w.pin)],
    ['Aiming at', `${w.target.name}, ${m(w.toTarget)} away on ${w.aim.toFixed(1)}°${state.nudge ? ` (moved ${Math.abs(state.nudge)}° ${state.nudge > 0 ? 'right' : 'left'} by hand)` : ''}`],
  ];
  if (!w.competition) {
    const { head, cross } = w.flight;
    rows.push(
      ['Wind on this shot', w.wind.speed ? `${Math.abs(head).toFixed(1)} km/h ${head >= 0 ? 'against' : 'behind'}, ${Math.abs(cross).toFixed(1)} km/h from the ${cross >= 0 ? 'left' : 'right'}` : 'calm'],
      ['Club', `${w.club.name}${state.club == null ? ` (${w.why})` : ' (chosen by hand)'}: ${m(w.club.carry)} in still air`],
      ['Where it lands', `${m(w.zone.carry)} out${Math.abs(w.zone.drift) >= 0.05 ? `, ${m(Math.abs(w.zone.drift))} ${w.zone.drift > 0 ? 'right' : 'left'} of the aim` : ''}; zone ${m(2 * w.zone.deep)} long by ${m(2 * w.zone.wide)} wide`],
      ['Zone reaches into', w.trouble ?? 'nothing'],
    );
  }
  rows.push(
    ['Hazards in play, nearest first', w.inPlay.length ? w.inPlay.map((h) => `${h.name}: reach ${m(h.reach)}, carry ${m(h.carry)}, ${Math.abs(h.off).toFixed(0)}° ${h.off > 0 ? 'right' : 'left'}`).join(' · ') : 'none within 25° of the aim'],
    ['Looking at', w.look ? `${w.look.feature.name}, ${m(w.look.distance)}, ${Math.abs(w.look.off).toFixed(1)}° ${w.look.off > 0 ? 'right' : 'left'} of where you face` : w.around[0] ? `nothing within 7.5°; nearest is ${w.around[0].feature.name}, ${Math.abs(w.around[0].off).toFixed(0)}° ${w.around[0].off > 0 ? 'right' : 'left'}` : 'nothing mapped'],
    ['Display', state.hidden ? 'hidden' : 'showing'],
  );
  const table = $('numbers');
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

// ------------------------------------------------------ course and holes --

function newShot() {
  state.club = null;
  state.nudge = 0;
}

function setHole(hole) {
  state.hole = hole;
  $('holeNo').value = String(hole.number);
  newShot();
}

async function setCourse(id) {
  let course = MADE_UP;
  if (COURSES[id]) {
    try {
      const response = await fetch(COURSES[id]);
      if (!response.ok) throw new Error(`Could not load the course (${response.status})`);
      course = await response.json();
    } catch (error) {
      showStatus(`${error.message}. Showing the made-up hole instead.`);
      $('course').value = 'made-up';
    }
  }
  state.course = course;
  $('holeNo').replaceChildren(...course.holes.map((h) => new Option(`${h.number}${h.par ? `  ·  par ${h.par}  ·  ${h.length ?? Math.round(lineOf(h).length)} m` : ''}`, String(h.number))));
  setHole(course.holes[0]);
  $('along').value = 0;
  $('side').value = 0;
  render();
}

function showStatus(text) {
  $('status').textContent = text ?? '';
}

// ------------------------------------------------------------- the phone --

function onFix(p) {
  state.fix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy };
  // Which hole: the one whose line of play is nearest, without flipping at a green.
  const found = holeAt(state.course, state.fix, { current: state.hole.number });
  if (found && found.hole !== state.hole) setHole(found.hole);
  const off = found ? found.distance : 0;
  showStatus(
    off > 400
      ? `GPS good to ${Math.round(state.fix.accuracy)} m. You are ${off > 2000 ? `${(off / 1000).toFixed(1)} km` : `${Math.round(off)} m`} from the nearest mapped hole, so these distances are from where you are, not from the course.`
      : `GPS good to ${Math.round(state.fix.accuracy)} m. On hole ${state.hole.number}.`,
  );
  render();
}

function toggleGps() {
  if (state.watch != null) navigator.geolocation.clearWatch(state.watch);
  state.watch = null;
  state.fix = null;
  if (!$('gps').checked) return showStatus('');
  if (!navigator.geolocation) {
    $('gps').checked = false;
    return showStatus('This browser has no location service.');
  }
  showStatus('Waiting for GPS…');
  state.watch = navigator.geolocation.watchPosition(onFix, (error) => showStatus(error.code === 1 ? 'Location is blocked for this site.' : error.message || 'No position yet.'), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}

function onOrientation(event) {
  if (!$('sensors').checked) return;
  // Readings measured from north: Android's absolute event, or iOS's compass heading.
  const alpha = event.webkitCompassHeading != null ? 360 - event.webkitCompassHeading : event.absolute ? event.alpha : null;
  if (alpha == null || event.beta == null || event.gamma == null) return;
  const raw = cameraPose(alpha, event.beta, event.gamma, screen.orientation?.angle ?? 0);
  const heading = (raw.yaw * 180) / Math.PI;
  const tilt = (raw.pitch * 180) / Math.PI;
  if (!state.pose) state.pose = { heading, tilt };
  else {
    // Steady it a little: the sensors jitter.
    const turn = (angleBetween((state.pose.heading * Math.PI) / 180, raw.yaw) * 180) / Math.PI;
    state.pose = { heading: (state.pose.heading + turn * 0.25 + 360) % 360, tilt: state.pose.tilt + (tilt - state.pose.tilt) * 0.3 };
  }
}

async function toggleSensors() {
  state.pose = null;
  if (!$('sensors').checked) return;
  try {
    // iOS asks before it hands over the compass.
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') throw new Error('The compass was not allowed.');
    }
  } catch (error) {
    $('sensors').checked = false;
    showStatus(error.message);
  }
}

/** Take where the golfer is standing as today's pin on this hole. */
function pinHere() {
  const w = state.last;
  if (!w) return;
  if (!w.green.onGreen && w.green.front > 8) return showStatus(`Stand at the flag first: you are ${Math.round(w.green.front)} m short of the green.`);
  state.pins[pinKey(state.hole)] = { lat: w.position.lat, lon: w.position.lon, day: today() };
  saveSettings('golfPins', state.pins);
  showStatus(`Today's pin on hole ${state.hole.number} is set to where you are standing. It is used for the rest of today.`);
  render();
}

/**
 * The wind at the course now, from a public forecast service. It is told
 * where the hole is to the nearest kilometre or so, never where the golfer is.
 */
async function windNow() {
  const button = $('windNow');
  button.disabled = true;
  $('windNote').textContent = 'Asking Open-Meteo…';
  try {
    const { lat, lon } = state.hole.tee;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`the forecast service answered ${response.status}`);
    const now = (await response.json()).current;
    const speed = Number(now?.wind_speed_10m);
    const from = Number(now?.wind_direction_10m);
    if (!Number.isFinite(speed) || !Number.isFinite(from)) throw new Error('the forecast had no wind in it');
    $('wind').value = clamp(Math.round(speed), 0, 45);
    $('from').value = (Math.round(from / 5) * 5) % 360;
    const gusts = Number(now.wind_gusts_10m);
    $('windNote').textContent = `Open-Meteo, ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}: ${Math.round(speed)} km/h from the ${compassPoint(from)}${Number.isFinite(gusts) ? `, gusting ${Math.round(gusts)}` : ''}. A forecast for the area at 10 m up, not a reading on the course.`;
    render();
  } catch (error) {
    $('windNote').textContent = `Could not get the wind: ${error.message}. The sliders are unchanged.`;
  } finally {
    button.disabled = false;
  }
}

// ---------------------------------------------------------------- the bag --

function buildBag() {
  const box = $('bag');
  box.replaceChildren();
  state.clubs.forEach((club, i) => {
    const label = document.createElement('label');
    label.textContent = club.name;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '20';
    input.max = '350';
    input.step = '0.5';
    input.value = String(club.carry);
    input.addEventListener('change', () => {
      const carry = Number(input.value);
      if (!(carry >= 20 && carry <= 350)) return void (input.value = String(club.carry));
      state.clubs[i] = { ...club, carry };
      saveSettings('golf', { clubs: state.clubs });
      render();
    });
    label.append(input);
    box.append(label);
  });
}

// ---------------------------------------------------------------- wiring --

function setView(view) {
  state.view = view;
  render();
}

function onKey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest('input, select, textarea')) return;
  const activates = event.key === 'Enter' || event.key === ' ';
  if (activates && event.target.closest('button, a')) return;
  const turn = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  const move = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
  if (activates) setView(VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length]);
  else if (state.view === 'green' && move && !onPhone()) {
    // At the desk: the next hole, or the one before.
    const holes = state.course.holes;
    setHole(holes[clamp(holes.indexOf(state.hole) + move, 0, holes.length - 1)]);
    render();
  } else if (state.view === 'club' && turn) {
    // Right is a longer club, left a shorter one. The bag runs longest first.
    const now = state.club ?? Math.max(0, state.clubs.findIndex((c) => c.name === work().club.name.replace(', part shot', '')));
    state.club = clamp(now - turn, 0, state.clubs.length - 1);
    render();
  } else if (state.view === 'club' && move) {
    state.nudge = clamp(state.nudge + move * 2, -40, 40);
    render();
  } else if (state.view === 'look' && turn) {
    $('follow').checked = false;
    $('heading').value = (Number($('heading').value) + turn * 5 + 360) % 360;
    render();
  } else return;
  event.preventDefault();
}

async function init() {
  const saved = loadSettings('golf').clubs;
  if (Array.isArray(saved) && saved.length) state.clubs = saved;
  state.pins = loadSettings('golfPins');
  state.test = initFieldTest({ now: () => state.last, say: showStatus });
  $('pinHere').addEventListener('click', pinHere);
  $('windNow').addEventListener('click', windNow);
  buildBag();
  $('resetBag').addEventListener('click', () => {
    state.clubs = BAG.map((c) => ({ ...c }));
    saveSettings('golf', { clubs: state.clubs });
    buildBag();
    newShot();
    render();
  });

  for (const id of ['heading', 'tilt', 'wind', 'from', 'competition', 'follow']) $(id).addEventListener('input', render);
  // Moving to a new spot is a new shot: back to the club for the distance, aimed at the target.
  for (const id of ['along', 'side']) {
    $(id).addEventListener('input', () => {
      newShot();
      render();
    });
  }
  for (const button of document.querySelectorAll('#spots button')) {
    button.addEventListener('click', () => {
      const { length } = lineOf(state.hole);
      const out = button.dataset.out;
      $('along').value = out === 'tee' ? 0 : clamp((length - Number(out)) / length, 0, 1);
      $('side').value = 0;
      newShot();
      render();
    });
  }
  $('course').addEventListener('change', (event) => setCourse(event.target.value));
  $('holeNo').addEventListener('change', (event) => {
    setHole(state.course.holes.find((h) => String(h.number) === event.target.value));
    $('along').value = 0;
    $('side').value = 0;
    render();
  });
  $('gps').addEventListener('change', () => {
    toggleGps();
    render();
  });
  $('sensors').addEventListener('change', toggleSensors);
  window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => setView(button.dataset.view));
  $('screen').addEventListener('click', () => setView(VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length]));
  document.addEventListener('keydown', onKey);

  const params = new URLSearchParams(location.search);
  if (VIEWS.includes(params.get('view'))) state.view = params.get('view');
  if (params.get('course') === 'made-up') $('course').value = 'made-up';
  await setCourse($('course').value);
  const wanted = state.course.holes.find((h) => String(h.number) === params.get('hole'));
  if (wanted) setHole(wanted);
  if (params.has('along')) $('along').value = clamp(Number(params.get('along')) || 0, 0, 1);
  // The hide at address depends on time passing, and the phone's readings arrive on their own, so keep looking.
  setInterval(render, 150);
  render();
}

// For tests and for poking at from the console.
window.sportshudGolf = state;

init();
