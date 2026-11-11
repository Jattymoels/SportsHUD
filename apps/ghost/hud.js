// Drawing for the ghost run display: a 600×600 screen of thin bright strokes
// on black. Black is transparent on the glasses, so nothing is filled except
// text. Each function draws one screen from a plain description of it.

export const SIZE = 600;

const INK = '#f4f4ee';
const DIM = '#8d8d86';
const AHEAD = '#3ddc97';
const BEHIND = '#ffb347';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function text(ctx, string, x, y, size, { color = INK, align = 'center', weight = 500 } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(string, x, y);
  return ctx.measureText(string).width;
}

function line(ctx, x1, y1, x2, y2, color, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function clear(ctx) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
}

// ------------------------------------------------------------ formatting --

export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
export const pace = (secondsPerKm) => (secondsPerKm && Number.isFinite(secondsPerKm) ? clock(Math.round(secondsPerKm)) : '–:––');
export const km = (metres) => (metres / 1000).toFixed(2);

/** A time gap as the big number: "+12", "−3", "+2:05". */
function gapNumber(seconds) {
  const size = Math.abs(seconds);
  const sign = seconds < 0 ? '−' : '+';
  if (size < 0.5) return '0';
  return size < 99.5 ? sign + Math.round(size) : sign + clock(Math.round(size));
}

// ------------------------------------------------------------ the ghost --

/** A ghost outline `height` tall, standing on (x, y). */
function ghostGlyph(ctx, x, y, height, color) {
  const w = height * 0.72;
  const r = w / 2;
  const top = y - height;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, height / 26);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x - r, top + r);
  ctx.arc(x, top + r, r, Math.PI, 0);
  ctx.lineTo(x + r, y);
  // The hem: three scallops back along the bottom.
  for (let i = 0; i < 3; i++) {
    const right = x + r - (i * w) / 3;
    ctx.quadraticCurveTo(right - w / 6, y - height * 0.16, right - w / 3, y);
  }
  ctx.stroke();
  if (height > 26) {
    ctx.fillStyle = color;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x + side * r * 0.38, top + r * 0.95, Math.max(1.5, height / 22), 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

// The road ahead, in perspective. A ghost `d` metres ahead sits at depth()
// between the horizon (far) and the base (at your feet).
const ROAD = { horizon: 92, base: 318, halfBase: 178, halfFar: 10, near: 30 };
const depth = (d) => ROAD.near / (ROAD.near + Math.max(0, d)); // 1 at your feet, towards 0 far away
const roadY = (d) => ROAD.horizon + (ROAD.base - ROAD.horizon) * depth(d);
const roadHalf = (d) => ROAD.halfFar + (ROAD.halfBase - ROAD.halfFar) * depth(d);

function road(ctx) {
  for (const side of [-1, 1]) {
    line(ctx, 300 + side * ROAD.halfBase, ROAD.base, 300 + side * ROAD.halfFar, ROAD.horizon, DIM, 2);
  }
  // Faint marks at 10, 25, 50 and 100 m, to give the road some depth.
  for (const d of [10, 25, 50, 100]) {
    const y = roadY(d);
    const half = roadHalf(d);
    line(ctx, 300 - half, y, 300 - half + 10, y, DIM, 1.5);
    line(ctx, 300 + half - 10, y, 300 + half, y, DIM, 1.5);
  }
}

// --------------------------------------------------------------- screens --

/**
 * The run itself.
 * @param {object} v
 * @param {number} v.time seconds on your clock
 * @param {number} v.distance metres covered
 * @param {number} v.speed m/s
 * @param {number} v.timeGap seconds; positive is ahead
 * @param {number} v.distGap metres; positive is ahead
 * @param {number} v.trend seconds of gap gained per minute; positive is gaining
 * @param {string} v.ghostLabel what the ghost is
 * @param {boolean} v.paused
 * @param {string|null} v.notice a short word for the top of the screen ("GPS?", "OFF ROUTE")
 * @param {string|null} v.banner a line shown across the road for a few seconds (a split, a pass)
 * @param {number} v.float seconds, for the ghost's slow bob; any steadily rising clock
 */
export function drawRun(ctx, v) {
  clear(ctx);
  const level = Math.abs(v.timeGap) < 0.5;
  const color = level ? INK : v.timeGap > 0 ? AHEAD : BEHIND;
  ctx.globalAlpha = v.paused ? 0.55 : 1;

  // Top: your time and distance.
  text(ctx, clock(v.time), 28, 54, 36, { align: 'left' });
  text(ctx, `${km(v.distance)} km`, SIZE - 28, 54, 36, { align: 'right' });

  // Middle: the road, with the ghost on it if it is ahead of you.
  road(ctx);
  const ahead = -v.distGap; // metres the ghost is ahead of you
  if (ahead > 0.5) {
    const height = Math.max(18, 150 * depth(ahead));
    // It hovers a little, as ghosts do, unless everything is paused.
    const y = roadY(ahead) + (v.paused ? 0 : Math.sin((v.float ?? 0) * 3.9) * height * 0.035);
    ghostGlyph(ctx, 300, y, height, color);
    // Its distance, beside it and clear of the road's edge.
    const beside = 300 + Math.max(roadHalf(ahead), height * 0.36) + 22;
    text(ctx, `${Math.round(ahead)} m`, beside, y - height / 2 + 10, 28, { color, align: 'left' });
  } else if (ahead < -0.5) {
    // It is behind you: nothing on the road, and a marker at your back.
    line(ctx, 282, ROAD.base - 16, 300, ROAD.base - 2, color, 3);
    line(ctx, 318, ROAD.base - 16, 300, ROAD.base - 2, color, 3);
    text(ctx, `${Math.round(-ahead)} m behind you`, 300, ROAD.base - 30, 26, { color });
  }
  if (v.banner) {
    // Across the far end of the road, clear of a ghost that is close.
    ctx.fillStyle = '#000';
    ctx.fillRect(70, 70, 460, 54);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(70, 70, 460, 54);
    text(ctx, v.banner, 300, 107, 30);
  }

  // The number: seconds ahead or behind.
  const number = gapNumber(v.timeGap);
  const big = number.includes(':') ? 124 : 156;
  ctx.font = `700 ${big}px ${FONT}`;
  const width = ctx.measureText(number).width;
  const unit = number.includes(':') || number === '0' ? '' : 's';
  const left = 300 - (width + (unit ? 44 : 0)) / 2;
  text(ctx, number, left, 462, big, { color, align: 'left', weight: 700 });
  if (unit) text(ctx, unit, left + width + 8, 462, 60, { color, align: 'left', weight: 600 });

  const word = level ? 'LEVEL' : v.timeGap > 0 ? 'AHEAD' : 'BEHIND';
  const moving = Math.abs(v.trend) < 1 ? '' : v.trend > 0 ? '   ▲ gaining' : '   ▼ losing';
  text(ctx, word + moving, 300, 508, 30, { color, weight: 600 });

  // Bottom: your pace now, and what the ghost is.
  text(ctx, v.speed > 0.4 ? `${pace(1000 / v.speed)} /km` : '–:–– /km', 28, 572, 36, { align: 'left' });
  text(ctx, v.ghostLabel, SIZE - 28, 570, 24, { color: DIM, align: 'right', weight: 400 });

  ctx.globalAlpha = 1;
  if (v.paused) text(ctx, 'PAUSED', 300, 54, 30, { weight: 600 });
  else if (v.notice) text(ctx, v.notice, 300, 54, 26, { color: BEHIND, weight: 600 });
}

/**
 * A list to choose from.
 * @param {object} v
 * @param {string} v.title
 * @param {Array<{main:string, detail?:string, adjustable?:boolean}>} v.rows
 * @param {number} v.selected index of the highlighted row
 * @param {string} v.hint a line of help at the bottom
 */
export function drawList(ctx, v) {
  clear(ctx);
  text(ctx, v.title, 300, 76, 44, { weight: 700 });
  const visible = 5;
  const first = Math.max(0, Math.min(v.selected - 2, v.rows.length - visible));
  v.rows.slice(first, first + visible).forEach((row, i) => {
    const index = first + i;
    const y = 122 + i * 82;
    const on = index === v.selected;
    if (on) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(28, y, 544, 70, 12);
      ctx.stroke();
    }
    const color = on ? INK : DIM;
    const main = row.adjustable && on ? `◀  ${row.main}  ▶` : row.main;
    if (row.detail) {
      text(ctx, main, 50, y + 32, 30, { color, align: 'left', weight: on ? 600 : 500 });
      text(ctx, row.detail, 50, y + 58, 20, { color: DIM, align: 'left', weight: 400 });
    } else {
      text(ctx, main, 50, y + 46, 30, { color, align: 'left', weight: on ? 600 : 500 });
    }
  });
  if (first > 0) text(ctx, '▲', 300, 116, 16, { color: DIM });
  if (first + visible < v.rows.length) text(ctx, '▼', 300, 546, 16, { color: DIM });
  text(ctx, v.hint, 300, 578, 20, { color: DIM, weight: 400 });
}

/**
 * A short menu over the run.
 * @param {{options: string[], selected: number, hint: string}} v
 */
export function drawMenu(ctx, v) {
  clear(ctx);
  v.options.forEach((label, i) => {
    const y = 210 + i * 100;
    const on = i === v.selected;
    text(ctx, label, 300, y + 50, 40, { color: on ? INK : DIM, weight: 600 });
    if (!on) return;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(90, y, 420, 76, 12);
    ctx.stroke();
  });
  text(ctx, v.hint, 300, 578, 20, { color: DIM, weight: 400 });
}

/**
 * Before setting off, and after finishing: a headline, a few lines, a hint.
 * @param {object} v
 * @param {string} v.title
 * @param {Array<{text:string, tone?:'ink'|'dim'|'good'|'warn', size?:number}>} v.lines
 * @param {string} v.hint
 */
export function drawCard(ctx, v) {
  clear(ctx);
  text(ctx, v.title, 300, 110, 60, { weight: 700 });
  const tones = { ink: INK, dim: DIM, good: AHEAD, warn: BEHIND };
  let y = 190;
  for (const row of v.lines) {
    const size = row.size ?? 32;
    text(ctx, row.text, 300, y, size, { color: tones[row.tone ?? 'ink'], weight: size > 40 ? 700 : 500 });
    y += size + 24;
  }
  text(ctx, v.hint, 300, 578, 20, { color: DIM, weight: 400 });
}
