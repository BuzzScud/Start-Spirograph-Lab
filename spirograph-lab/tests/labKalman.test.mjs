// The Kalman rungs on the synthetic bank: seeded from a free-phase fit, called a quarter lap ahead, and the planted
// cycle's turns clear the nulls. The planted cycle is 250 minutes, not 240: it does not divide the day, so its turns
// move round the clock and only a free phase can follow them (a 240 would repeat daily and the clock null would match it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedKalman, kalmanCalls, rungTurnsIn } from '../lab/labKalman.js';
import { realTurnsByPeriod, gradeCall, turnReport, swingMin } from '../lab/labTurns.js';
import { sessionLevels } from '../lab/labLevels.js';
import { closesFromBars } from '../engine/freeze.js';
import { DAILY_PERIODS } from '../engine/dailySet.js';
import { nyEpoch } from '../engine/levels.js';
import { synthBars } from './helpers.mjs';

const M = 60000;

test('the seed fits the planted cycles and the walk calls their turns a quarter lap ahead', () => {
  const from = nyEpoch(2026, 8, 17, 18), to = nyEpoch(2026, 9, 11, 17), bars = synthBars(from, to, { seed: 9, period: 250 });
  const seed = seedKalman(bars, nyEpoch(2026, 8, 31, 18));
  assert.ok(seed && seed.count > 2000, `seeded on ${seed && seed.count} closes`);
  assert.ok(seed.fit.A[1] > 8 && seed.fit.A[1] < 30, `the 4H rung (a ±20 cycle of 250 min planted) fitted at ±${seed.fit.A[1].toFixed(1)}`);
  const turns = rungTurnsIn(seed.st, 1, seed.st.t / M, seed.st.t / M + 240);
  assert.equal(turns.length, 2, 'one peak and one trough a lap');
  assert.notEqual(turns[0].kind, turns[1].kind);
  const f = nyEpoch(2026, 9, 1, 18), t = nyEpoch(2026, 9, 10, 17), x = kalmanCalls({ bars, from: f, to: t });
  assert.ok(!x.refused && x.calls.length > 500, `${x.calls.length} calls`);
  for (const c of x.calls) { assert.ok(c.at >= f && c.at < t); assert.ok(c.at - c.calledAt >= Math.max(c.P / 4, swingMin(c.P) + 1) * M - M, 'called at least a quarter lap ahead'); }
  const c4 = x.calls.filter(c => c.n === 1);
  assert.ok(c4.length >= 60, `${c4.length} 4H calls in nine sessions`);
  for (let i = 1; i < c4.length; i++) assert.ok(c4[i].at - c4[i - 1].at > 60 * M, 'one call a turn');
  const closes = closesFromBars(bars, f - 2 * 86400e3, t + 86400e3), realByP = realTurnsByPeriod(closes, DAILY_PERIODS), levels = sessionLevels(bars, f, t);
  const graded = x.calls.map(c => gradeCall(c, realByP.get(c.P), closes, levels, t + 86400e3));
  const rep = turnReport(graded, realByP, closes, levels, { reps: 20 });
  const cell = rep.cells['c:kalman|1'];
  assert.ok(cell.judged && cell.rate > 0.6 && cell.clears, `4H: ${(100 * cell.rate).toFixed(0)}% of ${cell.n} against ${(100 * cell.hardest).toFixed(0)}% (${cell.hardestName})`);
  assert.equal(kalmanCalls({ bars: bars.slice(0, 100), from: f, to: t }).refused, 'history');
});
