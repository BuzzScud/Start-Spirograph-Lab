// The Spirograph Lab's neural network (16 Sep, on request: "a small neural network that works and is real, that learns
// the circles"). The XOR network (2→4→1, sigmoid, backpropagation) grown to the circles: the ten numbers a frozen pen
// gives plus the time it was frozen go in, a sigmoid hidden layer invents features, and two outputs come out: P(the next
// 3 hours go up) and the size of the move. Walked forward like the edge check's learners: trained only on the forecasts
// before each call, then it calls the next one.
//
// One file for both sides. The server runs it when a grade is built and keeps a fingerprint; the page runs the same code
// on the same rows, live, and checks its fingerprint against the server's. Seeded, no Math.random, fixed loop order.
// Pure: no DOM, no database.
import { sinceOpenMin } from '../engine/dayClock.js';

export const NET_VERSION = 1;
export const WARM = 80, MIN_ROWS = WARM + 30;   // the edge check's: 80 to learn from, 30 calls before anything is said
export const NET = { hidden: 8, seed: 42, rate: 0.01, decay: 1e-3, firstEpochs: 600, epochs: 120, maxFits: 60, mask: null };
/** A config with some inputs left out of training (mask[j] 0: that input reaches the network as 0 after scaling). */
export const withMask = mask => ({ ...NET, mask: mask && mask.some(m => !m) ? mask.map(m => (m ? 1 : 0)) : null });
export const INPUTS = ['1D', '4H', '2H', '24m', '12m', '6m', 'explained', 'miss', 'pen 3h', 'pen 1h', 'time sin', 'time cos'];

/** Rows from graded forecasts [{ run, grade }]: the circles' numbers and the pen's freeze time in, direction and move out. */
export function netRows(items) {
  const rows = [];
  for (const { run, grade } of items) {
    if (!grade || !grade.over || grade.dirHit === null || !grade.actual) continue;
    const a = 2 * Math.PI * sinceOpenMin(run.at) / 1440;
    rows.push({
      at: run.at, y: grade.actual > 0 ? 1 : 0, move: grade.actual, pen: run.move,
      x: [...run.amps, run.fit.explained ?? 0, run.fit.rms ?? 0, run.move, run.pen[60] - run.pen[0], Math.sin(a), Math.cos(a)],
    });
  }
  return rows.sort((a, b) => a.at - b.at);
}

function mulberry32(a) {
  return () => { let t = (a += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const sig = z => 1 / (1 + Math.exp(z > 40 ? -40 : z < -40 ? 40 : -z));

/** A fresh network: d inputs → h sigmoid → [P(up) logit, move in sd units]. Weights as flat Float64Arrays. */
export function createNet(d, cfg = NET) {
  const h = cfg.hidden, r = mulberry32(cfg.seed), g = () => { const u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const W1 = new Float64Array(h * d), b1 = new Float64Array(h), W2 = new Float64Array(2 * h), b2 = new Float64Array(2);
  const s1 = 1 / Math.sqrt(d), s2 = 1 / Math.sqrt(h);
  for (let i = 0; i < W1.length; i++) W1[i] = g() * s1;
  for (let i = 0; i < W2.length; i++) W2[i] = g() * s2;
  const params = [W1, b1, W2, b2];
  return { d, h, W1, b1, W2, b2, params, m: params.map(p => new Float64Array(p.length)), v: params.map(p => new Float64Array(p.length)), t: 0,
    mu: new Float64Array(d), sd: new Float64Array(d).fill(1), msd: 1, mask: Float64Array.from({ length: d }, (_, j) => (cfg.mask ? cfg.mask[j] : 1)) };
}

/** Forward one raw input: { hid, p (P up), size (points) }. */
export function forward(net, x) {
  const { d, h, W1, b1, W2, b2, mu, sd, mask } = net, hid = new Float64Array(h);
  for (let k = 0; k < h; k++) { let s = b1[k]; for (let j = 0; j < d; j++) s += W1[k * d + j] * ((x[j] - mu[j]) / sd[j] * mask[j]); hid[k] = sig(s); }
  let o0 = b2[0], o1 = b2[1];
  for (let k = 0; k < h; k++) { o0 += W2[k] * hid[k]; o1 += W2[h + k] * hid[k]; }
  return { hid, p: sig(o0), size: o1 * net.msd };
}

/** Scale to rows[0..n) (inputs to mean 0 sd 1, the move to sd 1). Kept on the net so a call is scaled as it was trained. */
function scaleTo(net, rows, n) {
  const { d, mu, sd } = net; mu.fill(0); sd.fill(0); let ms = 0;
  for (let i = 0; i < n; i++) { const x = rows[i].x; for (let j = 0; j < d; j++) mu[j] += x[j] / n; ms += rows[i].move * rows[i].move / n; }
  for (let i = 0; i < n; i++) { const x = rows[i].x; for (let j = 0; j < d; j++) sd[j] += (x[j] - mu[j]) ** 2 / n; }
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  net.msd = Math.sqrt(ms) || 1;
}

/**
 * Train on rows[0..n) for `epochs` full passes: backpropagation of cross-entropy (direction) plus half squared error
 * (move, in sd units), a small weight decay, Adam. Returns the loss every 10 epochs.
 */
export function train(net, rows, n, epochs, cfg = NET) {
  scaleTo(net, rows, n);
  const { d, h, W1, b1, W2, b2, params, mu, sd, mask } = net, grads = params.map(p => new Float64Array(p.length));
  const [gW1, gb1, gW2, gb2] = grads, z = new Float64Array(d), hid = new Float64Array(h), dh = new Float64Array(h), losses = [];
  for (let ep = 0; ep < epochs; ep++) {
    for (const g of grads) g.fill(0);
    let loss = 0;
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      for (let j = 0; j < d; j++) z[j] = (r.x[j] - mu[j]) / sd[j] * mask[j];
      for (let k = 0; k < h; k++) { let s = b1[k]; for (let j = 0; j < d; j++) s += W1[k * d + j] * z[j]; hid[k] = sig(s); }
      let o0 = b2[0], o1 = b2[1];
      for (let k = 0; k < h; k++) { o0 += W2[k] * hid[k]; o1 += W2[h + k] * hid[k]; }
      const p = sig(o0), t = r.move / net.msd, e0 = p - r.y, e1 = o1 - t;
      loss += -(r.y ? Math.log(p + 1e-12) : Math.log(1 - p + 1e-12)) + 0.5 * e1 * e1;
      gb2[0] += e0; gb2[1] += e1;
      for (let k = 0; k < h; k++) {
        gW2[k] += e0 * hid[k]; gW2[h + k] += e1 * hid[k];
        dh[k] = (e0 * W2[k] + e1 * W2[h + k]) * hid[k] * (1 - hid[k]);
        gb1[k] += dh[k];
        for (let j = 0; j < d; j++) gW1[k * d + j] += dh[k] * z[j];
      }
    }
    net.t++;
    const c1 = 1 - 0.9 ** net.t, c2 = 1 - 0.999 ** net.t;
    for (let q = 0; q < params.length; q++) {
      const P = params[q], G = grads[q], m = net.m[q], v = net.v[q], wd = q % 2 === 0 ? cfg.decay : 0;   // decay the weights, not the biases
      for (let i = 0; i < P.length; i++) {
        const g = G[i] / n + wd * P[i];
        m[i] = 0.9 * m[i] + 0.1 * g; v[i] = 0.999 * v[i] + 0.001 * g * g;
        P[i] -= cfg.rate * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
      }
    }
    if (ep % 10 === 9 || ep === epochs - 1) losses.push(loss / n);
  }
  return losses;
}

/**
 * Walk forward over `rows`, one step at a time so a page can draw each: yields { kind: 'fit', upTo, losses } after each
 * training and { kind: 'call', i, p, size } for each call. The net warm-starts from its last weights. Retrains at every
 * row while that is cheap, and at most `maxFits` times over the whole walk. Fewer than WARM + 1 rows: one fit, no calls.
 */
export function* netWalk(rows, cfg = NET) {
  const n = rows.length;
  if (!n) return null;
  const net = createNet(rows[0].x.length, cfg);
  if (n <= WARM) { yield { kind: 'fit', upTo: n, losses: train(net, rows, n, cfg.firstEpochs, cfg), net }; return net; }
  const every = Math.max(1, Math.ceil((n - WARM) / cfg.maxFits));
  for (let i = WARM; i < n; i++) {
    if ((i - WARM) % every === 0) yield { kind: 'fit', upTo: i, losses: train(net, rows, i, i === WARM ? cfg.firstEpochs : cfg.epochs, cfg), net };
    const f = forward(net, rows[i].x);
    yield { kind: 'call', i, p: f.p, size: f.size, hid: f.hid, net };
  }
  return net;
}

/** A copy of everything a call is made with: the weights and the scaling, as they stand after a fit. */
export function snapshot(net) {
  return { d: net.d, h: net.h, W1: net.W1.slice(), b1: net.b1.slice(), W2: net.W2.slice(), b2: net.b2.slice(), mu: net.mu.slice(), sd: net.sd.slice(), msd: net.msd, mask: net.mask.slice() };
}

/**
 * The whole forward pass of raw input `x` through snapshot `n`, every number shown: each input's scaling, each hidden
 * neuron's weighted terms, bias, sum and sigmoid, each output's terms, and how a unit of each raw input moves P(up) and
 * the size (the chain rule through the hidden layer). With `row` ({ y, move }), the call's losses as training counts them.
 */
export function explain(n, x, row = null) {
  const { d, h } = n, O = ['up', 'size'];
  const inputs = Array.from({ length: d }, (_, j) => ({ j, raw: x[j], mu: n.mu[j], sd: n.sd[j], on: !!n.mask[j], z: (x[j] - n.mu[j]) / n.sd[j] * n.mask[j] }));
  const hidden = Array.from({ length: h }, (_, k) => {
    const terms = inputs.map(({ j, z }) => ({ j, w: n.W1[k * d + j], z, wz: n.W1[k * d + j] * z }));
    const sum = terms.reduce((s, t) => s + t.wz, n.b1[k]), a = sig(sum);
    return { k, terms, bias: n.b1[k], sum, a };
  });
  const outputs = O.map((key, o) => {
    const terms = hidden.map(({ k, a }) => ({ k, w: n.W2[o * h + k], a, wa: n.W2[o * h + k] * a }));
    const sum = terms.reduce((s, t) => s + t.wa, n.b2[o]);
    return { key, terms, bias: n.b2[o], sum, value: o === 0 ? sig(sum) : sum * n.msd };
  });
  const p = outputs[0].value, size = outputs[1].value;
  const sens = inputs.map(({ j }) => {   // ∂/∂raw x_j = Σ_k W2[o,k] · a_k(1 − a_k) · W1[k,j] · mask_j / sd_j, then the output's own link
    let s0 = 0, s1 = 0;
    for (const { k, a } of hidden) { const g = a * (1 - a) * n.W1[k * d + j] * n.mask[j] / n.sd[j]; s0 += n.W2[k] * g; s1 += n.W2[h + k] * g; }
    return { j, dp: p * (1 - p) * s0, dsize: s1 * n.msd };
  });
  const out = { inputs, hidden, outputs, p, size, sens, msd: n.msd };
  if (row) {
    const t = row.move / n.msd, e1 = outputs[1].sum - t;
    out.loss = { y: row.y, move: row.move, t, ce: -(row.y ? Math.log(p + 1e-12) : Math.log(1 - p + 1e-12)), e1, sq: 0.5 * e1 * e1 };
    out.loss.total = out.loss.ce + out.loss.sq;
  }
  return out;
}

/** P(up) of raw input `x` through snapshot `n` (explain's first output, without the working). */
export function pUp(n, x) {
  const { d, h } = n;
  let o = n.b2[0];
  for (let k = 0; k < h; k++) { let s = n.b1[k]; for (let j = 0; j < d; j++) s += n.W1[k * d + j] * ((x[j] - n.mu[j]) / n.sd[j] * n.mask[j]); o += n.W2[k] * sig(s); }
  return sig(o);
}

/**
 * The value of input j that gives P(up) = `target`, the other inputs as in `x`: the root nearest `anchor` (the real
 * value, so the smallest change). P(up) along one input is a sum of sigmoids, so it can bend back: every crossing within
 * ±30 spreads of the training mean is found on a grid, then bisected. { v, p } when reachable; { lo, hi } (the P(up) it
 * can reach) when not; null for an input left out of training (it cannot move the answer).
 */
export function solveInput(n, x, j, target, anchor = x[j]) {
  if (!n.mask[j]) return null;
  const xx = Array.from(x), at = v => { xx[j] = v; return pUp(n, xx) - target; };
  const STEPS = 1200, a = n.mu[j] - 30 * n.sd[j], w = 60 * n.sd[j] / STEPS;
  const grid = Array.from({ length: STEPS + 1 }, (_, i) => a + i * w);
  if (anchor < grid[0] || anchor > grid[STEPS]) { grid.push(anchor); grid.sort((p, q) => p - q); }
  let best = null, lo = 1, hi = 0, prevV = grid[0], prevF = at(grid[0]);
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i], f = i ? at(v) : prevF;
    lo = Math.min(lo, f + target); hi = Math.max(hi, f + target);
    let root = f === 0 ? v : null;
    if (root === null && i && (prevF < 0) !== (f < 0) && prevF !== 0) {
      let l = prevV, r = v, fl = prevF;
      for (let k = 0; k < 60; k++) { const m = (l + r) / 2, fm = at(m); if ((fm < 0) === (fl < 0)) { l = m; fl = fm; } else r = m; }
      root = (l + r) / 2;
    }
    if (root !== null && (best === null || Math.abs(root - anchor) < Math.abs(best - anchor))) best = root;
    prevV = v; prevF = f;
  }
  if (best === null) return { lo, hi };
  xx[j] = best;
  return { v: best, p: pUp(n, xx) };
}

/**
 * Rows for a retrain variant: tweaks[j] 'shuffle' mixes input j across the forecasts (seeded, so it keeps its values but
 * loses any link to the outcome) or 'negate' flips its sign (the network could learn it back exactly: any change in the
 * score is the luck of the seeded start). No tweaks: the same rows, untouched.
 */
export function tweakRows(rows, tweaks = {}) {
  const js = Object.keys(tweaks).map(Number).filter(j => tweaks[j] === 'shuffle' || tweaks[j] === 'negate');
  if (!js.length) return rows;
  const out = rows.map(r => ({ ...r, x: r.x.slice() }));
  for (const j of js) {
    if (tweaks[j] === 'negate') { for (const r of out) r.x[j] = -r.x[j]; continue; }
    const r = mulberry32(NET.seed + 1000 + j), order = out.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [order[i], order[k]] = [order[k], order[i]]; }
    const col = out.map(q => q.x[j]);
    out.forEach((q, i) => { q.x[j] = col[order[i]]; });
  }
  return out;
}

/** 32-bit FNV-1a over the calls, rounded to 1e-9 so the last bit of an engine's Math.exp cannot split two runs. */
export function fingerprint(calls) {
  let hsh = 0x811c9dc5;
  const put = v => { const s = Math.round(v * 1e9).toString(); for (let k = 0; k < s.length; k++) { hsh ^= s.charCodeAt(k); hsh = Math.imul(hsh, 0x01000193); } hsh ^= 44; hsh = Math.imul(hsh, 0x01000193); };
  for (const c of calls) { put(c.i); put(c.p); put(c.size); }
  return (hsh >>> 0).toString(16).padStart(8, '0');
}

/**
 * Score the calls: direction against always guessing the usual way (the edge check's ±chance band), size by its average
 * miss against a flat line (a move of 0) and the pen's own move. The size edge is a paired test on the per-call misses.
 */
export function netScore(rows, calls) {
  const n = rows.length, tested = calls.length;
  const out = { v: NET_VERSION, rows: n, warm: WARM, tested, ready: n >= MIN_ROWS, fingerprint: fingerprint(calls) };
  if (!tested) return { ...out, verdict: `only ${n} graded forecasts: the network needs at least ${MIN_ROWS} to be judged (${WARM} to learn from, 30 to call)` };
  let hits = 0, ups = 0, points = 0, penHits = 0, mae = 0, flat = 0, pen = 0, dsum = 0, dsq = 0;
  for (const c of calls) {
    const r = rows[c.i], up = c.p > 0.5;
    if ((up ? 1 : 0) === r.y) hits++;
    if (r.y) ups++;
    if ((r.pen > 0 ? 1 : 0) === r.y) penHits++;
    points += (up ? 1 : -1) * r.move;
    const en = Math.abs(c.size - r.move), e0 = Math.abs(r.move), dlt = e0 - en;
    mae += en; flat += e0; pen += Math.abs(r.pen - r.move); dsum += dlt; dsq += dlt * dlt;
  }
  const usual = Math.max(ups, tested - ups) / tested, rate = hits / tested, noise = 1.96 * Math.sqrt(0.25 / tested);
  const gain = dsum / tested, se = Math.sqrt(Math.max(0, dsq / tested - gain * gain) / tested);
  Object.assign(out, {
    hits, rate, usual, usualWord: ups >= tested - ups ? 'up' : 'down', noise, penRate: penHits / tested, points: r1(points),
    dirEdge: out.ready && rate - usual > noise,
    mae: r1(mae / tested), flatMae: r1(flat / tested), penMae: r1(pen / tested), gain: r1(gain), gainBand: r1(1.96 * se),
    sizeEdge: out.ready && gain > 1.96 * se && se > 0,
  });
  out.verdict = !out.ready ? `${tested} calls: too few to judge (needs 30 after the first ${WARM})`
    : `direction ${pct(rate)} against ${pct(usual)} for the usual way (±${pct(noise)} chance) · size missed by ${out.mae} against ${out.flatMae} for a flat line`
      + (out.dirEdge || out.sizeEdge ? ': worth a closer look' : ': nothing learned beyond chance yet');
  return out;
}

/** The whole walk at once (the server): the score, the final weights, the loss after each fit. */
export function netCheck(rows, cfg = NET) {
  const calls = [], losses = [];
  let net = null;
  for (const s of netWalk(rows, cfg)) {
    net = s.net;
    if (s.kind === 'fit') losses.push(s.losses[s.losses.length - 1]);
    else calls.push({ i: s.i, p: s.p, size: s.size });
  }
  return { ...netScore(rows, calls), losses: losses.map(v => Math.round(v * 1e4) / 1e4), weights: net && { W1: [...net.W1], W2: [...net.W2] } };
}

const r1 = v => Math.round(v * 10) / 10;
const pct = x => `${Math.round(100 * x)}%`;
