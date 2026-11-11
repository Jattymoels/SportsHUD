// The engine against the truth. The synthetic generator knows exactly where
// each effort was at every instant, so the gap it reports is the real one.
// Real recordings can never be checked this way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, simulate, thin, trueGap, GPS_NOISE, NO_NOISE } from '../../fixtures/generate.mjs';
import { checkB1, compareGapSeries } from '../index.js';
import { recording } from './helpers.js';

function againstTruth(scenario, noise, { seedShift = 0, sparse = false } = {}) {
  const shifted = {
    ...scenario,
    efforts: {
      a: { ...scenario.efforts.a, seed: scenario.efforts.a.seed + seedShift },
      b: { ...scenario.efforts.b, seed: scenario.efforts.b.seed + seedShift },
    },
  };
  const a = simulate(shifted, 'a', noise);
  const b = simulate(shifted, 'b', noise);
  const runner = sparse ? thin(b.fixes, 5 + seedShift) : b.fixes;
  const { live, stats, route } = checkB1(recording(a.fixes), recording(runner));
  const truth = live.slice(0, stats.samples).map((s) => ({ t: s.t, ...trueGap(a, b, s.t), finished: false }));
  return { live, truth, route, b1: stats };
}

const percentile = (values, p) => [...values].sort((x, y) => x - y)[Math.min(values.length - 1, Math.floor(p * values.length))];

for (const scenario of SCENARIOS) {
  test(`${scenario.id}: with perfect GPS the live gap is the true gap`, () => {
    const { live, truth, route } = againstTruth(scenario, NO_NOISE);
    // Within 2 s throughout (same 2 s timing slack as B1, for the ghost's stops).
    const stats = compareGapSeries(live, truth, { targetS: 2 });
    assert.equal(stats.pass, true, `misses at t = ${stats.misses}`);
    assert.ok(stats.p95TimeError < 0.3, `95th percentile error ${stats.p95TimeError.toFixed(2)} s`);
    assert.ok(stats.maxDistError < 6, `distance gap off by up to ${stats.maxDistError.toFixed(1)} m`);
    // The route is the true path, give or take corners cut between fixes.
    assert.ok(Math.abs(route.length - scenario.path.length) < 0.005 * scenario.path.length);
  });

  test(`${scenario.id}: with GPS drift the live gap stays within about 10 m of the truth`, () => {
    // A time error is worth (error × speed) metres. GPS that is a few metres
    // out on both recordings cannot do better than a few metres.
    const speed = scenario.efforts.a.speed;
    for (const seedShift of [0, 100, 200, 300, 400]) {
      const { live, truth, b1 } = againstTruth(scenario, GPS_NOISE, { seedShift });
      const errors = truth.map((s, i) => Math.abs(live[i].timeGap - s.timeGap));
      const p95 = percentile(errors, 0.95) * speed;
      assert.ok(p95 < 10, `seed +${seedShift}: 95th percentile error is worth ${p95.toFixed(1)} m`);
      assert.ok(b1.within > 0.995, `seed +${seedShift}: only ${(100 * b1.within).toFixed(2)}% of live readings match the gap computed afterwards`);
    }
  });

  test(`${scenario.id}: stays on track when fixes arrive only every 1 to 6 s`, () => {
    const speed = scenario.efforts.a.speed;
    for (const seedShift of [0, 100, 200]) {
      const { live, truth, b1 } = againstTruth(scenario, GPS_NOISE, { seedShift, sparse: true });
      assert.equal(b1.tickS, 1);
      assert.ok(b1.maxFixAge >= 4, 'fixture should really be sparse');
      const errors = truth.map((s, i) => Math.abs(live[i].timeGap - s.timeGap));
      const p95 = percentile(errors, 0.95) * speed;
      assert.ok(p95 < 12, `seed +${seedShift}: 95th percentile error is worth ${p95.toFixed(1)} m`);
    }
  });
}
