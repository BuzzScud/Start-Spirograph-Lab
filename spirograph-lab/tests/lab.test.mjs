// The server's side on a synthetic bank: series, sessions, a day replay and a short grade, run in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLab, normSeries } from '../server/lab.mjs';
import { nyEpoch } from '../engine/levels.js';
import { synthBars, makeBank } from './helpers.mjs';

const U = 'CON.F.US.ENQ.U26', Z = 'CON.F.US.ENQ.Z26';
const q = o => new URLSearchParams(o);

test('series, sessions, a built day and a graded range', async t => {
  const from = nyEpoch(2026, 8, 16, 18), to = nyEpoch(2026, 9, 4, 17);
  const bank = makeBank({ [U]: synthBars(from, to, { vol: 500 }), [Z]: synthBars(from, to, { level: 20250, vol: 5, seed: 3 }) });
  t.after(bank.done);
  const now = nyEpoch(2026, 9, 5, 12);
  const lab = createLab({ bankFile: bank.file, labFile: bank.lab, inline: true, now: () => now });
  t.after(() => lab.close());

  const series = lab.get('series', q({})).body.series;
  assert.deepEqual(series.map(s => s.id), ['FRONT:ENQ', U, Z]);
  const days = lab.get('days', q({ series: 'FRONT:ENQ' })).body.days;
  assert.ok(days.length >= 14 && days.every(d => d.contract === U), 'U out-trades Z throughout');

  const open = nyEpoch(2026, 9, 2, 18);
  assert.throws(() => lab.startDay({ series: U, open: open + 60000 }), /6 pm/);
  assert.throws(() => lab.startDay({ series: U, open: nyEpoch(2026, 9, 6, 18) }), /not ended/);
  const r = lab.startDay({ series: U, open });
  assert.ok(r.id);
  assert.equal(lab.lab.job(r.id).status, 'done', lab.lab.job(r.id).detail);
  const day = lab.get('day', q({ series: U, open })).body.day;
  assert.equal(day.frames.pen.length, 1441);
  assert.equal(day.held.pen.length, 1441);
  assert.ok(day.frames.mkt.filter(v => v != null).length >= 1300);
  assert.deepEqual(lab.startDay({ series: U, open }), { cached: true }, 'a built day is not built again');
  assert.ok(lab.days(U).find(d => d.open === open).built);

  const g = lab.startGrade({ series: U, from: nyEpoch(2026, 9, 1, 18), to: nyEpoch(2026, 9, 3, 18) });
  assert.equal(lab.lab.job(g.id).status, 'done', lab.lab.job(g.id).detail);
  const grade = lab.get('grade', q({ series: U, key: g.key })).body;
  assert.equal(grade.sc.runs, 16, 'two sessions of eight slots');
  assert.equal(grade.runs.length, 16);
  assert.ok(grade.runs[0].at > grade.runs[15].at, 'newest first');
  assert.equal(grade.edge.ready, false, 'too few for the edge check');
  const fc = lab.get('forecast', q({ series: U, key: g.key, at: grade.runs[0].at })).body;
  assert.equal(fc.run.pen.length, 181);
  assert.ok(fc.closes.length > 200);
  assert.equal(lab.get('grades', q({ series: U })).body.grades.length, 1);
  assert.equal(lab.post('grade', { series: U, from: 5, to: 4 }).status, 400);
  assert.equal(lab.get('nope', q({})).status, 404);
});

test('only real series are accepted', () => {
  assert.equal(normSeries('FRONT:ENQ'), 'FRONT:ENQ');
  assert.equal(normSeries(U), U);
  assert.equal(normSeries('../../etc'), null);
  assert.equal(normSeries(''), null);
});
