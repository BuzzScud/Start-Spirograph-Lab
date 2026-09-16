// The turn rule: real turns from closes, the grade, the late rule, and the nulls (a planted cycle clears them, noise does not).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realTurns, realTurnsByPeriod, nearestTurn, gradeCall, turnReport, dailyCalls, earnedRate, swingMin, tolMin } from '../lab/labTurns.js';
import { sessionLevels } from '../lab/labLevels.js';
import { closesFromBars } from '../engine/freeze.js';
import { nyEpoch } from '../engine/levels.js';
import { synthBars } from './helpers.mjs';

const M = 60000;
const from = nyEpoch(2026, 8, 24, 18), to = nyEpoch(2026, 9, 11, 17);

/** Bars with one clean 250-minute cycle and no walk, so its turns are known. 250 does not divide the day, so its turns move round the clock: a cycle at the same times every day would be caught by the clock null, as it should be. */
const PER = 250;
function sineBars() {
  return synthBars(from, to).map(b => { const c = 20000 + 30 * Math.sin(2 * Math.PI * b.t / (PER * M)); return { ...b, o: c, h: c + 0.5, l: c - 0.5, c }; });
}
const peakTimes = bars => { const out = []; for (const b of bars) { const ph = ((b.t / (PER * M)) % 1 + 1) % 1; if (ph - 0.25 > -0.5 / PER && ph - 0.25 <= 0.5 / PER) out.push(b.t + M); } return out; };

test('real turns are the closes no neighbour within an eighth of a lap beats, alternating', () => {
  const bars = sineBars(), closes = closesFromBars(bars, from, to), real = realTurns(closes, 240);
  assert.equal(swingMin(240), 30); assert.equal(swingMin(6), 2); assert.equal(tolMin(6), 1); assert.equal(tolMin(240), 30);
  assert.ok(real.n > 80, `found ${real.n} turns`);
  let same = 0; for (let i = 1; i < real.n; i++) if (real.k[i] === real.k[i - 1]) same++;
  assert.ok(same < real.n / 8, `peaks and troughs alternate, except across a shut market (${same} of ${real.n})`);
  const peaks = peakTimes(bars);
  let matched = 0;
  for (let i = 0; i < real.n; i++) if (real.k[i]) { const near = peaks.some(t => Math.abs(t - real.t[i]) <= 2 * M); if (near) matched++; }
  const found = real.k.reduce((a, b) => a + b, 0);
  assert.ok(matched / found > 0.95, `${matched} of ${found} peaks land on the sine's peaks`);
  assert.equal(realTurns({ t: new Float64Array(0), p: new Float64Array(0), n: 0 }, 240).n, 0);
});

test('a call at a real turn hits, one far away misses, one made too late is not graded', () => {
  const bars = sineBars(), closes = closesFromBars(bars, from, to), realByP = realTurnsByPeriod(closes, [240]), levels = sessionLevels(bars, from, to);
  const real = realByP.get(240), now = to + 86400e3;
  let i = 0; while (i < real.n && (!real.k[i] || real.t[i] < from + 2 * 86400e3)) i++;
  const at = real.t[i], mk = (a, calledAt = a - 120 * M) => ({ fam: 'daily', n: 1, P: 240, at: a, kind: 'peak', calledAt, A: 30 });
  assert.equal(nearestTurn(real, at + 5 * M, 1, 30 * M).off, -5);
  const hit = gradeCall(mk(at + 4 * M), real, closes, levels, now);
  assert.equal(hit.state, 'hit'); assert.equal(hit.off, -4); assert.ok(hit.zone); assert.ok(hit.tag);
  assert.equal(gradeCall(mk(at + 70 * M), real, closes, levels, now).state, 'miss', 'a trough would be there, not a peak');
  assert.equal(gradeCall({ ...mk(at), kind: 'trough' }, real, closes, levels, now).state, 'miss');
  assert.equal(gradeCall(mk(at, at - 10 * M), real, closes, levels, now).state, 'late', 'called inside the swing\'s own window');
  assert.equal(gradeCall(mk(at), real, closes, levels, at).state, 'ahead');
  assert.equal(gradeCall(mk(nyEpoch(2026, 9, 5, 12)), real, closes, levels, now).state, 'shut');
});

test('planted calls clear every null; random calls sit inside them', () => {
  const bars = sineBars(), closes = closesFromBars(bars, from, to), realByP = realTurnsByPeriod(closes, [240]), levels = sessionLevels(bars, from, to), now = to + 86400e3;
  const peaks = peakTimes(bars).filter(t => t > from + 86400e3);
  const good = peaks.map(t => ({ fam: 'kalman', n: 1, P: 240, at: t + 3 * M, kind: 'peak', calledAt: t - 60 * M, A: 30 }));
  let s = 5; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const bad = peaks.map(t => ({ fam: 'daily', n: 1, P: 240, at: t + Math.floor(rnd() * PER) * M, kind: rnd() < 0.5 ? 'peak' : 'trough', calledAt: t - 60 * M, A: 30 }));
  const graded = [...good, ...bad].map(c => gradeCall(c, realByP.get(c.P), closes, levels, now));
  const rep = turnReport(graded, realByP, closes, levels, { reps: 20 });
  const k = rep.cells['f:kalman'], d = rep.cells['f:daily'];
  assert.ok(k.n >= 60 && k.rate > 0.9, `planted: ${k.rate} of ${k.n}`);
  assert.ok(k.clears, `planted calls clear the hardest null ${k.hardestName} ${k.hardest}`);
  assert.ok(d.n >= 60 && !d.clears && Math.abs(d.rate - d.hardest) < 0.15, `random: ${d.rate} vs ${d.hardest}`);
  assert.ok(rep.verdict.lines.length >= 3 && rep.verdict.any);
  assert.ok(Number.isFinite(k.null.random.mean) && Number.isFinite(k.null.clock.mean) && Number.isFinite(k.null.shift.mean));
  assert.equal(rep.calls.kalman, good.length);
  const e = earnedRate(graded, good[good.length - 1], to, 20);
  assert.ok(e && e.rate > 0.9 && ['zone', 'circle'].includes(e.level), JSON.stringify(e));
  assert.equal(earnedRate(graded, good[0], from, 20), null, 'nothing before the first call');
});

test('the Daily set\'s calls come from its forecasts, circles too small left out', () => {
  const run = { at: 1, turns: [{ n: 1, P: 240, at: 100, kind: 'peak' }, { n: 5, P: 6, at: 200, kind: 'trough' }], amps: [0, 12, 0, 0, 0, 0.1] };
  const calls = dailyCalls([{ run }]);
  assert.deepEqual(calls, [{ fam: 'daily', n: 1, P: 240, at: 100, kind: 'peak', calledAt: 1, A: 12 }]);
});
