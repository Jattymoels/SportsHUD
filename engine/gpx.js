// GPX reader. No DOM needed, so the same code runs in a browser, on the
// glasses and in Node tests.

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
