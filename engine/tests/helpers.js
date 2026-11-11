// Shared helpers for engine tests.

import { createProjection } from '../geo.js';

const proj = createProjection(-34.92, 138.6);

/** A lat/lon point `x` metres east and `y` metres north of the test origin. */
export function at(x, y) {
  const [lat, lon] = proj.toLatLon(x, y);
  return { lat, lon };
}

/** Points every `step` metres along straight lines joining the given corners (in metres). */
export function path(corners, step = 1) {
  const points = [at(...corners[0])];
  for (let i = 1; i < corners.length; i++) {
    const [x0, y0] = corners[i - 1];
    const [x1, y1] = corners[i];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 1; k <= n; k++) points.push(at(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n));
  }
  return points;
}

/** Fixes for someone moving along `points` (1 m apart) at a steady `speed` m/s, one fix a second. */
export function steady(points, speed) {
  const fixes = [];
  for (let t = 0; t * speed <= points.length - 1; t++) {
    const s = t * speed;
    const i = Math.min(points.length - 2, Math.floor(s));
    const f = s - i;
    fixes.push({
      t,
      lat: points[i].lat + f * (points[i + 1].lat - points[i].lat),
      lon: points[i].lon + f * (points[i + 1].lon - points[i].lon),
    });
  }
  return fixes;
}

/** A parsed-GPX-shaped recording from fixes. */
export function recording(fixes, startMs = Date.UTC(2026, 9, 3)) {
  return {
    name: 'test',
    points: fixes.map((f) => ({ lat: f.lat, lon: f.lon, ele: null, time: startMs + f.t * 1000 })),
  };
}

/** Repeatable pseudo-random numbers in [-1, 1). */
export function noise(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 2147483648 - 1;
  };
}
