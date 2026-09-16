// The Spirograph's second set of circles (15 Sep, on request: "a second set of circles for the spirograph tab only").
//
// THE DAY CLOCK (15 Sep, on request: "the daily circle starts at 6 pm … ensuring the circles rotate based on the day,
// fractally"). The user's answers: the day is 24 hours and the circles keep turning through the 5–6 pm break and the
// weekend; the second circle is a chart 4H; every circle starts at 6 pm; a CME holiday table (cmeHolidays.js).
// The circles are 1D · 4H · 2H · 24m · 12m · 6m: each fits a whole number of times inside the one above (×6 ×2 ×5 ×2 ×2),
// so each restarts exactly when the one above it does, and 2H and 24m are the ladder's own. The user asked for 24m in
// place of 30m; 24m does not fit inside 1H (2.5 turns) nor 15m inside it (1.6), so 2H took 1H's place and 12m and 6m
// follow. (Before: 1D 4H 1H 15m 5m 3m on wall time with fitted timing; 2m, and the 1m first asked for, cannot be seen in
// one-minute closes: at two closes a lap the rung's timing is decided by one close and it read ±73–119 pts live.)
//
// It is a sim of its own on the day clock (dayClock.js, sim.js `clock`): each circle's angle is its speed × minutes since
// 6 pm, so the fit sets only its signed size. Fed the ladder's minute bars, fitted once a minute closes. Nothing else
// reads it: the lanes, cards, alerts, the Kalman filter and its record stay on the ladder's own rungs. Pure: no DOM.
import { createSim } from './sim.js';
import { MAXL, TPM } from './constants.js';
import { dayClockMin, sinceOpenMin, tradeMin } from './dayClock.js';
import { sessionNote } from './cmeHolidays.js';

export const DAILY_PERIODS = [1440, 240, 120, 24, 12, 6];

/** The Spirograph's meta line for the Daily set at `ms`: how far into the 6 pm day, and the session's word when it has one. */
export function clockLine(ms) {
  const pct = Math.min(99, Math.floor(100 * sinceOpenMin(ms) / 1440)), note = sessionNote(ms);
  return `Daily set · 1D 4H 2H 24m 12m 6m · day ${pct}% since 6 pm${note ? ` · ${note}` : ''}`;
}

/** The traded minutes `main` holds from `fromMs` on, as ascending one-minute bars. */
export function barsOf(main, fromMs = -Infinity) {
  const { MIN } = main, t0 = main.live.t0, base = main.tick0 / TPM, M = main.minutes(), out = [];
  const m0 = Number.isFinite(fromMs) ? Math.max(0, Math.floor((fromMs - t0) / 60000) - base) : 0;
  for (let m = m0; m < M; m++) if (MIN.has[m]) out.push({ t: t0 + (base + m) * 60000, o: MIN.o[m], h: MIN.h[m], l: MIN.l[m], c: MIN.c[m] });
  return out;
}

export function createDailySet() {
  let sim = null, from = null, lastMs = -Infinity, fitMin = -1;
  /** Bring the set up to `main` (the ladder's live sim) at `now`. Returns the set's sim once it has a fit, else null. */
  function sync(main, now = Date.now()) {
    if (!main || main.mode !== 'live' || !main.live) return null;
    if (from !== main || !sim) {   // another instrument or a re-seed: start again from its bars
      from = main; lastMs = -Infinity; fitMin = -1;
      // The circles turn on the 24h day; the trend counts traded minutes only, so it stands still over the weekend.
      sim = createSim({ maxTicks: main.maxTicks, periods: DAILY_PERIODS, clock: dayClockMin, driftClock: tradeMin });
      sim.startLive({ contract: main.live.contract, name: main.live.name, t0: main.live.t0, weeks: main.live.weeks });
      sim.setLevels(MAXL);
    }
    const bars = barsOf(main, lastMs);   // the last minute taken is read again: the minute in progress grows
    if (bars.length) { sim.ingestBars(bars); lastMs = bars[bars.length - 1].t; }
    if (main.live.quoteAt) { sim.live.quote = main.live.quote; sim.live.quoteAt = main.live.quoteAt; }
    sim.advanceLiveTo(now);
    const minute = Math.floor(now / 60000);
    if (minute !== fitMin && sim.refit()) fitMin = minute;
    return sim.live.fit ? sim : null;
  }
  return { sync, get sim() { return sim && sim.live && sim.live.fit ? sim : null; } };
}
