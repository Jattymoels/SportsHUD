// Golf HUD at the desk. Every number comes from engine/golf.js; this file
// stands in for GPS, the compass and a wind forecast with sliders, and draws.

import {
  bearingTo, distanceTo, pointAlong, centreOf, greenDistances, carryInWind, landingZone, clubFor, zoneTouches,
  hazardsInPlay, lookTarget, lookAround, featuresOf, createAddressHider, DEFAULT_CLUBS,
} from '../../engine/index.js';
import { HOLE } from '../../fixtures/golf.mjs';
import { drawGreen, drawClub, drawLook, drawHidden, compassPoint } from './screens.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const VIEWS = ['green', 'club', 'look'];
const DISPLAY_HALF = 10; // degrees either side of the gaze the display covers: 20 across, as on the glasses

const state = {
  hole: HOLE,
  clubs: DEFAULT_CLUBS,
  view: 'green',
  club: null, // index into clubs once chosen by hand; null follows the distance
  nudge: 0, // degrees the aim has been moved off the target by hand
  hider: createAddressHider(),
  hidden: false,
};

// ------------------------------------------------------------ the golfer --

/** Lengths of each leg of the line of play, and their total. */
const legs = state.hole.line.slice(1).map((p, i) => distanceTo(state.hole.line[i], p));
const lineLength = legs.reduce((sum, d) => sum + d, 0);

/** The position `share` of the way along the line of play, `side` metres to its right. */
function positionAt(share, side) {
  let left = share * lineLength;
  for (let i = 0; i < legs.length; i++) {
    if (left <= legs[i] || i === legs.length - 1) {
      const bearing = bearingTo(state.hole.line[i], state.hole.line[i + 1]);
      return pointAlong(pointAlong(state.hole.line[i], bearing, left), bearing + 90, side);
    }
    left -= legs[i];
  }
  return state.hole.line[0];
}

/** Everything the screens show, for where the sliders put the golfer. */
function work() {
  const { hole, clubs } = state;
  const position = positionAt(Number($('along').value), Number($('side').value));
  const competition = $('competition').checked;
  const wind = { speed: Number($('wind').value), from: Number($('from').value) };
  const green = greenDistances(position, hole.green);
  const pin = hole.pin ? distanceTo(position, hole.pin) : null;

  // What to aim at: the pin if the green is in reach of the longest club,
  // otherwise the next point of the line of play still a good way off.
  const longest = Math.max(...clubs.map((c) => c.carry));
  let target = { name: hole.pin ? 'the pin' : 'the green', at: hole.pin ?? centreOf(hole.green) };
  if (green.centre > longest + 20) {
    const ahead = hole.line.slice(1, -1).find((p) => distanceTo(position, p) > 60 && distanceTo(p, centreOf(hole.green)) < green.centre);
    if (ahead) target = { name: 'the corner', at: ahead };
  }
  const toTarget = distanceTo(position, target.at);
  const aim = (bearingTo(position, target.at) + state.nudge + 360) % 360;

  const suggest = clubFor(toTarget, aim, clubs, competition ? null : wind);
  const club = clubs[state.club ?? clubs.indexOf(suggest.club)];
  const zone = competition ? null : landingZone(position, aim, club, wind);
  const flight = carryInWind(club.carry, wind, aim);
  const inPlay = hazardsInPlay(position, aim, hole.hazards);
  const trouble = zone ? (hole.hazards.find((h) => zoneTouches(zone, h.shape))?.name ?? null) : null;

  const heading = $('follow').checked ? aim : Number($('heading').value);
  const features = featuresOf(hole);
  const around = lookAround(position, heading, features);
  const target2 = lookTarget(position, heading, features);
  return { hole, position, competition, wind, green, pin, target, toTarget, aim, suggest, club, zone, flight, inPlay, trouble, heading, around, look: target2 };
}

// --------------------------------------------------------------- drawing --

function render() {
  const w = work();
  const tilt = Number($('tilt').value);
  state.hidden = state.hider.update(tilt, performance.now() / 1000);
  const ctx = $('screen').getContext('2d');
  if (state.hidden) drawHidden(ctx);
  else if (state.view === 'green') drawGreen(ctx, { hole: w.hole, green: w.green, pin: w.pin, wind: w.wind, aim: w.aim, competition: w.competition, suggest: w.competition ? null : w.suggest });
  else if (state.view === 'club') drawClub(ctx, { hole: w.hole, position: w.position, aim: w.aim, club: w.club, zone: w.zone, inPlay: w.inPlay, trouble: w.trouble, toGreen: w.green.centre, wind: w.wind, competition: w.competition });
  else drawLook(ctx, { heading: w.heading, target: w.look, around: w.around, half: DISPLAY_HALF });

  const names = { green: 'the green', club: 'the club and its landing zone', look: 'look to range' };
  $('viewName').textContent = state.hidden ? 'hidden: looking down at the ball' : names[state.view];
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === state.view));

  // The sliders' own read-outs.
  $('alongOut').textContent = `${Math.round(Number($('along').value) * lineLength)} m from the tee`;
  const side = Number($('side').value);
  $('sideOut').textContent = side === 0 ? 'on it' : `${Math.abs(side)} m ${side > 0 ? 'right' : 'left'}`;
  $('heading').disabled = $('follow').checked;
  if ($('follow').checked) $('heading').value = Math.round(w.heading) % 360;
  $('headingOut').textContent = `${String(Math.round(w.heading) % 360).padStart(3, '0')}° ${compassPoint(w.heading)}`;
  $('tiltOut').textContent = tilt === 0 ? 'level' : `${Math.abs(tilt)}° ${tilt < 0 ? 'down' : 'up'}`;
  $('windOut').textContent = w.wind.speed ? `${w.wind.speed} km/h` : 'calm';
  $('fromOut').textContent = `from the ${compassPoint(w.wind.from)} (${String(w.wind.from).padStart(3, '0')}°)`;

  numbers(w);
}

function numbers(w) {
  const m = (v) => `${v.toFixed(1)} m`;
  const rows = [
    ['Green, along the line from you through its middle', `front ${m(w.green.front)} · centre ${m(w.green.centre)} · back ${m(w.green.back)}${w.green.onGreen ? ' (you are on it)' : ''}`],
    ['Pin', w.pin == null ? 'not set' : m(w.pin)],
    ['Aiming at', `${w.target.name}, ${m(w.toTarget)} away on ${w.aim.toFixed(1)}°${state.nudge ? ` (moved ${Math.abs(state.nudge)}° ${state.nudge > 0 ? 'right' : 'left'} by hand)` : ''}`],
  ];
  if (!w.competition) {
    const head = w.flight.head;
    const cross = w.flight.cross;
    rows.push(
      ['Wind on this shot', w.wind.speed ? `${Math.abs(head).toFixed(1)} km/h ${head >= 0 ? 'against' : 'behind'}, ${Math.abs(cross).toFixed(1)} km/h from the ${cross >= 0 ? 'left' : 'right'}` : 'calm'],
      ['Club', `${w.club.name}${state.club == null ? ' (nearest to the distance)' : ' (chosen by hand)'}: ${m(w.club.carry)} in still air`],
      ['Where it lands', `${m(w.zone.carry)} out${Math.abs(w.zone.drift) >= 0.05 ? `, ${m(Math.abs(w.zone.drift))} ${w.zone.drift > 0 ? 'right' : 'left'} of the aim` : ''}; zone ${m(2 * w.zone.deep)} long by ${m(2 * w.zone.wide)} wide`],
      ['Zone reaches into', w.trouble ?? 'nothing'],
    );
  }
  rows.push(
    ['Hazards in play, nearest first', w.inPlay.length ? w.inPlay.map((h) => `${h.name}: reach ${m(h.reach)}, carry ${m(h.carry)}, ${Math.abs(h.off).toFixed(0)}° ${h.off > 0 ? 'right' : 'left'}`).join(' · ') : 'none within 25° of the aim'],
    ['Looking at', w.look ? `${w.look.feature.name}, ${m(w.look.distance)}, ${Math.abs(w.look.off).toFixed(1)}° ${w.look.off > 0 ? 'right' : 'left'} of where you face` : `nothing within 7.5°; nearest is ${w.around[0]?.feature.name ?? 'nothing'}, ${Math.abs(w.around[0]?.off ?? 0).toFixed(0)}° ${w.around[0]?.off > 0 ? 'right' : 'left'}`],
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
  else if (state.view === 'club' && turn) {
    // Right is a longer club, left a shorter one.
    const now = state.club ?? state.clubs.indexOf(work().suggest.club);
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

function init() {
  for (const id of ['along', 'side', 'heading', 'tilt', 'wind', 'from', 'competition', 'follow']) $(id).addEventListener('input', render);
  // Moving to a new spot is a new shot: back to the club for the distance, aimed at the target.
  for (const id of ['along', 'side']) {
    $(id).addEventListener('input', () => {
      state.club = null;
      state.nudge = 0;
      render();
    });
  }
  for (const button of document.querySelectorAll('[data-spot]')) {
    button.addEventListener('click', () => {
      $('along').value = button.dataset.spot;
      $('side').value = 0;
      state.club = null;
      state.nudge = 0;
      render();
    });
  }
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => setView(button.dataset.view));
  $('screen').addEventListener('click', () => setView(VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length]));
  document.addEventListener('keydown', onKey);

  const params = new URLSearchParams(location.search);
  if (VIEWS.includes(params.get('view'))) state.view = params.get('view');
  if (params.has('along')) $('along').value = clamp(Number(params.get('along')) || 0, 0, 1);
  // The hide at address depends on time passing, so keep looking.
  setInterval(render, 150);
  render();
}

init();
