// Drawing for the golf display: 600×600, thin bright strokes on black, like
// the other glasses screens. Each function draws one screen from numbers
// worked out by engine/golf.js; nothing is calculated here but where to draw.

import { SIZE, INK, DIM, AHEAD, BEHIND, FONT } from '../ghost/hud.js';
import { createProjection } from '../../engine/index.js';

const WATER = '#7cc7ff';
const RAD = Math.PI / 180;

function clear(ctx) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
}

function text(ctx, string, x, y, size, { color = INK, align = 'center', weight = 500 } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(string, x, y);
  return ctx.measureText(string).width;
}

function stroke(ctx, points, color, width = 2, { closed = false, dash = null } = {}) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash ?? []);
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (closed) ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Whole metres, as a golfer reads them. */
const m = (metres) => String(Math.round(metres));

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassPoint = (bearing) => COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];

/**
 * The wind, as an arrow showing where it is blowing to when you face
 * `facing`: straight down the screen is a headwind.
 */
function windMark(ctx, x, y, wind, facing, color = INK) {
  if (!wind || !(wind.speed > 0)) {
    text(ctx, 'calm', x, y + 8, 24, { color: DIM, align: 'right' });
    return;
  }
  const to = (wind.from + 180 - facing) * RAD; // direction it blows towards, clockwise from up
  const ax = x - 22;
  const ay = y;
  const [dx, dy] = [Math.sin(to), -Math.cos(to)];
  const tail = [ax - dx * 18, ay - dy * 18];
  const tip = [ax + dx * 18, ay + dy * 18];
  stroke(ctx, [tail, tip], color, 4);
  const head = (turn) => [tip[0] - 13 * (dx * Math.cos(turn) - dy * Math.sin(turn)), tip[1] - 13 * (dx * Math.sin(turn) + dy * Math.cos(turn))];
  stroke(ctx, [head(0.6), tip, head(-0.6)], color, 4);
  text(ctx, `${Math.round(wind.speed)}`, ax - 30, y + 9, 28, { color, align: 'right', weight: 600 });
}

function header(ctx, v) {
  text(ctx, `HOLE ${v.hole.number}`, 28, 50, 26, { align: 'left', weight: 600 });
  if (v.hole.par) text(ctx, `PAR ${v.hole.par}`, 28, 80, 20, { align: 'left', color: DIM });
  if (!v.competition) windMark(ctx, SIZE - 28, 44, v.wind, v.aim);
}

/**
 * The green: back, centre and front, the centre largest.
 * @param {object} v
 * @param {{front:number, centre:number, back:number, onGreen:boolean}} v.green from greenDistances
 * @param {number|null} v.pin metres to the pin, if its place is known
 * @param {{club:{name:string}, carry:number}|null} v.suggest the club for the distance; null in competition
 */
export function drawGreen(ctx, v) {
  clear(ctx);
  header(ctx, v);
  const { front, centre, back } = v.green;
  text(ctx, 'BACK', 190, 172, 22, { color: DIM, align: 'right' });
  text(ctx, m(back), 300, 180, 64, { weight: 600 });
  const big = m(centre);
  ctx.font = `700 190px ${FONT}`;
  const wide = ctx.measureText(big).width;
  text(ctx, big, 300, 372, 190, { weight: 700, color: AHEAD });
  text(ctx, 'm', 300 + wide / 2 + 10, 372, 54, { color: AHEAD, align: 'left', weight: 600 });
  text(ctx, 'FRONT', 190, 452, 22, { color: DIM, align: 'right' });
  text(ctx, v.green.onGreen ? 'on' : m(front), 300, 460, 64, { weight: 600 });
  if (v.pin != null) text(ctx, `pin ${m(v.pin)}`, 28, 570, 30, { align: 'left' });
  if (v.suggest) text(ctx, `${v.suggest.club.name}`, SIZE - 28, 570, 30, { align: 'right', color: DIM });
}

/**
 * The hole from above with the aim straight up the screen: where the
 * chosen club lands the ball, and what is in the way.
 * @param {object} v
 * @param {{lat:number, lon:number}} v.position
 * @param {number} v.aim bearing the shot is aimed on
 * @param {{name:string, carry:number}} v.club
 * @param {object|null} v.zone from landingZone; null in competition
 * @param {Array} v.inPlay from hazardsInPlay
 * @param {string|null} v.trouble name of a hazard the zone reaches into
 * @param {number} v.toGreen metres to the middle of the green
 */
export function drawClub(ctx, v) {
  clear(ctx);
  header(ctx, v);

  // Fit: from just behind the golfer to a little past the zone, or the green if that is within reach.
  const far = v.zone ? v.zone.carry + v.zone.deep : 0;
  const reach = Math.max(far + 25, Math.min(v.toGreen + 30, far * 1.7 || v.toGreen + 30));
  const top = 150;
  const base = 520;
  const scale = (base - top) / reach;
  const proj = createProjection(v.position.lat, v.position.lon);
  const sin = Math.sin(v.aim * RAD);
  const cos = Math.cos(v.aim * RAD);
  const toPx = (p) => {
    const [x, y] = proj.toXY(p.lat, p.lon);
    return [300 + (x * cos - y * sin) * scale, base - (x * sin + y * cos) * scale];
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 96, SIZE, 440);
  ctx.clip();
  for (const fairway of v.hole.fairways ?? (v.hole.fairway ? [v.hole.fairway] : [])) stroke(ctx, fairway.map(toPx), DIM, 1.5, { closed: true });
  for (const tee of v.hole.tees ?? []) stroke(ctx, tee.map(toPx), DIM, 1.5, { closed: true });
  for (const hazard of v.hole.hazards ?? []) {
    stroke(ctx, hazard.shape.map(toPx), hazard.kind === 'water' ? WATER : INK, 2, { closed: true, dash: hazard.kind === 'water' ? null : [5, 5] });
  }
  stroke(ctx, v.hole.green.map(toPx), AHEAD, 3, { closed: true });
  if (v.hole.pin) {
    const [px, py] = toPx(v.hole.pin);
    stroke(ctx, [[px, py], [px, py - 20]], AHEAD, 2);
    stroke(ctx, [[px, py - 20], [px + 11, py - 15], [px, py - 10]], AHEAD, 2);
  }
  // The aim line, and the zone on it.
  stroke(ctx, [[300, base], [300, top - 60]], DIM, 1.5, { dash: [3, 9] });
  if (v.zone) {
    const [zx, zy] = toPx(v.zone.centre);
    const color = v.trouble ? BEHIND : INK;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(zx, zy, v.zone.wide * scale, v.zone.deep * scale, 0, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // The golfer.
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(300, base, 7, 0, 2 * Math.PI);
  ctx.fill();

  // What the club is and how far it goes today.
  if (v.zone) {
    text(ctx, v.club.name.toUpperCase(), 300, 50, 34, { weight: 700 });
    const plays = Math.round(v.zone.carry) !== Math.round(v.zone.stillCarry);
    const side = Math.abs(v.zone.drift) >= 1 ? `, ${m(Math.abs(v.zone.drift))} m ${v.zone.drift > 0 ? 'right' : 'left'}` : '';
    text(ctx, plays || side ? `${m(v.zone.stillCarry)} m, lands ${m(v.zone.carry)}${side}` : `${m(v.zone.stillCarry)} m`, 300, 84, 24, { color: DIM });
    text(ctx, '◀', 150, 48, 26, { color: DIM });
    text(ctx, '▶', 450, 48, 26, { color: DIM });
  } else {
    text(ctx, 'DISTANCES ONLY', 300, 54, 28, { weight: 600 });
  }
  // The line at the bottom: trouble first, else the nearest hazard's numbers.
  const nearest = v.inPlay[0];
  if (v.trouble) text(ctx, `REACHES: ${v.trouble.toUpperCase()}`, 300, 574, 26, { color: BEHIND, weight: 600 });
  else if (nearest) text(ctx, `${nearest.name}: reach ${m(nearest.reach)}, carry ${m(nearest.carry)}`, 300, 574, 24, { color: DIM });
  else text(ctx, `green ${m(v.toGreen)}`, 300, 574, 24, { color: DIM });
}

/**
 * Look to range: what the golfer is looking towards, and how far it is.
 * @param {object} v
 * @param {number} v.heading bearing faced
 * @param {{feature:{name:string, kind:string}, distance:number, off:number}|null} v.target from lookTarget
 * @param {Array<{feature:object, distance:number, off:number}>} v.around from lookAround, for the cue when nothing is in view
 * @param {number} v.half degrees either side of the gaze the display covers
 */
export function drawLook(ctx, v) {
  clear(ctx);
  text(ctx, `${String(Math.round(((v.heading % 360) + 360) % 360)).padStart(3, '0')}° ${compassPoint(v.heading)}`, 300, 50, 26, { color: DIM });
  // Where things are across the display: a tick for each feature in view.
  const acrossX = (off) => 300 + (off / v.half) * 260;
  stroke(ctx, [[40, 110], [560, 110]], DIM, 1.5);
  stroke(ctx, [[300, 98], [300, 122]], INK, 2);
  for (const f of v.around) {
    if (Math.abs(f.off) > v.half) continue;
    const x = acrossX(f.off);
    const mine = v.target && f.feature === v.target.feature;
    stroke(ctx, [[x, 100], [x, 120]], mine ? AHEAD : DIM, mine ? 5 : 3);
  }
  if (v.target) {
    text(ctx, m(v.target.distance), 300, 350, 190, { weight: 700, color: AHEAD });
    text(ctx, v.target.feature.name.toUpperCase(), 300, 420, 38, { weight: 600 });
    text(ctx, 'metres', 300, 462, 24, { color: DIM });
  } else {
    text(ctx, 'NOTHING MAPPED HERE', 300, 300, 30, { color: DIM, weight: 600 });
    // Point the way to the nearest thing, and say how far round it is.
    const next = v.around[0];
    if (next) {
      const left = next.off < 0;
      text(ctx, left ? '◀' : '▶', left ? 60 : 540, 372, 54);
      text(ctx, `${next.feature.name}, ${Math.round(Math.abs(next.off))}° ${left ? 'left' : 'right'}`, 300, 368, 30);
    }
  }
}

/** At address: nothing at all. Black is see-through on the glasses. */
export function drawHidden(ctx) {
  clear(ctx);
}
