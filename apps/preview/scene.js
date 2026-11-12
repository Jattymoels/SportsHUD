// The view through the glasses: a first-person scene along a recorded
// route, with what the glasses would add drawn over it.
//
// Two layers. The world is a plain stand-in for what your eyes see: sky,
// ground, the path, posts beside it. Over that goes what the glasses add,
// drawn as light, and only inside the part of your view the display covers.

import { pointAtDistance } from '../../engine/index.js';
import { ghostGlyph, drawRun, clock, pace, INK, AHEAD, BEHIND, FONT } from '../ghost/hud.js';

const RAD = Math.PI / 180;
const EYE = 1.6; // metres above the ground
export const VIEW_FOV = 64; // degrees of your view the picture spans, left to right, unless told otherwise
const RUNNER_PITCH = -5 * RAD; // looking slightly down, as a runner does
const GUIDE = '#8fdcff';
const MARKER = '#ffe9a8';

const square = document.createElement('canvas');
square.width = 600;
square.height = 600;

/**
 * The point `d` metres along the route, with GPS wobble averaged out over
 * the 12 m either side, so the path and the view along it are steady.
 */
export function steady(route, d) {
  let x = 0;
  let y = 0;
  for (const shift of [-12, -6, 0, 6, 12]) {
    const p = pointAtDistance(route, d + shift);
    x += p.x / 5;
    y += p.y / 5;
  }
  return { x, y };
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
 * @param {number} [v.fov] degrees the picture spans, left to right
 * @param {number} [v.pitch] radians the gaze is above the horizon
 * @param {number} [v.roll] radians the view is tilted clockwise
 * @param {boolean} [v.world] draw the stand-in street; false when a camera
 *   picture is behind the canvas instead
 * @param {boolean} [v.readouts] show the gap and pace; false while lining up
 * @param {number} [v.unit] canvas pixels per unit of text and line size
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
    const right = dx * cos - dy * sin;
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
    for (const [from, to, alpha, width] of [[4, 60, 0.8, 3.5], [60, 150, 0.4, 2]]) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width * u;
      ctx.beginPath();
      let drawing = false;
      for (const sample of samples) {
        const away = sample.d - v.dist;
        if (!sample.centre || away < from || away > to + 8) {
          drawing = false;
          continue;
        }
        if (drawing) ctx.lineTo(sample.centre.x, sample.centre.y);
        else ctx.moveTo(sample.centre.x, sample.centre.y);
        drawing = true;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // A gate across the path at each marker, and at the finish.
    const gates = [];
    for (let d = v.markerEvery; d < route.length - 30; d += v.markerEvery) gates.push({ d, label: d % 1000 === 0 ? `${d / 1000} km` : `${(d / 1000).toFixed(1)} km`, major: d % 1000 === 0 });
    gates.push({ d: route.length, label: 'FINISH', major: true });
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
      ctx.globalAlpha = gate.major ? 1 : 0.75;
      ctx.lineWidth = Math.max(1.5 * u, ((gate.major ? 0.1 : 0.07) * focal) / corners[0].depth);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (const p of corners.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      const top = project(c.x, c.y, tall);
      const size = Math.max(14 * u, Math.min(54 * u, (0.75 * focal) / top.depth));
      write(gate.label, top.x, top.y - size * 0.45, size, { fill: MARKER });
      if (away > 25) write(`${Math.round(away / 5) * 5} m`, top.x, top.y - size * 1.5, Math.max(11 * u, size * 0.6), { fill: MARKER, weight: 400 });
      ctx.globalAlpha = 1;
    }

    // The ghost, standing on the path where it is.
    const lead = v.ghostDist == null ? null : v.ghostDist - v.dist; // metres the ghost is ahead of you
    if (lead != null && lead > 1.2) {
      const g = steady(route, v.ghostDist);
      const feet = project(g.x, g.y, 0);
      if (inBox(feet)) {
        const height = Math.max(12 * u, (1.75 * focal) / feet.depth);
        const bob = v.paused ? 0 : Math.sin(performance.now() / 260) * height * 0.03;
        ghostGlyph(ctx, feet.x, feet.y + bob, height, color, 0.22);
        // Its distance, beside it, where a gate's label will not sit.
        const size = Math.max(14 * u, Math.min(30 * u, height * 0.3));
        write(`${Math.round(lead)} m`, feet.x + height * 0.36 + 10 * u, feet.y - height * 0.45, size, { fill: color, align: 'left' });
      } else if (feet) {
        // Out of the display's reach: point to it from the nearest edge.
        const leftward = feet.x < W / 2;
        const x = leftward ? box.x + 16 * u : box.x + box.w - 16 * u;
        const y = Math.max(box.y + 30 * u, Math.min(box.y + box.h - 70 * u, feet.y - 40 * u));
        write(leftward ? '◀' : '▶', x, y + 8 * u, 24 * u, { fill: color });
        write(`${Math.round(lead)} m`, leftward ? x + 20 * u : x - 20 * u, y + 7 * u, 18 * u, { fill: color, align: leftward ? 'left' : 'right' });
      } else {
        // Ahead on the route but behind your head, round a bend: point the way.
        const g2 = Math.atan2(g.x - here.x, g.y - here.y) - v.yaw;
        const leftward = Math.sin(g2) < 0;
        write(leftward ? '◀' : '▶', leftward ? box.x + 16 * u : box.x + box.w - 16 * u, H / 2 + 8 * u, 24 * u, { fill: color });
      }
    }

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
    else if (lead != null && lead < -1.2) write(`▼ ghost ${Math.round(-lead)} m behind`, W / 2, floor - big * 1.2, big * 0.5, { fill: color });
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
