// Print the B1 result for pairs of recordings.
//
//   node tools/b1.mjs                         every pair in fixtures/index.json
//   node tools/b1.mjs ghost.gpx runner.gpx    one pair of your own files

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGpx, checkB1 } from '../engine/index.js';

const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const load = (path) => parseGpx(readFileSync(path, 'utf8'));

let pairs;
if (process.argv.length >= 4) {
  pairs = [{ label: 'Your files', ghost: process.argv[2], runner: process.argv[3] }];
} else {
  const index = JSON.parse(readFileSync(fixtures + 'index.json', 'utf8'));
  pairs = index.pairs.map((p) => ({ ...p, ghost: fixtures + p.ghost, runner: fixtures + p.runner }));
}

const pct = (x) => (100 * x).toFixed(1) + '%';
const sec = (x) => x.toFixed(2) + ' s';
for (const pair of pairs) {
  const { stats, route } = checkB1(load(pair.ghost), load(pair.runner));
  console.log(`\n${pair.label}${pair.stress ? '  [stress case]' : ''}`);
  console.log(`  route ${(route.length / 1000).toFixed(2)} km, ${stats.samples} readings, one every ${stats.tickS} s (oldest fix used: ${stats.maxFixAge} s)`);
  console.log(`  B1 ${stats.pass ? 'PASS' : 'FAIL'}: ${pct(stats.within)} of readings within ${stats.targetS} s of the gap computed afterwards (allowing ${stats.slackS} s of timing slack); worst ${sec(stats.maxTimeErrorWithSlack)}`);
  console.log(`  same instant, no slack: ${pct(stats.withinSameInstant)} within ${stats.targetS} s; worst ${sec(stats.maxTimeError)}, 95th percentile ${sec(stats.p95TimeError)}, mean ${sec(stats.meanTimeError)}`);
  console.log(`  distance gap: worst difference ${stats.maxDistError.toFixed(1)} m`);
  console.log(`  ghost stood still at ${stats.ghostStops.count} place(s), longest ${stats.ghostStops.longestS.toFixed(0)} s; replayed recording had ${stats.holes.count} hole(s), longest ${stats.holes.longestS.toFixed(0)} s${stats.holes.filled ? ', filled' : ''}; off the ghost's route for ${stats.offRouteS} s`);
  if (stats.sameInstantMisses.length) console.log(`  over ${stats.targetS} s at the same instant: t = ${stats.sameInstantMisses.join(', ')} s`);
  if (stats.misses.length) console.log(`  over ${stats.targetS} s even with slack: t = ${stats.misses.join(', ')} s`);
}
