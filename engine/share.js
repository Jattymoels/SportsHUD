// A run small enough to send as a link.
//
// A ghost needs to know where a run went and when it was where. A watch
// saves that once a second: several thousand positions for an hour's run,
// most of them saying "carried on in a straight line at the same speed".
// Keep only the moments where that stopped being true, and the same run is
// a few hundred positions; written as small differences from one to the
// next, a couple of thousand characters. That fits in a link, and a link
// needs no server, no account and nobody's permission but the runner's.

import { haversine, createProjection } from './geo.js';
import { fillGaps } from './replay.js';

export const SHARE_DEFAULTS = {
  within: 2, // metres: at every moment, the run rebuilt from the link is within this of the run that was packed
};

const VERSION = 1;
const PLACES = 1e5; // positions are kept to 0.00001 of a degree, about a metre
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LONGEST = 48 * 3600; // seconds: a link claiming a longer run than this is damaged, or made to choke whoever opens it

/**
 * The fixes that matter: the fewest such that joining them with straight
 * lines, at steady speed between each pair, is never more than `within`
 * metres from where the full recording was at the same moment.
 *
 * @param {Array<{t:number, lat:number, lon:number}>} fixes
 * @param {number} [within] metres
 */
export function thinFixes(fixes, within = SHARE_DEFAULTS.within) {
  if (fixes.length <= 2) return [...fixes];
  const proj = createProjection(fixes[0].lat, fixes[0].lon);
  const at = fixes.map((f) => proj.toXY(f.lat, f.lon));
  const keep = new Uint8Array(fixes.length);
  keep[0] = keep[fixes.length - 1] = 1;
  const spans = [[0, fixes.length - 1]];
  while (spans.length) {
    const [a, b] = spans.pop();
    const whole = fixes[b].t - fixes[a].t;
    let worst = 0;
    let which = -1;
    for (let i = a + 1; i < b; i++) {
      const f = whole > 0 ? (fixes[i].t - fixes[a].t) / whole : 0;
      const off = Math.hypot(at[a][0] + f * (at[b][0] - at[a][0]) - at[i][0], at[a][1] + f * (at[b][1] - at[a][1]) - at[i][1]);
      if (off > worst) {
        worst = off;
        which = i;
      }
    }
    if (worst > within) {
      keep[which] = 1;
      spans.push([a, which], [which, b]);
    }
  }
  return fixes.filter((_, i) => keep[i]);
}

/** A run with `metres` taken off each end, for sending a run that starts or ends at home. Times start again from zero. */
export function trimEnds(fixes, pauses, metres) {
  if (!(metres > 0)) return { fixes, pauses, cut: 0 };
  const along = [0];
  for (let i = 1; i < fixes.length; i++) along.push(along[i - 1] + haversine(fixes[i - 1].lat, fixes[i - 1].lon, fixes[i].lat, fixes[i].lon));
  const total = along[along.length - 1];
  if (total < 4 * metres) return { fixes, pauses, cut: 0 }; // too short to trim and still be a run
  const first = along.findIndex((d) => d >= metres);
  let last = along.length - 1;
  while (along[last] > total - metres) last--;
  const t0 = fixes[first].t;
  const t1 = fixes[last].t;
  return {
    fixes: fixes.slice(first, last + 1).map((f) => ({ ...f, t: f.t - t0 })),
    pauses: pauses.filter((p) => p.end > t0 && p.start < t1).map((p) => ({ start: Math.max(0, p.start - t0), end: Math.min(t1, p.end) - t0 })),
    cut: t0,
  };
}

/**
 * Pack a run into text that can go in a link.
 *
 * @param {object} run
 * @param {number} run.startedAt when it began, milliseconds since 1970
 * @param {Array<{t:number, lat:number, lon:number}>} run.fixes
 * @param {Array<{start:number, end:number}>} [run.pauses]
 * @param {string} [run.from] whose run it is, as they want to be named; up to 24 characters are kept
 * @param {Partial<typeof SHARE_DEFAULTS>} [options]
 * @returns {string} letters, digits, "-" and "_" only
 */
export function packRun({ startedAt, fixes, pauses = [], from = '' }, options) {
  const o = { ...SHARE_DEFAULTS, ...options };
  const bytes = [VERSION];
  const whole = (n) => {
    // A whole number, zero or more, seven bits to a byte, smallest first.
    let v = Math.max(0, Math.round(n));
    while (v >= 128) {
      bytes.push((v % 128) + 128);
      v = Math.floor(v / 128);
    }
    bytes.push(v);
  };
  const signed = (n) => whole(n < 0 ? -2 * n - 1 : 2 * n);

  const name = new TextEncoder().encode([...String(from).trim()].slice(0, 24).join(''));
  whole(name.length);
  bytes.push(...name);
  whole(startedAt / 1000);

  // Whole seconds and whole steps of position first, then thinned: so what is
  // packed is exactly what was thinned, and rounding adds no error of its own.
  const rounded = fixes.map((f) => ({ t: Math.round(f.t), lat: Math.round(f.lat * PLACES) / PLACES, lon: Math.round(f.lon * PLACES) / PLACES }));
  const kept = thinFixes(rounded.filter((f, i) => i === 0 || f.t > rounded[i - 1].t), o.within);
  whole(kept.length);
  let before = { t: 0, lat: 0, lon: 0 };
  for (const f of kept) {
    whole(f.t - before.t);
    signed(Math.round((f.lat - before.lat) * PLACES));
    signed(Math.round((f.lon - before.lon) * PLACES));
    before = f;
  }
  whole(pauses.length);
  let clock = 0;
  for (const p of pauses) {
    whole(p.start - clock);
    whole(p.end - p.start);
    clock = Math.round(p.end);
  }

  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = bytes.slice(i, i + 3);
    const four = LETTERS[a >> 2] + LETTERS[((a & 3) << 4) | (b >> 4)] + LETTERS[((b & 15) << 2) | (c >> 6)] + LETTERS[c & 63];
    text += four.slice(0, Math.min(4, bytes.length - i + 1));
  }
  return text;
}

/**
 * The run a link carries, with a position every second again.
 *
 * @param {string} text from packRun
 * @returns {{startedAt:number, fixes:Array<{t:number, lat:number, lon:number}>, pauses:Array<{start:number, end:number}>, from:string}}
 * @throws {Error} if the text is not a packed run, or is damaged
 */
export function unpackRun(text) {
  const bytes = [];
  const clean = String(text).trim();
  if (!clean || /[^A-Za-z0-9_-]/.test(clean)) throw new Error('This link does not hold a run.');
  for (let i = 0; i < clean.length; i += 4) {
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => (i + k < clean.length ? LETTERS.indexOf(clean[i + k]) : -1));
    if (b < 0) throw new Error('The run in this link is cut short.');
    bytes.push((a << 2) | (b >> 4));
    if (c >= 0) bytes.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) bytes.push(((c & 3) << 6) | d);
  }
  let at = 0;
  const whole = () => {
    let v = 0;
    let scale = 1;
    for (;;) {
      if (at >= bytes.length) throw new Error('The run in this link is cut short.');
      const byte = bytes[at++];
      v += (byte & 127) * scale;
      if (byte < 128) return v;
      scale *= 128;
    }
  };
  const signed = () => {
    const v = whole();
    return v % 2 ? -(v + 1) / 2 : v / 2;
  };

  if (bytes[at++] !== VERSION) throw new Error('This link is from a newer version of the app, or does not hold a run.');
  const nameLength = whole();
  if (nameLength > 96 || at + nameLength > bytes.length) throw new Error('The run in this link is cut short.');
  const from = new TextDecoder().decode(Uint8Array.from(bytes.slice(at, at + nameLength)));
  at += nameLength;
  const startedAt = whole() * 1000;
  const count = whole();
  if (count < 2 || count > 50000) throw new Error('This link does not hold a run.');
  const kept = [];
  let before = { t: 0, lat: 0, lon: 0 };
  for (let i = 0; i < count; i++) {
    const t = before.t + whole();
    const lat = before.lat + signed();
    const lon = before.lon + signed();
    before = { t, lat, lon };
    kept.push({ t, lat: lat / PLACES, lon: lon / PLACES });
  }
  if (kept.some((f) => Math.abs(f.lat) > 90 || Math.abs(f.lon) > 180) || kept[kept.length - 1].t > LONGEST) throw new Error('The run in this link is damaged.');
  const pauses = [];
  let clock = 0;
  for (let n = whole(); n > 0; n--) {
    const start = clock + whole();
    const end = start + whole();
    if (end > LONGEST) throw new Error('The run in this link is damaged.');
    pauses.push({ start, end });
    clock = end;
  }
  // Filling in between whole seconds should give whole seconds; make sure of it.
  return { startedAt, fixes: fillGaps(kept).map((f) => ({ ...f, t: Math.round(f.t) })), pauses, from };
}
