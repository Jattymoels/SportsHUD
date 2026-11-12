// The course test: log what a rangefinder says beside what the app says,
// and keep the tally against the spec's targets for B7 (green distances)
// and B9 (look to range). Everything is kept on the device.

import { scoreDistances, scoreLooks } from '../../engine/index.js';
import { loadSettings, saveSettings } from '../ghost/store.js';

const $ = (id) => document.getElementById(id);
const WHAT = { pin: 'pin', centre: 'centre', front: 'front', back: 'back' };

/**
 * @param {object} hooks
 * @param {() => object|null} hooks.now the page's latest working: hole, green distances, pin, look, heading, where the position came from
 * @param {(text:string) => void} hooks.say show a line of status
 */
export function initFieldTest({ now, say }) {
  const saved = loadSettings('golfTest');
  const log = { distances: saved.distances ?? [], looks: saved.looks ?? [] };
  const keep = () => saveSettings('golfTest', log);

  function verdict(node, pass) {
    if (pass == null) return;
    const chip = document.createElement('span');
    chip.className = `verdict ${pass ? 'pass' : 'fail'}`;
    const word = document.createElement('span');
    word.textContent = pass ? 'Pass' : 'Fail';
    chip.append(pass ? '✓ ' : '✕ ', word);
    node.append(chip);
  }

  function render() {
    const d = scoreDistances(log.distances);
    const b7 = $('b7Tally');
    b7.textContent = d.count
      ? `Green distances (B7): ${d.good} of ${d.count} within 5 m; typically ${d.typical.toFixed(1)} m out, at worst ${d.worst.toFixed(1)} m. Target: 9 of 10.`
      : 'Green distances (B7): nothing logged yet. Target: within 5 m on 9 of 10 readings.';
    verdict(b7, d.pass);
    const l = scoreLooks(log.looks);
    const b9 = $('b9Tally');
    b9.textContent = l.count ? `Look to range (B9): the right feature ${l.right} of ${l.count} times. Target: 8 of 10.` : 'Look to range (B9): nothing logged yet. Target: the right feature 8 times in 10.';
    verdict(b9, l.pass);

    const table = $('testTable');
    table.replaceChildren();
    const head = table.createTHead().insertRow();
    for (const title of ['When', 'Hole', 'Check', 'App', 'Measured', 'Out by', 'GPS good to']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = title;
      head.append(th);
    }
    const body = table.createTBody();
    const rows = [
      ...log.distances.map((r) => [r.at, r.hole, `distance to the ${WHAT[r.to]}`, `${r.app.toFixed(1)} m`, `${r.measured} m`, `${(r.app - r.measured).toFixed(1)} m`, r.accuracy == null ? 'desk' : `${Math.round(r.accuracy)} m`]),
      ...log.looks.map((r) => [r.at, r.hole, `looking at ${r.feature ?? 'nothing'}`, r.distance == null ? '' : `${r.distance.toFixed(1)} m`, r.right ? 'right' : 'wrong', '', r.accuracy == null ? 'desk' : `${Math.round(r.accuracy)} m`]),
    ].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    for (const row of rows) {
      const tr = body.insertRow();
      row.forEach((value, i) => (tr.insertCell().textContent = i === 0 ? new Date(value).toLocaleTimeString() : String(value)));
    }
  }

  /** Called with the page's working each time it is redrawn: what "looking at" is right now. */
  function show(w) {
    $('lookNow').textContent = w.look ? `The app says you are looking at: ${w.look.feature.name}, ${Math.round(w.look.distance)} m` : 'The app says you are looking at: nothing mapped';
  }

  $('testLog').addEventListener('click', () => {
    const w = now();
    const measured = Number($('testMetres').value);
    const to = $('testTo').value;
    if (!w || !(measured > 0)) return say('Enter what the rangefinder or marker says, in metres.');
    const app = to === 'pin' ? w.pin : w.green[to];
    if (app == null) return say('No pin is known on this hole. Stand at the flag and press "I am at today\'s pin", or check the centre instead.');
    log.distances.push({ at: new Date().toISOString(), hole: w.hole.number, to, app, measured, accuracy: w.accuracy, lat: w.position.lat, lon: w.position.lon, pinSet: to === 'pin' ? w.pinSet : undefined });
    keep();
    $('testMetres').value = '';
    say(`Logged: the app says ${app.toFixed(1)} m to the ${WHAT[to]}, the rangefinder ${measured} m.`);
    render();
  });
  for (const [id, right] of [['lookRight', true], ['lookWrong', false]]) {
    $(id).addEventListener('click', () => {
      const w = now();
      if (!w) return;
      log.looks.push({ at: new Date().toISOString(), hole: w.hole.number, feature: w.look?.feature.name ?? null, distance: w.look?.distance ?? null, heading: w.heading, right, accuracy: w.accuracy });
      keep();
      render();
    });
  }
  $('testCsv').addEventListener('click', () => {
    const lines = ['when,hole,check,app_m,measured_m,out_by_m,gps_accuracy_m,lat,lon,heading_deg,right'];
    for (const r of log.distances) lines.push([r.at, r.hole, `distance_${r.to}${r.pinSet ? '_set_today' : ''}`, r.app.toFixed(2), r.measured, (r.app - r.measured).toFixed(2), r.accuracy ?? '', r.lat?.toFixed(6) ?? '', r.lon?.toFixed(6) ?? '', '', ''].join(','));
    for (const r of log.looks) lines.push([r.at, r.hole, `look_${(r.feature ?? 'nothing').replace(/[, ]+/g, '_')}`, r.distance?.toFixed(2) ?? '', '', '', r.accuracy ?? '', '', '', r.heading?.toFixed(1) ?? '', r.right ? 1 : 0].join(','));
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sportshud-course-test.csv';
    link.click();
    URL.revokeObjectURL(url);
  });
  $('testClear').addEventListener('click', () => {
    if (!log.distances.length && !log.looks.length) return;
    if (!window.confirm('Clear everything logged for the course test?')) return;
    log.distances = [];
    log.looks = [];
    keep();
    render();
  });

  render();
  return { show, log };
}
