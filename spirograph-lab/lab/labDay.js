// The Spirograph Lab's day player (16 Sep): one session, 6 pm to 6 pm New York, through the Daily set's own sim
// (engine/dailyTest.js dailySim: the circles on the 6 pm day clock, the trend on Globex's traded minutes).
//
// The pen is only ever HELD (16 Sep, on request: "only allow held from 6 pm, with the ability to edit that to 1 other
// time"): the circles are fitted once at a hold time, on the bars that closed before it and nothing later, then kept
// for the rest of the day. A day is built with a hold at every quarter-hour, so the player can hold from 6 pm or from
// any one other quarter-hour without building again. Before its hold time a pen has nothing to say.
//
// Built from the first Monday 14 Sep replay (a scratchpad page, 15 Sep). Pure: no DOM, no database.
import { MAXL } from '../engine/constants.js';
import { dailySim, HISTORY_WEEKS } from '../engine/dailyTest.js';
import { DAILY_PERIODS } from '../engine/dailySet.js';
import { weekStartNy } from '../engine/anchors.js';
import { openBefore } from '../engine/dayClock.js';

const M = 60000;
export const DAY_MIN = 1440;
export const DAY_VERSION = 2;        // 1: refit each minute + one 6 pm hold; 2: a hold every quarter-hour
export const HOLD_EVERY = 15;        // minutes between the holds a day is built with
export const PEN_STEP = 5;           // minutes between a held pen's stored points
export const MIN_DAY_BARS = 60;      // a session with fewer traded minutes is not worth a replay
export const MIN_PRE_BARS = 1000;    // bars before the open the fit needs (about 17 traded hours)
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

/** The 6 pm New York open of the session holding `ms`. */
export const sessionOpen = ms => openBefore(ms).ms;
/** A hold time the player accepts: a quarter-hour from 6 pm up to the last one before the break. */
export const normHold = h => Math.max(0, Math.min(DAY_MIN - 60 - HOLD_EVERY, Math.round(h / HOLD_EVERY) * HOLD_EVERY));

/**
 * Build the session opening at `open` (epoch ms, a 6 pm New York) from ascending one-minute `bars` covering
 * HISTORY_WEEKS before it through its end. { day } or { refused: 'no-bars' | 'history' | 'no-fit', have }.
 * `progress(k)` is called after each hour of holds.
 */
export function replayDay({ bars, open, name = '', progress = () => {} }) {
  const end = open + DAY_MIN * M, t0 = weekStartNy(open, HISTORY_WEEKS);
  const pre = bars.filter(b => b.t >= t0 && b.t < open), day = bars.filter(b => b.t >= open && b.t < end);
  if (day.length < MIN_DAY_BARS) return { refused: 'no-bars', have: day.length };
  if (pre.length < MIN_PRE_BARS) return { refused: 'history', have: pre.length };
  const all = pre.concat(day), sim = dailySim();
  sim.startLive({ contract: name, name, t0, weeks: HISTORY_WEEKS });
  sim.setLevels(MAXL);
  let bi = 0;
  const take = T => { const got = []; while (bi < all.length && all[bi].t + M <= T) got.push(all[bi++]); if (got.length) sim.ingestBars(got); };
  const tOf = T => (T - t0) / M;

  const mkt = new Array(DAY_MIN + 1).fill(null);   // the close of the minute that ended at open + k
  for (const b of day) mkt[(b.t + M - open) / M] = b.c;

  const holds = {};
  for (let h = 0; h <= normHold(DAY_MIN); h += HOLD_EVERY) {
    const T = open + h * M;
    take(T);
    sim.advanceLiveTo(T);
    const fit = sim.refit();
    if (!fit) { if (h === 0) return { refused: 'no-fit', have: pre.length }; continue; }
    const last = all[bi - 1], pen = [];
    for (let k = h; k <= DAY_MIN; k += PEN_STEP) pen.push(r2(sim.modelAt(tOf(open + k * M), MAXL - 1)));
    holds[h] = {
      A: Array.from({ length: MAXL }, (_, n) => r3(sim.G.lever[n] * sim.G.scale)), pen,
      close: last.c, closeAt: last.t + M, drift: r3(fit.drift),
      trend: r2(fit.drift * (sim.driftOf(tOf(T)) - sim.driftOf(tOf(last.t + M)))),   // what the trend adds between that close and the hold
      explained: fit.statN ? r3(fit.explained) : null, rms: fit.statN ? r2(fit.rms) : null,
    };
    if (h && h % 60 === 0) progress(h);
  }
  return { day: { v: DAY_VERSION, name, open, periods: DAILY_PERIODS.slice(), every: HOLD_EVERY, step: PEN_STEP, mkt, holds, bars: { pre: pre.length, day: day.length } } };
}

/** The pen held from minute `h`, at minute `k` of the day; null before its hold (or for a hold the day lacks). */
export function penAt(day, h, k) {
  const x = day.holds[h];
  if (!x || k < h) return null;
  const f = (k - h) / day.step, i = Math.floor(f), a = x.pen;
  return i >= a.length - 1 ? a[a.length - 1] : a[i] + (a[i + 1] - a[i]) * (f - i);
}

/** How the pen held from `h` did over the rest of the day: its root-mean-square miss beside the hold price kept flat. */
export function holdScore(day, h) {
  const x = day.holds[h];
  if (!x) return null;
  let ss = 0, sf = 0, n = 0, first = null, last = null;
  for (let k = h + 1; k <= DAY_MIN; k++) {
    const m = day.mkt[k]; if (m == null) continue;
    if (first == null) first = m;
    last = m;
    const e = m - penAt(day, h, k), f = m - x.close; ss += e * e; sf += f * f; n++;
  }
  const penEnd = x.pen[x.pen.length - 1];
  return {
    n, held: n ? Math.sqrt(ss / n) : NaN, flat: n ? Math.sqrt(sf / n) : NaN, first, last,
    move: first == null ? null : last - x.close, penMove: penEnd - x.pen[0], start: x.pen[0], close: x.close,
  };
}
