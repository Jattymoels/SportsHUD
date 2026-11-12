// Drawing for the route guide's two glasses screens, 600×600, thin bright
// strokes on black like the ghost run display. Each function draws one
// screen from a guide built by engine/guide.js; nothing is worked out here.

import { SIZE, INK, DIM, AHEAD, BEHIND, FONT, clock } from '../ghost/hud.js';

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

function stroke(ctx, points, color, width = 3) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

function dot(ctx, x, y, r, color, filled = true) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  if (filled) {
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

/** Metres as a runner would say them: "120 m", "1.2 km". */
export function metres(m) {
  if (m < 995) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`;
}

/** A length of time in the fewest words: "40 s", "2 min", "2:24". */
export function wait(seconds) {
  return seconds < 90 ? `${Math.max(5, Math.round(seconds / 5) * 5)} s` : clock(Math.round(seconds));
}

/** A run's length in time, to the minute: "14 min", "1 h 04". */
export function duration(seconds) {
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** How many different places of a kind are in a list where one place can be passed, and listed, more than once. */
export function places(amenities, kind) {
  return new Set((amenities ?? []).filter((a) => a.kind === kind).map((a) => `${a.lat},${a.lon}`)).size;
}

/** Index of the first route point at or beyond `d` metres. */
function indexAt(route, d) {
  let lo = 0;
  let hi = route.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (route.cum[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A function from the route's own x/y to the screen, fitting the route in a box. */
function fit(route, left, top, width, height) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < route.x.length; i++) {
    minX = Math.min(minX, route.x[i]);
    maxX = Math.max(maxX, route.x[i]);
    minY = Math.min(minY, route.y[i]);
    maxY = Math.max(maxY, route.y[i]);
  }
  const scale = Math.min(width / (maxX - minX || 1), height / (maxY - minY || 1));
  const ox = left + (width - (maxX - minX) * scale) / 2;
  const oy = top + (height - (maxY - minY) * scale) / 2;
  return (x, y) => [ox + (x - minX) * scale, oy + (maxY - y) * scale];
}

/** The route's line between two distances along it, as screen points. */
function stretch(route, toPx, from, to) {
  const points = [];
  for (let i = indexAt(route, from); i < route.cum.length && route.cum[i] <= to; i++) points.push(toPx(route.x[i], route.y[i]));
  return points;
}

/** The elevation profile as a thin line in a box; a flat line if there is none. */
function profileStrip(ctx, guide, left, top, width, height, at = null) {
  const x = (d) => left + (d / guide.length) * width;
  if (!guide.climb) {
    stroke(ctx, [[left, top + height], [left + width, top + height]], DIM, 2);
  } else {
    const { dist, ele } = guide.climb.profile;
    const span = Math.max(10, guide.climb.highest - guide.climb.lowest);
    const y = (e) => top + height - ((e - guide.climb.lowest) / span) * height;
    stroke(ctx, Array.from(dist, (d, k) => [x(d), y(ele[k])]), DIM, 2);
    // The climbs worth knowing about, picked out brighter.
    for (const climb of guide.climb.climbs) {
      const part = [];
      dist.forEach((d, k) => {
        if (d >= climb.from && d <= climb.to) part.push([x(d), y(ele[k])]);
      });
      if (part.length > 1) stroke(ctx, part, INK, 4);
    }
  }
  if (at != null) stroke(ctx, [[x(at), top - 6], [x(at), top + height + 6]], AHEAD, 3);
}

// --------------------------------------------------------------- glyphs --

/** An arrow for a turn, drawn in a box about 130 px across centred on (cx, cy). */
function turnGlyph(ctx, cx, cy, side, shape, color) {
  const s = side === 'left' ? -1 : 1;
  const shaft = [[cx - s * 30, cy + 62], [cx - s * 30, cy - 8]];
  let tip;
  let from;
  if (shape === 'back') {
    // Up, over and back down.
    shaft.push([cx - s * 30, cy - 30], [cx - s * 8, cy - 52], [cx + s * 14, cy - 52], [cx + s * 36, cy - 30]);
    tip = [cx + s * 36, cy + 40];
    from = [cx + s * 36, cy - 30];
  } else if (shape === 'sharp') {
    shaft.push([cx - s * 30, cy - 34]);
    tip = [cx + s * 44, cy + 22];
    from = [cx - s * 30, cy - 34];
  } else {
    shaft.push([cx - s * 30, cy - 34]);
    tip = [cx + s * 52, cy - 34];
    from = [cx - s * 30, cy - 34];
  }
  stroke(ctx, [...shaft, tip], color, 9);
  // Arrowhead, pointing along the last leg.
  const ux = tip[0] - from[0];
  const uy = tip[1] - from[1];
  const len = Math.hypot(ux, uy) || 1;
  const [dx, dy] = [ux / len, uy / len];
  const head = (turn) => [tip[0] - 26 * (dx * Math.cos(turn) - dy * Math.sin(turn)), tip[1] - 26 * (dx * Math.sin(turn) + dy * Math.cos(turn))];
  stroke(ctx, [head(0.55), tip, head(-0.55)], color, 9);
}

function glyph(ctx, feature, cx, cy, color) {
  if (feature.kind === 'turn') {
    turnGlyph(ctx, cx, cy, feature.side, feature.shape, color);
  } else if (feature.kind === 'wait') {
    // Two bars: a pause.
    stroke(ctx, [[cx - 24, cy - 50], [cx - 24, cy + 50]], color, 18);
    stroke(ctx, [[cx + 24, cy - 50], [cx + 24, cy + 50]], color, 18);
  } else if (feature.kind === 'climb') {
    // A slope with an arrow up it.
    stroke(ctx, [[cx - 64, cy + 48], [cx + 64, cy + 48], [cx + 64, cy - 30], [cx - 64, cy + 48]], color, 7);
    stroke(ctx, [[cx - 40, cy - 6], [cx + 10, cy - 46]], color, 7);
    stroke(ctx, [[cx - 14, cy - 50], [cx + 10, cy - 46], [cx + 2, cy - 22]], color, 7);
  } else if (feature.kind === 'water') {
    // A drop.
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 62);
    ctx.bezierCurveTo(cx + 14, cy - 30, cx + 44, cy - 6, cx + 44, cy + 22);
    ctx.arc(cx, cy + 22, 44, 0, Math.PI);
    ctx.bezierCurveTo(cx - 44, cy - 6, cx - 14, cy - 30, cx, cy - 62);
    ctx.closePath();
    ctx.stroke();
  } else if (feature.kind === 'toilets') {
    // A sign with the two letters every runner knows.
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(cx - 70, cy - 50, 140, 104, 14);
    ctx.stroke();
    text(ctx, 'WC', cx, cy + 26, 68, { color, weight: 700 });
  } else if (feature.kind === 'marker') {
    // A gate across the path.
    stroke(ctx, [[cx - 56, cy + 56], [cx - 56, cy - 44], [cx + 56, cy - 44], [cx + 56, cy + 56]], color, 8);
  } else {
    // The finish: a flag.
    stroke(ctx, [[cx - 40, cy + 60], [cx - 40, cy - 56]], color, 8);
    stroke(ctx, [[cx - 40, cy - 56], [cx + 48, cy - 34], [cx - 40, cy - 8]], color, 8);
  }
}

/** The words for a feature: a headline and a line of detail. */
export function describe(feature) {
  if (feature.kind === 'turn') {
    const way = feature.side === 'left' ? 'LEFT' : 'RIGHT';
    if (feature.shape === 'back') return { title: 'TURN BACK', detail: `round to the ${feature.side}` };
    return { title: feature.shape === 'sharp' ? `SHARP ${way}` : way, detail: '' };
  }
  if (feature.kind === 'wait') {
    // Every run that passed here counts, whichever way it was going.
    const waited = feature.runs + (feature.elsewhere?.runs ?? 0);
    const passed = feature.of + (feature.elsewhere?.of ?? 0);
    const often = passed > 1 ? `${waited} of ${passed} runs waited` : 'waited here once';
    return { title: 'LIKELY WAIT', detail: `${often}, about ${wait(feature.typical)}` };
  }
  if (feature.kind === 'climb') return { title: 'CLIMB', detail: `${Math.round(feature.gain)} m up over ${metres(feature.length)}` };
  if (feature.kind === 'marker') return { title: feature.label, detail: '' };
  if (feature.kind === 'water' || feature.kind === 'toilets') {
    const where = feature.off < 15 ? 'beside the route' : `${metres(feature.off)} to the ${feature.side}`;
    return { title: feature.kind === 'water' ? 'WATER' : 'TOILETS', detail: where };
  }
  return { title: 'FINISH', detail: '' };
}

// -------------------------------------------------------------- screens --

/**
 * Before the start: the route's shape, its length, climb, usual time and
 * how much waiting to expect.
 * @param guide from buildGuide
 * @param {string} name what to call the route
 */
export function drawPreview(ctx, guide, name) {
  clear(ctx);
  const water = places(guide.amenities, 'water');
  const toilets = places(guide.amenities, 'toilets');
  const stops = guide.amenities ? `   ·   ${water} WATER   ·   ${toilets} TOILETS` : '';
  text(ctx, name.toUpperCase() + stops, 300, 44, 22, { color: DIM, weight: 600 });

  // The route: its line, the climbs brighter, a mark at each place runs wait.
  const { route } = guide;
  const toPx = fit(route, 70, 70, 460, 230);
  stroke(ctx, stretch(route, toPx, 0, route.length), DIM, 3);
  for (const climb of guide.climb?.climbs ?? []) stroke(ctx, stretch(route, toPx, climb.from, climb.to), INK, 5);
  const place = (d) => {
    const i = Math.min(route.cum.length - 1, indexAt(route, d));
    return toPx(route.x[i], route.y[i]);
  };
  for (const p of guide.pausePoints.filter((point) => point.likely !== false)) {
    const [x, y] = place(p.dist);
    dot(ctx, x, y, 9, '#000');
    dot(ctx, x, y, 6, BEHIND);
  }
  const [sx, sy] = place(0);
  const [fx, fy] = place(route.length);
  dot(ctx, fx, fy, 9, '#000');
  dot(ctx, fx, fy, 8, INK, false);
  dot(ctx, sx, sy, 9, '#000');
  dot(ctx, sx, sy, 7, AHEAD);

  // The headline: how far.
  const km = (guide.length / 1000).toFixed(guide.length < 99500 ? 2 : 0);
  ctx.font = `700 92px ${FONT}`;
  const wide = ctx.measureText(km).width;
  text(ctx, km, 300 - 34, 408, 92, { weight: 700 });
  text(ctx, 'km', 300 - 34 + wide / 2 + 12, 408, 40, { color: DIM, align: 'left' });

  // Three things to know, each with a caption.
  const waits = guide.pausePoints.filter((point) => point.likely !== false).length;
  const facts = [
    guide.climb ? [`+${Math.round(guide.climb.gain)} m`, 'climb'] : ['–', 'no climb data'],
    [duration(guide.times.moving), guide.runs > 1 ? 'usual time' : 'last time'],
    waits ? [`${waits} wait${waits === 1 ? '' : 's'}`, `about ${wait(guide.usualWait)}`] : ['0 waits', 'none likely'],
  ];
  facts.forEach(([value, caption], i) => {
    const x = 110 + i * 190;
    text(ctx, value, x, 470, 40, { weight: 600 });
    text(ctx, caption, x, 500, 20, { color: DIM, weight: 400 });
  });

  profileStrip(ctx, guide, 60, 522, 480, 34);
  text(ctx, 'Enter: what is coming up', 300, 588, 18, { color: DIM, weight: 400 });
}

/**
 * On the way: the next thing to act on, how far off it is, and what follows.
 * @param guide from buildGuide
 * @param {number} dist metres along the route
 * @param {{now:object|null, then:object|null, climb:object|null}} cue from nextCue
 */
export function drawComing(ctx, guide, dist, cue) {
  clear(ctx);
  text(ctx, `${(dist / 1000).toFixed(2)} km`, 40, 52, 34, { align: 'left', weight: 600 });
  text(ctx, `${metres(Math.max(0, guide.length - dist))} to go`, 560, 52, 26, { color: DIM, align: 'right', weight: 400 });

  const { now, then, climb } = cue;
  if (!now) {
    text(ctx, 'FINISHED', 300, 300, 64, { weight: 700, color: AHEAD });
  } else {
    // Close enough to act on: bright. Further off: for information, dimmer.
    const near = now.in <= 150;
    const color = now.kind === 'wait' ? BEHIND : near ? INK : DIM;
    glyph(ctx, now, 300, 170, color);
    const words = describe(now);
    text(ctx, words.title, 300, 320, 62, { weight: 700, color: near ? INK : DIM });
    text(ctx, `in ${metres(now.in)}`, 300, 386, 52, { weight: 600 });
    if (words.detail) text(ctx, words.detail, 300, 428, 24, { color: DIM, weight: 400 });
    if (then) text(ctx, `then ${describe(then).title} in ${metres(then.in)}`, 300, 478, 26, { color: DIM, weight: 500 });
  }
  if (climb) text(ctx, `Climbing: ${metres(climb.left)} to the top`, 300, 520, 26, { weight: 500 });

  // Where this is on the route, over its ups and downs.
  profileStrip(ctx, guide, 40, 545, 520, 30, Math.min(dist, guide.length));
}
