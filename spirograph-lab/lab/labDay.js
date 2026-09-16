// The Spirograph Lab's day player (16 Sep, on request: "any stored day, both fits"): one session, 6 pm to 6 pm New York,
// replayed a minute at a time through the Daily set's own sim (dailyTest.js dailySim: the circles on the 6 pm day clock,
// the trend on Globex's traded minutes), as the Spirograph would have drawn it live.
//
//   refit  each minute that closed a bar, the circles are fitted again on every close up to it: what the app showed.
//          Its pen has seen the market it is measured against, so its miss is not a forecast.
//   held   the circles as fitted at 6 pm on the bars before the open, kept all day: a forward test.
//
// Built from the first Monday 14 Sep replay (a scratchpad page, 15 Sep). Pure: no DOM, no database.
import { MAXL } from '../engine/constants.js';
import { dailySim, HISTORY_WEEKS } from '../engine/dailyTest.js';
import { DAILY_PERIODS } from '../engine/dailySet.js';
import { weekStartNy } from '../engine/anchors.js';
import { openBefore } from '../engine/dayClock.js';

const M = 60000;
export const DAY_MIN = 1440;
export const MIN_DAY_BARS = 60;      // a session with fewer traded minutes is not worth a replay
export const MIN_PRE_BARS = 1000;    // bars before the open the fit needs (about 17 traded hours)
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

/** The 6 pm New York open of the session holding `ms`. */
export const sessionOpen = ms => openBefore(ms).ms;

/**
 * Replay the session opening at `open` (epoch ms, a 6 pm New York) from ascending one-minute `bars` covering
 * HISTORY_WEEKS before it through its end. { day } or { refused: 'no-bars' | 'history' | 'no-fit', have }.
 * `progress(k)` is called every 60 minutes replayed.
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
  const take = T => { const got = []; while (bi < all.length && all[bi].t + M <= T) got.push(all[bi++]); if (got.length) sim.ingestBars(got); return got.length; };
  const amps = () => Array.from({ length: MAXL }, (_, n) => r3(sim.G.lever[n] * sim.G.scale));
  const tOf = T => (T - t0) / M;

  // the fit as it stood when the last bar before the open closed: nothing from the day has been read
  take(open);
  const last = pre[pre.length - 1];
  sim.advanceLiveTo(open);
  const fit0 = sim.refit();
  if (!fit0) return { refused: 'no-fit', have: pre.length };
  const held = { A: amps(), pen: [] };
  for (let k = 0; k <= DAY_MIN; k++) held.pen.push(r2(sim.modelAt(tOf(open + k * M), MAXL - 1)));
  const trend = fit0.drift * (sim.driftOf(tOf(open)) - sim.driftOf(tOf(last.t + M)));

  const F = { A: [], pen: [], mkt: [], expl: [], rms: [] };
  for (let k = 0; k <= DAY_MIN; k++) {
    const T = open + k * M, got = k ? take(T) : 0;
    sim.advanceLiveTo(T);
    if (got) sim.refit();
    const fit = sim.live.fit, b = all[bi - 1];
    F.A.push(k ? amps() : held.A);
    F.pen.push(k ? r2(sim.modelAt(tOf(T), MAXL - 1)) : held.pen[0]);
    F.mkt.push(b && b.t === T - M && b.t >= open ? b.c : null);
    F.expl.push(fit && fit.statN ? r3(fit.explained) : null);
    F.rms.push(fit && fit.statN ? r2(fit.rms) : null);
    if (k && k % 60 === 0) progress(k);
  }
  return {
    day: {
      v: 1, name, open, periods: DAILY_PERIODS.slice(), frames: F, held,
      pre: { close: last.c, at: last.t + M, drift: r3(fit0.drift), trend: r2(trend) },
      bars: { pre: pre.length, day: day.length },
    },
  };
}

/** The day's numbers the rail shows: each pen's root-mean-square miss beside two flat lines. */
export function dayScore(d) {
  const F = d.frames, N = F.pen.length - 1, first = F.mkt.find(v => v != null);
  const rms = pick => { let ss = 0, c = 0; for (let k = 0; k <= N; k++) { const m = F.mkt[k]; if (m == null) continue; const e = m - pick(k); ss += e * e; c++; } return c ? Math.sqrt(ss / c) : NaN; };
  let lastMkt = null; for (let k = N; k >= 0 && lastMkt == null; k--) lastMkt = F.mkt[k];
  return {
    held: rms(k => d.held.pen[k]), refit: rms(k => F.pen[k]), flatPrev: rms(() => d.pre.close), flatFirst: rms(() => first),
    first, last: lastMkt, move: first == null || lastMkt == null ? null : lastMkt - first,
    heldMove: d.held.pen[N] - d.held.pen[0],
  };
}
