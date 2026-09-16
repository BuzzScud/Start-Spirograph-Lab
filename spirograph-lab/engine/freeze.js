// Frozen forecasts: the ladder as it stood at one moment, kept so what the market does next can be measured
// against it.
//
// A FORECAST IS THE MARKET MAKER DESK'S RUN (src/forecast.js, band.js), cut the way the desk cuts one: at the
// last CLOSED minute, over 13 bars of a chosen timeframe. Its path is the pen's change from the cut added to
// the cut's close; its cone is the 68% band and 80% envelope of how far this market has actually moved from
// that hour of the New York day, laid round the CUT PRICE (never round the path: forecast.js says why); and it
// is graded bar by bar with the desk's own gradeRun. One adaptation, on purpose: the path follows the rung the
// pen rides (the Ladder's pen is the sum through L), where the desk's runs through all six.
//
// The run also keeps the fit's closed form (level, trend, each rung's size, phase and rate, and the t0 its
// minutes count from), so its cycles redraw exactly in any later session and nothing a refit does can move
// them. They are pinned as the desk pins its frozen cycles (frozen.js): moved by what the market stood above
// or below the pen at the cut, so the pen runs through every stamp of the path.
//
// Freezes saved before the runs (v1: the fit alone, no path and no band) still read, draw and turn-check.
// Pure, no DOM: the relay checks a posted forecast with the same normForecast, and the tests run in Node.
import { TAU, TPM, MAXL } from './constants.js';
import { RUN_STEPS, RUN_SCHEMA, checkRun, lastClosedMinute, closeAtFromSim, runIdFor, runName, gradeRun, runState } from './forecast.js';
import { bandFor, bandAt, nyHour, BAND_PCT, ENVELOPE_PCT } from './band.js';
import { shadowBand } from './bandShadow.js';

/** The timeframes a run can be cut over, in minutes: 13 bars of each is 65 min, 3h15m and 13 h. The desk's 4H and D reach past its band (32 h). */
export const RUN_TFS = [5, 15, 60];
/** The desk's words for a refused cut (desks/fractal main.js REFUSAL). */
export const REFUSAL = { 'no-fit': 'no fit yet', 'no-bars': 'the cut minute never traded', 'thin-band': 'no band this far out' };
const M = 60000;
const FLAT = 0.5;   // points: a rung smaller than this names no turns (ladderView's `flat`)

const fin = v => typeof v === 'number' && Number.isFinite(v);
const six = (a, ok = fin) => (Array.isArray(a) && a.length === MAXL && a.every(ok) ? a.slice() : null);
const text = (s, max) => (typeof s === 'string' && s.length > 0 && s.length <= max ? s : null);
const opt = v => (fin(v) ? v : null);

/**
 * Cut a run from the live sim at `nowMs` over RUN_STEPS bars of `tf` minutes: { run, warn } or { refused, detail }.
 * The desk's checkRun decides what is refused (no fit, an untraded cut, a band that cannot reach the horizon);
 * `force` cuts a thin-band one anyway, as shift does on the desk. makeRun's arithmetic, line for line, except
 * that the pen is read through its own rung. The fit is read from the sim's own geometry (G), so the cycles
 * saved are the ones on the screen.
 */
export function makeLadderRun(sim, nowMs, tf, { force = false } = {}) {
  const chk = checkRun(sim, nowMs, tf, TPM);
  if (!chk.ok && !force) return { refused: chk.reason, detail: chk.detail };
  const cut = lastClosedMinute(nowMs), anchor = closeAtFromSim(sim, TPM)(cut);
  if (anchor === null) return { refused: 'no-bars', detail: 'the cut minute never traded' };
  const L = sim.L, top = L - 1, cutMin = (cut - sim.live.t0) / M, penCut = sim.modelAt(cutMin, top), band = bandFor(sim, cut);
  const path = [];
  for (let i = 0; i <= RUN_STEPS; i++) {
    const k = i * tf, o = i ? bandAt(band, k) : null;   // step 0 is the join: the anchor exactly
    path.push({ i, t: cut + k * M, path: anchor + (sim.modelAt(cutMin + k, top) - penCut), lo: o ? anchor + o.lo : anchor, hi: o ? anchor + o.hi : anchor, outLo: o ? anchor + o.outLo : anchor, outHi: o ? anchor + o.outHi : anchor, n: o ? o.n : 0 });
  }
  const f = sim.live.fit, G = sim.G, S = G.scale;
  const run = {
    v: RUN_SCHEMA, kind: 'ladder', id: runIdFor(sim.live.contract, cut, tf), contract: sim.live.contract, name: runName(sim.live.name, cut),
    cut, tf, steps: RUN_STEPS, horizonMin: RUN_STEPS * tf, anchor, bandPct: BAND_PCT, envelopePct: ENVELOPE_PCT, bandHour: nyHour(cut),
    bandQuality: chk.ok ? 'measured' : chk.reason, fitQuality: (chk.warn || []).includes('flat-fit') ? 'flat' : 'ok', ...(chk.ok ? {} : { forced: true }),
    L, path, savedAt: nowMs,
    fit: {
      p0: sim.p0(), drift: G.drift, tRef: G.tRef,
      A: Array.from({ length: MAXL }, (_, n) => G.lever[n] * S),
      phi: Array.from(G.phi.subarray(0, MAXL)),
      off: Array.from({ length: MAXL }, (_, n) => G.off[n] * S),
      omega: G.omega.slice(0, MAXL),
      t0: sim.live.t0, pack: sim.k, scale: S,
      rms: f.rms > 0 ? f.rms : sim.explainOver().rms, explained: f.explained || 0, explainedRaw: f.explainedRaw ?? f.explained ?? 0, statMin: f.statMin ?? null, statN: f.statN ?? null,
    },
  };
  // the volatility band (bandShadow.js), cut beside the desk's and graded on the same stamps: the one drawn (drawnRun)
  const sh = shadowBand(sim, run);
  if (sh) run.shadow = sh;
  return { run: normForecast(run), warn: chk.warn || [] };
}

/**
 * The run as the Ladder draws and grades it (15 Sep, on request): with its volatility band (bandShadow.js, kept on
 * `run.shadow`) in place of band.js's hour-of-day band when it carries one, since on NQZ6 the backtest found it 25%
 * narrower at an honest 68% over 31 runs; else as cut. `band` says which: 'vol' or 'hour'. The run itself keeps both
 * (`path` is the desk's band, as the Market Maker cuts it), so the relay and the scorecard still grade them side by
 * side, and a saved run from before the switch draws its volatility band too. The same object for the same run.
 * `desk` asks for the desk's band anyway: the live before/after preview's "before" side (freezeView deskBand).
 */
const drawnRuns = new WeakMap(), deskRuns = new WeakMap();
export function drawnRun(fc, desk = false) {
  if (!fc || !fc.path) return fc;
  const vol = !desk && !!fc.shadow, memo = vol ? drawnRuns : deskRuns;
  let r = memo.get(fc);
  if (!r) { r = vol ? { ...fc, path: fc.shadow.path, band: 'vol' } : { ...fc, band: 'hour' }; memo.set(fc, r); }
  return r;
}

// ---------------------------------------------------------------- what may be kept
function normStep(s, i) {
  return s && s.i === i && [s.t, s.path, s.lo, s.hi, s.outLo, s.outHi].every(fin)
    ? { i, t: s.t, path: s.path, lo: s.lo, hi: s.hi, outLo: s.outLo, outHi: s.outHi, n: fin(s.n) ? s.n : 0 } : null;
}
function normRun(x) {
  const f = x.fit;
  if (!f || typeof f !== 'object') return null;
  const A = six(f.A), phi = six(f.phi), off = six(f.off), omega = six(f.omega, v => fin(v) && v !== 0), contract = text(x.contract, 80);
  if (!A || !phi || !off || !omega || !contract || typeof x.id !== 'string' || !/^[0-9a-f]{12}$/.test(x.id)) return null;
  if (![x.cut, x.savedAt, x.anchor, x.horizonMin, x.bandPct, x.envelopePct, f.p0, f.drift, f.tRef, f.t0, f.rms].every(fin) || f.rms < 0) return null;
  if (!Number.isInteger(x.tf) || x.tf < 1 || x.tf > 1440 || x.steps !== RUN_STEPS || !Number.isInteger(x.L) || x.L < 1 || x.L > MAXL) return null;
  if (!Array.isArray(x.path) || x.path.length !== RUN_STEPS + 1) return null;
  const path = x.path.map(normStep);
  if (path.some(s => !s)) return null;
  const sp = x.shadow && typeof x.shadow === 'object' && Array.isArray(x.shadow.path) && x.shadow.path.length === RUN_STEPS + 1 ? x.shadow.path.map(normStep) : null;
  const shadow = sp && !sp.some(s => !s) && fin(x.shadow.vol) ? { kind: text(x.shadow.kind, 20) || 'vol', vol: x.shadow.vol, path: sp } : null;
  return {
    v: RUN_SCHEMA, kind: 'ladder', id: x.id, contract, name: text(x.name, 120) || contract, cut: x.cut, tf: x.tf, steps: RUN_STEPS, horizonMin: x.horizonMin,
    anchor: x.anchor, bandPct: x.bandPct, envelopePct: x.envelopePct, bandHour: Number.isInteger(x.bandHour) ? x.bandHour : null,
    bandQuality: text(x.bandQuality, 20) || 'measured', fitQuality: text(x.fitQuality, 10) || 'ok', ...(x.forced === true ? { forced: true } : {}),
    // where it came from (none: cut on the page; 'auto': the relay's schedule; 'bt': a past cut) and the group it is filed under
    ...(x.source === 'auto' || x.source === 'bt' ? { source: x.source } : {}), ...(typeof x.groupId === 'string' && /^[0-9a-f]{12}$/.test(x.groupId) ? { groupId: x.groupId } : {}),
    // the scheduled pass that cut it (forecastDesk.mjs slotKey), so Home's slot timeline can open it: ?slot=<runKey>
    ...(typeof x.runKey === 'string' && /^\d{4}-\d{2}-\d{2}\|\d{2}:\d{2}$/.test(x.runKey) ? { runKey: x.runKey } : {}),
    L: x.L, path, ...(shadow ? { shadow } : {}), savedAt: x.savedAt,
    fit: { p0: f.p0, drift: f.drift, tRef: f.tRef, A, phi, off, omega, t0: f.t0, pack: opt(f.pack), scale: opt(f.scale), rms: f.rms,
      explained: opt(f.explained) ?? 0, explainedRaw: opt(f.explainedRaw), statMin: opt(f.statMin), statN: opt(f.statN) },
  };
}
/** A freeze saved before the runs: the fit at the moment it froze, with no path and no band. */
function normFreeze(x) {
  const f = x.fit;
  if (!f || typeof f !== 'object') return null;
  const A = six(f.A), phi = six(f.phi), off = six(f.off), omega = six(f.omega, v => fin(v) && v !== 0), contract = text(x.contract, 80);
  if (!A || !phi || !off || !omega || !contract) return null;
  if (![x.savedAt, x.cut, x.t0, x.mkt, x.pen, f.p0, f.drift, f.tRef, f.sigma].every(fin) || f.sigma < 0) return null;
  if (!Number.isInteger(x.L) || x.L < 1 || x.L > MAXL) return null;
  const out = {
    v: 1, contract, name: text(x.name, 80) || contract, savedAt: x.savedAt, cut: x.cut, t0: x.t0, weeks: opt(x.weeks), L: x.L, mkt: x.mkt, pen: x.pen,
    fit: { p0: f.p0, drift: f.drift, tRef: f.tRef, A, phi, off, omega, sigma: f.sigma, explained: opt(f.explained) ?? 0 },
  };
  if (typeof x.id === 'string' && /^[0-9a-f]{12}$/.test(x.id)) out.id = x.id;
  return out;
}
/** A run or an earlier freeze with only the fields it should have, each checked; null for anything else. The relay's gate too. */
export function normForecast(x) {
  if (!x || typeof x !== 'object') return null;
  if (x.v === RUN_SCHEMA && x.kind === 'ladder') return normRun(x);
  if (x.v === 1) return normFreeze(x);
  return null;
}

// ---------------------------------------------------------------- its cycles
const t0Of = fc => (fc.path ? fc.fit.t0 : fc.t0);
/** The last stamp of a run (epoch ms); null for an earlier freeze, which has no horizon. */
export const runEnd = fc => (fc.path ? fc.path[fc.path.length - 1].t : null);
/** The fit's price `t` minutes after its t0, through rung n: sim.modelAt's closed form. */
function priceAt(F, t, n) {
  let y = F.p0 + F.drift * (t - F.tRef);
  for (let k = 0; k <= n; k++) y += F.off[k] + F.A[k] * Math.sin(F.phi[k] + F.omega[k] * t);
  return y;
}
const pins = new WeakMap();
/** What a forecast's cycles are moved by: a run's pen is pinned to its path (the cut's close less the pen there); an earlier freeze is where it was drawn. */
export function pinOf(fc) {
  let d = pins.get(fc);
  if (d === undefined) { d = fc.path ? fc.anchor - priceAt(fc.fit, (fc.cut - t0Of(fc)) / M, fc.L - 1) : 0; pins.set(fc, d); }
  return d;
}
/** The forecast's price at epoch `ms` through rung n (0 = L1), pinned. */
export function forecastAt(fc, ms, n = fc.L - 1) { return priceAt(fc.fit, (ms - t0Of(fc)) / M, n) + pinOf(fc); }

/**
 * The forecast on a sim's clock (minutes since `simT0`, which a later session need not share), in the shape
 * draw/price.js's ladderColumns reads: `levels(m, out)` fills out[0] with the base and out[n + 1] with the
 * price through rung n.
 */
export function onSimClock(fc, simT0) {
  const F = fc.fit, dt = (simT0 - t0Of(fc)) / M, d = pinOf(fc);
  return {
    at: (m, n = MAXL - 1) => priceAt(F, m + dt, n) + d,
    levels(m, out) {
      const t = m + dt; let y = F.p0 + F.drift * (t - F.tRef) + d;
      out[0] = y;
      for (let k = 0; k < MAXL && k + 1 < out.length; k++) { y += F.off[k] + F.A[k] * Math.sin(F.phi[k] + F.omega[k] * t); out[k + 1] = y; }
      return out;
    },
    amp: k => Math.abs(F.A[k]),
    period: k => TAU / Math.abs(F.omega[k]),
  };
}
/** Rung n's period in minutes. */
export const rungPeriod = (fc, n) => TAU / Math.abs(fc.fit.omega[n]);

// ---------------------------------------------------------------- measuring it
/**
 * The sim's CLOSED one-minute closes whose minute ends in (fromMs, toMs], each stamped at that end (as
 * sim.js closes() stamps them), in epoch ms. The minute still forming is never one of them.
 */
export function simCloses(sim, fromMs, toMs) {
  const t0 = sim.live.t0, base = sim.tick0 / TPM, Mn = sim.minutes(), H = sim.MIN.has, C = sim.MIN.c;
  const t = [], p = [];
  for (let m = Math.max(0, Math.floor((fromMs - t0) / M - base - 1)); m < Mn; m++) {
    const end = t0 + (base + m + 1) * M;
    if (end > toMs) break;
    if (end > fromMs && H[m]) { t.push(end); p.push(C[m]); }
  }
  return { t: Float64Array.from(t), p: Float64Array.from(p), n: t.length };
}

/**
 * Rung n's predicted turns in (fromMs, toMs], ascending: [{ at, kind }]. A·sin θ, θ = φ + ω·t, is highest at
 * θ = π/2 when A > 0 (3π/2 when a signed fit left it negative), and turns every half lap after that.
 */
export function rungTurns(fc, n, fromMs, toMs) {
  const F = fc.fit, A = F.A[n], w = F.omega[n], phi = F.phi[n], t0 = t0Of(fc);
  if (!(Math.abs(A) >= FLAT) || !(toMs > fromMs)) return [];
  const peak = A > 0 ? Math.PI / 2 : 1.5 * Math.PI;
  const ta = (fromMs - t0) / M, tb = (toMs - t0) / M;
  const ja = (phi + w * ta - peak) / Math.PI, jb = (phi + w * tb - peak) / Math.PI;   // θ = peak + jπ: even j a peak, odd a trough
  const out = [];
  for (let j = Math.floor(Math.min(ja, jb)); j <= Math.ceil(Math.max(ja, jb)); j++) {
    const t = (peak + j * Math.PI - phi) / w;
    if (t > ta && t <= tb) out.push({ at: t0 + t * M, kind: ((j % 2) + 2) % 2 === 0 ? 'peak' : 'trough' });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Ascending one-minute `bars` [{t, c}] as closes stamped at their minute's end, those ending in (fromMs, toMs]: simCloses over bars. */
export function closesFromBars(bars, fromMs, toMs) {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].t + M <= fromMs) lo = mid + 1; else hi = mid; }
  const t = [], p = [];
  for (let i = lo; i < bars.length && bars[i].t + M <= toMs; i++) { t.push(bars[i].t + M); p.push(bars[i].c); }
  return { t: Float64Array.from(t), p: Float64Array.from(p), n: t.length };
}

function lowerBound(arr, n, x) { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; } return lo; }

/**
 * Did the market turn where the rung said? The window is a quarter of the rung's lap either side of the
 * predicted time, and it is graded once the whole of it has closed. The market's highest close in it (for a
 * peak; lowest for a trough) is where it actually turned:
 *   hit     within an eighth of a lap of the prediction (a market with no cycle there, a random walk, does
 *           that about a third of the time: turnChance)
 *   miss    further out than that
 *   none    the extreme sits on the window's edge: the market ran straight through, no turn at all
 *   nodata  fewer than three closes in the window (the market was shut, or the rung is too quick for
 *           one-minute closes)
 *   open    the window has not closed yet; `ahead` the turn itself is still to come
 * `off` is actual − predicted in minutes: positive late, negative early.
 */
export function gradeTurn(turn, periodMin, closes, nowMs) {
  const half = periodMin / 4 * M, a = turn.at - half, b = turn.at + half;
  if (b > nowMs) return { ...turn, state: turn.at > nowMs ? 'ahead' : 'open' };
  const i0 = lowerBound(closes.t, closes.n, a), i1 = lowerBound(closes.t, closes.n, b + 1);
  if (i1 - i0 < 3) return { ...turn, state: 'nodata' };
  let k = i0;
  for (let i = i0 + 1; i < i1; i++) if (turn.kind === 'peak' ? closes.p[i] > closes.p[k] : closes.p[i] < closes.p[k]) k = i;
  const off = (closes.t[k] - turn.at) / M, edge = k === i0 || k === i1 - 1;
  return { ...turn, state: edge ? 'none' : Math.abs(off) <= periodMin / 8 ? 'hit' : 'miss', off, actual: closes.t[k], price: closes.p[k] };
}

/**
 * How often a market with no cycle at all, a random walk, would pass the turn check at a rung of `periodMin`:
 * about a third, not a half. A random walk's high and low in a window sit near its edges far more often than in
 * its middle (the arcsine law puts 1/3 of them in the middle half), and the edges are graded as no turn. Measured
 * on a simulated walk (tests/freeze.test.js): 34% at 2 h and 10 h, 38% at 24 min, where one-minute closes are few.
 */
export const turnChance = periodMin => (periodMin < 60 ? 0.38 : 0.34);

const GRADED = new Set(['hit', 'miss', 'none']);
/**
 * Every rung the forecast's pen rides, its turns graded against `closes`: a run's inside its horizon (the cut
 * to its last stamp), an earlier freeze's from the cut on. Per rung the counts, the median offset of the turns
 * that happened, the last one graded and the next one due; totals over the rungs that turn at all.
 */
export function turnCheck(fc, closes, nowMs) {
  const rows = [], end = runEnd(fc);
  let graded = 0, hits = 0;
  for (let n = 0; n < fc.L; n++) {
    const P = rungPeriod(fc, n), amp = Math.abs(fc.fit.A[n]);
    const turns = rungTurns(fc, n, fc.cut, end ?? nowMs + P * M).map(t => gradeTurn(t, P, closes, nowMs));
    const done = turns.filter(t => GRADED.has(t.state));
    const offs = done.filter(t => t.state !== 'none').map(t => t.off).sort((a, b) => a - b);
    const row = {
      n, period: P, amp, flat: !(amp >= FLAT), total: turns.length,
      graded: done.length, hits: done.filter(t => t.state === 'hit').length, none: done.filter(t => t.state === 'none').length,
      nodata: turns.filter(t => t.state === 'nodata').length,
      median: offs.length ? (offs.length % 2 ? offs[offs.length >> 1] : (offs[offs.length / 2 - 1] + offs[offs.length / 2]) / 2) : NaN,
      last: done.length ? done[done.length - 1] : null, recent: done.slice(-4),
      next: turns.find(t => t.state === 'ahead') || null,
    };
    rows.push(row); graded += row.graded; hits += row.hits;
  }
  return { rows, graded, hits };
}

/**
 * The whole measure of a forecast against a live sim at `nowMs`: a run's grade (the desk's gradeRun, over the
 * sim's closes) and its state (armed, tracking, expired), and the turn check. Closes are read from a quarter of
 * the slowest rung's lap before the cut, since a turn's window can start there. `from` is when measuring starts:
 * the cut, or the first minute the sim still holds if the forecast is older than its history.
 */
export function scoreForecast(fc, sim, nowMs) {
  let reach = 0; for (let n = 0; n < fc.L; n++) reach = Math.max(reach, rungPeriod(fc, n) / 4);
  const end = runEnd(fc), closes = simCloses(sim, fc.cut - reach * M, end === null ? nowMs : Math.min(nowMs, end + reach * M));
  const g = fc.path ? gradeRun(fc, closeAtFromSim(sim, TPM)) : null;
  const held = sim.live.t0 + sim.tick0 / TPM * M;
  return { g, state: fc.path ? runState(fc, g, nowMs) : 'tracking', turns: turnCheck(fc, closes, nowMs), from: Math.max(fc.cut, held), partial: fc.cut < held, at: nowMs };
}
