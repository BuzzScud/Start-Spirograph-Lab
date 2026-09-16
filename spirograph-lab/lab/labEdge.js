// The Spirograph Lab's edge check (16 Sep, on request: "can we create a neural network attached to the spirograph
// learning?"). Before any network: can a small learner find anything in the circles at all? Each graded 3-hour
// forecast (dailyTest.js) becomes one row, a learner is trained on the rows before it only, and calls the next one's
// direction. Three learners, fed the circles' own numbers, the market's recent moves, and both, against two yardsticks:
// always guessing the usual way, and the pen's own call. A learner shows an edge only if it clears the usual way by
// more than chance allows for that many calls. Pure: no DOM, no database.
export const WARM = 80;               // rows before the first call: a learner needs something to learn from
export const MIN_ROWS = WARM + 30;    // and at least 30 calls before anything is said
const H3 = 3 * 3600e3, H1 = 3600e3;

function closeBefore(bars, t) {
  let lo = 0, hi = bars.length - 1, at = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].t < t) { at = mid; lo = mid + 1; } else hi = mid - 1; }
  return at < 0 ? null : bars[at].c;
}

/**
 * Rows from graded forecasts [{ run, grade }] (over, with a direction) and the ascending bars they were made from.
 * spiro: the pen's 3-hour move, its first-hour move, the six signed circle sizes, the fit's explained share and miss.
 * mom:   the market's move over the 3 hours and the hour before the slot.
 */
export function edgeRows(items, bars) {
  const rows = [];
  for (const { run, grade } of items) {
    if (!grade || !grade.over || grade.dirHit === null || !grade.actual) continue;
    const b3 = closeBefore(bars, run.at - H3), b1 = closeBefore(bars, run.at - H1);
    rows.push({
      at: run.at, y: grade.actual > 0 ? 1 : 0, move: grade.actual, penDir: run.dir,
      spiro: [run.move, run.pen[60] - run.pen[0], ...run.amps, run.fit.explained ?? 0, run.fit.rms ?? 0],
      mom: [b3 == null ? 0 : run.anchor - b3, b1 == null ? 0 : run.anchor - b1],
    });
  }
  return rows.sort((a, b) => a.at - b.at);
}

/** Ridge-penalised logistic regression on standardised features, by gradient descent. Returns x → P(up). */
export function trainLogit(X, y, { iters = 300, rate = 0.5, lambda = 1 } = {}) {
  const n = X.length, d = X[0].length, mu = new Float64Array(d), sd = new Float64Array(d);
  for (const r of X) for (let j = 0; j < d; j++) mu[j] += r[j] / n;
  for (const r of X) for (let j = 0; j < d; j++) sd[j] += (r[j] - mu[j]) ** 2 / n;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map(r => r.map((v, j) => (v - mu[j]) / sd[j]));
  const w = new Float64Array(d); let b = 0;
  const gw = new Float64Array(d);
  for (let it = 0; it < iters; it++) {
    gw.fill(0); let gb = 0;
    for (let i = 0; i < n; i++) {
      const z = Z[i]; let s = b; for (let j = 0; j < d; j++) s += z[j] * w[j];
      const e = 1 / (1 + Math.exp(-s)) - y[i]; gb += e; for (let j = 0; j < d; j++) gw[j] += e * z[j];
    }
    for (let j = 0; j < d; j++) w[j] -= rate * (gw[j] + lambda * w[j]) / n;
    b -= rate * gb / n;
  }
  return x => { let s = b; for (let j = 0; j < d; j++) s += (x[j] - mu[j]) / sd[j] * w[j]; return 1 / (1 + Math.exp(-s)); };
}

export const LEARNERS = [
  { key: 'spiro', label: 'The circles’ numbers', feat: r => r.spiro },
  { key: 'mom', label: 'Recent moves only', feat: r => r.mom },
  { key: 'both', label: 'Both', feat: r => [...r.spiro, ...r.mom] },
];

/** Walk forward over `rows`. `progress(done, total)` as it goes. */
export function edgeCheck(rows, { progress = () => {} } = {}) {
  const n = rows.length, tested = Math.max(0, n - WARM);
  const out = { rows: n, warm: WARM, tested, ready: n >= MIN_ROWS, noise: tested ? 1.96 * Math.sqrt(0.25 / tested) : NaN, baselines: [], learners: [], calls: {} };
  if (!out.ready) { out.verdict = `only ${n} graded forecasts: the check needs at least ${MIN_ROWS} (${WARM} to learn from, 30 to call)`; return out; }
  const test = rows.slice(WARM), ups = test.filter(r => r.y).length, usual = Math.max(ups, tested - ups);
  // every call in order, 1 up / 0 down, one string per caller: the page draws each call from these
  out.calls.at = test.map(r => r.at);
  out.calls.pen = test.map(r => (r.penDir > 0 ? 1 : 0)).join('');
  const penHits = test.filter(r => (r.penDir > 0 ? 1 : 0) === r.y).length;
  const penPts = test.reduce((s, r) => s + (r.penDir > 0 ? 1 : -1) * r.move, 0);
  out.baselines.push({ key: 'usual', label: `Always ${ups >= tested - ups ? 'up' : 'down'} (the usual way)`, hits: usual, n: tested, rate: usual / tested, points: null });
  out.baselines.push({ key: 'pen', label: 'The pen’s own call', hits: penHits, n: tested, rate: penHits / tested, points: r1(penPts) });
  // retrain at every row while that is cheap; past 400 rows, every few rows (each learner still sees only the past)
  const every = Math.max(1, Math.ceil(n / 400)), total = LEARNERS.length * tested;
  let done = 0;
  for (const L of LEARNERS) {
    let hits = 0, pts = 0, f = null, said = '';
    for (let i = WARM; i < n; i++) {
      if (!f || (i - WARM) % every === 0) { const tr = rows.slice(0, i); f = trainLogit(tr.map(L.feat), tr.map(r => r.y)); }
      const up = f(L.feat(rows[i])) > 0.5;
      said += up ? '1' : '0';
      if ((up ? 1 : 0) === rows[i].y) hits++;
      pts += (up ? 1 : -1) * rows[i].move;
      if (++done % 20 === 0) progress(done, total);
    }
    out.learners.push({ key: L.key, label: L.label, hits, n: tested, rate: hits / tested, points: r1(pts) });
    out.calls[L.key] = said;
  }
  const base = usual / tested, best = out.learners.reduce((a, b) => (b.rate > a.rate ? b : a));
  const clear = x => x.rate - base > out.noise;
  out.edge = out.learners.some(clear);
  const spiro = out.learners.find(l => l.key === 'spiro');
  out.spiroEdge = clear(spiro);
  out.verdict = out.edge
    ? `${best.label.toLowerCase()} called ${pct(best.rate)} against ${pct(base)} for the usual way, more than chance allows over ${tested} calls: worth a closer look${out.spiroEdge ? '' : ', though not from the circles'}`
    : `no learner beat the usual way (${pct(base)}) by more than chance allows (±${pct(out.noise)} over ${tested} calls): there is nothing here for a bigger model to learn yet`;
  return out;
}

const r1 = v => Math.round(v * 10) / 10;
const pct = x => `${Math.round(100 * x)}%`;

/**
 * The one line a multi-day grade is read by, from dailyTest.js dailyScorecard: the path against flat, direction against
 * the usual way, turns against a random walk. `edge` only when direction or turns clear their bar at 95%.
 */
export function headline(sc) {
  if (!sc || !sc.runs) return { edge: false, ready: false, text: 'no graded forecasts in this range' };
  const ready = sc.dir.n >= 30;
  const dirEdge = ready && sc.dir.lo > sc.dir.majority, turnEdge = sc.turns.graded >= 30 && sc.turns.lo > sc.turns.chance;
  const path = Number.isFinite(sc.path.ratio) ? `path ${sc.path.ratio.toFixed(2)}× a flat line (${sc.path.ratio < 1 ? 'better' : 'worse'})` : 'no path graded';
  const text = `${path} · direction ${pct(sc.dir.rate)} against ${pct(sc.dir.majority)} for the usual way · turns ${pct(sc.turns.rate)} against ${pct(sc.turns.chance)} by chance`;
  return { edge: dirEdge || turnEdge, dirEdge, turnEdge, ready, text, word: !ready ? 'Too few forecasts' : dirEdge || turnEdge ? 'An edge' : 'No edge' };
}
