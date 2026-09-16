// The shadow band: a challenger to band.js's hour-of-day band, cut and graded beside it on every forecast and
// every backtest cut, and shown only on the Data tab until it measurably beat it (shadow first). It did: on NQZ6
// it was 25% narrower at an honest 68% over 31 runs, so since 15 Sep (on request) it is the band Unrolled draws and
// grades a run by (freeze.js drawnRun). band.js's band is still cut on every run, so the Data tab keeps comparing.
//
// WHAT IT CHANGES. band.js takes the quantiles of the raw k-minute move from every traded minute at this New York
// hour, so its width is that hour's AVERAGE width: too wide on a quiet day and too narrow on a loud one, right only
// on the average. Volatility clusters, so how loud the last hour was says a good deal about the next. This band
// takes the quantiles of each move DIVIDED BY ITS ORIGIN'S OWN RECENT VOLATILITY (the root-mean-square of its last
// VOL_WIN one-minute close changes) and scales them by the volatility at the cut. On average it promises the same
// 68%; it is narrower when the market has been quiet and wider when it has been loud. Whether that is tighter at
// an honest coverage on this market is what the backtest and the graded record measure. Nothing here assumes it.
//
// Its quantiles are exact: interpolated at q·(n + 1), which covers q of the next draw at every n. Nearest rank,
// which band.js uses, covers 65.9% at n = 40 for a promised 68% (the audit's correction).
//
// It sees no more than band.js does: an origin's volatility is read from the minutes before it, and a move counts
// only if its end is in the sim, which holds nothing after the cut. Pure; runs in Node.
import { TPM } from './constants.js';
import { nyHour, bandAt, BAND_KS, BAND_Q, ENVELOPE_Q, MIN_ORIGINS } from './band.js';

export const VOL_WIN = 60;   // one-minute changes that make a minute's recent volatility
export const VOL_MIN = 30;   // fewer known changes than this and the minute has none
const M = 60000;

/** The q-quantile of an ascending array, interpolated at q·(n + 1): coverage q for the next draw, at every n. */
export function qExact(sorted, q) {
  const n = sorted.length;
  if (!n) return NaN;
  const pos = Math.min(n, Math.max(1, q * (n + 1))), i = Math.floor(pos), f = pos - i;
  return i >= n ? sorted[n - 1] : sorted[i - 1] + f * (sorted[i] - sorted[i - 1]);
}

/**
 * Each minute's recent volatility: the root-mean-square of the last VOL_WIN one-minute close changes known up to
 * and including minute m (a change is known when both its minutes traded), NaN with fewer than VOL_MIN or on a
 * minute that did not trade.
 */
export function volSeries(c, has, count) {
  const out = new Float64Array(count).fill(NaN), ring = new Float64Array(VOL_WIN);
  let n = 0, at = 0, ss = 0;
  for (let m = 1; m < count; m++) {
    if (has[m] === 1 && has[m - 1] === 1) {
      const d = c[m] - c[m - 1], sq = d * d;
      if (n === VOL_WIN) ss -= ring[at]; else n++;
      ring[at] = sq; ss += sq; at = (at + 1) % VOL_WIN;
    }
    if (n >= VOL_MIN && has[m] === 1) out[m] = Math.sqrt(Math.max(0, ss) / n);
  }
  return out;
}

/**
 * Quantiles of the standardised k-minute move (move ÷ its origin's volatility) from every traded minute at NY hour
 * `hour`, in band.js's row shape so its bandAt reads them: { hour, ks, rows: [{ k, n, med, lo, hi, outLo, outHi }] },
 * plus the volatility series and the minute index it is laid on. Null off a live sim.
 */
export function volQuantiles(sim, hour, ks = BAND_KS) {
  if (sim.mode !== 'live' || !sim.live) return null;
  const c = sim.MIN.c, has = sim.MIN.has, count = sim.minutes(), base = sim.live.t0 + (sim.tick0 / TPM) * M;
  const vol = volSeries(c, has, count);
  const origins = [];
  for (let m = 0; m < count; m++) if (has[m] === 1 && vol[m] > 0 && nyHour(base + m * M) === hour) origins.push(m);
  const rows = ks.map(k => {
    const d = [];
    for (const m of origins) { const j = m + k; if (j < count && has[j] === 1) d.push((c[j] - c[m]) / vol[m]); }
    if (d.length < MIN_ORIGINS) return { k, n: d.length, med: NaN, lo: NaN, hi: NaN, outLo: NaN, outHi: NaN };
    d.sort((a, b) => a - b);
    return { k, n: d.length, med: qExact(d, 0.5), lo: qExact(d, BAND_Q.lo), hi: qExact(d, BAND_Q.hi), outLo: qExact(d, ENVELOPE_Q.lo), outHi: qExact(d, ENVELOPE_Q.hi) };
  });
  return { hour, ks, rows, vol, base };
}

let cache = { key: '', vq: null };
function volFor(sim, cut) {
  const key = `${sim.live.contract}|${sim.live.t0}|${sim.tick0}|${nyHour(cut)}|${Math.floor(cut / M)}`;
  if (cache.key !== key) cache = { key, vq: volQuantiles(sim, nyHour(cut)) };
  return cache.vq;
}

/**
 * The shadow band for `run`, cut from this sim: { kind: 'vol', vol, path }, its steps shaped as the run's own
 * (the run's path, with this band's lo/hi and envelope round the anchor), so the desk's gradeRun grades it as it
 * grades the run. Null when the cut has no volatility or the band cannot reach every stamp.
 */
export function shadowBand(sim, run) {
  const vq = volFor(sim, run.cut);
  if (!vq) return null;
  const s = vq.vol[Math.round((run.cut - vq.base) / M)];
  if (!(s > 0)) return null;
  const path = [];
  for (const st of run.path) {
    const o = st.i ? bandAt(vq, st.i * run.tf) : null;
    if (st.i && !o) return null;
    const a = run.anchor;
    path.push({ i: st.i, t: st.t, path: st.path, lo: o ? a + s * o.lo : a, hi: o ? a + s * o.hi : a, outLo: o ? a + s * o.outLo : a, outHi: o ? a + s * o.outHi : a, n: o ? o.n : 0 });
  }
  return { kind: 'vol', vol: s, path };
}
/** The run with the shadow band in its place: what gradeRun is handed to grade the shadow on the same stamps. */
export const withShadow = run => (run && run.shadow ? { ...run, path: run.shadow.path } : null);
