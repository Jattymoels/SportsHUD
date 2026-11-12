import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGpx, toFixes, findPauses, fillGaps, haversine, thinFixes, trimEnds, packRun, unpackRun, ghostFromFixes, createRunSession } from '../index.js';
import { at, path, steady, noise } from './helpers.js';

const STARTED = Date.UTC(2026, 9, 3, 6, 30, 12);

/** A run round some streets with GPS wobble, a wait at a crossing, and speed that comes and goes. */
function streets(seed = 4) {
  const rand = noise(seed);
  const points = path([[0, 0], [0, 400], [300, 400], [300, 900], [-200, 900], [-200, 1500]]);
  const fixes = [];
  let s = 0;
  let wobbleX = 0;
  let wobbleY = 0;
  for (let t = 0; s < points.length - 1; t++) {
    const waiting = t >= 200 && t < 235; // stood at a crossing
    if (!waiting) s += 3 + 0.6 * Math.sin(t / 40);
    const p = points[Math.min(points.length - 1, Math.round(s))];
    wobbleX = 0.9 * wobbleX + 0.5 * rand();
    wobbleY = 0.9 * wobbleY + 0.5 * rand();
    fixes.push({ t, lat: p.lat + wobbleY / 111195, lon: p.lon + wobbleX / 91170 });
  }
  return fixes;
}

/** The furthest apart the two runs ever are at the same second. */
function furthestApart(original, rebuilt) {
  let worst = 0;
  for (const f of original) {
    const b = rebuilt[Math.round(f.t)];
    assert.equal(b.t, Math.round(f.t));
    worst = Math.max(worst, haversine(f.lat, f.lon, b.lat, b.lon));
  }
  return worst;
}

test('a run comes back from its link: same seconds, same places to within the promise', () => {
  const fixes = streets();
  const pauses = [{ start: 201, end: 234 }];
  const text = packRun({ startedAt: STARTED, fixes, pauses, from: 'Zoë' });
  assert.match(text, /^[A-Za-z0-9_-]+$/, 'safe to put in a link as it is');
  const back = unpackRun(text);
  assert.equal(back.startedAt, STARTED);
  assert.equal(back.from, 'Zoë');
  assert.deepEqual(back.pauses, pauses);
  assert.equal(back.fixes.length, fixes.length, 'a position every second again');
  // 2 m from thinning, and up to 0.8 m more from keeping positions to the nearest metre or so.
  const apart = furthestApart(fixes, back.fixes);
  assert.ok(apart <= 2.8, `furthest apart ${apart}`);
  console.log(`a ${Math.round(fixes.length / 60)} min run with a wait: ${fixes.length} positions as ${text.length} characters, never more than ${apart.toFixed(1)} m out`);
  assert.ok(text.length < fixes.length, 'far smaller than one character a position');
});

test('a tighter promise costs a longer link, and is kept', () => {
  const fixes = streets(9);
  const loose = packRun({ startedAt: STARTED, fixes }, { within: 5 });
  const tight = packRun({ startedAt: STARTED, fixes }, { within: 1 });
  assert.ok(tight.length > loose.length);
  assert.ok(furthestApart(fixes, unpackRun(tight).fixes) <= 1.8);
  assert.ok(furthestApart(fixes, unpackRun(loose).fixes) <= 5.8);
});

test('a straight steady run needs only its two ends', () => {
  const fixes = steady(path([[0, 0], [900, 0]]), 3);
  assert.equal(thinFixes(fixes).length, 2);
  const text = packRun({ startedAt: STARTED, fixes });
  assert.ok(text.length < 40, `${text.length} characters`);
  assert.ok(furthestApart(fixes, unpackRun(text).fixes) < 1);
});

test('standing still is kept as standing still, not smoothed into slow running', () => {
  const fixes = streets();
  const back = unpackRun(packRun({ startedAt: STARTED, fixes })).fixes;
  // Through the wait at the crossing the rebuilt run barely moves.
  const moved = haversine(back[205].lat, back[205].lon, back[230].lat, back[230].lon);
  assert.ok(moved < 3, `moved ${moved} m while waiting`);
  // And it is where the original was just before and just after.
  assert.ok(haversine(back[199].lat, back[199].lon, fixes[199].lat, fixes[199].lon) < 2.8);
  assert.ok(haversine(back[240].lat, back[240].lon, fixes[240].lat, fixes[240].lon) < 2.8);
});

test('the ghost from a link races like the ghost it was made from', () => {
  const load = (name) => {
    const saved = toFixes(parseGpx(readFileSync(new URL(`../../fixtures/synthetic/${name}.gpx`, import.meta.url), 'utf8')));
    return { fixes: fillGaps(saved), pauses: findPauses(saved) };
  };
  const theirs = load('run-a');
  const mine = load('run-b');
  const sent = unpackRun(packRun({ startedAt: STARTED, ...theirs }));
  const race = (run) => {
    const { route, ghost } = ghostFromFixes(run.fixes, run.pauses);
    const session = createRunSession({ ghost: { kind: 'track', route, profile: ghost }, clock: 'elapsed' });
    return mine.fixes.map((fix) => {
      session.update(fix);
      const r = session.at(fix.t);
      return r && !r.offRoute ? r.timeGap : null;
    });
  };
  const asRecorded = race(theirs);
  const fromLink = race(sent);
  const differences = asRecorded.flatMap((gap, i) => (gap == null || fromLink[i] == null ? [] : [Math.abs(gap - fromLink[i])])).sort((a, b) => a - b);
  const typical = differences[differences.length >> 1];
  const most = differences[Math.floor(differences.length * 0.95)];
  console.log(`gap against a ghost from a link, compared with the ghost as recorded: typically ${typical.toFixed(2)} s different, 19 in 20 within ${most.toFixed(2)} s`);
  assert.ok(differences.length > 0.9 * mine.fixes.length);
  assert.ok(typical < 0.3, `typical ${typical}`);
  assert.ok(most < 1, `19 in 20 within ${most}`);
});

test('a link that is cut short, garbled or not a run is refused with a reason', () => {
  const text = packRun({ startedAt: STARTED, fixes: streets(), pauses: [{ start: 201, end: 234 }], from: 'Sam' });
  assert.throws(() => unpackRun(text.slice(0, text.length >> 1)), /cut short/);
  assert.throws(() => unpackRun(''), /does not hold a run/);
  assert.throws(() => unpackRun('hello there!'), /does not hold a run/);
  assert.throws(() => unpackRun('Zm9v'), /newer version|does not hold a run/);
  // One made to claim a run of years, which would otherwise be filled in second by second.
  const end = { t: 3e8, ...at(0, 50) };
  assert.throws(() => unpackRun(packRun({ startedAt: STARTED, fixes: [{ t: 0, ...at(0, 0) }, end] })), /damaged/);
});

test('trimming takes the same distance off both ends and starts the clock again', () => {
  const fixes = steady(path([[0, 0], [0, 1200]]), 3); // 400 s
  const pauses = [{ start: 20, end: 30 }, { start: 150, end: 160 }, { start: 390, end: 395 }];
  const cut = trimEnds(fixes, pauses, 200);
  assert.equal(cut.fixes[0].t, 0);
  const first = cut.fixes[0];
  const last = cut.fixes[cut.fixes.length - 1];
  assert.ok(Math.abs(haversine(fixes[0].lat, fixes[0].lon, first.lat, first.lon) - 200) <= 3);
  assert.ok(Math.abs(haversine(fixes[fixes.length - 1].lat, fixes[fixes.length - 1].lon, last.lat, last.lon) - 200) <= 3);
  // Only the pause in the part that is left survives, on the new clock.
  assert.equal(cut.pauses.length, 1);
  assert.ok(Math.abs(cut.pauses[0].start - (150 - cut.cut)) < 1e-9);
  assert.ok(Math.abs(cut.pauses[0].end - (160 - cut.cut)) < 1e-9);
});

test('a run too short to trim is sent whole', () => {
  const fixes = steady(path([[0, 0], [0, 500]]), 3);
  assert.equal(trimEnds(fixes, [], 200).fixes.length, fixes.length);
  assert.equal(trimEnds(fixes, [], 0).fixes.length, fixes.length);
});
