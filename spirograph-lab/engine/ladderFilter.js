// The ladder as a Kalman filter (14 Sep, on request: the rungs moved on every refit, so their turns and the
// past could not be trusted). The six periods stay the ladder's own; what is estimated is each rung's size and
// timing and the trend, and they are updated once per CLOSED minute by an amount the filter controls:
//
//   close(t) = level(t) + Σ_n (a_n cos ω_n t + b_n sin ω_n t) + noise          (t in minutes on the epoch clock)
//
// This is dynamic harmonic regression (Young, Pedregal & Tych 1999), the state-space form of Harvey's cycle
// models. A rung A·sin(ωt + φ) is a = A sin φ, b = A cos φ, so A = √(a² + b²) and φ = atan2(a, b), as fit.js.
//
// THE CYCLES ARE FILTERED ON THE CLOSE'S CHANGE, not its level. A market is mostly a random walk, and a walk read
// as levels looks like slow cycles: a first version filtered the level and handed the walk to L1–L4, which then
// slid minutes a minute. Differenced, the walk is plain noise of variance q a minute, the cycles are
// a_n Δcos + b_n Δsin, and the trend is d·Δt. q and the closes' own noise R are measured from the seed day's
// changes (their variance and their lag-one covariance).
//
// The LEVEL the lines stand on is what it always was: the close less the cycles, averaged over the last
// LEVEL_MIN closes (the refit's level correction), carried with the trend.
//
// How far each rung may move is its STIFFNESS: the random walk on (a, b) is sized so that the rung's timing
// wanders by `lap` of a lap (one standard deviation) per lap of its own. In the steady state the estimate moves
// about as much as that walk allows, so this is how still a rung is.
//
// The state is kept on the EPOCH clock (minutes since 1970), not the sim's, whose t0 moves with History and the
// week: a state saved on Monday reads the same on Friday. fitOf turns it into the sim's own fit shape, so
// sim.modelAt, the lanes, the alerts and Freeze & save read the filter without knowing it is one.
//
// Pure: no DOM. The app, the Data tab's backtest and the tests run the same code.
import { TAU, TPM, MAXL, FIT_LAPS, FIT_STAT_MIN } from './constants.js';
import { globexOpen } from './session.js';

export const FILTER_V = 1;
export const D = 2 + 2 * MAXL;              // the state: level, trend, then a cos and a sin weight per rung
export const WARM_MIN = 1440;               // a filter is seeded a day before the minute it is first needed, and run up to it
export const LEVEL_MIN = FIT_STAT_MIN;      // the level's memory, in closes
export const STIFFNESS = [
  { id: 'stiff', label: 'Stiff', lap: 1 / 32 },
  { id: 'balanced', label: 'Balanced', lap: 1 / 16 },
  { id: 'loose', label: 'Loose', lap: 1 / 8 },
  { id: 'follow', label: 'Follow', lap: 1 / 4 },
];
export const DEFAULT_STIFFNESS = 'balanced';
export const stiffnessOf = id => STIFFNESS.find(s => s.id === id) || STIFFNESS.find(s => s.id === DEFAULT_STIFFNESS);
const CLIP = 4;                              // a change past 4σ moves the state only 4σ of it: a news bar or a roll is not a cycle
const MEMORY = 1440;                         // closes: how long q remembers the innovations
const A_FLOOR = 0.25;                        // × √q: the smallest size a rung's stiffness is reckoned from, so a quiet rung can still grow
const MIN = 60000;
const ALPHA = 2 / (LEVEL_MIN + 1);
const wrapPi = a => a - TAU * Math.floor((a + Math.PI) / TAU);
const periodOf = w => TAU / Math.abs(w);

/** Process noise per minute: the trend's walk and each rung's (from its current size). */
function noise(st, cfg) {
  const W1 = FIT_LAPS * periodOf(st.omega[0]), qd = st.q / (W1 * W1);   // over L1's window the trend moves by what that window's mean change can tell
  const kappa = TAU * cfg.lap, floor = A_FLOOR * Math.sqrt(st.q), qc = new Float64Array(MAXL);
  for (let n = 0; n < MAXL; n++) {
    if (!st.on[n]) continue;
    const A = Math.max(Math.hypot(st.x[2 + 2 * n], st.x[3 + 2 * n]), floor);
    qc[n] = (kappa * A) ** 2 / periodOf(st.omega[n]);
  }
  return { qd, qc };
}

/**
 * A filter seeded from a batch fit (sim.live.fit's shape: A, phi on the sim clock counted from `t0`, p0, drift,
 * tRef) at epoch ms `atMs`. `noise`: { q, R } (seedNoise). `last`: the close at or before the seed, { t, p }, which
 * the first change is measured from. `on[n]` false holds rung n at zero (a period under two bars). Each rung
 * starts as uncertain as one lap of its stiffness, the trend as the mean of L1's window of changes.
 */
export function seedFilter({ fit, omega, t0, atMs, noise: nz, last = null, on = null, cfg }) {
  const x = new Float64Array(D), P = new Float64Array(D * D), t0m = t0 / MIN, tm = (atMs - t0) / MIN;
  const offs = (fit.off || []).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  x[0] = fit.p0 + fit.drift * (tm - fit.tRef) + offs;
  x[1] = fit.drift;
  const st = {
    v: FILTER_V, omega: Array.from(omega).slice(0, MAXL), on: Array.from({ length: MAXL }, (_, n) => (on ? !!on[n] : true)),
    t: atMs, x, P, q: nz.q, q0: nz.q, R: nz.R, yPrev: last ? last.p : NaN, tPrev: last ? last.t : NaN, seededAt: atMs, closes: 0,
  };
  for (let n = 0; n < MAXL; n++) {
    if (!st.on[n]) continue;
    const phiE = fit.phi[n] - st.omega[n] * t0m;   // A sin(ω·t_sim + φ) = A sin(ω·m + φ − ω·t0m), m on the epoch clock
    x[2 + 2 * n] = fit.A[n] * Math.sin(phiE); x[3 + 2 * n] = fit.A[n] * Math.cos(phiE);
  }
  const W1 = FIT_LAPS * periodOf(st.omega[0]), { qc } = noise(st, cfg);
  P[D + 1] = nz.q / W1;
  for (let n = 0; n < MAXL; n++) { const i = 2 + 2 * n, v = qc[n] * periodOf(st.omega[n]); P[i * D + i] = v; P[(i + 1) * D + i + 1] = v; }
  return st;
}

/**
 * Carry the state forward to epoch ms `toMs`: the level moves with the trend and the weights' uncertainty grows.
 * The rungs' walks grow only over `openMin` of those minutes (default all), so a weekend does not unlearn them.
 */
export function predict(st, toMs, cfg, openMin = null) {
  const dt = (toMs - st.t) / MIN;
  if (!(dt > 0)) return st;
  const open = openMin === null ? dt : Math.max(0, Math.min(dt, openMin)), P = st.P, { qd, qc } = noise(st, cfg);
  st.x[0] += dt * st.x[1];
  P[D + 1] += qd * dt;
  for (let n = 0; n < MAXL; n++) { const i = 2 + 2 * n; P[i * D + i] += qc[n] * open; P[(i + 1) * D + i + 1] += qc[n] * open; }
  st.t = toMs;
  return st;
}

const H = new Float64Array(D), PH = new Float64Array(D);
/** The sum of the rungs' cycles at epoch ms. */
function cyclesAt(st, ms) {
  const m = ms / MIN; let c = 0;
  for (let n = 0; n < MAXL; n++) { const th = st.omega[n] * m; c += st.x[2 + 2 * n] * Math.cos(th) + st.x[3 + 2 * n] * Math.sin(th); }
  return c;
}

/**
 * Read one close `y` at the state's own time (predict to its stamp first): the change since the last close updates
 * the trend and the weights, then the level takes its share of what the cycles leave. Returns { e, s } — the
 * change's innovation and its standard deviation — or null when there was no change to read (the first close).
 */
export function update(st, y, cfg) {
  if (!Number.isFinite(y)) return null;
  const x = st.x, P = st.P, t = st.t;
  let out = null;
  if (Number.isFinite(st.yPrev) && t > st.tPrev) {
    const m = t / MIN, mp = st.tPrev / MIN, gap = (t - st.tPrev) / MIN, h = H;
    h[0] = 0; h[1] = gap;
    for (let n = 0; n < MAXL; n++) {
      const w = st.omega[n], on = st.on[n];
      h[2 + 2 * n] = on ? Math.cos(w * m) - Math.cos(w * mp) : 0; h[3 + 2 * n] = on ? Math.sin(w * m) - Math.sin(w * mp) : 0;
    }
    const V = st.q * gap + 2 * st.R;
    let S = V, dHat = 0;
    for (let i = 1; i < D; i++) { let s = 0; for (let j = 1; j < D; j++) s += P[i * D + j] * h[j]; PH[i] = s; S += h[i] * s; dHat += h[i] * x[i]; }
    const e = (y - st.yPrev) - dHat, sd = Math.sqrt(S), ec = Math.max(-CLIP, Math.min(CLIP, e / sd)) * sd;
    for (let i = 1; i < D; i++) x[i] += PH[i] / S * ec;
    for (let i = 1; i < D; i++) for (let j = 1; j < D; j++) P[i * D + j] -= PH[i] * PH[j] / S;
    for (let i = 1; i < D; i++) if (!(P[i * D + i] > 0)) P[i * D + i] = 1e-12;
    if (gap <= 5) st.q = Math.max(st.q0 * 0.01, (1 - 1 / MEMORY) * st.q + (Math.max(0, ec * ec - (S - V) - 2 * st.R) / gap) / MEMORY);
    out = { e, s: sd };
  }
  x[0] += ALPHA * (y - cyclesAt(st, t) - x[0]);
  st.yPrev = y; st.tPrev = t; st.closes++;
  return out;
}

/** predict to the close's stamp, then read it. */
export function step(st, closeMs, y, cfg, openMin = null) { predict(st, closeMs, cfg, openMin); return update(st, y, cfg); }

/** The state's price through rung n (0 = L1) at epoch ms: its projection when `ms` is past its time. */
export function priceAt(st, ms, n = MAXL - 1) {
  const x = st.x, m = ms / MIN;
  let p = x[0] + x[1] * (ms - st.t) / MIN;
  for (let k = 0; k <= n && k < MAXL; k++) { const th = st.omega[k] * m; p += x[2 + 2 * k] * Math.cos(th) + x[3 + 2 * k] * Math.sin(th); }
  return p;
}

/**
 * The standard deviation of a close at epoch ms around the price through rung n: the level's lag behind the walk
 * (an average of LEVEL_MIN closes trails it), the walk from now to then, what the state does not know about how
 * the trend and the cycles CHANGE from now to then (the level has already absorbed their error now), and the
 * close's own noise. The walk q is measured from the closes, so it already holds what the rungs' drift does to
 * a close; it is not added twice. The 68% band is ± this.
 */
export function sdAt(st, ms, n = MAXL - 1, cfg) {
  const dt = Math.max(0, (ms - st.t) / MIN), m = ms / MIN, m0 = st.t / MIN, P = st.P, h = H;
  let v = st.q * (1 - ALPHA) ** 2 / (ALPHA * (2 - ALPHA)) + st.R * ALPHA / (2 - ALPHA) + st.q * dt + st.R;
  h.fill(0); h[1] = dt;
  for (let k = 0; k <= n && k < MAXL; k++) {
    if (!st.on[k]) continue;
    const w = st.omega[k]; h[2 + 2 * k] = Math.cos(w * m) - Math.cos(w * m0); h[3 + 2 * k] = Math.sin(w * m) - Math.sin(w * m0);
  }
  for (let i = 1; i < D; i++) { if (!h[i]) continue; let s = 0; for (let j = 1; j < D; j++) s += P[i * D + j] * h[j]; v += h[i] * s; }
  v += noise(st, cfg).qd * dt * dt * dt / 3;
  return Math.sqrt(Math.max(0, v));
}

/**
 * Each rung's size and timing with their uncertainty: { n, period, on, A, sdA, phi (epoch clock), sdPhi (radians),
 * sdMin (its turns' timing, ± minutes) }. φ = atan2(a, b), so dφ = (b·da − a·db)/A².
 */
export function rungStats(st) {
  return st.omega.map((w, n) => {
    const i = 2 + 2 * n, a = st.x[i], b = st.x[i + 1], A = Math.hypot(a, b), P = st.P;
    const paa = P[i * D + i], pbb = P[(i + 1) * D + i + 1], pab = P[i * D + i + 1];
    const sdA = Math.sqrt(Math.max(0, A > 0 ? (a * a * paa + 2 * a * b * pab + b * b * pbb) / (A * A) : (paa + pbb) / 2));
    const sdPhi = A > 0 ? Math.sqrt(Math.max(0, (b * b * paa - 2 * a * b * pab + a * a * pbb) / (A ** 4))) : Infinity;
    return { n, period: periodOf(w), on: st.on[n], A, sdA, phi: Math.atan2(a, b), sdPhi, sdMin: sdPhi / Math.abs(w) };
  });
}

/**
 * Whether a rung is holding: its size clear of its own uncertainty (1.5σ), its timing known to within 1.6 × the
 * stiffness's share of a lap, and its turns not drifting more than twice that a lap. Measured on replays of three
 * markets on 14 Sep: on the demo and on cycles 5–8% off the ladder's periods every rung held; on a random walk
 * with no cycles L3–L6 did not. `r` is a rungStats row, `drift` filterRecord.driftOf (or null).
 * { holding, reasons: ['size' | 'timing' | 'drift'] }.
 */
export function holdingOf(r, drift, cfg) {
  const reasons = [];
  if (!(r.A >= 1.5 * r.sdA)) reasons.push('size');
  if (!(r.sdMin <= 1.6 * cfg.lap * r.period)) reasons.push('timing');
  if (drift && Math.abs(drift.perLap) > 2 * cfg.lap) reasons.push('drift');
  return { holding: r.on && !reasons.length, reasons };
}

/**
 * The state as the sim's fit (sim.js applyFit reads it): A ≥ 0, φ on the sim clock counted from `t0`, the level
 * as p0 at tRef (the state's time), the trend as drift. sim.modelAt then equals priceAt at every time.
 */
export function fitOf(st, t0) {
  const t0m = t0 / MIN, A = [], phi = [];
  for (let n = 0; n < MAXL; n++) { const a = st.x[2 + 2 * n], b = st.x[3 + 2 * n]; A.push(Math.hypot(a, b)); phi.push(wrapPi(Math.atan2(a, b) + st.omega[n] * t0m)); }
  return { kind: 'filter', A, phi, drift: st.x[1], tRef: (st.t - t0) / MIN, p0: st.x[0], off: new Array(MAXL).fill(0), level: { p0: st.x[0], c: 0 }, passes: 0, count: st.closes, q: st.q, R: st.R };
}

/** A state as plain JSON for the relay; fromJSON checks every field back and returns null for anything else. */
export function toJSON(st) {
  const f = v => (Number.isFinite(v) ? v : null);
  return { v: st.v, omega: st.omega, on: st.on, t: st.t, x: Array.from(st.x), P: Array.from(st.P), q: st.q, q0: st.q0, R: st.R, yPrev: f(st.yPrev), tPrev: f(st.tPrev), seededAt: st.seededAt, closes: st.closes };
}
export function fromJSON(o, omega = null) {
  const fin = v => typeof v === 'number' && Number.isFinite(v);
  if (!o || o.v !== FILTER_V || !Array.isArray(o.omega) || o.omega.length !== MAXL || !o.omega.every(v => fin(v) && v !== 0)) return null;
  if (omega && o.omega.some((w, n) => Math.abs(w - omega[n]) > 1e-12 * Math.abs(w))) return null;   // another ladder's periods
  if (!Array.isArray(o.x) || o.x.length !== D || !o.x.every(fin) || !Array.isArray(o.P) || o.P.length !== D * D || !o.P.every(fin)) return null;
  if (![o.t, o.q, o.q0, o.R, o.seededAt].every(fin) || !(o.q > 0) || !(o.q0 > 0) || !(o.R >= 0)) return null;
  const on = Array.isArray(o.on) && o.on.length === MAXL ? o.on.map(Boolean) : new Array(MAXL).fill(true);
  return {
    v: FILTER_V, omega: o.omega.slice(), on, t: o.t, x: Float64Array.from(o.x), P: Float64Array.from(o.P), q: o.q, q0: o.q0, R: o.R,
    yPrev: fin(o.yPrev) ? o.yPrev : NaN, tPrev: fin(o.tPrev) ? o.tPrev : NaN, seededAt: o.seededAt, closes: Number.isInteger(o.closes) ? o.closes : 0,
  };
}

// ---------------------------------------------------------------- words, for the cards, the chips and Fit
const dur = m => (m < 1 ? `${Math.round(m * 60)}s` : m < 10 ? `${m.toFixed(1)}m` : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`);
/** A rung's timing confidence: "±6.3m". */
export const timingText = r => (r && Number.isFinite(r.sdMin) ? `±${dur(r.sdMin)}` : '±—');
/** How fast its turns are drifting: "+2.1m/h" later, "−40s/h" earlier; "—" before there is an hour of record to tell. */
export const driftText = d => (d && Number.isFinite(d.perHour) ? `${d.perHour >= 0 ? '+' : '−'}${dur(Math.abs(d.perHour))}/h` : '—');
/** The stiffness as a share of a lap: "1/16". */
export const lapText = lap => `1/${Math.round(1 / lap)}`;
/** Why a rung is or is not holding, in a sentence. `info`: rungStats row + { drift, holding, reasons }. */
export function holdText(info, cfg) {
  if (!info) return '';
  const lap = info.period, words = {
    size: `its size (±${info.A.toFixed(1)}) is not clear of its own uncertainty (±${info.sdA.toFixed(1)})`,
    timing: `its timing is uncertain by ${timingText(info)}, more than ${dur(1.6 * cfg.lap * lap)}`,
    drift: `its turns are drifting ${driftText(info.drift)}, more than ${lapText(cfg.lap / 2)} of a lap a lap`,
  };
  const facts = `size ±${info.A.toFixed(1)} (±${info.sdA.toFixed(1)}), timing ${timingText(info)}, drift ${driftText(info.drift)}`;
  return info.holding ? `Holding: ${facts}.` : `Not holding: ${info.reasons.map(r => words[r]).join('; ')}.`;
}

// ---------------------------------------------------------------- the filter on a sim
/** The sim's closed minutes whose close is stamped in (fromMs, toMs]: { t (epoch ms), p }, ascending. The minute still forming is never one. */
export function closesOf(sim, fromMs, toMs) {
  const t0 = sim.live.t0, base = sim.tick0 / TPM, M = sim.minutes(), has = sim.MIN.has, c = sim.MIN.c, out = [];
  const nowEnd = Math.floor(sim.simMin) + 1;   // the minute in progress ends here: it is not closed
  for (let m = Math.max(0, Math.floor((fromMs - t0) / MIN - base) - 1); m < M; m++) {
    const end = t0 + (base + m + 1) * MIN;
    if (end > toMs || base + m + 1 >= nowEnd) break;
    if (end > fromMs && has[m]) out.push({ t: end, p: c[m] });
  }
  return out;
}

/** Minutes of (fromMs, toMs] the market was open, counted a minute at a time (only asked across a gap). */
export function openMinutes(fromMs, toMs) {
  const n = Math.round((toMs - fromMs) / MIN);
  if (n <= 1) return Math.max(0, n);
  let open = 0;
  for (let k = 1; k <= n; k++) if (globexOpen(fromMs + (k - 1) * MIN)) open++;
  return Math.max(1, open);   // the close itself was traded
}

/**
 * The walk's variance q a minute and the closes' own noise R, from the seed day's closes before `atMs` less the
 * batch fit's cycles and trend: of one-minute changes d, q + 2R is their variance and −R their lag-one covariance.
 */
export function seedNoise(sim, atMs) {
  const cl = closesOf(sim, atMs - WARM_MIN * MIN, atMs), t0 = sim.live.t0;
  const r = cl.map(c => c.p - sim.modelAt((c.t - t0) / MIN, MAXL - 1));
  const d = new Float64Array(cl.length), ok = new Uint8Array(cl.length);
  let s = 0, k = 0;
  for (let i = 1; i < cl.length; i++) if (cl[i].t - cl[i - 1].t === MIN) { d[i] = r[i] - r[i - 1]; ok[i] = 1; s += d[i]; k++; }
  if (k < 60) return { q: 1, R: 0.01 };
  const mu = s / k;
  let g0 = 0, g1 = 0, k1 = 0;
  for (let i = 1; i < cl.length; i++) { if (!ok[i]) continue; g0 += (d[i] - mu) ** 2; if (ok[i - 1]) { g1 += (d[i] - mu) * (d[i - 1] - mu); k1++; } }
  g0 /= k; g1 = k1 ? g1 / k1 : 0;
  const R = Math.max(g0 * 1e-4, -g1), q = Math.max(g0 * 1e-3, g0 - 2 * R);
  return { q, R };
}

/**
 * Run a state over the sim's closes in (st.t, toMs], one at a time. `onRow(st, close)` is called after each, for
 * the record. Returns how many were read.
 */
export function runOver(sim, st, toMs, cfg, onRow = null) {
  let read = 0;
  for (const c of closesOf(sim, st.t, toMs)) {
    step(st, c.t, c.p, cfg, openMinutes(st.t, c.t));
    read++;
    if (onRow) onRow(st, c);
  }
  return read;
}

/**
 * Seed a filter on `sim` as of the minute ending `seedMs` and run it up to `toMs`: the sim is given `bars` (ascending
 * one-minute bars, none past toMs) in two parts, the batch fit (sim.refit, as the app always fitted) is made on the
 * part up to the seed, and the filter reads the rest one close at a time. The sim is left live on every bar, with
 * the filter's fit applied. Returns { st, seedFit } or null when no fit could be made.
 * `live` is sim.startLive's argument; `L` the rung the pen rides.
 */
export function seedAndRun(sim, { live, L, bars, seedMs, toMs, cfg, onRow = null }) {
  sim.startLive(live);
  sim.setLevels(L);
  let i = 0; while (i < bars.length && bars[i].t + MIN <= seedMs) i++;
  sim.ingestBars(bars.slice(0, i));
  sim.advanceLiveTo(seedMs);
  const seedFit = sim.n ? sim.refit() : null;
  if (!seedFit) return null;
  const on = Array.from({ length: MAXL }, (_, n) => sim.resolvable(n)), before = closesOf(sim, seedMs - WARM_MIN * MIN, seedMs);
  const st = seedFilter({ fit: seedFit, omega: sim.G.omega, t0: live.t0, atMs: seedMs, noise: seedNoise(sim, seedMs), last: before[before.length - 1] || null, on, cfg });
  const oos = seedFit.oos || null;
  if (i < bars.length) sim.ingestBars(bars.slice(i));
  sim.advanceLiveTo(toMs);
  runOver(sim, st, toMs, cfg, onRow);
  applyFilter(sim, st, oos);
  return { st, seedFit };
}

/**
 * Put the state on the sim: its fit (fitOf) in place of the refit's, with `oos` — the score, [{ rms, explained,
 * explainedRaw, n }] per rung the pen could ride — and the state itself on sim.live.filter.
 */
export function applyFilter(sim, st, oos) {
  const fit = fitOf(st, sim.live.t0);
  fit.oos = oos || (sim.live.fit && sim.live.fit.oos) || null;
  sim.setFit(fit);
  sim.live.filter = st;
  return fit;
}
