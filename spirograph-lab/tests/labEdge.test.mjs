import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeCheck, headline, trainLogit, WARM } from '../lab/labEdge.js';

const rng = seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rows = (n, signal, seed = 7) => {
  const r = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const x = r() - 0.5, y = signal ? (x > 0 ? 1 : 0) : (r() > 0.5 ? 1 : 0);
    out.push({ at: i, y, move: y ? 10 : -10, penDir: 1, spiro: [x, r(), r()], mom: [r(), r()] });
  }
  return out;
};

test('a learner finds a real signal in the circles, and nothing in noise', () => {
  const real = edgeCheck(rows(200, true));
  assert.ok(real.ready && real.edge && real.spiroEdge, real.verdict);
  assert.ok(real.learners.find(l => l.key === 'spiro').rate > 0.9);
  const none = edgeCheck(rows(200, false));
  assert.equal(none.edge, false, none.verdict);
  assert.match(none.verdict, /nothing here for a bigger model/);
});

test('too few rows says so rather than guessing', () => {
  const x = edgeCheck(rows(WARM + 5, true));
  assert.equal(x.ready, false);
  assert.match(x.verdict, /at least/);
});

test('the logistic learner separates a clean split', () => {
  const f = trainLogit([[-2], [-1], [1], [2]], [0, 0, 1, 1]);
  assert.ok(f([-3]) < 0.5 && f([3]) > 0.5);
});

test('the headline reads a scorecard', () => {
  const sc = { runs: 40, dir: { n: 40, rate: 0.5, lo: 0.35, majority: 0.55 }, turns: { graded: 100, rate: 0.3, lo: 0.25, chance: 0.38 }, path: { ratio: 1.1 } };
  const h = headline(sc);
  assert.equal(h.word, 'No edge');
  assert.match(h.text, /1\.10× a flat line \(worse\)/);
  assert.equal(headline({ ...sc, dir: { ...sc.dir, lo: 0.6 } }).word, 'An edge');
  assert.equal(headline(null).edge, false);
});
