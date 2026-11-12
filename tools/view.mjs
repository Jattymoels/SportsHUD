// How much of a route would a pair of glasses show a ghost on?
//
//   node tools/view.mjs run.gpx [more.gpx ...]
//   npm run view -- run.gpx
//
// For each recording, and for displays of several sizes and places in the
// view, prints the share of the route on which a ghost a given distance
// ahead would be on the display. With no files it uses the sample run.
//
// Two answers are given for each, between which the truth lies: with the
// runner's head pointing 15 m up the route, as runners mostly do, and with
// it pointing dead along the route where they stand, which is the worst
// case at a corner.

import { readFile } from 'node:fs/promises';
import { parseGpx, toFixes, findPauses, fillGaps, ghostFromFixes, coverage } from '../engine/index.js';

// Degrees across and down, and where the middle sits from straight ahead.
const DISPLAYS = [
  ['14 x 14, lower right (as on today\'s everyday display glasses)', { w: 14, h: 14, right: 12, up: -10 }],
  ['14 x 14, straight ahead', { w: 14, h: 14 }],
  ['24 x 18, straight ahead (30 corner to corner)', { w: 24, h: 18 }],
  ['40 x 30, straight ahead', { w: 40, h: 30 }],
  ['56 x 42, straight ahead (70 corner to corner)', { w: 56, h: 42 }],
];
const LEADS = [8, 12, 20, 40, 80];

const files = process.argv.slice(2);
if (!files.length) files.push(new URL('../fixtures/synthetic/run-a.gpx', import.meta.url).pathname);

for (const file of files) {
  const saved = toFixes(parseGpx(await readFile(file, 'utf8')));
  const { route } = ghostFromFixes(fillGaps(saved), findPauses(saved));
  console.log(`\n${file.split('/').pop()}: ${(route.length / 1000).toFixed(2)} km`);
  console.log('Share of the route with the whole ghost on the display: head pointing up the route, to head pointing dead along it');
  console.log('  ' + 'display'.padEnd(62) + LEADS.map((lead) => `${lead} m ahead`.padStart(13)).join(''));
  for (const [name, display] of DISPLAYS) {
    const cells = LEADS.map((lead) => {
      const natural = coverage(route, lead, display).whole;
      const rigid = coverage(route, lead, display, { lookAhead: 2 }).whole;
      const [lo, hi] = [Math.min(natural, rigid), Math.max(natural, rigid)].map((share) => Math.round(share * 100));
      return (lo === hi ? `${hi}%` : `${lo}-${hi}%`).padStart(13);
    });
    console.log('  ' + name.padEnd(62) + cells.join(''));
  }
  console.log('  ' + 'how tall the ghost stands, in degrees'.padEnd(62) + LEADS.map((lead) => `${coverage(route, lead, { w: 1, h: 1 }).tall.toFixed(1)}`.padStart(13)).join(''));
}
