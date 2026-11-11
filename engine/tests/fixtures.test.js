// B1 and B2 on the GPX files in fixtures/.
//
// fixtures/index.json lists pairs of recordings of the same route. Synthetic
// pairs must pass. Real pairs you add are replayed and their numbers printed,
// but a miss does not fail the build: on real data a miss is a finding.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGpx, checkB1 } from '../index.js';
import { buildFixtures } from '../../fixtures/generate.mjs';

const fixtures = new URL('../../fixtures/', import.meta.url);
const read = (path) => readFileSync(new URL(path, fixtures), 'utf8');
const { pairs } = JSON.parse(read('index.json'));
const b1 = (pair) => checkB1(parseGpx(read(pair.ghost)), parseGpx(read(pair.runner))).stats;
const summary = (s) =>
  `${(100 * s.within).toFixed(1)}% within ${s.targetS} s (${(100 * s.withinSameInstant).toFixed(1)}% at the same instant), worst ${s.maxTimeError.toFixed(2)} s, ${s.samples} readings`;

test('synthetic fixtures are what fixtures/generate.mjs writes', () => {
  for (const [path, text] of Object.entries(buildFixtures())) {
    assert.equal(read(path), text, `${path} is stale: run "npm run fixtures"`);
  }
});

for (const pair of pairs.filter((p) => p.synthetic)) {
  test(`B1 ${pair.id}: live gap within 3 s of the gap computed afterwards, updated every second`, (t) => {
    const stats = b1(pair);
    t.diagnostic(summary(stats));
    assert.ok(stats.samples > 300);
    assert.equal(stats.tickS, 1, 'a reading every second');
    assert.equal(stats.maxFixAge, 0, 'every reading uses a fix from that second, holes in the recording having been filled');
    assert.equal(stats.pass, true, `readings outside 3 s at t = ${stats.misses}`);
    assert.ok(stats.withinSameInstant >= 0.99, `only ${(100 * stats.withinSameInstant).toFixed(2)}% within 3 s at the same instant`);
    assert.ok(stats.p95TimeError < 1, `95th percentile error ${stats.p95TimeError.toFixed(2)} s`);
  });
}

test('B2: a run, a ride and a walk all pass B1 on the same code and settings', () => {
  // checkB1 is called with no options and no hint of the sport.
  for (const id of ['run', 'ride', 'walk']) {
    const pair = pairs.find((p) => p.id === id);
    assert.ok(pair, `fixtures/index.json should list a "${id}" pair`);
    assert.equal(b1(pair).pass, true, `${id} fails B1`);
  }
});

for (const pair of pairs.filter((p) => !p.synthetic)) {
  test(`recorded ${pair.id}: replays (B1 result is printed, not enforced)`, (t) => {
    const stats = b1(pair);
    t.diagnostic(`${stats.pass ? 'B1 PASS' : 'B1 FAIL'}: ${summary(stats)}`);
    assert.ok(stats.samples > 0);
  });
}
