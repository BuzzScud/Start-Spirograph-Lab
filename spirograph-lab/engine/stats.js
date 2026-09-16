// The two interval estimators the measurements use. Kept in one place because a project that
// scores itself must not carry three copies of its own error bars: wilson() was written out
// three times (the fire card, the backtest, the k sweep) and could have drifted between them.
// Pure; runs in Node.

/**
 * Wilson 95% interval for k successes of n independent trials.
 * Right for one observation per unit — a direction call per run, a fire per block, one step
 * index across runs — and wrong for anything clustered, which is what clusterCI is for.
 */
export function wilson(k, n, z = 1.96) {
  if (!n) return { p: NaN, lo: NaN, hi: NaN };
  const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return { p, lo: c - h, hi: c + h };
}

/**
 * 95% interval for a rate whose observations arrive in CLUSTERS, by resampling the clusters.
 *
 * `cells` is one { k, n } per cluster — successes and trials. A replicate draws whole clusters
 * with replacement and re-pools them, so the correlation inside a cluster is carried into the
 * interval rather than assumed away.
 *
 * WHY THIS AND NOT WILSON. The thirteen stamps of a forecast run walk one price path: a cone the
 * price has already left at step 3 is usually still missed at step 4. Handing Wilson the step
 * count pretends they are thirteen independent trials. Measured against a cone that is exactly
 * right by construction, the step-pooled Wilson interval contained the truth 53–56% of the time
 * at a nominal 95% and ran 1.8× to 2.3× too narrow; the bootstrap below came out at 94–95%.
 *
 * Seeded, so the same data always prints the same interval.
 */
export function clusterCI(cells, boot = 4000, lo = 0.025, hi = 0.975) {
  const use = cells.filter(c => c && c.n > 0), R = use.length;
  if (R < 2) return { lo: NaN, hi: NaN, clusters: R };
  let s = 0x9e3779b9;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0; return (s >>> 0) / 4294967296; };
  const reps = new Float64Array(boot);
  for (let b = 0; b < boot; b++) {
    let k = 0, n = 0;
    for (let i = 0; i < R; i++) { const c = use[(rnd() * R) | 0]; k += c.k; n += c.n; }
    reps[b] = n ? k / n : NaN;
  }
  const ok = Array.from(reps).filter(Number.isFinite).sort((a, b) => a - b);
  if (!ok.length) return { lo: NaN, hi: NaN, clusters: R };
  const at = q => ok[Math.min(ok.length - 1, Math.max(0, Math.round(q * (ok.length - 1))))];
  return { lo: at(lo), hi: at(hi), clusters: R };
}
