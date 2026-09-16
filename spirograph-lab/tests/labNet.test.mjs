import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNet, train, forward, netWalk, netCheck, netScore, explain, snapshot, withMask, pUp, solveInput, tweakRows, WARM } from '../lab/labNet.js';

const rng = seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// twelve inputs; with `signal` the direction is XOR-shaped in the first two (no straight line splits it) and the size follows the third
const rows = (n, signal, seed = 7) => {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const x = Array.from({ length: 12 }, () => r() - 0.5);
    const move = signal ? (x[0] * x[1] > 0 ? 1 : -1) * (5 + 20 * Math.abs(x[2])) : (r() - 0.5) * 20;
    return { at: i, y: move > 0 ? 1 : 0, move, pen: r() - 0.5, x };
  });
};

test('it learns XOR, as the demo it grew from does', () => {
  const xs = [[0, 0], [0, 1], [1, 0], [1, 1]], data = xs.map((x, i) => ({ x, y: [0, 1, 1, 0][i], move: [-1, 1, 1, -1][i] }));
  const net = createNet(2, { hidden: 4, seed: 42, rate: 0.05, decay: 0 });
  train(net, data, 4, 3000, { rate: 0.05, decay: 0 });
  xs.forEach((x, i) => assert.equal(forward(net, x).p > 0.5 ? 1 : 0, data[i].y, `XOR ${x}`));
});

test('it finds a planted pattern walking forward, and nothing in noise', () => {
  const real = netCheck(rows(300, true));
  assert.ok(real.ready && real.dirEdge && real.sizeEdge, real.verdict);
  const none = netCheck(rows(300, false));
  assert.equal(none.dirEdge || none.sizeEdge, false, none.verdict);
});

test('the same rows train the same network, step by step or all at once', () => {
  const data = rows(160, true, 3), a = netCheck(data), calls = [];
  for (const s of netWalk(JSON.parse(JSON.stringify(data)))) if (s.kind === 'call') calls.push(s);
  assert.equal(netScore(data, calls).fingerprint, a.fingerprint);
  assert.equal(netCheck(data).fingerprint, a.fingerprint);
  assert.notEqual(netCheck(rows(160, true, 4)).fingerprint, a.fingerprint);
  assert.equal(calls.length, 160 - WARM);
  assert.ok(calls.every((c, k) => c.i === WARM + k), 'one call per row after the warm-up, in order');
});

test('too few rows trains once and judges nothing', () => {
  const x = netCheck(rows(WARM - 10, true));
  assert.equal(x.tested, 0); assert.equal(x.ready, false); assert.match(x.verdict, /at least/);
  assert.ok(x.losses.length === 1 && x.weights);
});

test('the audit works the same answer the network gives, and its slopes are the real ones', () => {
  const data = rows(120, true, 5), net = createNet(12);
  train(net, data, 100, 200);
  const snap = snapshot(net), x = data[110].x, f = forward(net, x), ex = explain(snap, x, data[110]);
  assert.equal(ex.p, f.p); assert.equal(ex.size, f.size);
  ex.hidden.forEach((hd, k) => assert.equal(hd.a, f.hid[k]));
  for (let j = 0; j < 12; j++) {
    const h = 1e-6 * snap.sd[j], up = explain(snap, x.map((v, q) => (q === j ? v + h : v))), dn = explain(snap, x.map((v, q) => (q === j ? v - h : v)));
    assert.ok(Math.abs((up.p - dn.p) / (2 * h) - ex.sens[j].dp) < 1e-5, `dP/dx${j}`);
    assert.ok(Math.abs((up.size - dn.size) / (2 * h) - ex.sens[j].dsize) < 1e-3 * Math.max(1, Math.abs(ex.sens[j].dsize)), `dsize/dx${j}`);
  }
  assert.ok(Number.isFinite(ex.loss.total) && ex.loss.total > 0);
  const w0 = snap.W1[0]; net.W1.fill(0);
  assert.ok(w0 !== 0 && snap.W1[0] === w0, 'a snapshot is a copy: later training does not change it');
});

test('an input left out of training is 0 to the network, and makes a different run', () => {
  const data = rows(160, true, 3), mask = Array(12).fill(1);
  assert.equal(withMask(mask).mask, null, 'all inputs on is the server\'s run');
  assert.equal(netCheck(data, withMask(mask)).fingerprint, netCheck(data).fingerprint);
  mask[0] = 0;
  const v = netCheck(data, withMask(mask));
  assert.notEqual(v.fingerprint, netCheck(data).fingerprint);
  const net = createNet(12, withMask(mask)); train(net, data, 100, 50, withMask(mask));
  const a = forward(net, data[120].x), b = forward(net, data[120].x.map((x, j) => (j === 0 ? x + 1e6 : x)));
  assert.equal(a.p, b.p, 'the left-out input cannot move the answer');
});

test('a preset finds the input value that gives the P(up) asked for, nearest the real value', () => {
  const data = rows(160, true, 11), net = createNet(12);
  train(net, data, 160, 300);
  const snap = snapshot(net), x = data[3].x;
  assert.ok(Math.abs(pUp(snap, x) - explain(snap, x).p) < 1e-12);
  let reached = 0;
  for (const target of [0.1, 0.3, 0.5, 0.7, 0.9]) for (let j = 0; j < 3; j++) {
    const r = solveInput(snap, x, j, target);
    if ('v' in r) {
      reached++;
      assert.ok(Math.abs(r.p - target) < 1e-9, `input ${j} to ${target}: got ${r.p}`);
      // no closer crossing: P(up) stays on one side of the target between the real value and the answer
      const xx = x.slice(), side = pUp(snap, x) > target;
      for (let k = 1; k < 200; k++) { xx[j] = x[j] + (r.v - x[j]) * k / 200; assert.equal(pUp(snap, xx) > target, side, `crossing before the answer, input ${j} to ${target}`); }
    } else assert.ok(r.lo <= r.hi && (target < r.lo || target > r.hi), `unreachable ${target} should be outside ${r.lo}–${r.hi}`);
  }
  assert.ok(reached > 0, 'at least one target is reachable');
  const off = createNet(12, withMask(Array.from({ length: 12 }, (_, j) => (j === 1 ? 0 : 1))));
  train(off, data, 160, 50, withMask(Array.from({ length: 12 }, (_, j) => (j === 1 ? 0 : 1))));
  assert.equal(solveInput(snapshot(off), x, 1, 0.5), null, 'an input left out cannot move the answer');
});

test('retrain variants: shuffle keeps the values but breaks the link, negate flips the sign, none leaves the rows alone', () => {
  const data = rows(300, true), before = JSON.stringify(data);
  assert.equal(tweakRows(data, {}), data);
  const sh = tweakRows(data, { 0: 'shuffle' }), ng = tweakRows(data, { 1: 'negate' });
  assert.equal(JSON.stringify(data), before, 'the grade rows are not changed');
  assert.deepEqual(sh.map(r => r.x[0]).sort(), data.map(r => r.x[0]).sort());
  assert.notDeepEqual(sh.map(r => r.x[0]), data.map(r => r.x[0]));
  assert.deepEqual(tweakRows(data, { 0: 'shuffle' }), sh, 'seeded');
  ng.forEach((r, i) => { assert.equal(r.x[1], -data[i].x[1]); assert.deepEqual(r.x.slice(2), data[i].x.slice(2)); });
  assert.equal(netCheck(sh).dirEdge, false, 'with its XOR half shuffled away the planted direction is gone');
});
