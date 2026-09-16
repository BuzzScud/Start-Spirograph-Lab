import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContract, seriesName, frontSchedule, stitch, sessionVolumes, sessionOf, frontId } from '../lab/labSeries.js';
import { nyEpoch } from '../engine/levels.js';
import { synthBars } from './helpers.mjs';

test('contract ids read as their exchange names, in expiry order', () => {
  assert.deepEqual([parseContract('CON.F.US.ENQ.Z26').name, parseContract('CON.F.US.EP.U26').name, parseContract('CON.F.US.BP6.Z26').name], ['NQZ6', 'ESU6', '6BZ6']);
  assert.ok(parseContract('CON.F.US.ENQ.Z26').order > parseContract('CON.F.US.ENQ.U26').order);
  assert.equal(parseContract('nope'), null);
  assert.equal(seriesName(frontId('ENQ')), 'NQ front month');
});

test('the front month rolls the session after the new contract out-trades the old, never back, and is back-adjusted', () => {
  const from = nyEpoch(2026, 9, 6, 18), mid = nyEpoch(2026, 9, 9, 18), to = nyEpoch(2026, 9, 12, 12);
  const u = [...synthBars(from, mid, { vol: 500 }), ...synthBars(mid, to, { vol: 50 })];
  const z = [...synthBars(from, mid, { level: 20300, vol: 20 }), ...synthBars(mid, to, { level: 20300, vol: 900 })];
  const U = 'CON.F.US.ENQ.U26', Z = 'CON.F.US.ENQ.Z26';
  const sched = frontSchedule({ [U]: sessionVolumes(u), [Z]: sessionVolumes(z) });
  const firstZ = sched.find(s => s.contract === Z);
  assert.ok(firstZ, 'it rolls');
  // Z out-traded U first in the session opening Wed 9 Sep 6 pm, so the roll lands on the next one (Thu 10 Sep 6 pm)
  assert.equal(firstZ.session, sessionOf(nyEpoch(2026, 9, 10, 18)));
  assert.ok(sched.slice(sched.indexOf(firstZ)).every(s => s.contract === Z), 'never back');
  const { bars, rolls } = stitch({ [U]: u, [Z]: z }, sched);
  assert.equal(rolls.length, 1);
  assert.ok(Math.abs(rolls[0].gap - 300) < 1e-6, 'the gap is the difference between the two at the roll');
  assert.ok(bars.every((b, i) => !i || b.t > bars[i - 1].t), 'one ascending series');
  const at = bars.findIndex(b => b.t === rolls[0].at);
  assert.ok(Math.abs(bars[at].c - bars[at - 1].c) < 40, 'no jump at the roll');
});
