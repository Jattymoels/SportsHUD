// The view through the glasses: a first-person scene along a recorded
// route, with what the glasses would add drawn over it.
//
// Two layers. The world is a plain stand-in for what your eyes see: sky,
// ground, the path, posts beside it. Over that goes what the glasses add,
// drawn as light, and only inside the part of your view the display covers.

import { smoothPoint, ghostForm } from '../../engine/index.js';
import { ghostGlyph, drawRun, clock, pace, INK, AHEAD, BEHIND, FONT } from '../ghost/hud.js';
import { describe, metres } from '../route/screen.js';

const RAD = Math.PI / 180;
const EYE = 1.6; // metres above the ground
export const VIEW_FOV = 64; // degrees of your view the picture spans, left to right, unless told otherwise
const RUNNER_PITCH = -5 * RAD; // looking slightly down, as a runner does
const GUIDE = '#8fdcff';
const MARKER = '#ffe9a8';

const square = document.createElement('canvas');
square.width = 600;
square.height = 600;

/** The point `d` metres along the route, with GPS wobble averaged out: the engine's, under the name used here. */
export const steady = smoothPoint;

// How strongly things placed in the world are showing on each canvas drawn
// on, eased towards what the engine asks for: fading out as the runner stops
// and back as they set off takes most of a second, never a blink.
const showing = new WeakMap();
function easedShow(canvas, target) {
  const now = performance.now();
  const was = showing.get(canvas) ?? { value: target, at: now };
  const dt = Math.min(0.25, (now - was.at) / 1000);
  const value = was.value + (target - was.value) * (1 - Math.exp(-dt / 0.3));
  showing.set(canvas, { value, at: now });
  return value;
}

/** Sample distances ahead of the runner: close together near, spreading out far. */
function ahead(from, to, reach) {
  const out = [];
  for (let step = 1.5; step < reach && from + step < to; step *= 1.13) out.push(from + step);
  return out;
}

/**
 * @param ctx a 2D canvas context, W×H
 * @param {object} v
 * @param route from the engine
 * @param {number} v.dist the runner's distance along the route, metres
 * @param {number} v.yaw direction of gaze, radians clockwise from north
 * @param {number|null} v.ghostDist the ghost's distance along the route
 * @param {number} v.timeGap seconds; positive is ahead of the ghost
 * @param {number} v.speed m/s
 * @param {number} v.time seconds on the runner's clock
 * @param {number} v.distance metres the runner has covered
 * @param {boolean} v.paused
 * @param {string} v.ghostLabel
 * @param {'anchored'|'square'} v.style what the glasses draw
 * @param {{w:number, h:number}|null} v.display degrees of view the display covers; null for all of it
 * @param {number} v.markerEvery metres between distance markers
 * @param {Array<{d:number, label:string, major:boolean}>} [v.gates] the gates to stand across the path, each `d` metres
 *   along the route, in place of the route's own markers and finish: for a
 *   path with no end, or markers that count the runner's distance and not the route's
 * @param {number} [v.lineTo] metres ahead the line along the path is drawn; 150 unless told
 * @param {Array<{kind:string, dist:number}>} [v.features] turns, likely waits
 *   and climbs along the route, from the engine's route guide; a sign is
 *   placed in the world at each
 * @param {{now:object|null, then:object|null}} [v.cue] the next thing to act
 *   on, from the engine's nextCue; named at the top of the display while it
 *   is within 400 m, since a sign that far off is too small to read
 * @param {number} [v.fov] degrees the picture spans, left to right
 * @param {number} [v.pitch] radians the gaze is above the horizon
 * @param {number} [v.roll] radians the view is tilted clockwise
 * @param {boolean} [v.world] draw the stand-in street; false when a camera
 *   picture is behind the canvas instead
 * @param {boolean} [v.readouts] show the gap and pace; false while lining up
 * @param {number} [v.unit] canvas pixels per unit of text and line size
 * @param {number} [v.eye] metres this eye sits to the right of the middle of the head, when a picture is drawn for each eye
 */
export function drawScene(ctx, W, H, route, v) {
  const focal = W / 2 / Math.tan(((v.fov ?? VIEW_FOV) / 2) * RAD);
  const u = v.unit ?? W / 1280; // sizes below are for a picture 1280 wide, unless told the unit
  const pitch = v.pitch ?? RUNNER_PITCH;
  const here = steady(route, v.dist);
  const sin = Math.sin(v.yaw);
  const cos = Math.cos(v.yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sr = Math.sin(-(v.roll ?? 0));
  const cr = Math.cos(-(v.roll ?? 0));
  /** A point in the world (x east, y north, z up, metres) on the screen; null if behind you. */
  const project = (x, y, z = 0) => {
    const dx = x - here.x;
    const dy = y - here.y;
    const flat = dx * sin + dy * cos;
    const right = dx * cos - dy * sin - (v.eye ?? 0);
    const up = z - EYE;
    const forward = flat * cp + up * sp;
    if (forward < 0.8) return null;
    // On the picture, before and then after allowing for a tilted head.
    const px = (focal * right) / forward;
    const py = -(focal * (up * cp - flat * sp)) / forward;
    return { x: W / 2 + px * cr - py * sr, y: H / 2 + px * sr + py * cr, depth: forward };
  };
  const horizon = H / 2 + focal * Math.tan(pitch);
  const world = v.world ?? true;

  // ------------------------------------------------- the world, as it is --
  ctx.clearRect(0, 0, W, H);
  if (world) {
    const far = 2 * Math.hypot(W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-(v.roll ?? 0));
    ctx.translate(-W / 2, -H / 2);
    const sky = ctx.createLinearGradient(0, horizon - H, 0, horizon);
    sky.addColorStop(0, '#15202e');
    sky.addColorStop(1, '#5d6f7d');
    ctx.fillStyle = sky;
    ctx.fillRect(-far, horizon - far, 2 * far + W, far);
    const ground = ctx.createLinearGradient(0, horizon, 0, horizon + H);
    ground.addColorStop(0, '#39413a');
    ground.addColorStop(1, '#1c211d');
    ctx.fillStyle = ground;
    ctx.fillRect(-far, horizon, 2 * far + W, far);
    ctx.restore();
  }

  // The path, as a strip 3 m wide, and its centre line for later.
  const samples = ahead(v.dist, route.length, 420).map((d) => {
    const c = steady(route, d);
    const n = steady(route, Math.min(route.length, d + 2));
    const len = Math.hypot(n.x - c.x, n.y - c.y) || 1;
    const nx = (n.y - c.y) / len; // unit normal, to the right of travel
    const ny = -(n.x - c.x) / len;
    return { d, c, nx, ny, centre: project(c.x, c.y), left: project(c.x - nx * 1.5, c.y - ny * 1.5), right: project(c.x + nx * 1.5, c.y + ny * 1.5) };
  });
  ctx.fillStyle = '#4a4e50';
  for (let i = samples.length - 1; world && i > 0; i--) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a.left || !a.right || !b.left || !b.right) continue;
    ctx.beginPath();
    ctx.moveTo(a.left.x, a.left.y);
    ctx.lineTo(b.left.x, b.left.y);
    ctx.lineTo(b.right.x, b.right.y);
    ctx.lineTo(a.right.x, a.right.y);
    ctx.fill();
  }
  // Posts beside the path every 20 m, so that movement shows.
  ctx.strokeStyle = '#6a7074';
  for (let d = Math.ceil((v.dist + 3) / 20) * 20; world && d < Math.min(route.length, v.dist + 260); d += 20) {
    const c = steady(route, d);
    const n = steady(route, Math.min(route.length, d + 2));
    const len = Math.hypot(n.x - c.x, n.y - c.y) || 1;
    const side = (d / 20) % 2 ? 3.2 : -3.2;
    const px = c.x + ((n.y - c.y) / len) * side;
    const py = c.y - ((n.x - c.x) / len) * side;
    const foot = project(px, py, 0);
    const top = project(px, py, 3);
    if (!foot || !top) continue;
    ctx.lineWidth = Math.max(u, (0.12 * focal) / foot.depth);
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
  }

  // --------------------------------------- what the display can light up --
  const box = v.display
    ? { w: 2 * focal * Math.tan((v.display.w / 2) * RAD), h: 2 * focal * Math.tan((v.display.h / 2) * RAD) }
    : { w: W, h: H };
  box.x = (W - box.w) / 2;
  box.y = (H - box.h) / 2;
  const inBox = (p) => p && p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
  const level = Math.abs(v.timeGap) < 0.5;
  const color = level ? INK : v.timeGap > 0 ? AHEAD : BEHIND;
  const write = (string, x, y, size, { fill = INK, align = 'center', weight = 600 } = {}) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = fill;
    ctx.textAlign = align;
    ctx.fillText(string, x, y);
  };

  // How the ghost is drawn at this distance on a display this tall, and how
  // strongly anything placed in the world shows: right down while stopped.
  const form = ghostForm({
    lead: v.ghostDist == null ? null : v.ghostDist - v.dist,
    speed: v.speed,
    paused: v.paused,
    running: v.readouts ?? true,
    displayTall: (2 * Math.atan(box.h / 2 / focal)) / RAD,
  });
  const show = easedShow(ctx.canvas, form.world);
  /** Light for something placed in the world: its own strength, less whatever the world is faded by. */
  const light = (strength) => (ctx.globalAlpha = strength * show);

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter'; // the display adds light; it cannot darken

  if (v.style === 'square') {
    // Today's display: the heads-up screen, fixed in your view.
    drawRun(square.getContext('2d'), {
      time: v.time, distance: v.distance, speed: v.speed, timeGap: v.timeGap, distGap: v.ghostDist == null ? 0 : v.dist - v.ghostDist,
      trend: 0, ghostLabel: v.ghostLabel, paused: v.paused, notice: null, banner: null, float: performance.now() / 1000,
    });
    const side = Math.min(box.w, box.h);
    ctx.drawImage(square, W / 2 - side / 2, H / 2 - side / 2, side, side);
  } else {
    // The direction: things placed in the world, along the route.
    // A thin line down the path for the next 150 m, starting a few steps
    // ahead: brighter for the first 60 m, fainter beyond.
    ctx.strokeStyle = GUIDE;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const reach = v.lineTo ?? 150;
    for (const [from, to, alpha, width] of [[4, 60, 0.8, 3.5], [60, 150, 0.4, 2]]) {
      light(alpha);
      ctx.lineWidth = width * u;
      ctx.beginPath();
      let drawing = false;
      for (const sample of samples) {
        const away = sample.d - v.dist;
        if (!sample.centre || away < from || away > Math.min(to + 8, reach)) {
          drawing = false;
          continue;
        }
        if (drawing) ctx.lineTo(sample.centre.x, sample.centre.y);
        else ctx.moveTo(sample.centre.x, sample.centre.y);
        drawing = true;
      }
      ctx.stroke();
    }
    light(1);

    // A gate across the path at each marker, and at the finish.
    const gates = v.gates ? [...v.gates] : [];
    for (let d = v.markerEvery; !v.gates && d < route.length - 30; d += v.markerEvery) gates.push({ d, label: d % 1000 === 0 ? `${d / 1000} km` : `${(d / 1000).toFixed(1)} km`, major: d % 1000 === 0 });
    if (!v.gates) gates.push({ d: route.length, label: 'FINISH', major: true });
    for (const gate of gates) {
      const away = gate.d - v.dist;
      if (away < 2 || away > 450) continue;
      const c = steady(route, gate.d);
      const b = steady(route, Math.max(0, gate.d - 2));
      const len = Math.hypot(c.x - b.x, c.y - b.y) || 1;
      const nx = (c.y - b.y) / len;
      const ny = -(c.x - b.x) / len;
      const half = 1.9;
      const tall = gate.major ? 2.9 : 2.3;
      const corners = [[-half, 0], [-half, tall], [half, tall], [half, 0]].map(([s, z]) => project(c.x + nx * s, c.y + ny * s, z));
      if (corners.some((p) => !p)) continue;
      ctx.strokeStyle = MARKER;
      light(gate.major ? 1 : 0.75);
      ctx.lineWidth = Math.max(1.5 * u, ((gate.major ? 0.1 : 0.07) * focal) / corners[0].depth);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (const p of corners.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      const top = project(c.x, c.y, tall);
      const size = Math.max(14 * u, Math.min(54 * u, (0.75 * focal) / top.depth));
      write(gate.label, top.x, top.y - size * 0.45, size, { fill: MARKER });
      if (away > 25) write(`${Math.round(away / 5) * 5} m`, top.x, top.y - size * 1.5, Math.max(11 * u, size * 0.6), { fill: MARKER, weight: 400 });
      light(1);
    }

    // A sign at each thing the route guide knows about: chevrons across the
    // path at a turn, a pause mark beside it where runs tend to wait, a
    // slope at the foot of a climb.
    for (const f of v.features ?? []) {
      const away = f.dist - v.dist;
      if (away < 2 || away > 320) continue;
      const c = steady(route, f.dist);
      const b = steady(route, Math.max(0, f.dist - 8)); // the way in
      const len = Math.hypot(c.x - b.x, c.y - b.y) || 1;
      const nx = (c.y - b.y) / len; // to the right of the way in
      const ny = -(c.x - b.x) / len;
      const at = (s, z) => project(c.x + nx * s, c.y + ny * s, z);
      const shape = (points, width) => {
        if (points.some((p) => !p)) return false;
        ctx.lineWidth = Math.max(2 * u, (width * focal) / points[0].depth);
        ctx.beginPath();
        points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        return true;
      };
      let label = null;
      let top = null;
      let tint = GUIDE;
      if (f.kind === 'turn') {
        const way = f.side === 'left' ? -1 : 1;
        ctx.strokeStyle = GUIDE;
        for (const k of [-1, 0, 1]) shape([at(k * 0.95 - way * 0.3, 1.92), at(k * 0.95 + way * 0.3, 1.5), at(k * 0.95 - way * 0.3, 1.08)], 0.1);
        label = f.shape === 'back' ? 'TURN BACK' : `${f.shape === 'sharp' ? 'SHARP ' : ''}${f.side.toUpperCase()}`;
        top = at(0, 2.2);
      } else if (f.kind === 'wait') {
        tint = BEHIND;
        ctx.strokeStyle = BEHIND;
        shape([at(2.4, 0), at(2.4, 1.15)], 0.04);
        shape([at(2.18, 1.3), at(2.18, 2.1)], 0.13);
        shape([at(2.62, 1.3), at(2.62, 2.1)], 0.13);
        label = `WAIT ~${f.typical < 90 ? `${Math.max(5, Math.round(f.typical / 5) * 5)} s` : clock(Math.round(f.typical))}`;
        top = at(2.4, 2.3);
      } else if (f.kind === 'climb') {
        tint = MARKER;
        ctx.strokeStyle = MARKER;
        shape([at(-3.2, 1.2), at(-1.8, 1.2), at(-1.8, 2.0), at(-3.2, 1.2)], 0.07);
        label = `CLIMB +${Math.round(f.gain)} m`;
        top = at(-2.5, 2.2);
      }
      // Words only once it is close: further off, signs sit on top of one
      // another and nothing could be read. The cue at the top covers those.
      if (!label || !top || away > 40) continue;
      const size = Math.max(13 * u, Math.min(44 * u, (0.6 * focal) / top.depth));
      write(label, top.x, top.y - size * 0.45, size, { fill: tint });
    }

    // The ghost, standing on the path where it is. Close up it would not
    // fit, so there it is a mark at the shoulder instead: the engine says
    // how much of each to draw.
    const lead = v.ghostDist == null ? null : v.ghostDist - v.dist; // metres the ghost is ahead of you
    if (form.where === 'ahead') {
      const g = steady(route, v.ghostDist);
      const feet = project(g.x, g.y, 0);
      if (feet && form.shoulder > 0) {
        // Its head and shoulders, a fixed size, rising from the bottom edge
        // in the direction it is, kept clear of the numbers in the corners.
        light(form.shoulder);
        const height = box.h * 0.42;
        const x = Math.max(box.x + box.w * 0.3, Math.min(box.x + box.w * 0.7, feet.x));
        ghostGlyph(ctx, x, box.y + box.h + height * 0.52, height, color, 0.22);
        write(`${Math.round(lead)} m`, x + height * 0.36 + 10 * u, box.y + box.h - height * 0.2, Math.max(14 * u, Math.min(30 * u, height * 0.22)), { fill: color, align: 'left' });
      }
      light(form.figure);
      if (form.figure <= 0) {
        // Nothing of the figure to draw.
      } else if (inBox(feet)) {
        const height = Math.max(12 * u, (1.75 * focal) / feet.depth);
        const bob = v.paused ? 0 : Math.sin(performance.now() / 260) * height * 0.03;
        ghostGlyph(ctx, feet.x, feet.y + bob, height, color, 0.22);
        // Its distance, beside it, where a gate's label will not sit.
        const size = Math.max(14 * u, Math.min(30 * u, height * 0.3));
        write(`${Math.round(lead)} m`, feet.x + height * 0.36 + 10 * u, feet.y - height * 0.45, size, { fill: color, align: 'left' });
      } else if (feet && form.shoulder === 0) {
        // Out of the display's reach: point to it from the nearest edge. (Not
        // while the mark at the shoulder is showing: then it is below the
        // display because it is close, not off to one side.)
        const leftward = feet.x < W / 2;
        const x = leftward ? box.x + 16 * u : box.x + box.w - 16 * u;
        const y = Math.max(box.y + 30 * u, Math.min(box.y + box.h - 70 * u, feet.y - 40 * u));
        write(leftward ? '◀' : '▶', x, y + 8 * u, 24 * u, { fill: color });
        write(`${Math.round(lead)} m`, leftward ? x + 20 * u : x - 20 * u, y + 7 * u, 18 * u, { fill: color, align: leftward ? 'left' : 'right' });
      }
      if (!feet) {
        // Ahead on the route but behind your head, round a bend: point the way.
        light(1);
        const g2 = Math.atan2(g.x - here.x, g.y - here.y) - v.yaw;
        const leftward = Math.sin(g2) < 0;
        write(leftward ? '◀' : '▶', leftward ? box.x + 16 * u : box.x + box.w - 16 * u, H / 2 + 8 * u, 24 * u, { fill: color });
      }
    }
    // What follows is fixed in the view, and stays lit whatever the world does.
    ctx.globalAlpha = 1;

    // Fixed in your view, small, along the bottom where the road is nearest:
    // the gap, your pace, and the ghost if it is behind you.
    if (v.readouts ?? true) {
    const big = Math.max(18 * u, Math.min(60 * u, box.h * 0.14, box.w * 0.1));
    const floor = box.y + box.h - 12 * u;
    const size = Math.abs(v.timeGap);
    const number = size < 0.5 ? 'level' : `${v.timeGap > 0 ? '+' : '−'}${size < 99.5 ? `${Math.round(size)} s` : clock(Math.round(size))}`;
    write(number, box.x + box.w - 12 * u, floor, big, { fill: color, align: 'right', weight: 700 });
    write(v.speed > 0.4 ? `${pace(1000 / v.speed)} /km` : '–:–– /km', box.x + 12 * u, floor, big * 0.5, { align: 'left', weight: 500 });
    if (v.paused) write('PAUSED', W / 2, box.y + big * 0.7, big * 0.5, {});
    else if (v.cue?.now && v.cue.now.in <= 400) {
      // The next thing to act on, named at the top of the display.
      const { now, then } = v.cue;
      const arrow = now.kind !== 'turn' ? ['', ''] : now.side === 'left' ? ['◀ ', ''] : ['', ' ▶'];
      write(`${arrow[0]}${describe(now).title}${arrow[1]}  ${metres(now.in)}`, W / 2, box.y + big * 0.75, big * 0.55, { fill: now.kind === 'wait' ? BEHIND : INK, weight: 700 });
      const more = then && then.in - now.in <= 150 ? `then ${describe(then).title} ${metres(then.in)}` : describe(now).detail;
      if (more) write(more, W / 2, box.y + big * 1.3, big * 0.36, { weight: 400 });
    }
    if (!v.paused && lead != null && lead < -1.2) write(`▼ ghost ${Math.round(-lead)} m behind`, W / 2, floor - big * 1.2, big * 0.5, { fill: color });
    }
  }
  ctx.restore();

  // The edge of the display, so its reach is plain.
  if (v.display) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = u;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
  }
}
