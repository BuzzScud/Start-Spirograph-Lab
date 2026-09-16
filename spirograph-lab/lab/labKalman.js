// The Kalman rungs in the Lab (16 Sep, on request: "both, compared"): the Ladder's filter (engine/ladderFilter.js,
// dynamic harmonic regression read one closed minute at a time) on the Daily set's six periods, so the two circle
// families can be compared circle for circle. Where the Daily set locks every phase to 6 pm and fits only each
// circle's signed size, this one lets each rung's size AND timing move with the market by an amount its stiffness
// allows.
//
// A TURN IS CALLED A QUARTER LAP AHEAD, as the Ladder's turnScore.js takes it: after each close the state in force
// is asked for the turns it puts exactly a quarter of the rung's lap ahead of that close (and never less than a
// minute past the swing's own reach, labTurns.js swingMin, for the fastest rungs). Asked any later, the filter would
// have read closes inside the turn's own window and leaned towards where the market really turned, and graded that
// way it would beat the luck baseline for free. One call per turn: a later call of the same kind within a quarter lap
// is the same turn, called again with less lead.
//
// Seeded from a batch fit (engine/fit.js, free phase, on the epoch clock) a day before the first call and run over
// every close in between, as the Ladder seeds the filter the first time it opens an instrument. Pure: no DOM.
import { fitCycles, evalCycles } from '../engine/fit.js';
import { seedFilter, step, openMinutes, stiffnessOf, WARM_MIN, DEFAULT_STIFFNESS, D } from '../engine/ladderFilter.js';
import { FIT_LAPS, TAU } from '../engine/constants.js';
import { DAILY_PERIODS } from '../engine/dailySet.js';
import { globexOpen } from '../engine/session.js';
import { FLAT, swingMin } from './labTurns.js';

const M = 60000;
export const KALMAN_STIFFNESS = DEFAULT_STIFFNESS;
export const MIN_SEED_CLOSES = 600;   // closes the batch fit needs behind the seed (ten traded hours)

function lowerBound(bars, t) { let lo = 0, hi = bars.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].t < t) lo = mid + 1; else hi = mid; } return lo; }

/** The walk's variance q a minute and the closes' own noise R from the residual changes (ladderFilter.js seedNoise, on bars). */
export function noiseFrom(res, tMin) {
  const d = [], n = res.length;
  for (let i = 1; i < n; i++) if (Math.abs(tMin[i] - tMin[i - 1] - 1) < 1e-9) d.push(res[i] - res[i - 1]); else d.push(NaN);
  const ok = d.filter(Number.isFinite), k = ok.length;
  if (k < 60) return { q: 1, R: 0.01 };
  const mu = ok.reduce((a, b) => a + b, 0) / k;
  let g0 = 0, g1 = 0, k1 = 0;
  for (let i = 0; i < d.length; i++) { if (!Number.isFinite(d[i])) continue; g0 += (d[i] - mu) ** 2; if (i && Number.isFinite(d[i - 1])) { g1 += (d[i] - mu) * (d[i - 1] - mu); k1++; } }
  g0 /= k; g1 = k1 ? g1 / k1 : 0;
  const R = Math.max(g0 * 1e-4, -g1), q = Math.max(g0 * 1e-3, g0 - 2 * R);
  return { q, R };
}

/**
 * Seed a filter at epoch ms `seedMs` from ascending one-minute `bars`: a free-phase batch fit over FIT_LAPS laps of the
 * slowest period (its closes before the seed), then the state. Returns { st, t0, omega, fit } or null.
 */
export function seedKalman(bars, seedMs, periods = DAILY_PERIODS, cfg = stiffnessOf(KALMAN_STIFFNESS)) {
  const omega = periods.map(P => TAU / P), t0 = seedMs - 14 * 86400e3;
  const i1 = lowerBound(bars, seedMs - M + 1), i0 = lowerBound(bars, seedMs - FIT_LAPS * periods[0] * M);   // t + 1 min ≤ seedMs: closed by the seed
  const count = i1 - i0;
  if (count < Math.max(MIN_SEED_CLOSES, 2 + 2 * periods.length)) return null;
  const t = new Float64Array(count), p = new Float64Array(count);
  for (let i = 0; i < count; i++) { const b = bars[i0 + i]; t[i] = (b.t + M - t0) / M; p[i] = b.c; }
  const fit = fitCycles(t, p, count, omega);
  if (!fit || !fit.A.every(Number.isFinite)) return null;
  const w0 = Math.max(0, count - WARM_MIN), res = [], tm = [];
  for (let i = w0; i < count; i++) { res.push(p[i] - evalCycles(fit, omega, t[i])); tm.push(t[i]); }
  const last = bars[i1 - 1];
  const st = seedFilter({ fit, omega, t0, atMs: seedMs, noise: noiseFrom(res, tm), last: { t: last.t + M, p: last.c }, on: periods.map(() => true), cfg });
  return { st, t0, omega, fit, count };
}

/** Rung k's turns in epoch minutes (fromMin, toMin] for a state: [{ at, kind }]. A·sin(ωm + φ) peaks at ωm + φ = π/2 + 2πj. */
export function rungTurnsIn(st, k, fromMin, toMin) {
  const a = st.x[2 + 2 * k], b = st.x[3 + 2 * k], w = st.omega[k], out = [];
  if (!(Math.hypot(a, b) >= FLAT) || !(toMin > fromMin)) return out;
  const phi = Math.atan2(a, b), peak = Math.PI / 2;
  const ja = (w * fromMin + phi - peak) / Math.PI, jb = (w * toMin + phi - peak) / Math.PI;
  for (let j = Math.floor(Math.min(ja, jb)); j <= Math.ceil(Math.max(ja, jb)); j++) {
    const m = (peak + j * Math.PI - phi) / w;
    if (m > fromMin && m <= toMin) out.push({ at: m * M, kind: ((j % 2) + 2) % 2 === 0 ? 'peak' : 'trough' });
  }
  return out;
}
/** Rung k's timing uncertainty, ± minutes (ladderFilter.js rungStats, for one rung). */
export function rungSdMin(st, k) {
  const i = 2 + 2 * k, a = st.x[i], b = st.x[i + 1], A = Math.hypot(a, b), P = st.P;
  if (!(A > 0)) return Infinity;
  const paa = P[i * D + i], pbb = P[(i + 1) * D + i + 1], pab = P[i * D + i + 1];
  return Math.sqrt(Math.max(0, (b * b * paa - 2 * a * b * pab + a * a * pbb) / (A ** 4))) / Math.abs(st.omega[k]);
}

/**
 * Walk the filter over ascending one-minute `bars` and call every rung's turns a quarter lap ahead, for turns due in
 * [from, to). Seeded WARM_MIN before `from`. Yields nothing; returns { calls, seed, closes } or { calls: [], refused }.
 * `trace(ms)` is called after each close with the state (for a day's drawing); `progress(done, total)` as it goes.
 */
export function kalmanCalls({ bars, from, to, periods = DAILY_PERIODS, stiffness = KALMAN_STIFFNESS, progress = () => {}, trace = null }) {
  const cfg = stiffnessOf(stiffness), seedMs = from - WARM_MIN * M, seed = seedKalman(bars, seedMs, periods, cfg);
  if (!seed) return { calls: [], refused: 'history' };
  const { st } = seed, calls = [], last = periods.map(() => null);
  const i0 = lowerBound(bars, seedMs), i1 = lowerBound(bars, to), total = i1 - i0;
  let read = 0;
  for (let i = i0; i < i1; i++) {
    const b = bars[i], T = b.t + M;
    if (T <= st.t) continue;
    step(st, T, b.c, cfg, openMinutes(st.t, T));
    read++;
    if (trace) trace(T, st);
    if (T >= from - M) {
      for (let k = 0; k < periods.length; k++) {
        const P = periods[k], lead = Math.max(P / 4, swingMin(P) + 1), Tm = T / M;
        for (const t of rungTurnsIn(st, k, Tm + lead - 1, Tm + lead)) {
          if (t.at < from || t.at >= to || !globexOpen(t.at)) continue;
          const prev = last[k];
          if (prev && prev.kind === t.kind && t.at - prev.at < P / 4 * M) continue;   // the same turn, called again with less lead
          const call = { fam: 'kalman', n: k, P, at: Math.round(t.at), kind: t.kind, calledAt: T, A: Math.hypot(st.x[2 + 2 * k], st.x[3 + 2 * k]), sdMin: rungSdMin(st, k) };
          calls.push(call); last[k] = call;
        }
      }
    }
    if (read % 2000 === 0) progress(read, total);
  }
  calls.sort((a, b) => a.at - b.at || a.n - b.n);
  return { calls, seed: { at: seedMs, count: seed.count, q: st.q0, R: st.R }, closes: read };
}
