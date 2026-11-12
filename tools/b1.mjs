// Print the B1 result for pairs of recordings.
//
//   node tools/b1.mjs                         every pair in fixtures/index.json
//   node tools/b1.mjs ghost.gpx runner.gpx    one pair of your own files
//
// Add --elapsed to keep the clocks running through pauses (race timing).
// By default paused time does not count.
//
// Add --segments=5:15 to run the live segments check (B12) instead: the
// runner against a ghost holding that pace per km, with the ghost recording
// taking over wherever the two routes share ground. Pairs in
// fixtures/index.json that share only part of a route are always run this way.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGpx, checkB1, checkSegments } from '../engine/index.js';

const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const load = (path) => parseGpx(readFileSync(path, 'utf8'));

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const clock = process.argv.includes('--elapsed') ? 'elapsed' : 'moving';
const paceArg = /^--segments=(\d{1,2}):([0-5]\d)$/.exec(process.argv.find((a) => a.startsWith('--segments')) ?? '');
if (process.argv.some((a) => a.startsWith('--segments')) && !paceArg) {
  console.error('Give the pace as minutes:seconds per km, for example --segments=5:15');
  process.exit(1);
}
const segmentsPace = paceArg ? Number(paceArg[1]) * 60 + Number(paceArg[2]) : null;

let pairs;
if (args.length >= 2) {
  pairs = [{ label: 'Your files', ghost: args[0], runner: args[1] }];
} else {
  const index = JSON.parse(readFileSync(fixtures + 'index.json', 'utf8'));
  pairs = index.pairs.map((p) => ({ ...p, ghost: fixtures + p.ghost, runner: fixtures + p.runner }));
}

const pct = (x) => (100 * x).toFixed(1) + '%';
const sec = (x) => x.toFixed(2) + ' s';
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const signed = (x, digits = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(digits)}`;

function segments(pair, secondsPerKm) {
  const { stats, switches, stretches, live } = checkSegments([load(pair.ghost)], load(pair.runner), secondsPerKm, { clock });
  console.log(`\n${pair.label}: live segments`);
  console.log(`  ghost holds ${mmss(secondsPerKm)} per km; the ghost recording takes over where the routes share ground`);
  console.log(`  clock: ${clock === 'moving' ? `paused time not counted (replayed recording paused ${stats.pausedS.runner.toFixed(0)} s)` : 'elapsed, never stops'}; gap at the end ${signed(live.at(-1).timeGap, 0)} s; ${(stats.distance / 1000).toFixed(2)} km measured`);
  console.log(`  racing the recording for ${mmss(stats.onRecordingS)} of ${mmss(live.length * stats.tickS)}, in ${stretches.length} stretch(es)`);
  console.log(`  B12 ${stats.pass ? 'PASS' : 'FAIL'} (no jump at a change of ghost): largest jump ${sec(stats.maxSwitchJump)} over ${switches.length} change(s), target ${stats.jumpS} s; largest change in any one second ${sec(stats.maxStep)}`);
  for (const s of switches) {
    const trueT = pair.shared && switches.length === 2 ? (s.to === 'recording' ? pair.shared.joinS : pair.shared.leaveS) : null;
    const timing = trueT == null ? '' : `, ${Math.abs(s.t - trueT)} s ${s.t >= trueT ? 'after' : 'before'} it truly happened`;
    console.log(`    ${mmss(s.t).padStart(6)}  ${s.to === 'recording' ? 'recording takes over' : 'set pace takes over '}  ${(s.dist / 1000).toFixed(2)} km in, gap ${signed(s.timeGap)} s${timing}`);
  }
}

for (const pair of pairs) {
  if (segmentsPace || pair.segments) {
    segments(pair, segmentsPace ?? pair.secondsPerKm);
    continue;
  }
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
