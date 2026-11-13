// The head-test analysis, against made-up recordings whose truth is known.
// What is tested is that the tool finds what was put in. Whether a real
// head gives signals like these is what a real recording is for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { madeUpHeadTest } from './head-madeup.mjs';
import { parseHeadTest, analyseHeadTest, describeHeadTest, readHeadTest } from './head.mjs';

const near = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);
const between = (a, b) => (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

test('a made-up run: the tool finds the wander, the look aside and how the phone sat', (t) => {
  const { text, truth } = madeUpHeadTest();
  const [r] = analyseHeadTest(text);
  t.diagnostic(describeHeadTest([r]).split('\n').filter((line) => /a minute|Ordinary|look aside at|the stride read|Facing forwards|compass, |it read/.test(line)).join(' | '));
  assert.deepEqual(r.problems, []);
  // What was written down.
  near(r.seconds, 500, 1);
  near(r.rates.orientation, 60, 1);
  near(r.rates.motion, 60, 1);
  near(r.rates.gps, 1, 0.05);
  near(r.distance, 1430, 40, 'metres run');
  // How the phone sat: found from the standing start, the stride and the GPS, with nothing to line up by.
  // "Up" is taken from how the head was carried standing still, and the made-up runner carries theirs 5° down.
  assert.ok(between(r.mount.up, truth.sits.up) < 6.5, `up is ${between(r.mount.up, truth.sits.up)}° off`);
  assert.ok(between(r.mount.forward, truth.sits.forward) < 8, `forward is ${between(r.mount.forward, truth.sits.forward)}° off`);
  assert.equal(r.mount.squared.sure, true, 'which end faces forwards was settled');
  // The wander put in: 1.5° a minute.
  near(r.wander.perMinute, truth.drift, 0.5, 'wander a minute');
  // The look aside put in: 35° to the right for a minute from 4:10.
  assert.equal(r.aside.length, 1);
  near(r.aside[0].from, truth.asideFrom, 6, 'look aside begins');
  near(r.aside[0].seconds, truth.asideFor, 8, 'look aside lasts');
  near(r.aside[0].angle, truth.aside, 4, 'look aside angle');
  // The heading kept with no compass: fine on ordinary running, pulled by the look aside, as its own tests say.
  assert.ok(r.kept.typical < 2, `typical ${r.kept.typical}`);
  assert.ok(r.kept.most < 4, `19 in 20 within ${r.kept.most}`);
  assert.ok(r.kept.aside[0].late > 10, `pulled ${r.kept.aside[0].late}° by the look aside`);
  assert.ok(r.kept.aside[0].after < 3, `back to ${r.kept.aside[0].after}° two minutes on`);
  // The stride sees the look aside, and with its help the heading holds through it.
  near(r.stride.steps, truth.steps, 0.06);
  near(r.stride.aside[0].hindsight, -truth.aside, 4, 'body to the left of the head, by hindsight');
  near(r.stride.aside[0].stride, -truth.aside, 6, 'and by the stride');
  assert.ok(r.withStride.aside[0].late < 5, `with the stride: ${r.withStride.aside[0].late}° out during the look aside`);
  assert.ok(r.withStride.most < 4, `with the stride, ordinary running: ${r.withStride.most}`);
  // The compass put in: 9° out steadily.
  near(r.compass.steadily, 9, 4, 'compass steadily out');
});

test('an older recording, with no compass rows and a GPS that gives no heading of its own, is still read', () => {
  const { text, truth } = madeUpHeadTest({ compass: false, gpsHeading: false, seed: 2 });
  const [r] = analyseHeadTest(text);
  assert.equal(r.gps.travelFrom, 'positions');
  assert.equal(r.compass, undefined);
  near(r.wander.perMinute, truth.drift, 0.8, 'wander a minute');
  assert.equal(r.aside.length, 1);
  near(r.aside[0].angle, truth.aside, 6, 'look aside angle');
  near(r.stride.aside[0].stride, -truth.aside, 8, 'the stride through the look aside');
});

test('a look the other way, a faster wander, and gravity reported upside down', () => {
  const { text, truth } = madeUpHeadTest({ aside: -28, drift: -4, upsideDown: true, seed: 3 });
  const [r] = analyseHeadTest(text);
  assert.equal(r.gravity.flipped, true);
  near(r.gravity.size, 9.81, 0.5);
  near(r.wander.perMinute, truth.drift, 0.8, 'wander a minute');
  near(r.aside[0].angle, truth.aside, 4, 'look aside angle');
  near(r.stride.aside[0].stride, -truth.aside, 6, 'the stride through the look aside');
  assert.ok(between(r.mount.forward, truth.sits.forward) < 8);
});

test('a page dropped part-way: two parts, each read on its own clock, the phone taken not to have moved', () => {
  const { text, truth } = madeUpHeadTest({ droppedAt: 120, seed: 4 });
  const parts = parseHeadTest(text);
  assert.equal(parts.length, 2);
  assert.match(parts[1].notes[0], /carried on after the page was dropped/);
  assert.ok(parts[1].startedAt - parts[0].startedAt === 126000, 'the second part began 126 s after the first');
  const [first, second] = analyseHeadTest(text);
  near(first.seconds, 120, 1);
  assert.equal(second.mount.carried, true);
  assert.equal(first.aside.length, 0);
  // The look aside falls in the second part, whose clock began again: 250 s in is 124 s on that clock.
  assert.equal(second.aside.length, 1);
  near(second.aside[0].from, truth.asideFrom - 126, 6);
  near(second.stride.aside[0].stride, -truth.aside, 6);
  assert.match(describeHeadTest([first, second]), /PART 2 of 2: after the page was opened afresh/);
});

test('the risk named in engine/stride.js, seen end to end: a nodding head hides part of a look aside from the stride', (t) => {
  const { text, truth } = madeUpHeadTest({ nod: 0.6, seed: 5 });
  const [r] = analyseHeadTest(text);
  const part = r.stride.aside[0].stride / r.stride.aside[0].hindsight;
  t.diagnostic(`with a nodding head the stride saw ${Math.round(100 * part)}% of a ${truth.aside}° look aside; the heading with its help was ${r.withStride.aside[0].late.toFixed(1)}° out, against ${r.kept.aside[0].late.toFixed(1)}° without`);
  assert.ok(part > 0.4 && part < 1, `saw ${part} of it`);
  assert.ok(r.withStride.aside[0].late < r.kept.aside[0].late, 'still better than without');
});

test('a squeezed file is read like a plain one, and a file with nothing in it says so', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sportshud-head-'));
  try {
    const { text } = madeUpHeadTest({ seed: 6 });
    await writeFile(join(dir, 'a.csv'), text);
    await writeFile(join(dir, 'a.csv.gz'), gzipSync(text));
    assert.equal(await readHeadTest(join(dir, 'a.csv.gz')), await readHeadTest(join(dir, 'a.csv')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  assert.equal(describeHeadTest(analyseHeadTest('')), 'No readings in this file.\n');
  assert.equal(describeHeadTest(analyseHeadTest('not,a,recording\n')), 'No readings in this file.\n');
  // A few readings and no movement: counted, and nothing claimed.
  const short = analyseHeadTest('# kind,seconds\n# head test started 2026-11-12T20:00:00.000Z on a phone\no,0.010,10.00,80.00,1.00,0\ng,0.200,-34.920000,138.600000,4.0,,0.00,21.0,100\n');
  assert.equal(short.length, 1);
  assert.equal(short[0].mount, undefined);
  assert.ok(short[0].problems.length > 0);
});
