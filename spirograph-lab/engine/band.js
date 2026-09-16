// The band: how far this instrument has actually moved over the next k minutes, from every
// traded minute at the same hour of the New York day as now. It is the Trading Platform's
// "persist_hist" baseline — no model, just what this market has done over this horizon at this
// time of day — drawn around the path so the path is read with the width it deserves. Range
// varies about 4× across the day (the cash open against the overnight), which one flat width
// cannot represent. Pure; runs in Node.
import { nyParts } from './levels.js';
import { TPM } from './constants.js';

export const BAND_Q = { lo: 0.16, hi: 0.84 };          // the drawn band
export const ENVELOPE_Q = { lo: 0.10, hi: 0.90 };      // the outer envelope
export const BAND_PCT = Math.round((BAND_Q.hi - BAND_Q.lo) * 100);           // 68, computed from the quantiles drawn so the label cannot drift
export const ENVELOPE_PCT = Math.round((ENVELOPE_Q.hi - ENVELOPE_Q.lo) * 100); // 80
export const MIN_ORIGINS = 40;   // fewer origins than this at an hour and the band is not drawn
/** Horizons, in minutes, the band is measured at; between them it is interpolated. */
export const BAND_KS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 960, 1440, 1920];

const HOUR = 3600e3, hours = new Map();
/**
 * The New York hour of `ms`, memoised per UTC hour.
 *
 * THE CACHE KEY IS THE UTC HOUR, NOT THE UTC DAY. A UTC day holds two different New York
 * offsets on each changeover, and NY 19:00–23:59 belongs to the NEXT UTC day — so a per-day
 * offset sampled at UTC noon was wrong from about 19:00 the evening BEFORE each switch through
 * 02:00 on the day itself (21 wrong hours across 2026, on four separate days), not merely
 * "before 02:00". US offsets change on a whole UTC hour, so an hour-keyed cache is exact,
 * and it still calls Intl once per hour of history rather than once per minute.
 */
export function nyHour(ms) {
  const h = Math.floor(ms / HOUR); let v = hours.get(h);
  if (v === undefined) { v = nyParts(h * HOUR).h; if (hours.size > 1 << 17) hours.clear(); hours.set(h, v); }
  return v;
}
/**
 * The q-th quantile of an ALREADY SORTED array, by nearest rank.
 *
 * Exported for the same reason wilson() lives in one place: scripts/scale.mjs takes the band's
 * width off resampled subsets of the same moves, and a second quantile convention there would
 * make its answer about the convention rather than about the market.
 */
export const quantileOf = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
const pick = quantileOf;
/**
 * Quantiles of the signed k-minute close-to-close move from every traded minute at NY hour
 * `hour` whose target minute also traded, for each k in `ks`. Returns null off a live sim.
 * { hour, ks, rows: [{ k, n, med, lo, hi, outLo, outHi }] } — a row with n < MIN_ORIGINS holds NaN.
 *
 * `hour === null` pools EVERY traded minute whatever the hour, and the quantiles then come from
 * the pooled sample itself. An n-weighted mean of the 24 hourly quantiles is NOT that quantile —
 * on a mixture of a quiet hour and a loud one it runs about 18% wide — so a pooled control has
 * to be measured here, from the moves, and never assembled out of hourly rows.
 */
export function moveQuantiles(sim, hour, ks = BAND_KS) {
  if (sim.mode !== 'live' || !sim.live) return null;
  const MIN = sim.MIN, c = MIN.c, has = MIN.has, m1 = sim.minutes(), base = sim.live.t0 + (sim.tick0 / TPM) * 60000;   // tick0 is a multiple of TPM
  const origins = []; for (let m = 0; m < m1; m++) if (has[m] === 1 && (hour === null || nyHour(base + m * 60000) === hour)) origins.push(m);
  const rows = ks.map(k => {
    const d = []; for (const m of origins) { const j = m + k; if (j < m1 && has[j] === 1) d.push(c[j] - c[m]); }
    if (d.length < MIN_ORIGINS) return { k, n: d.length, med: NaN, lo: NaN, hi: NaN, outLo: NaN, outHi: NaN };
    d.sort((a, b) => a - b);
    return { k, n: d.length, med: pick(d, 0.5), lo: pick(d, BAND_Q.lo), hi: pick(d, BAND_Q.hi), outLo: pick(d, ENVELOPE_Q.lo), outHi: pick(d, ENVELOPE_Q.hi) };
  });
  return { hour, ks, rows };
}
/**
 * The band's offsets at `k` minutes ahead: {lo, hi, outLo, outHi} as moves from the origin, centred so
 * the median move is 0, interpolated between the measured horizons. A horizon with too few origins is
 * skipped rather than interpolated toward — a market that is shut at one offset and open at the next
 * leaves holes in the ladder, and interpolating into one would poison a band either side of it.
 * Null when nothing measured surrounds `k`.
 *
 * PAST THE LAST MEASURED RUNG THIS RETURNS NULL — IT DOES NOT CLAMP. It used to fall back to the
 * widest rung it had, which is silently, badly wrong: a ladder measured only out to 30 minutes
 * answered 30 minutes' width at k = 60, at k = 120 and at k = 780 alike, so a thirteen-hour cone got
 * a half-hour's width, was frozen, was graded, and reported "broke at step 1" as though the market
 * had done something extraordinary. That happens on any fresh contract and in any NY hour thin
 * enough that the long horizons miss MIN_ORIGINS. A band that cannot reach the horizon asked of it
 * has no answer, and saying so lets makeRun refuse the run instead of freezing a lie.
 *
 * AND IT WILL BRIDGE ONE MISSING RUNG, NEVER A CHASM. Stepping over a hole is right — a market shut
 * at one offset and open at the next leaves gaps that must not poison the band either side. Stepping
 * over ten of them is not interpolation, it is invention: on a thin hour whose ladder held k = 10 and
 * then nothing until k = 1440, a sixty-minute width was being read off the line joining a ten-minute
 * quantile to a twenty-four-hour one, and came out barely wider than ten minutes. Adjacent rungs of
 * BAND_KS are never more than 3x apart, so a bracket wider than that has skipped at least two and is
 * refused.
 */
const GAP_MAX = 3;   // the widest bracket that is still interpolation: one missing rung of BAND_KS
export function bandAt(band, k) {
  if (!band) return null; const r = band.rows;
  let a = null, b = null;
  for (const row of r) { if (!Number.isFinite(row.lo)) continue; if (row.k <= k) a = row; else { b = row; break; } }
  if (!a && !b) return null;
  if (a && !b && k > a.k) return null;                            // beyond the ladder: unmeasured, not "the same as the last rung"
  if (a && a.k === k) b = a;                                      // k is measured outright; nothing is being read across
  if (a && b && b.k > GAP_MAX * a.k) return null;                 // the bracket has skipped too much to be read across
  if (!a) a = b; if (!b) b = a;
  const f = a === b || b.k === a.k ? 0 : Math.max(0, Math.min(1, (k - a.k) / (b.k - a.k)));
  const mix = (x, y) => f === 0 ? x : x + (y - x) * f, c = mix(a.med, b.med);   // f === 0 short-circuits: (NaN - x) * 0 is NaN, not 0
  return { lo: mix(a.lo, b.lo) - c, hi: mix(a.hi, b.hi) - c, outLo: mix(a.outLo, b.outLo) - c, outHi: mix(a.outHi, b.outHi) - c, n: Math.round(mix(a.n, b.n)) };
}
let cache = { key: '', band: null };
/** The band for a live sim at `nowMs`, remeasured once a minute or when the hour changes. */
export function bandFor(sim, nowMs, ks = BAND_KS) {
  if (sim.mode !== 'live' || !sim.live) return null;
  const hour = nyHour(nowMs), key = `${sim.live.contract}|${hour}|${Math.floor(nowMs / 60000)}|${ks.length}`;
  if (cache.key !== key) cache = { key, band: moveQuantiles(sim, hour, ks) };
  return cache.band;
}
