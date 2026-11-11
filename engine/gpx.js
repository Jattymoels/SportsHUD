// GPX reader. No DOM needed, so the same code runs in a browser, on the
// glasses and in Node tests.

import { haversine } from './geo.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeText(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name])
    .trim();
}

function attr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`).exec(attrs);
  return m ? parseFloat(m[1]) : NaN;
}

function child(body, tag) {
  if (!body) return null;
  const m = new RegExp(`<${tag}\\b[^>]*>([^<]*)</${tag}\\s*>`).exec(body);
  return m ? m[1].trim() : null;
}

function readPoints(xml, tag) {
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}\\s*>)`, 'g');
  const points = [];
  let m;
  while ((m = re.exec(xml))) {
    const lat = attr(m[1], 'lat');
    const lon = attr(m[1], 'lon');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const ele = parseFloat(child(m[2], 'ele'));
    const time = Date.parse(child(m[2], 'time') ?? '');
    points.push({
      lat,
      lon,
      ele: Number.isFinite(ele) ? ele : null,
      time: Number.isFinite(time) ? time : null,
    });
  }
  return points;
}

/**
 * Parse GPX text into a recording.
 *
 * Track points (`trkpt`) from every track and segment are joined in file
 * order. A file with no track falls back to its route points (`rtept`).
 *
 * @param {string} xml
 * @returns {{ name: string|null, points: Array<{lat:number, lon:number, ele:number|null, time:number|null}> }}
 *   `time` is milliseconds since the Unix epoch, or null if the point has none.
 */
export function parseGpx(xml) {
  if (typeof xml !== 'string') throw new TypeError('parseGpx expects GPX text');
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');
  if (!/<gpx[\s>]/.test(text)) throw new Error('Not a GPX file: no <gpx> element');

  let points = readPoints(text, 'trkpt');
  if (points.length === 0) points = readPoints(text, 'rtept');
  if (points.length === 0) throw new Error('GPX file has no track or route points');

  // Prefer the track's own name, then the file's metadata name.
  let name = null;
  for (const scope of [/<trk\b[\s\S]*?<trkseg/, /<metadata\b[\s\S]*?<\/metadata>/]) {
    const m = scope.exec(text);
    const n = m && /<name\b[^>]*>([\s\S]*?)<\/name>/.exec(m[0]);
    if (n) {
      name = decodeText(n[1]);
      break;
    }
  }
  return { name, points };
}

/**
 * Turn a parsed recording into position fixes on its own clock: `t` is
 * seconds since the first point. Points whose time does not move forward
 * are dropped. Throws if the recording has no timestamps, because a ghost
 * without times cannot be raced.
 *
 * @returns {Array<{t:number, lat:number, lon:number}>}
 */
export function toFixes(recording) {
  const timed = recording.points.filter((p) => p.time != null);
  if (timed.length < 2) {
    throw new Error('Recording has no timestamps; export the activity itself, not a planned route');
  }
  const t0 = timed[0].time;
  const fixes = [];
  let last = -Infinity;
  for (const p of timed) {
    if (p.time <= last) continue;
    last = p.time;
    fixes.push({ t: (p.time - t0) / 1000, lat: p.lat, lon: p.lon });
  }
  return fixes;
}

/**
 * Write fixes out as GPX text, so a run recorded here can be opened anywhere
 * else, or read back in with parseGpx.
 *
 * @param {Array<{t:number, lat:number, lon:number}>} fixes `t` in seconds since `startedAt`
 * @param {{name?: string, startedAt?: number}} [details] startedAt in milliseconds since the Unix epoch
 */
export function toGpx(fixes, { name = 'SportsHUD run', startedAt = 0 } = {}) {
  const escape = (text) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const stamp = (t) => new Date(startedAt + t * 1000).toISOString();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="SportsHUD" xmlns="http://www.topografix.com/GPX/1/1">',
    ` <trk><name>${escape(name)}</name><trkseg>`,
    ...fixes.map((f) => `  <trkpt lat="${f.lat.toFixed(7)}" lon="${f.lon.toFixed(7)}"><time>${stamp(f.t)}</time></trkpt>`),
    ' </trkseg></trk>',
    '</gpx>',
    '',
  ].join('\n');
}

/**
 * Find where a recording was paused.
 *
 * A paused watch saves nothing, so a pause shows up as a hole between two
 * fixes. A hole of `holeSeconds` or more counts as a pause unless it was
 * crossed at more than half the recording's usual speed, which is just a
 * watch saving fixes far apart. The pause is taken to start one usual fix
 * interval after the last fix before the hole, since the watch was still
 * running when it saved that one.
 *
 * @param {Array<{t:number, lat:number, lon:number}>} fixes from toFixes
 * @returns {Array<{start:number, end:number}>} seconds on the recording's clock
 */
export function findPauses(fixes, { holeSeconds = 5 } = {}) {
  const steps = [];
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1];
    const b = fixes[i];
    steps.push({ start: a.t, end: b.t, speed: haversine(a.lat, a.lon, b.lat, b.lon) / (b.t - a.t) });
  }
  const median = (values) => values.sort((x, y) => x - y)[values.length >> 1] ?? 0;
  const usualSpeed = median(steps.map((s) => s.speed));
  const usualStep = median(steps.map((s) => s.end - s.start));
  return steps
    .filter((s) => s.end - s.start >= holeSeconds && s.speed < usualSpeed / 2)
    .map((s) => ({ start: Math.min(s.start + usualStep, s.end), end: s.end }));
}
