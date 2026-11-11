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
const b1 = (pair, clock) => checkB1(parseGpx(read(pair.ghost)), parseGpx(read(pair.runner)), { clock }).stats;
const summary = (s) =>
  `${(100 * s.within).toFixed(1)}% within ${s.targetS} s (${(100 * s.withinSameInstant).toFixed(1)}% at the same instant), worst ${s.maxTimeError.toFixed(2)} s, ${s.samples} readings`;

test('synthetic fixtures are what fixtures/generate.mjs writes', () => {
  for (const [path, text] of Object.entries(buildFixtures())) {
    assert.equal(read(path), text, `${path} is stale: run "npm run fixtures"`);
  }
});

// Both ways of running the clocks: 'moving' leaves paused time out (everyday
// runs), 'elapsed' never stops (races).
for (const clock of ['moving', 'elapsed']) {
  for (const pair of pairs.filter((p) => p.synthetic)) {
    test(`B1 ${pair.id}, ${clock} clock: live gap within 3 s of the gap computed afterwards, updated every second`, (t) => {
      const stats = b1(pair, clock);
      t.diagnostic(summary(stats));
      assert.ok(stats.samples > 300);
      assert.equal(stats.tickS, 1, 'a reading every second');
      assert.equal(stats.maxFixAge, 0, 'every reading uses a fix from that second, holes in the recording having been filled');
      assert.equal(stats.pass, true, `readings outside 3 s at t = ${stats.misses}`);
      assert.ok(stats.withinSameInstant >= 0.99, `only ${(100 * stats.withinSameInstant).toFixed(2)}% within 3 s at the same instant`);
      assert.ok(stats.p95TimeError < 1, `95th percentile error ${stats.p95TimeError.toFixed(2)} s`);
    });
  }

  test(`B2, ${clock} clock: a run, a ride and a walk all pass B1 on the same code and settings`, () => {
    // Nothing passed to checkB1 says what the sport is.
    for (const id of ['run', 'ride', 'walk']) {
      const pair = pairs.find((p) => p.id === id);
      assert.ok(pair, `fixtures/index.json should list a "${id}" pair`);
      assert.equal(b1(pair, clock).pass, true, `${id} fails B1`);
    }
  });
}

test('the synthetic run was saved with auto-pause, so the two clocks differ', () => {
  const run = pairs.find((p) => p.id === 'run');
  const moving = b1(run, 'moving');
  assert.ok(moving.pausedS.runner > 10 && moving.pausedS.ghost > 30, JSON.stringify(moving.pausedS));
  assert.deepEqual(b1(run, 'elapsed').pausedS, { runner: 0, ghost: 0 });
});

for (const pair of pairs.filter((p) => !p.synthetic)) {
  test(`recorded ${pair.id}: replays (B1 result is printed, not enforced)`, (t) => {
    const stats = b1(pair, 'moving');
    t.diagnostic(`${stats.pass ? 'B1 PASS' : 'B1 FAIL'}: ${summary(stats)}`);
    assert.ok(stats.samples > 0);
  });
}
