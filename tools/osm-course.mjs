// Turn OpenStreetMap data into a course file the golf app can load.
//
//   node tools/osm-course.mjs map.json fixtures/courses/name.json [--name=Grange]
//
// map.json is what OpenStreetMap's map call returns for the area of the
// course, for example
//   https://api.openstreetmap.org/api/0.6/map.json?bbox=west,south,east,north
// Only the course itself is written out, not the map data around it. The
// result is derived from OpenStreetMap and stays under its licence (ODbL):
// keep the attribution with it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { courseFromOsm } from '../engine/index.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const name = process.argv.find((a) => a.startsWith('--name='))?.slice(7);
if (args.length < 2) {
  console.error('Usage: node tools/osm-course.mjs map.json out.json [--name=Part of the course name]');
  process.exit(1);
}
const osm = JSON.parse(readFileSync(args[0], 'utf8'));
const course = courseFromOsm(osm, { name });
course.source = 'OpenStreetMap';
course.fetched = new Date().toISOString().slice(0, 10);
mkdirSync(dirname(args[1]), { recursive: true });
writeFileSync(args[1], JSON.stringify(course) + '\n');

const m = course.mapped;
console.log(`${course.name}: ${m.holes} holes with a line of play; in the course outline ${m.greens} greens, ${m.tees} tees, ${m.fairways} fairways, ${m.bunkers} bunkers, ${m.water} water hazards, ${m.pins} pins`);
for (const h of course.holes) {
  console.log(`  ${String(h.number).padStart(2)}  par ${h.par ?? '?'}  index ${String(h.index ?? '?').padStart(2)}  ${String(h.length).padStart(3)} m  pin ${h.pin ? 'yes' : 'no '}  ${h.fairways.length} fairway(s), ${h.tees.length} tee(s), ${h.hazards.filter((z) => z.kind === 'bunker').length} bunkers, ${h.hazards.filter((z) => z.kind === 'water').length} water`);
}
console.log(`wrote ${args[1]}`);
