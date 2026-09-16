// The walk-forward backtest: at each cut a forecast is made with the SAME code Freeze & save runs (freeze.js
// makeLadderRun, the Market Maker's run) from a sim that has seen only bars up to the cut, then graded with the desk's
// gradeRun against what printed after it. Nothing here re-implements the engine; a second implementation is the
// mistake a parity test exists to catch. The shadow band and the turn check are graded on the same cuts.
//
// The ladder at each cut is the app's own: its Kalman filter (ladderFilter.js seedAndRun), seeded from a fit to the
// bars up to a day before the cut and run a close at a time up to it, as the app does the first time it opens an
// instrument (14 Sep, on request: the backtest grades the filter the chart shows, not the refit it replaced).
//
// "Now" for each cut is the minute after it, so the cut is the last CLOSED minute, as it is live. The sim is
// handed bars with t ≤ cut and nothing later, so the fit, the filter, the band and the shadow band cannot see the
// answer; tests/backtest.test.js changes every bar after a cut and checks the run it makes does not move.
// Pure: no DOM and no database, so the relay's worker and the tests run it the same way.
import { createSim } from './sim.js';
import { TPM, T1 } from './constants.js';
import { weekStartNy } from './anchors.js';
import { gradeRun, closeAtFromBars, RUN_STEPS } from './forecast.js';
import { makeLadderRun, turnCheck, closesFromBars, rungPeriod, runEnd } from './freeze.js';
import { withShadow } from './bandShadow.js';
import { seedAndRun, stiffnessOf, WARM_MIN, DEFAULT_STIFFNESS } from './ladderFilter.js';

const M = 60000, DAY = 86400e3;
export const MIN_HISTORY = 2000;   // bars a cut needs behind it (the desk's backtest): fewer and it is skipped
/** Ticks a sim needs for `weeks` of history plus the week in progress (app.js's own sizing). */
export const ticksFor = weeks => Math.round(((weeks + 1) * T1 + 2 * 1440) * TPM);

function lowerBound(bars, t) { let lo = 0, hi = bars.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].t < t) lo = mid + 1; else hi = mid; } return lo; }

/** The cuts a job will try: every `every` minutes on the clock, from `from` until a run's last stamp would pass `to`. */
export function cutsOf({ from, to, tf, every }) {
  const out = [], step = every * M, horizon = RUN_STEPS * tf * M;
  for (let cut = Math.ceil(from / step) * step; cut + horizon <= to; cut += step) out.push(cut);
  return out;
}

/** A turn check boiled down to what a record keeps: per rung, how many turns were graded and how many hit. */
export const turnSummary = t => t.rows.map(r => ({ n: r.n, graded: r.graded, hits: r.hits, none: r.none, total: r.total }));

/**
 * One cut, made from ascending one-minute `bars` with t ≤ cut and nothing later: { run } or { refused } ('shut' when
 * the cut minute never traded, 'history' with fewer than MIN_HISTORY bars behind it, 'no-fit', or the desk's own
 * refusals: 'no-bars', 'thin-band'). walkForward makes each of its runs with it, and so do the relay's scheduled and
 * past cuts (server/forecastDesk.mjs), so all three are the same forecast. `sim` may be handed in to be reused.
 */
export function cutAt({ bars, contract, name = contract, tf = 60, cut, weeks = 8, L = 4, stiffness = DEFAULT_STIFFNESS, sim = null }) {
  const t0 = weekStartNy(cut, weeks), i0 = lowerBound(bars, t0), i1 = lowerBound(bars, cut + 1);   // bars with t ≤ cut: the cut's own minute has closed
  if (!(i1 > 0 && bars[i1 - 1].t === cut)) return { refused: 'shut' };
  if (i1 - i0 < MIN_HISTORY) return { refused: 'history' };
  const s = sim || createSim({ maxTicks: ticksFor(weeks) });
  const got = seedAndRun(s, { live: { contract, name, t0, weeks }, L, bars: bars.slice(i0, i1), seedMs: cut + M - WARM_MIN * M, toMs: cut + M, cfg: stiffnessOf(stiffness) });
  if (!got) return { refused: 'no-fit' };
  const r = makeLadderRun(s, cut + M, tf);
  return r.refused ? { refused: r.refused } : { run: r.run };
}

/**
 * Walk forward over ascending one-minute `bars`: yields { cut, run, grade, shadow, turns } for each forecast made,
 * or { cut, refused } for a cut that could not make one (cutAt says which). `weeks` is the history each fit gets
 * (app.js's History), `L` the rung the pen rides, `stiffness` the filter's (ladderFilter.js STIFFNESS id).
 */
export function* walkForward({ bars, contract, name = contract, tf = 60, every = 60, weeks = 8, L = 4, stiffness = DEFAULT_STIFFNESS, from, to }) {
  if (!bars.length) return;
  const closeAt = closeAtFromBars(bars, Infinity);
  const sim = createSim({ maxTicks: ticksFor(weeks) });
  const last = bars[bars.length - 1].t + M;
  let reach = 0;
  for (const cut of cutsOf({ from: Math.max(from, bars[0].t + DAY), to: Math.min(to, last), tf, every })) {
    const x = cutAt({ bars, contract, name, tf, cut, weeks, L, stiffness, sim });
    if (x.refused) { yield { cut, refused: x.refused }; continue; }
    const run = x.run;
    if (!reach) for (let n = 0; n < run.L; n++) reach = Math.max(reach, rungPeriod(run, n) / 4);
    const grade = gradeRun(run, closeAt), sh = withShadow(run);
    const closes = closesFromBars(bars, run.cut - reach * M, runEnd(run) + reach * M);
    yield { cut, run, grade, shadow: sh ? gradeRun(sh, closeAt) : null, turns: turnSummary(turnCheck(run, closes, Infinity)) };
  }
}
