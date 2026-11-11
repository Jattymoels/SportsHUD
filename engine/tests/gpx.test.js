import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGpx, toFixes } from '../index.js';

const wrap = (body) => `<?xml version="1.0"?><gpx version="1.1" creator="test">${body}</gpx>`;

test('reads track points with elevation and time', () => {
  const gpx = parseGpx(wrap(`
    <trk><name>Morning run</name><trkseg>
      <trkpt lat="-34.9200" lon="138.6000"><ele>41.5</ele><time>2026-10-03T21:30:00Z</time></trkpt>
      <trkpt lon='138.6001' lat='-34.9201'><time>2026-10-03T21:30:01.500Z</time></trkpt>
    </trkseg></trk>`));
  assert.equal(gpx.name, 'Morning run');
  assert.deepEqual(gpx.points, [
    { lat: -34.92, lon: 138.6, ele: 41.5, time: Date.UTC(2026, 9, 3, 21, 30, 0) },
    { lat: -34.9201, lon: 138.6001, ele: null, time: Date.UTC(2026, 9, 3, 21, 30, 1, 500) },
  ]);
});

test('joins segments in order and ignores waypoints and comments', () => {
  const gpx = parseGpx(wrap(`
    <wpt lat="1" lon="1"><name>Tap</name></wpt>
    <!-- <trkpt lat="9" lon="9"/> -->
    <trk><trkseg><trkpt lat="10" lon="20"/></trkseg><trkseg><trkpt lat="11" lon="21"/></trkseg></trk>
    <trk><trkseg><trkpt lat="12" lon="22"/></trkseg></trk>`));
  assert.deepEqual(gpx.points.map((p) => p.lat), [10, 11, 12]);
  assert.equal(gpx.points[0].time, null);
});

test('falls back to route points when there is no track', () => {
  const gpx = parseGpx(wrap('<rte><rtept lat="10" lon="20"/><rtept lat="11" lon="21"/></rte>'));
  assert.equal(gpx.points.length, 2);
});

test('decodes names and falls back to the metadata name', () => {
  assert.equal(parseGpx(wrap('<trk><name>Tom &amp; Jo&apos;s loop</name><trkseg><trkpt lat="1" lon="2"/></trkseg></trk>')).name, "Tom & Jo's loop");
  assert.equal(parseGpx(wrap('<trk><name><![CDATA[5 < 6]]></name><trkseg><trkpt lat="1" lon="2"/></trkseg></trk>')).name, '5 < 6');
  assert.equal(parseGpx(wrap('<metadata><name>From metadata</name></metadata><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk>')).name, 'From metadata');
});

test('skips points with impossible coordinates', () => {
  const gpx = parseGpx(wrap('<trk><trkseg><trkpt lat="95" lon="20"/><trkpt lat="abc" lon="20"/><trkpt lat="10" lon="20"/></trkseg></trk>'));
  assert.equal(gpx.points.length, 1);
});

test('rejects files that are not GPX or have no points', () => {
  assert.throws(() => parseGpx('<kml></kml>'), /Not a GPX file/);
  assert.throws(() => parseGpx(wrap('<trk><trkseg></trkseg></trk>')), /no track or route points/);
  assert.throws(() => parseGpx(null), TypeError);
});

test('toFixes puts a recording on its own clock and drops fixes whose time does not advance', () => {
  const t0 = Date.UTC(2026, 0, 1);
  const fixes = toFixes({
    points: [
      { lat: 1, lon: 1, time: t0 },
      { lat: 2, lon: 2, time: t0 + 1000 },
      { lat: 3, lon: 3, time: t0 + 1000 },
      { lat: 4, lon: 4, time: t0 + 500 },
      { lat: 5, lon: 5, time: t0 + 4000 },
    ],
  });
  assert.deepEqual(fixes, [
    { t: 0, lat: 1, lon: 1 },
    { t: 1, lat: 2, lon: 2 },
    { t: 4, lat: 5, lon: 5 },
  ]);
});

test('toFixes refuses a recording without timestamps', () => {
  assert.throws(() => toFixes({ points: [{ lat: 1, lon: 1, time: null }, { lat: 2, lon: 2, time: null }] }), /no timestamps/);
});

test('reads a fixture file from fixtures/', () => {
  const gpx = parseGpx(readFileSync(new URL('../../fixtures/synthetic/run-a.gpx', import.meta.url), 'utf8'));
  assert.equal(gpx.name, 'Synthetic run A');
  assert.ok(gpx.points.length > 500);
  assert.ok(gpx.points.every((p) => p.time != null && p.lat < -34 && p.lon > 138));
  const fixes = toFixes(gpx);
  assert.equal(fixes[0].t, 0);
  assert.equal(fixes[fixes.length - 1].t, fixes.length - 1); // one fix a second
});
