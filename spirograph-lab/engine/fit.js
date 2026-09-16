// Fits a fixed ladder of cycles to a price series by least squares:
//   p(t) ≈ p0 + drift · (t − tRef) + Σ A_n · sin(ω_n t + φ_n)
// With the frequencies fixed this is linear in (p0, drift, a_n, b_n), where
// A sin(ωt + φ) = a cos ωt + b sin ωt, so A = √(a² + b²) and φ = atan2(a, b).
// p0 is the INTERCEPT, not the model's value at tRef: the cycles do not vanish
// there, so the fitted level at tRef is p0 + Σ A_n sin(ω_n·tRef + φ_n). It is
// where the fixed circle's centre sits, and the drift term carries the trend.
// Pure; runs in Node.

/**
 * @param t      Float64Array of sample times (minutes)
 * @param p      Float32Array | Float64Array of prices
 * @param count  samples to use from the start of both arrays
 * @param omegas angular frequencies (radians per minute), one per level
 * @param opts   tRef: reference time for p0 (default: last sample); ridge: relative regularisation (default 1e-4);
 *               drift: false to fit without the trend term; tau: recency weighting, samples tau minutes before tRef weigh 1/e;
 *               lockPhi: when a number and K = 1, phase is fixed (cycle starts at its calendar open) and only A is
 *               fitted - signed, so a cycle that falls first comes back negative rather than as its mirror image
 *
 * `rms` and `explained` are measured with the SAME weights the fit was made under, so they
 * describe the fit that was actually solved for rather than a different, unweighted one; with
 * no `tau` every weight is 1 and both reduce to the plain residual statistics.
 */
export function fitCycles(t, p, count, omegas, opts = {}) {
  const K = omegas.length, locked = Number.isFinite(opts.lockPhi) && K === 1, D = 2 + (locked ? 1 : 2 * K);
  const tRef = opts.tRef ?? (count ? t[count - 1] : 0), ridge = opts.ridge ?? 1e-4;
  // A trend on a clock of its own (sim.js driftClock: the Daily set's traded minutes): `td` holds each sample's time on
  // it and `dRef` the reference there, which the fit returns as its tRef. The cycles and the recency weights stay on `t`.
  const td = opts.td || t, dRef = opts.td ? (opts.dRef ?? (count ? td[count - 1] : 0)) : tRef;
  const zero = () => ({ p0: count ? mean(p, count) : 0, drift: 0, A: new Array(K).fill(0), phi: new Array(K).fill(locked ? opts.lockPhi : 0), rms: 0, explained: 0, count, tRef: dRef });
  if (count < D) return zero();
  const mu = mean(p, count), M = new Float64Array(D * D), v = new Float64Array(D), row = new Float64Array(D);
  const TW = 10080;                                          // time in weeks keeps the drift column well conditioned
  const tau = opts.tau > 0 ? opts.tau : 0;
  const wOf = i => tau ? Math.exp(-Math.abs(tRef - t[i]) / tau) : 1;
  for (let i = 0; i < count; i++) {
    row[0] = 1; row[1] = opts.drift === false ? 0 : (td[i] - dRef) / TW;
    if (locked) row[2] = Math.sin(omegas[0] * t[i] + opts.lockPhi);
    else for (let n = 0; n < K; n++) { const th = omegas[n] * t[i]; row[2 + 2 * n] = Math.cos(th); row[3 + 2 * n] = Math.sin(th); }
    const w = wOf(i), y = (p[i] - mu) * w;
    for (let r = 0; r < D; r++) { const rr = row[r] * w; v[r] += rr * y; const b = r * D; for (let c = r; c < D; c++) M[b + c] += rr * row[c] * w; }
  }
  for (let r = 0; r < D; r++) { if (r >= 2 && !locked) M[r * D + r] += ridge * count; for (let c = 0; c < r; c++) M[r * D + c] = M[c * D + r]; }
  if (opts.drift === false) M[1 * D + 1] = 1;
  const x = solve(M, v, D);
  if (!x) return zero();
  const A = [], phi = [];
  // Calendar clocks keep φ exactly as given, so 9:29 stays angle zero - and A KEEPS ITS SIGN, because
  // with φ fixed the sign is the only thing that says whether this cycle rises or falls first. It used
  // to be dropped (|A|), which fitted a perfect −10 sine as +10: a residual of ±14 instead of 0, and
  // every finer level then subtracted the wrong cycle. A negative A peaks at 3π/2 on its clock.
  if (locked) { A.push(x[2]); phi.push(opts.lockPhi); }
  else for (let n = 0; n < K; n++) { const a = x[2 + 2 * n], b = x[3 + 2 * n]; A.push(Math.hypot(a, b)); phi.push(Math.atan2(a, b)); }
  const fit = { p0: mu + x[0], drift: x[1] / TW, A, phi, rms: 0, explained: 0, count, tRef: dRef };
  // weighted, so the residual statistics score the same objective the solve minimised
  let sw = 0, swp = 0;
  for (let i = 0; i < count; i++) { const w = wOf(i); sw += w; swp += w * p[i]; }
  const muW = sw > 0 ? swp / sw : mu;
  let ss = 0, st = 0;
  for (let i = 0; i < count; i++) { const w = wOf(i), r = p[i] - evalCycles(fit, omegas, t[i]) - fit.drift * (td[i] - t[i]); ss += w * r * r; const d = p[i] - muW; st += w * d * d; }
  fit.rms = sw > 0 ? Math.sqrt(ss / sw) : 0; fit.explained = st > 0 ? Math.max(0, 1 - ss / st) : 0;
  return fit;
}

/** The fitted model at time t (minutes), using the first `levels` cycles (default all). */
export function evalCycles(fit, omegas, t, levels = fit.A.length) {
  let s = fit.p0 + fit.drift * (t - fit.tRef);
  for (let n = 0; n < levels; n++) s += fit.A[n] * Math.sin(omegas[n] * t + fit.phi[n]);
  return s;
}

/**
 * Geometric mean of A_n / A_{n+1} over the fitted levels: the size ratio the
 * market implies. Levels quieter than 2% of the loudest are left out, so a
 * silent level does not turn the estimate into noise.
 */
export function impliedRatio(A) {
  const a = A.map(Math.abs);   // sizes: a clock-locked fit carries the sign in A
  const floor = 0.02 * Math.max(0, ...a); let s = 0, c = 0;
  for (let n = 0; n + 1 < a.length; n++) if (a[n] > floor && a[n + 1] > floor) { s += Math.log(a[n] / a[n + 1]); c++; }
  return c ? Math.exp(s / c) : NaN;
}

function mean(p, count) { let s = 0; for (let i = 0; i < count; i++) s += p[i]; return s / count; }

/** Gaussian elimination with partial pivoting on a dense D×D system; null if singular. */
function solve(M, v, D) {
  const a = Float64Array.from(M), b = Float64Array.from(v);
  for (let c = 0; c < D; c++) {
    let piv = c; for (let r = c + 1; r < D; r++) if (Math.abs(a[r * D + c]) > Math.abs(a[piv * D + c])) piv = r;
    if (Math.abs(a[piv * D + c]) < 1e-12) return null;
    if (piv !== c) { for (let k = 0; k < D; k++) { const tmp = a[c * D + k]; a[c * D + k] = a[piv * D + k]; a[piv * D + k] = tmp; } const tb = b[c]; b[c] = b[piv]; b[piv] = tb; }
    for (let r = c + 1; r < D; r++) { const f = a[r * D + c] / a[c * D + c]; if (!f) continue; for (let k = c; k < D; k++) a[r * D + k] -= f * a[c * D + k]; b[r] -= f * b[c]; }
  }
  const x = new Float64Array(D);
  for (let r = D - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < D; k++) s -= a[r * D + k] * x[k]; x[r] = s / a[r * D + r]; }
  return x;
}
