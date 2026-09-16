// The turn network: rows from graded calls, a planted pattern learned, noise not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnRows, turnNetCheck, TURN_INPUTS, MAX_ROWS } from '../lab/labTurnNet.js';
import { nyEpoch } from '../engine/levels.js';

const M = 60000;
function calls(n, hitOf) {
  let s = 3; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const zones = ['asia', 'london', 'nyam', 'nypm', 'none'], out = [];
  for (let i = 0; i < n; i++) {
    const zone = zones[Math.floor(rnd() * 5)], at = nyEpoch(2026, 8, 3, 18) + i * 47 * M, off = rnd() * 20 - 10;
    const c = { fam: rnd() < 0.5 ? 'daily' : 'kalman', n: 1 + Math.floor(rnd() * 3), P: 240, at, kind: rnd() < 0.5 ? 'peak' : 'trough', calledAt: at - 60 * M, A: 5 + rnd() * 30, zone, px: 20000 + rnd() * 100, level: { high: 20100, low: 19900 } };
    const hit = hitOf(c, rnd); out.push({ ...c, state: hit ? 'hit' : 'miss', off: hit ? off : null });
  }
  return out;
}

test('rows carry the call\'s geometry and place; the walk learns a planted pattern and not noise', () => {
  const planted = calls(700, c => c.zone === 'nyam' || (c.kind === 'peak' && c.px > 20080));
  const rows = turnRows(planted);
  assert.equal(rows.length, 700); assert.equal(rows[0].x.length, TURN_INPUTS.length);
  assert.ok(rows.every((r, i) => !i || r.at >= rows[i - 1].at));
  const a = turnNetCheck(planted);
  assert.ok(a.ready && a.edge && a.brier < a.brierBase - 0.05, a.verdict);
  const noise = calls(700, (c, rnd) => rnd() < 0.4);
  const b = turnNetCheck(noise);
  assert.ok(b.ready && !b.edge, b.verdict);
  assert.equal(turnNetCheck(planted.slice(0, 50)).ready, false);
  const many = calls(MAX_ROWS + 500, c => c.zone === 'nyam');
  assert.equal(turnRows(many).length, MAX_ROWS, 'thinned to the cap');
  assert.equal(turnRows([{ ...planted[0], P: 6 }]).length, 0, 'the 6m circle is not learned from');
});
