// Print the B1 result for pairs of recordings.
//
//   node tools/b1.mjs                         every pair in fixtures/index.json
//   node tools/b1.mjs ghost.gpx runner.gpx    one pair of your own files
//
// Add --elapsed to keep the clocks running through pauses (race timing).
// By default paused time does not count.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGpx, checkB1 } from '../engine/index.js';

const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const load = (path) => parseGpx(readFileSync(path, 'utf8'));

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const clock = process.argv.includes('--elapsed') ? 'elapsed' : 'moving';

let pairs;
if (args.length >= 2) {
  pairs = [{ label: 'Your files', ghost: args[0], runner: args[1] }];
} else {
  const index = JSON.parse(readFileSync(fixtures + 'index.json', 'utf8'));
  pairs = index.pairs.map((p) => ({ ...p, ghost: fixtures + p.ghost, runner: fixtures + p.runner }));
}

const pct = (x) => (100 * x).toFixed(1) + '%';
const sec = (x) => x.toFixed(2) + ' s';
for (const pair of pairs) {
  const { stats, route, live } = checkB1(load(pair.ghost), load(pair.runner), { clock });
  const last = live[stats.samples - 1];
  console.log(`\n${pair.label}`);
  console.log(`  clock: ${clock === 'moving' ? `paused time not counted (replayed recording paused ${stats.pausedS.runner.toFixed(0)} s, ghost ${stats.pausedS.ghost.toFixed(0)} s)` : 'elapsed, never stops'}; last gap before the finish ${last.timeGap >= 0 ? '+' : ''}${last.timeGap.toFixed(0)} s`);
  console.log(`  route ${(route.length / 1000).toFixed(2)} km, ${stats.samples} readings, one every ${stats.tickS} s (oldest fix used: ${stats.maxFixAge} s)`);
  console.log(`  B1 ${stats.pass ? 'PASS' : 'FAIL'}: ${pct(stats.within)} of readings within ${stats.targetS} s of the gap computed afterwards (allowing ${stats.slackS} s of timing slack); worst ${sec(stats.maxTimeErrorWithSlack)}`);
  console.log(`  same instant, no slack: ${pct(stats.withinSameInstant)} within ${stats.targetS} s; worst ${sec(stats.maxTimeError)}, 95th percentile ${sec(stats.p95TimeError)}, mean ${sec(stats.meanTimeError)}`);
  console.log(`  distance gap: worst difference ${stats.maxDistError.toFixed(1)} m`);
  console.log(`  ghost stood still at ${stats.ghostStops.count} place(s), longest ${stats.ghostStops.longestS.toFixed(0)} s; replayed recording had ${stats.holes.count} hole(s), longest ${stats.holes.longestS.toFixed(0)} s${stats.holes.filled ? ', filled' : ''}; off the ghost's route for ${stats.offRouteS} s`);
  if (stats.sameInstantMisses.length) console.log(`  over ${stats.targetS} s at the same instant: t = ${stats.sameInstantMisses.join(', ')} s`);
  if (stats.misses.length) console.log(`  over ${stats.targetS} s even with slack: t = ${stats.misses.join(', ')} s`);
}
