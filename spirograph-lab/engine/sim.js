// The market simulation: the fractal spirograph generator, the tick history it
// writes, and the candles aggregated from that history. No DOM access, so the
// same code runs in the browser and in Node for the tests.
//
// Two modes share the same buffers and renderers:
//   synthetic  the spirograph generates the price (the pen IS the market)
//   live       a real instrument's price arrives from outside; the circles are
//              fitted to its recent history and the pen is the fitted model
import { TAU, TPM, DT, T1, MAXL, MAX_TICKS as MAX_CAP, P0, AMP1, TFS, DEFAULTS, MIN_PERIOD, FIT_STAT_MIN, FIT_LAPS, CYCLE_PACK, livePeriod } from './constants.js';
import { rngFactory, gauss } from './rng.js';
import { fitCycles, impliedRatio } from './fit.js';
import { ANCHOR_KINDS, intervalAt, anchorBarAt, yearOpeningRange, cycleOriginMin } from './anchors.js';
import { nyParts, nyEpoch } from './levels.js';

const DEFAULT_LIVE_WEEKS = 4;   // the desk's default window; short of FIT_LAPS laps of the slowest rung, which is reported

const GRAIN = 2 * TPM * 1440;   // shiftHistory halves the buffer, so a capacity is an even number of days

export function createSim(init = {}) {
  // How much history this sim keeps. The default is the full twelve weeks; a
  // derived instrument (the spread) only ever needs its fit window, and at ~24 MB
  // of buffers per sim at the default that difference is worth having.
  const MAX_TICKS = Math.max(GRAIN, Math.round((init.maxTicks || MAX_CAP) / GRAIN) * GRAIN);
  const MAX_MIN = MAX_TICKS / TPM;
  // Live periods in minutes, slowest first, in place of the 24-minute ladder: the Spirograph's Daily set (dailySet.js)
  const PERIODS = Array.isArray(init.periods) && init.periods.length === MAXL ? init.periods.slice() : null;
  // A day clock (epoch ms → minutes with every 6 pm New York a multiple of 1440: dayClock.js) the circles turn on in place
  // of wall time, each LOCKED to start at 6 pm, so the fit sets only a rung's signed size. The Daily set's; its periods divide a day.
  const CLOCK = typeof init.clock === 'function' ? init.clock : null;
  // The trend's clock (epoch ms → minutes), when it is not the circles' own: the Daily set's counts Globex's traded minutes
  // only (dayClock.js tradeMin), so the fitted trend stands still over the weekend and the break. driftOf reads it.
  const DCLOCK = typeof init.driftClock === 'function' ? init.driftClock : null;
  const MODEL_TAIL = Math.min(T1 * TPM, MAX_TICKS);   // ticks a refit rewrites at once: the week the spirograph draws
  // per-level partial sums (centre of circle n+1 = pen when L = n+1)
  const PSX = [], PSY = [];
  for (let n = 0; n < MAXL; n++) { PSX.push(new Float32Array(MAX_TICKS)); PSY.push(new Float32Array(MAX_TICKS)); }
  // live mode: the real price per tick, and true 1-minute bars the candles are built from
  const MKT = new Float32Array(MAX_TICKS);
  const MIN = { o: new Float32Array(MAX_MIN), h: new Float32Array(MAX_MIN), l: new Float32Array(MAX_MIN), c: new Float32Array(MAX_MIN), has: new Uint8Array(MAX_MIN) };   // has = 1 when the market traded that minute
  // generator
  const G = { R: [], omega: [], kmul: [], amul: [], th: new Float64Array(MAXL), m: new Float64Array(MAXL), sig: new Float64Array(MAXL), ou: new Float64Array(MAXL), rng: null, scale: 1,
    lever: new Float64Array(MAXL), phi: new Float64Array(MAXL), off: new Float64Array(MAXL), drift: 0, tRef: 0, lockPhi: [] };   // live geometry, in lever units
  // candles per timeframe
  const CAND = TFS.map(tf => { const cap = Math.ceil(MAX_TICKS / (tf * TPM)) + 4; return { tf, cap, o: new Float32Array(cap), h: new Float32Array(cap), l: new Float32Array(cap), c: new Float32Array(cap), t: new Float64Array(cap), n: 0, lastKey: -1 }; });
  const byTf = new Map(CAND.map(cd => [cd.tf, cd]));
  let modelFrom = 0;   // live: the lowest tick whose model levels hold the current fit

  const sim = {
    ratio: DEFAULTS.ratio, k: DEFAULTS.k, alt: DEFAULTS.alt, noise: DEFAULTS.noise, seed: DEFAULTS.seed,
    L: DEFAULTS.L,
    simMin: 0,           // simulated minutes the clock has been asked for
    n: 0, tick0: 0,      // ticks held in the buffers, and the absolute index of the first one
    mode: 'synthetic', live: null, maxTicks: MAX_TICKS,
    PSX, PSY, MKT, MIN, G, CAND,
    setup, regenerate, genTicks, advance, seek, setLevels, reset, rebuildCandles,
    periodOf, cycleAngle, cycleFrac, cycleLapStart, levelSign, turnAngle, dcAt, priceAt, levelPrice, marketAt, marketOpen, candles, ticks, elapsedMin, fractalDim, hurst, symmetry, chainNow, params,
    resolvable, resolvedLevels, fitLaps, determined, explainOver,
    p0, baseRadius, levelAmp, impliedSizeRatio, penNow, penPhase, marketNow, fineLevel, modelAt, modelLevels,
    startLive, stopLive, clockOf, driftOf, ingestBars, ingestQuote, advanceLiveTo, refit, minutes, ensureModel, setFit,
  };
  for (const key of ['ratio', 'k', 'alt', 'noise', 'seed']) if (init[key] !== undefined) sim[key] = init[key];

  // ---------------------------------------------------------------- generator
  function setup() {
    const r = rngFactory((sim.seed * 2654435761) >>> 0 || 1);
    G.rng = r;
    G.R = [1]; for (let n = 1; n <= MAXL; n++) G.R.push(G.R[n - 1] / sim.ratio);
    G.kmul = []; G.amul = [];
    for (let n = 0; n < MAXL; n++) { const u1 = r() * 2 - 1, u2 = r() * 2 - 1; G.kmul.push(1 + sim.noise * 0.25 * u1); G.amul.push(1 + sim.noise * 0.3 * u2); }
    G.omega = []; let w = TAU / T1;
    for (let n = 0; n < MAXL; n++) { if (n > 0) w = w * sim.k * G.kmul[n] * (sim.alt ? -1 : 1); G.omega.push(w); }
    for (let n = 0; n < MAXL; n++) {
      const P = TAU / Math.abs(G.omega[n]); const Nn = P * TPM;
      G.sig[n] = Math.min(0.6, sim.noise * (Math.PI / 2) / Math.sqrt(Nn));
      G.ou[n] = Math.min(0.15, DT / P);
      G.th[n] = Math.PI / 2; G.m[n] = 1;
    }
    G.scale = AMP1 / (G.R[0] + G.R[1]);
    if (sim.mode === 'live') setupLive();
  }
  function periodOf(n) { return TAU / Math.abs(G.omega[n]); }
  /**
   * Angle of level n at sim-minute `tMin`, clockwise. Live: θ = ω·t + φ with φ the FITTED phase, so
   * when a rung turns comes from the market. It used to be pinned to the history window's first 9:29
   * (G.lockPhi), which made L1–L3's turns move with the History setting and leaked what a rung could
   * not represent into the rungs below. Before the first fit, φ is that 9:29 grid (applyFit(null)).
   */
  function cycleAngle(n, tMin) {
    const t = tMin ?? sim.simMin;
    if (sim.mode === 'live' && n < G.lockPhi.length) return G.phi[n] + G.omega[n] * clockOf(t);
    const wsign = Math.sign(G.omega[n]) || 1, P = periodOf(n);
    return wsign * TAU * (t % P) / P;
  }
  /** Live: sim-minute `t` on the model's clock - wall time, or the day clock counted from the 6 pm before t0. */
  function clockOf(t) { return CLOCK && sim.live ? CLOCK(sim.live.t0 + t * 60000) - sim.live.clockBase : t; }
  /** Minute `t` on the trend's clock: clockOf unless a driftClock was given. G.tRef and every drift term are on it. */
  function driftOf(t) { return DCLOCK && sim.live ? DCLOCK(sim.live.t0 + t * 60000) - sim.live.driftBase : clockOf(t); }
  function cycleFrac(n, tMin) {
    const wsign = Math.sign(G.omega[n]) || 1, th = cycleAngle(n, tMin);
    let f = ((wsign * th) % TAU + TAU) % TAU / TAU;
    if (f > 1 - 1e-10) f = 0;   // a wrap lands on 1 − ε, which is the start of the next lap
    return f;
  }
  /** −1 when live level n was fitted falling first (a negative lever), else 1. */
  function levelSign(n) { return sim.mode === 'live' && G.lever[n] < 0 ? -1 : 1; }
  /**
   * Level n's angle in PRICE terms: the peak at π/2 and the trough at 3π/2. The clock (cycleAngle)
   * starts every live lap at 9:29; a level with a negative lever falls first, so its peak is half a
   * lap round from the clock's quarter. Whatever names a peak or a trough reads this; lap progress
   * (cycleFrac) reads the clock.
   */
  function turnAngle(n, tMin) { const th = cycleAngle(n, tMin); return levelSign(n) < 0 ? th + Math.PI : th; }
  /** Sim-minute where the current lap of level n began (9:29-aligned live; `t % P` synthetic). */
  function cycleLapStart(n, tMin) {
    const t = tMin ?? sim.simMin, P = periodOf(n);
    return t - cycleFrac(n, t) * P;
  }
  /**
   * Whether level n's cycle is long enough to be told apart from its aliases in one-minute
   * data. Below two bars a period is not measurable at all, so such a level is never fitted:
   * it is held at zero and reported as unresolved rather than carrying an alias as an amplitude.
   */
  function resolvable(n) { return sim.mode !== 'live' || periodOf(n) >= MIN_PERIOD; }
  /**
   * Laps of its own cycle level n's fit window actually covers. refit asks for FIT_LAPS of them but
   * cannot invent history, so a slow level on a short window silently gets fewer - and this reports
   * how many. The mirror of `resolvable`: that one guards cycles too FAST for one-minute bars, this
   * one cycles too SLOW for the history kept.
   */
  function fitLaps(n) {
    if (sim.mode !== 'live') return FIT_LAPS;
    const P = periodOf(n); if (!(P > 0)) return 0;
    return Math.min(sim.n / TPM, Math.max(30, FIT_LAPS * P)) / P;
  }
  /**
   * Whether level n's window covers the laps the fit asks for. Under-determined levels are still
   * fitted - the amplitude is reported, not hidden - but it leans on the trend rather than the
   * cycle, so everything that shows the number says the window was short.
   */
  function determined(n) { return sim.mode !== 'live' || fitLaps(n) >= FIT_LAPS - 1e-9; }
  /** How many of the MAXL levels the data can actually resolve (the rest sit at zero). */
  function resolvedLevels() { let c = 0; for (let n = 0; n < MAXL; n++) if (resolvable(n)) c++; return c; }
  function p0() { return sim.mode === 'live' ? sim.live.p0 : P0; }
  function priceAt(i) { return p0() + G.scale * PSY[sim.L - 1][i]; }
  function levelPrice(n, i) { return p0() + G.scale * PSY[n][i]; }
  /** The price the candles are built from: the real market when live, the pen otherwise. */
  function marketAt(i) { return sim.mode === 'live' ? MKT[i] : priceAt(i); }
  /** Live: whether the market traded during tick i's minute (closed minutes hold the last price but get no candle). */
  function marketOpen(i) { return sim.mode !== 'live' || MIN.has[Math.floor((sim.tick0 + i) / TPM) - sim.tick0 / TPM] === 1; }
  function candles(tf) { return byTf.get(tf); }
  function ticks() { return sim.tick0 + sim.n; }
  function minutes() { return Math.ceil(sim.n / TPM); }
  function elapsedMin() { return ticks() / TPM; }
  function params() { return { ratio: sim.ratio, k: sim.k, alt: sim.alt, noise: sim.noise, seed: sim.seed }; }
  function impliedSizeRatio() { return sim.mode === 'live' && sim.live.fit ? impliedRatio(sim.live.fit.A) : sim.ratio; }
  function fractalDim() {
    const r = impliedSizeRatio(); if (!Number.isFinite(r)) return NaN;
    return r < sim.k ? Math.min(2, 2 - Math.log(Math.max(1, r)) / Math.log(sim.k)) : 1;
  }
  function hurst() { return 2 - fractalDim(); }
  function symmetry() { return sim.alt ? sim.k + 1 : sim.k - 1; }
  /**
   * The pen's price at the clock's exact time (between ticks): the fitted sum through the rung the pen
   * rides, L. It used to be all six whatever L was, so "rides L4" sat beside a price that was L1–L6.
   */
  function penNow(tMin) {
    if (sim.mode === 'live') return modelAt(tMin ?? sim.simMin, sim.L - 1);
    const c = chainNow(tMin); return p0() + G.scale * c[c.length - 1].y;
  }
  /**
   * Live: the fitted model's price at minute `tMin` (minutes since t0) through level n, evaluated
   * from the closed form, so it can be read past the last tick. The one implementation the chart's
   * continuation and the fire both use, so the two can never disagree about where the model is.
   */
  function modelAt(tMin, n = MAXL - 1) {
    let y = G.drift * (driftOf(tMin) - G.tRef) / G.scale;
    for (let k = 0; k <= n; k++) y += G.off[k] + G.lever[k] * Math.sin(cycleAngle(k, tMin));
    return p0() + G.scale * y;
  }
  /**
   * modelAt for every level at once: out[0] is the base (no cycle), out[n + 1] the price through
   * level n. The same closed form in one pass instead of one per level, so the chart can reduce the
   * continuation to pixel columns without the hover (modelAt) and the drawing ever disagreeing.
   */
  function modelLevels(tMin, out) {
    const base = p0(), S = G.scale;
    let y = G.drift * (driftOf(tMin) - G.tRef) / S;
    out[0] = base + S * y;
    for (let k = 0; k < MAXL && k + 1 < out.length; k++) {
      y += G.off[k] + G.lever[k] * Math.sin(cycleAngle(k, tMin));
      out[k + 1] = base + S * y;
    }
    return out;
  }
  /** The pen level's angle at the clock's exact time (0 … 2π, peak at π/2 - turnAngle, so a falling-first level too) and the sign of its turning. */
  function penPhase(tMin) {
    const n = sim.L - 1, raw = sim.mode === 'live' ? turnAngle(n, tMin) : G.th[n];
    return { th: ((raw % TAU) + TAU) % TAU, dir: G.omega[n] >= 0 ? 1 : -1 };
  }
  /** The market's latest price: the last quote when live, the pen otherwise. */
  function marketNow() {
    if (sim.mode !== 'live') return sim.n ? priceAt(sim.n - 1) : P0;
    return sim.live.quoteAt ? sim.live.quote : sim.n ? MKT[sim.n - 1] : sim.live.p0;
  }
  /** The first level quick enough to refit every second (period of an hour or less); MAXL when there is none. */
  function fineLevel() { for (let n = 0; n < MAXL; n++) if (periodOf(n) <= 60) return n; return MAXL; }
  /** Radius of the synthetic construction's fixed circle in lever units. Live draws no stator: a sum of fitted cycles has no fixed circle. */
  function baseRadius() { return G.R[0]; }
  /** Peak-to-centre amplitude of level n in price points: a size, so never negative (levelSign carries the direction). */
  function levelAmp(n) { return sim.mode === 'live' ? Math.abs(G.lever[n]) * G.scale : (G.R[n] + G.R[n + 1]) * G.scale; }

  // ---------------------------------------------------------------- candles
  function resetCandles() { for (const cd of CAND) { cd.n = 0; cd.lastKey = -1; } }
  function updateCandlesTick(i) {
    const p = priceAt(i); const abs = sim.tick0 + i;
    for (const cd of CAND) {
      const key = Math.floor(abs / (cd.tf * TPM));
      if (key !== cd.lastKey) {
        if (cd.n >= cd.cap) { cd.n = 0; }              // cannot happen after shiftHistory; guard only
        const j = cd.n++; cd.o[j] = cd.h[j] = cd.l[j] = cd.c[j] = p; cd.t[j] = key * cd.tf; cd.lastKey = key;
      } else { const j = cd.n - 1; if (p > cd.h[j]) cd.h[j] = p; if (p < cd.l[j]) cd.l[j] = p; cd.c[j] = p; }
    }
  }
  /** Live: fold minute bar m into every timeframe. Safe to repeat for the minute in progress. Closed minutes are skipped. */
  function mergeMinute(m) {
    if (!MIN.has[m]) return;
    const absMin = sim.tick0 / TPM + m;
    for (const cd of CAND) {
      const key = Math.floor(absMin / cd.tf);
      if (key !== cd.lastKey) {
        if (cd.n >= cd.cap) { cd.n = 0; }
        const j = cd.n++; cd.o[j] = MIN.o[m]; cd.h[j] = MIN.h[m]; cd.l[j] = MIN.l[m]; cd.c[j] = MIN.c[m]; cd.t[j] = key * cd.tf; cd.lastKey = key;
      } else { const j = cd.n - 1; if (MIN.h[m] > cd.h[j]) cd.h[j] = MIN.h[m]; if (MIN.l[m] < cd.l[j]) cd.l[j] = MIN.l[m]; cd.c[j] = MIN.c[m]; }
    }
  }
  function rebuildCandles() {
    resetCandles();
    if (sim.mode === 'live') { const M = minutes(); for (let m = 0; m < M; m++) mergeMinute(m); }
    else for (let i = 0; i < sim.n; i++) updateCandlesTick(i);
  }

  // ---------------------------------------------------------------- history
  function shiftHistory() {
    const half = MAX_TICKS >> 1;
    for (let n = 0; n < MAXL; n++) { PSX[n].copyWithin(0, half); PSY[n].copyWithin(0, half); }
    if (sim.mode === 'live') { MKT.copyWithin(0, half); const hm = half / TPM; for (const k of ['o', 'h', 'l', 'c', 'has']) MIN[k].copyWithin(0, hm); }
    sim.n -= half; sim.tick0 += half; modelFrom = Math.max(0, modelFrom - half); rebuildCandles();
  }
  function genTicks(count) {
    const r = G.rng;
    while (count > 0) {
      if (sim.n >= MAX_TICKS) shiftHistory();
      const take = Math.min(count, MAX_TICKS - sim.n); count -= take;
      for (let c = 0; c < take; c++) {
        const i = sim.n; let sx = 0, sy = 0;
        for (let n = 0; n < MAXL; n++) {
          let th = G.th[n] + G.omega[n] * DT; if (G.sig[n] > 0) th += G.sig[n] * gauss(r);
          th = th % TAU; if (th < 0) th += TAU; G.th[n] = th;
          let m = G.m[n];
          if (sim.noise > 0) { const st = G.ou[n]; m += (1 - m) * st + sim.noise * 0.9 * gauss(r) * Math.sqrt(st); if (m < 0.3) m = 0.3; else if (m > 1.9) m = 1.9; G.m[n] = m; }
          const lever = G.R[n] + G.R[n + 1] * m * G.amul[n];
          sx += lever * Math.cos(th); sy += lever * Math.sin(th);
          PSX[n][i] = sx; PSY[n][i] = sy;
        }
        sim.n++; updateCandlesTick(i);
      }
    }
  }
  /** Rebuild the whole history with the current parameters, keeping the elapsed time. */
  function regenerate() {
    if (sim.mode === 'live') { setup(); refit(); return; }
    const A = sim.tick0 + sim.n;
    setup(); sim.n = 0; sim.tick0 = 0; resetCandles();
    if (A > 0) genTicks(A);
  }
  /** Change the number of levels the pen rides. Returns 1 if it grew, -1 if it shrank, 0 if unchanged. */
  function setLevels(v) {
    v = Math.max(1, Math.min(MAXL, v)); if (v === sim.L) return 0;
    const grew = v > sim.L; sim.L = v; if (sim.mode !== 'live') rebuildCandles();
    if (sim.mode === 'live' && sim.live && sim.live.fit) scoreInto(sim.live.fit);   // the pen follows L, and so does its score
    return grew ? 1 : -1;
  }
  /** Move the clock forward by `minutes` and generate the ticks that fall due. Returns how many were generated. */
  function advance(minutes, maxTicks = Infinity) {
    if (sim.mode === 'live') return 0;
    sim.simMin += minutes;
    let need = Math.floor(sim.simMin * TPM) - ticks();
    if (need > maxTicks) { need = maxTicks; sim.simMin = (ticks() + need) / TPM; }
    if (need > 0) genTicks(need);
    return need > 0 ? need : 0;
  }
  /** Jump to an absolute tick count (used when a shared link carries a time). */
  function seek(tickCount) {
    if (sim.mode === 'live') return;
    tickCount = Math.max(0, Math.round(tickCount));
    if (tickCount < ticks()) { setup(); sim.n = 0; sim.tick0 = 0; resetCandles(); }
    sim.simMin = tickCount / TPM;
    const need = tickCount - ticks(); if (need > 0) genTicks(need);
  }
  function reset() { if (sim.mode === 'live') stopLive(); sim.simMin = 0; sim.n = 0; sim.tick0 = 0; sim.L = 1; setup(); resetCandles(); }
  /**
   * Every circle up to the pen at `tMin` (default: now; live only for a past time), in lever units:
   * the tip of that level's arm (x, y), the centre of the circle drawn for it (cx, cy) and its radius.
   *
   * Synthetic: each circle ROLLS on the one before it - the first on a stator of radius G.R[0] at the
   * origin - and sits on its own arm's tip.
   *
   * Live: the FITTED cycles at their fitted size. Circle n is centred on the tip of arm n − 1 (L1 on
   * the origin), its radius is |lever n| (the level's ±pts over G.scale), and its arm turns on the 9:29
   * clock, pointing the other way when the fit came back negative. So the pen's height is the sum of
   * the cycles, and with dcAt it is the model price exactly - which the sheet's "+gap" is measured
   * against. It used to be the rolling stack at the synthetic 1:3 sizes: the circles did not match the
   * ±pts beside them and the pen's height was not price. Tangent rolling circles cannot carry fitted
   * sizes (a silent level between two swinging ones has no radius to roll on), so live draws the
   * cycles as epicycles and no stator. The DC leftover (off, drift) stays out of the chain, so the
   * figure does not jump when a refit moves an intercept.
   */
  function chainNow(tMin) {
    const pts = []; let x = 0, y = 0;
    const live = sim.mode === 'live', t = tMin ?? sim.simMin;
    for (let n = 0; n < sim.L; n++) {
      if (live) {
        const th = cycleAngle(n, t), l = G.lever[n], cx = x, cy = y;
        x += l * Math.cos(th); y += l * Math.sin(th);
        pts.push({ x, y, rad: Math.abs(l), cx, cy });
        continue;
      }
      const th = G.th[n], rad = G.R[n + 1] * G.m[n] * G.amul[n], lever = G.R[n] + rad;
      x += lever * Math.cos(th); y += lever * Math.sin(th);
      pts.push({ x, y, rad, cx: x, cy: y });
    }
    return pts;
  }
  /**
   * Live: what the model price holds besides its cycles at `tMin`, through level n, in lever units - the
   * trend and the finer levels' intercepts. modelAt(t, n) = p0 + scale · (dcAt(t, n) + chainNow(t)[n].y),
   * and PSY[n][i] less dcAt is the chain's own height at tick i. 0 synthetic.
   */
  function dcAt(tMin, n = MAXL - 1) {
    if (sim.mode !== 'live') return 0;
    let d = G.drift * (driftOf(tMin ?? sim.simMin) - G.tRef) / G.scale;
    for (let k = 0; k <= n && k < MAXL; k++) d += G.off[k];
    return d;
  }

  // ---------------------------------------------------------------- live mode
  /**
   * The fitted ladder. Every cycle turns CLOCKWISE (omega negative: the sheet draws y upward, so a
   * negative rate sweeps clockwise on screen), which is the convention a clock face sets and the one
   * these circles are read as.
   *
   * Live periods are 24 one-minute candles packed by `k` (default 5, so five laps = 2 hours),
   * clocked from 9:29 NY — not a calendar week divided by k. The direction is still a DRAWING
   * CHOICE, not a measurement: fitCycles solves a cos/sin pair at each frequency, and
   * {cos(wt), sin(wt)} spans the same functions as {cos(-wt), sin(-wt)}.
   */
  function applyLiveLadder() {
    const pack = sim.k || CYCLE_PACK;
    G.omega = [];
    for (let n = 0; n < MAXL; n++) G.omega.push(-TAU / (PERIODS ? PERIODS[n] : livePeriod(n, MAXL, pack)));
    const tOrig = sim.live && sim.live.t0 != null ? cycleOriginMin(sim.live.t0) : 0;
    G.lockPhi = [];
    for (let n = 0; n < MAXL; n++) {
      G.lockPhi.push(CLOCK ? 0 : -G.omega[n] * tOrig);   // on the day clock every rung starts at 6 pm
      G.phi[n] = G.lockPhi[n];
    }
  }
  function ohlcWindow(startMs, endMs) {
    let o, h = -Infinity, l = Infinity, c, t;
    for (const b of sim.live.extraBars || []) {
      if (b.t < startMs || b.t >= endMs) continue;
      if (o === undefined) { o = b.o; t = b.t; } if (b.h > h) h = b.h; if (b.l < l) l = b.l; c = b.c;
    }
    const t0 = sim.live.t0, base = sim.tick0 / TPM, M = minutes();
    const m0 = Math.floor((startMs - t0) / 60000) - base, m1 = Math.floor((endMs - t0) / 60000) - base;
    for (let m = Math.max(0, m0); m < Math.min(M, m1); m++) {
      if (!MIN.has[m]) continue;
      const ts = t0 + (base + m) * 60000;
      if (o === undefined) { o = MIN.o[m]; t = ts; } if (MIN.h[m] > h) h = MIN.h[m]; if (MIN.l[m] < l) l = MIN.l[m]; c = MIN.c[m];
    }
    return o === undefined ? null : { o, h, l, c, t };
  }
  function yearBar(year) {
    const extra = sim.live.extraBars || [];
    let r = yearOpeningRange(extra, year);
    if (r) return r;
    const t0 = sim.live.t0, base = sim.tick0 / TPM, M = minutes();
    const y0 = nyEpoch(year, 1, 1, 0, 0), y1 = nyEpoch(year, 2, 1, 0, 0);
    const m0 = Math.max(0, Math.floor((y0 - t0) / 60000) - base), m1 = Math.min(M, Math.floor((y1 - t0) / 60000) - base);
    const jan = [];
    for (let m = m0; m < m1; m++) if (MIN.has[m]) jan.push({ t: t0 + (base + m) * 60000, o: MIN.o[m], h: MIN.h[m], l: MIN.l[m], c: MIN.c[m] });
    return yearOpeningRange(jan, year);
  }
  function refreshAnchors(nowMs) {
    const out = {};
    const read = (startMs, tf) => ohlcWindow(startMs, startMs + tf * 60000);
    for (const kind of ANCHOR_KINDS) {
      if (kind === 'year') { const iv = intervalAt(kind, nowMs); out[kind] = { ...iv, bar: yearBar(nyParts(iv.startMs).y), barTf: iv.barTf }; continue; }
      out[kind] = anchorBarAt(kind, nowMs, read);
    }
    sim.live.anchors = out;
  }
  /** Period ladder: 24-minute unit packed by k (five → 2 hours), clocked from 9:29 NY. Amplitudes and phases come from the fit. */
  function setupLive() {
    applyLiveLadder();
    for (let n = 0; n < MAXL; n++) { G.kmul[n] = 1; G.amul[n] = 1; G.sig[n] = 0; G.m[n] = 1; }
    applyFit(sim.live.fit);
  }
  /**
   * Turn fitted amplitudes (points) into lever lengths (units) so the whole chain fills the same reach as a
   * synthetic construction. Levers are SIGNED like the fit's A: a negative one is a cycle that falls first.
   */
  function applyFit(fit, keepScale = false) {
    let reach = 0; for (let n = 0; n < MAXL; n++) reach += G.R[n] + G.R[n + 1];
    let sumA = 0; if (fit) for (const a of fit.A) sumA += Math.abs(a);
    if (!keepScale) G.scale = sumA > 0 ? sumA / reach : AMP1 / (G.R[0] + G.R[1]);   // a partial refit keeps the scale so the coarser levels' sums stay valid
    for (let n = 0; n < MAXL; n++) {
      G.lever[n] = fit ? fit.A[n] / G.scale : 0;
      G.phi[n] = fit ? fit.phi[n] : (G.lockPhi[n] ?? 0);
      G.off[n] = fit && n ? fit.off[n] / G.scale : 0;
    }
    G.drift = fit ? fit.drift : 0; G.tRef = fit ? fit.tRef : 0;
    sim.live.p0 = fit ? fit.p0 : sim.live.p0;
  }
  /** Write the model's partial sums for tick i (live only), from level `from` up when the coarser ones already hold. */
  function modelInto(i, from = 0) {
    const t = (sim.tick0 + i) / TPM; let sx = 0, sy = G.drift * (driftOf(t) - G.tRef) / G.scale;
    if (from > 0) { sx = PSX[from - 1][i]; sy = PSY[from - 1][i]; }   // the coarser levels are unchanged
    for (let n = from; n < MAXL; n++) { const th = cycleAngle(n, t); sx += G.lever[n] * Math.cos(th); sy += G.off[n] + G.lever[n] * Math.sin(th); PSX[n][i] = sx; PSY[n][i] = sy; }
  }
  /**
   * Ticks below `modelFrom` do not hold the current fit: a refit rewrites only
   * the tail it can be seen through, and `ensureModel` catches the rest up when
   * a chart pans back far enough to read it.
   */
  function ensureModel(i0) {
    if (sim.mode !== 'live') return;
    i0 = Math.max(0, Math.floor(i0)); if (i0 >= modelFrom) return;
    for (let i = i0; i < modelFrom; i++) modelInto(i, 0);
    modelFrom = i0;
  }
  /** Extend the buffers so that tick `abs` exists, holding the last price through any gap. */
  function ensureTicks(abs) {
    while (ticks() <= abs) {
      if (sim.n >= MAX_TICKS) shiftHistory();
      const i = sim.n, a = sim.tick0 + i, m = Math.floor(a / TPM) - sim.tick0 / TPM;
      const last = i > 0 ? MKT[i - 1] : sim.live.p0;
      MKT[i] = last;
      if (a % TPM === 0) { MIN.o[m] = MIN.h[m] = MIN.l[m] = MIN.c[m] = last; MIN.has[m] = 0; }   // closed until a bar or quote says otherwise
      modelInto(i); sim.n++;
    }
  }
  /**
   * Enter live mode for one instrument. `t0` is the epoch ms of tick 0 (a local
   * midnight so the day and week labels line up); ticks are 20 s of wall-clock time.
   */
  function startLive({ contract, name = contract, t0, weeks = DEFAULT_LIVE_WEEKS }) {
    sim.mode = 'live';
    sim.k = CYCLE_PACK;   // five 24-minute laps = 2 hours; the k slider is a synthetic control
    sim.live = { contract, name, t0, weeks, fit: null, p0: P0, quote: null, quoteAt: 0, bars: 0, error: '', extraBars: [], anchors: null };
    sim.live.driftBase = DCLOCK ? DCLOCK(t0) : 0;
    sim.live.clockBase = CLOCK ? 1440 * Math.floor(CLOCK(t0) / 1440) : 0;   // a 6 pm, so the model's clock stays small and every 6 pm stays a multiple of 1440
    sim.simMin = 0; sim.n = 0; sim.tick0 = 0; modelFrom = 0; resetCandles();
    setup();
  }
  function stopLive() {
    if (sim.mode !== 'live') return;
    sim.mode = 'synthetic'; sim.live = null; sim.k = DEFAULTS.k;
    sim.simMin = 0; sim.n = 0; sim.tick0 = 0; modelFrom = 0; resetCandles(); setup();
  }
  /** Ascending 1-minute bars [{t (epoch ms), o, h, l, c}]; minutes outside the buffer are ignored. */
  function ingestBars(bars) {
    if (sim.mode !== 'live' || !bars.length) return 0;
    if (sim.n === 0) sim.live.p0 = bars[0].o;
    let used = 0;
    for (const b of bars) {
      const absMin = Math.floor((b.t - sim.live.t0) / 60000); if (absMin < 0) continue;
      const a = absMin * TPM; if (a < sim.tick0) continue;
      ensureTicks(a + TPM - 1);
      const m = absMin - sim.tick0 / TPM, i = a - sim.tick0; const up = b.c >= b.o;
      MIN.o[m] = b.o; MIN.h[m] = b.h; MIN.l[m] = b.l; MIN.c[m] = b.c; MIN.has[m] = 1;
      MKT[i] = up ? b.l : b.h; MKT[i + 1] = up ? b.h : b.l; MKT[i + 2] = b.c;   // both extremes, ending on the close
      mergeMinute(m); used++;
    }
    sim.live.bars += used;
    if (used) sim.simMin = ticks() / TPM;
    return used;
  }
  /** A quote for the tick that contains `tMs`; updates the minute in progress and its candles. */
  function ingestQuote(price, tMs = Date.now()) {
    if (sim.mode !== 'live' || !Number.isFinite(price)) return;
    const a = Math.floor((tMs - sim.live.t0) / (60000 / TPM)); if (a < sim.tick0) return;
    ensureTicks(a);
    const i = a - sim.tick0, m = Math.floor(a / TPM) - sim.tick0 / TPM;
    MKT[i] = price; for (let j = i + 1; j < sim.n; j++) MKT[j] = price;   // a late quote still rules the ticks after it
    if (!MIN.has[m]) { MIN.has[m] = 1; MIN.o[m] = MIN.h[m] = MIN.l[m] = MIN.c[m] = price; }   // the first trade of the minute opens it
    else { if (price > MIN.h[m]) MIN.h[m] = price; if (price < MIN.l[m]) MIN.l[m] = price; MIN.c[m] = price; }
    mergeMinute(m);
    sim.live.quote = price; sim.live.quoteAt = tMs;
  }
  /** Move the live clock to wall-clock time `nowMs`, opening ticks as they fall due. Returns true if a tick was added. */
  function advanceLiveTo(nowMs) {
    if (sim.mode !== 'live') return false;
    const before = ticks(); sim.simMin = Math.max(0, (nowMs - sim.live.t0) / 60000);
    ensureTicks(Math.floor(sim.simMin * TPM));
    return ticks() !== before;
  }
  /**
   * How closely the sum of all cycles follows the market over the last `minutes` of history.
   *
   * MEASURED ON MINUTE CLOSES ONLY. `ingestBars` spreads each one-minute bar over its three ticks
   * as low, high, close (or high, low, close): a made-up ordering that stands in for a path nobody
   * recorded. Scoring the model against those ticks charged it for the bar's own high–low range —
   * with the closes held fixed and only the range varied, the same fit read 99.8% explained and
   * ±0.31 residual at a flat bar and 93.1% / ±1.73 at a four-point one. The closing tick of each
   * traded minute is the only price in the buffer the market actually printed at a known time,
   * so it is the only one scored. Returns { rms, explained, n } in points.
   */
  function explainOver(minutes = FIT_STAT_MIN) {
    if (sim.mode !== 'live' || !sim.live.fit) return { rms: 0, explained: 0, explainedRaw: 0, n: 0 };
    // IN SAMPLE: the current fit against its own last `minutes` closes, through the rung the pen rides.
    // The Explains readout is the held-out score (holdout, below); this one is kept to compare with it.
    const S = closes(Infinity, minutes), j0 = Math.max(0, S.n - minutes), c = S.n - j0;
    let mu = 0, ss = 0, sst = 0;
    for (let j = j0; j < S.n; j++) mu += S.p[j];
    mu /= c || 1;
    for (let j = j0; j < S.n; j++) { const d = S.p[j] - modelAt(S.t[j], sim.L - 1), e = S.p[j] - mu; ss += d * d; sst += e * e; }
    // `explained` stays clamped at zero because everything that reads it treats it as a share; `explainedRaw`
    // is the same number unclamped, because "0%" covered everything from "as good as the mean" to "four
    // times worse than the mean", and the second is a model actively pointing the wrong way.
    const raw = sst > 0 ? 1 - ss / sst : 0;
    return { rms: c ? Math.sqrt(ss / c) : 0, explained: Math.max(0, raw), explainedRaw: raw, n: c };
  }

  /**
   * The closes every fit and score reads: one per traded minute, stamped at the END of its minute — when
   * the market printed it — in sim-minutes since t0; the minute in progress at its latest quote. Every
   * close from `tFrom` on, and at least the last `atLeast`. The ticks inside a bar (its low and high, in an
   * order nobody recorded, 20 s apart) reach neither: they used to, and which of the three a slow rung
   * sampled depended on the second the refit ran at. { t, p, n }, oldest first.
   */
  function closes(tFrom = -Infinity, atLeast = 0) {
    const M = minutes(), base = sim.tick0 / TPM, now = sim.simMin;
    let m0 = M, got = 0;
    for (let m = M - 1; m >= 0; m--) { if (base + m + 1 < tFrom && got >= atLeast) break; if (MIN.has[m]) got++; m0 = m; }
    const t = new Float64Array(got), p = new Float64Array(got); let n = 0;
    for (let m = m0; m < M; m++) if (MIN.has[m]) { t[n] = Math.min(base + m + 1, now); p[n] = MIN.c[m]; n++; }
    return { t, p, n };
  }

  /** The closes with their times on the model's clock, which is what solve and holdout fit and grade on, and on the trend's (d). */
  function onClock(S) {
    const t = CLOCK ? S.t.map(clockOf) : S.t;
    return { t, p: S.p, n: S.n, d: DCLOCK ? S.t.map(driftOf) : t };
  }
  const FIT_PASSES = 4, FIT_TOL = 0.01;   // backfitting: at most this many passes, stopping once no size moves by FIT_TOL points
  /**
   * The ladder fitted to the closes S[0, J) up to time `tEnd`, by BACKFITTING: each rung in turn is fitted
   * to the market less every OTHER rung's current cycle — the faster ones too — on its own window of
   * FIT_LAPS of its own laps, and the passes repeat until no rung's size moves by FIT_TOL. It used to be
   * one pass, slowest first, each rung fitted to what the slower ones left, so whatever a slow rung missed
   * was handed down the ladder: on the demo that turned L2 upside down.
   *
   * Each rung's TIMING is free: a cos and a sin at its rate, so A ≥ 0 and φ come from the data rather than
   * from the 9:29 grid. L1 also carries the level p0 and the trend. Every other rung's fit has an intercept
   * of its own, which keeps a level mismatch in its window from bending its cycle and is then dropped: six
   * constants cannot be told apart, only their sum shows, and backfitting them one by one lets each drift
   * against the others. The sum is one level correction c instead: the mean of what is left over the last
   * FIT_STAT_MIN closes. `seed` (a previous fit) starts the passes; `only` refits the rungs from that index
   * up, holding the rest, the level and the trend.
   */
  function solve(S, J, tEnd, seed, only = 0, dEnd = tEnd) {
    const A = seed ? seed.A.slice() : new Array(MAXL).fill(0), phi = seed ? seed.phi.slice() : new Array(MAXL).fill(0);
    const keep = only > 0 && seed;
    let p0 = keep ? seed.level.p0 : 0, drift = keep ? seed.drift : 0;
    const tRef = keep ? seed.tRef : dEnd;   // on the trend's clock (S.d, dEnd): the circles' own unless a driftClock was given
    const Wn = n => Math.max(30, FIT_LAPS * periodOf(n));
    const startOf = tFrom => { let lo = 0, hi = J; while (lo < hi) { const mid = (lo + hi) >> 1; if (S.t[mid] < tFrom) lo = mid + 1; else hi = mid; } return lo; };
    const jA = startOf(tEnd - Wn(only)), L = J - jA;   // periods shrink with n: the first rung refitted has the widest window
    const T = S.t.subarray(jA, J), Pr = S.p.subarray(jA, J), Dt = S.d.subarray(jA, J);
    const cyc = Array.from({ length: MAXL }, () => new Float64Array(L)), sum = new Float64Array(L);   // each rung's cycle at every close in play, and their total
    const put = k => { const w = G.omega[k], c = cyc[k], a = A[k], f = phi[k]; for (let j = 0; j < L; j++) { const v = a * Math.sin(w * T[j] + f); sum[j] += v - c[j]; c[j] = v; } };
    for (let k = 0; k < MAXL; k++) put(k);
    const tw = new Float64Array(L), pw = new Float64Array(L), dw = new Float64Array(L), span = J ? tEnd - S.t[0] : 0;
    let passes = 0;
    while (passes < FIT_PASSES) {
      let moved = 0; passes++;
      for (let n = only; n < MAXL; n++) {
        if (!resolvable(n)) { if (A[n]) { A[n] = 0; put(n); } continue; }
        const j0 = startOf(tEnd - Wn(n)) - jA, cnt = L - j0;
        if (cnt < 8) continue;
        for (let j = 0; j < cnt; j++) { const jj = j0 + j; tw[j] = T[jj]; dw[j] = Dt[jj]; pw[j] = Pr[jj] - (sum[jj] - cyc[n][jj]) - (n ? p0 + drift * (Dt[jj] - tRef) : 0); }
        const f = fitCycles(tw.subarray(0, cnt), pw.subarray(0, cnt), cnt, [G.omega[n]], { drift: n === 0, tau: Math.max(1, Math.min(Wn(n), span)), ...(CLOCK && { lockPhi: 0 }),
          ...(DCLOCK ? { tRef: tEnd, td: dw.subarray(0, cnt), dRef: tRef } : { tRef }) });
        moved = Math.max(moved, Math.abs(f.A[0] - A[n]));
        A[n] = f.A[0]; phi[n] = f.phi[0]; put(n);
        if (n === 0) { p0 = f.p0; drift = f.drift; }
      }
      if (moved < FIT_TOL) break;
    }
    // the level: what the cycles, level and trend leave over the last FIT_STAT_MIN closes
    const h0 = Math.max(0, J - FIT_STAT_MIN);
    const cyclesAt = tt => { let y = 0; for (let k = 0; k < MAXL; k++) y += A[k] * Math.sin(G.omega[k] * tt + phi[k]); return y; };
    let c = 0;
    for (let j = h0; j < J; j++) { const jj = j - jA; c += S.p[j] - p0 - drift * (S.d[j] - tRef) - (jj >= 0 ? sum[jj] : cyclesAt(S.t[j])); }
    c /= (J - h0) || 1;
    return { A, phi, drift, tRef, level: { p0, c }, p0: p0 + c, off: new Array(MAXL).fill(0), passes };
  }

  /**
   * The score, OUT OF SAMPLE: the ladder fitted again without the last FIT_STAT_MIN closes — from cold, so
   * nothing in it has seen them — and graded on them through each rung, [{ rms, explained, explainedRaw,
   * n }], one for every rung the pen could ride. Equal weights, closes only. It used to be the live fit
   * graded on the 30 minutes L6 had just been fitted to. Null when too little history to hold any back.
   */
  function holdout(S) {
    const H = FIT_STAT_MIN, J = S.n - H;
    if (J < 8 * H) return null;
    const h = solve(S, J, S.t[J - 1], null, 0, S.d[J - 1]), out = [];
    let mu = 0;
    for (let j = J; j < S.n; j++) mu += S.p[j];
    mu /= H;
    for (let L = 0; L < MAXL; L++) {
      let ss = 0, st = 0;
      for (let j = J; j < S.n; j++) {
        const tt = S.t[j]; let m = h.p0 + h.drift * (S.d[j] - h.tRef);
        for (let k = 0; k <= L; k++) m += h.A[k] * Math.sin(G.omega[k] * tt + h.phi[k]);
        const d = S.p[j] - m, e = S.p[j] - mu; ss += d * d; st += e * e;
      }
      const raw = st > 0 ? 1 - ss / st : 0;
      out.push({ rms: Math.sqrt(ss / H), explained: Math.max(0, raw), explainedRaw: raw, n: H });
    }
    return out;
  }
  /** The fit's Explains and Resid: the held-out score of the pen as it rides now, through rung L. */
  function scoreInto(fit) {
    const o = fit.oos && fit.oos[sim.L - 1];
    fit.rms = o ? o.rms : 0; fit.explained = o ? o.explained : 0; fit.explainedRaw = o ? o.explainedRaw : 0; fit.statN = o ? o.n : 0; fit.statMin = FIT_STAT_MIN;
  }

  /**
   * Refit the ladder to recent history (solve) and, on a full refit, grade it out of sample (holdout).
   * `opts.from` refits only the rungs from that index up, holding the slower rungs, the level and the
   * trend of the previous fit — cheap enough to run every second on the fast rungs, which keep the
   * previous full refit's score. A rung under two one-minute bars (below the data's Nyquist limit) is
   * held at zero rather than fitted, and the legend names it unresolved.
   */
  function refit(opts = {}) {
    if (sim.mode !== 'live' || sim.n < 2 * TPM) return null;
    const prev = sim.live.fit, only = prev ? Math.max(0, Math.min(MAXL, opts.from ?? 0)) : 0;
    if (only >= MAXL) return prev;
    const now = sim.simMin, nowMs = sim.live.t0 + now * 60000;
    if (only === 0) { applyLiveLadder(); refreshAnchors(nowMs); }
    const S = onClock(only ? closes(now - Math.max(30, FIT_LAPS * periodOf(only)), FIT_STAT_MIN) : closes());
    if (S.n < 8) return null;
    const fit = solve(S, S.n, clockOf(now), prev, only, driftOf(now));
    fit.count = S.n;
    fit.oos = only === 0 ? holdout(S) : prev.oos;
    scoreInto(fit);
    sim.live.fit = fit; applyFit(fit, only > 0);
    const N = sim.n, iModel = Math.max(0, N - MODEL_TAIL), partial = only > 0 && iModel >= modelFrom ? only : 0;
    for (let i = iModel; i < N; i++) modelInto(i, partial);
    modelFrom = iModel;
    return fit;
  }
  /**
   * LADDER: a fit made outside the sim (the Kalman filter, ladderFilter.js) in place of the last refit's, scored
   * through the rung the pen rides as a refit is. The scale is kept once one is set, and the model tail is not
   * rewritten: the filter's past is its record (filterRecord.js), not this fit carried back over it.
   */
  function setFit(fit) {
    if (sim.mode !== 'live' || !fit) return null;
    sim.live.fit = fit; scoreInto(fit); applyFit(fit, sim.live.scaled === true);
    sim.live.scaled = true;
    return fit;
  }

  setup();
  return sim;
}
