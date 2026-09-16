// Calendar fib anchors for a live symbol. Each interval starts at its open and
// ends at the next same open; the fib range is the high–low of the first bar
// that actually printed. Times are America/New_York. Globex 4h bars are aligned
// to 18:00 NY; the Globex week opens Sunday 18:00. Pure; runs in Node.
import { nyParts, nyEpoch } from './levels.js';
import { CYCLE_OPEN_H, CYCLE_OPEN_MI } from './constants.js';

// ONE anchor per scale, and the app's six chart timeframes are exactly those six scales — which is
// what makes this a fractal model rather than six unrelated studies. The three intraday anchors nest
// into the 09:30 cash open: each is the last bar of its OWN size that closes before the bell.
export const ANCHOR_KINDS = ['year', 'month', 'week', 'session', 'preopen', 'bell'];
export const ANCHOR_TF = { year: 1440, month: 240, week: 60, session: 15, preopen: 5, bell: 1 };
export const TF_ANCHOR = { 1440: 'year', 240: 'month', 60: 'week', 15: 'session', 5: 'preopen', 1: 'bell' };
/** The New York wall clock each daily anchor opens at, and the bar length it measures. */
export const DAY_ANCHOR = { session: { h: 9, mi: 15 }, preopen: { h: 9, mi: 25 }, bell: { h: 9, mi: 29 } };
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, -0.272, -0.618];
export const FIB_NAMED = new Set([0, 0.5, 0.618, 1, 1.618, -0.618]);
/** CME Globex 4h session starts (NY hour). */
export const GLOBEX_4H = [2, 6, 10, 14, 18, 22];

const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Shift a NY calendar date by `days` (noon, so DST cannot land on the wrong day). */
export function nyDateAdd(y, mo, d, days) {
  const p = nyParts(nyEpoch(y, mo, d, 12, 0) + days * 86400e3);
  return { y: p.y, mo: p.mo, d: p.d };
}

function sundayOf(nowMs) {
  const p = nyParts(nowMs), s = nyDateAdd(p.y, p.mo, p.d, -DOW[p.dow]);
  return { y: s.y, mo: s.mo, d: s.d };
}

/** NY Sunday 00:00 of the week containing `nowMs`. */
export function nySundayMidnight(nowMs) {
  const s = sundayOf(nowMs);
  return nyEpoch(s.y, s.mo, s.d, 0, 0);
}

/** Sunday midnight NY, `weeks` weeks before the current NY week. Tape origin so day labels line up. */
export function weekStartNy(nowMs, weeks) {
  const s = sundayOf(nowMs), back = nyDateAdd(s.y, s.mo, s.d, -7 * weeks);
  return nyEpoch(back.y, back.mo, back.d, 0, 0);
}

/**
 * First 9:29 New York at or after `t0` (epoch ms). The live 24-minute and 2-hour
 * clocks both read zero here, and at every later 9:29 of the same UTC offset (1440 min is 60 × 24m =
 * 12 × 2h). Across a daylight-saving change a 9:29 is 23 or 25 hours on, half a lap of L4–L6, so there
 * they read π. The ladder fits each rung's phase now (sim.js cycleAngle), so this grid is a reference only.
 */
export function cycleOriginMs(t0) {
  const p = nyParts(t0);
  let t = nyEpoch(p.y, p.mo, p.d, CYCLE_OPEN_H, CYCLE_OPEN_MI);
  if (t < t0) {
    const n = nyDateAdd(p.y, p.mo, p.d, 1);
    t = nyEpoch(n.y, n.mo, n.d, CYCLE_OPEN_H, CYCLE_OPEN_MI);
  }
  return t;
}
/** That origin as minutes after `t0`, which is how the sim's clock is counted. */
export function cycleOriginMin(t0) { return (cycleOriginMs(t0) - t0) / 60000; }

/** Globex week open: Sunday 18:00 NY. Before 18:00 Sunday this is last week's open. */
export function globexWeekOpen(nowMs) {
  const s = sundayOf(nowMs);
  const open = nyEpoch(s.y, s.mo, s.d, 18, 0);
  if (nowMs >= open) return open;
  const prev = nyDateAdd(s.y, s.mo, s.d, -7);
  return nyEpoch(prev.y, prev.mo, prev.d, 18, 0);
}

/** First Globex 4h slot start at or after `ms` (18:00 NY aligned). */
export function globex4hOnOrAfter(ms) {
  const p = nyParts(ms);
  const days = [nyDateAdd(p.y, p.mo, p.d, -1), { y: p.y, mo: p.mo, d: p.d }, nyDateAdd(p.y, p.mo, p.d, 1), nyDateAdd(p.y, p.mo, p.d, 2)];
  const starts = [];
  for (const d of days) for (const h of GLOBEX_4H) starts.push(nyEpoch(d.y, d.mo, d.d, h, 0));
  starts.sort((a, b) => a - b);
  return starts.find(t => t >= ms) ?? starts[starts.length - 1];
}

/** First weekday of `year` that is not the observed New Year's Day (fallback when the tape has no January). */
export function firstTradingDay(year) {
  const jan1 = nyParts(nyEpoch(year, 1, 1, 12, 0));
  let d = jan1.dow === 'Sat' || jan1.dow === 'Sun' ? 3 : 2;
  if (jan1.dow === 'Fri') d = 4;
  const start = nyEpoch(year, 1, d, 0, 0), p = nyParts(start);
  if (p.dow === 'Sat') return nyEpoch(year, 1, d + 2, 0, 0);
  if (p.dow === 'Sun') return nyEpoch(year, 1, d + 1, 0, 0);
  return start;
}

function weekdayAt(y, mo, d, h, mi) { return nyEpoch(y, mo, d, h, mi); }

function prevWeekdayAt(nowMs, h, mi) {
  const p = nyParts(nowMs);
  for (let i = 0; i <= 8; i++) {
    const q = i ? nyDateAdd(p.y, p.mo, p.d, -i) : { y: p.y, mo: p.mo, d: p.d };
    const dow = nyParts(nyEpoch(q.y, q.mo, q.d, 12, 0)).dow;
    if (DOW[dow] < 1 || DOW[dow] > 5) continue;
    const t = weekdayAt(q.y, q.mo, q.d, h, mi);
    if (t <= nowMs) return t;
  }
  return weekdayAt(p.y, p.mo, p.d, h, mi);
}

function nextWeekdayAt(startMs, h, mi) {
  const p = nyParts(startMs);
  for (let i = 1; i <= 8; i++) {
    const q = nyDateAdd(p.y, p.mo, p.d, i);
    const dow = nyParts(nyEpoch(q.y, q.mo, q.d, 12, 0)).dow;
    if (DOW[dow] >= 1 && DOW[dow] <= 5) return weekdayAt(q.y, q.mo, q.d, h, mi);
  }
  return startMs + 86400e3;
}

/**
 * The interval of `kind` that contains `nowMs`.
 * { kind, startMs, endMs, barTf } — barTf is the first-bar length in minutes.
 */
export function intervalAt(kind, nowMs) {
  const p = nyParts(nowMs);
  if (kind === 'year') {
    const thisOpen = firstTradingDay(p.y);
    const start = nowMs < thisOpen ? firstTradingDay(p.y - 1) : thisOpen;
    const end = nowMs < thisOpen ? thisOpen : firstTradingDay(p.y + 1);
    return { kind, startMs: start, endMs: end, barTf: 1440 };
  }
  if (kind === 'month') {
    // The month's anchor opens at the first Globex 4h slot on or after calendar midnight, which is
    // 02:00 NY at the earliest — so deciding the month from midnight alone left the first hours of
    // every 1st sitting BEFORE the start of their own interval. Step back a month whenever the
    // Globex-aligned open has not happened yet.
    const step = (y, mo, d) => { mo += d; if (mo > 12) { mo = 1; y++; } else if (mo < 1) { mo = 12; y--; } return [y, mo]; };
    let y = p.y, mo = p.mo;
    if (nowMs < globex4hOnOrAfter(nyEpoch(y, mo, 1, 0, 0))) [y, mo] = step(y, mo, -1);
    const [ny, nmo] = step(y, mo, 1);
    return { kind, startMs: globex4hOnOrAfter(nyEpoch(y, mo, 1, 0, 0)), endMs: globex4hOnOrAfter(nyEpoch(ny, nmo, 1, 0, 0)), barTf: 240 };
  }
  if (kind === 'week') {
    const start = globexWeekOpen(nowMs), sp = nyParts(start), nx = nyDateAdd(sp.y, sp.mo, sp.d, 7);
    return { kind, startMs: start, endMs: nyEpoch(nx.y, nx.mo, nx.d, 18, 0), barTf: 60 };
  }
  // session / preopen / bell: one a trading day, at 09:15, 09:25 and 09:29 New York
  const { h, mi } = DAY_ANCHOR[kind] ?? DAY_ANCHOR.session;
  const start = prevWeekdayAt(nowMs, h, mi);
  return { kind, startMs: start, endMs: nextWeekdayAt(start, h, mi), barTf: ANCHOR_TF[kind] ?? 15 };
}

/** OHLC of 1-minute bars whose time is in [startMs, endMs). */
export function ohlcIn(bars, startMs, endMs) {
  let o, h = -Infinity, l = Infinity, c, t;
  for (const b of bars) {
    if (b.t < startMs || b.t >= endMs) continue;
    if (o === undefined) { o = b.o; t = b.t; }
    if (b.h > h) h = b.h; if (b.l < l) l = b.l; c = b.c;
  }
  return o === undefined ? null : { o, h, l, c, t };
}

/**
 * Opening-range bar: the first `barTf` minutes from `startMs` that actually
 * traded. Walks forward up to three days so a closed slot still finds the
 * first print (Sunday 18:00 for a week, next Globex 4h for a weekend month).
 */
export function openingRange(bars, startMs, barTf) {
  const span = barTf * 60000, limit = startMs + 3 * 86400e3;
  if (barTf === 240) {
    for (let t = globex4hOnOrAfter(startMs); t < limit; t = globex4hOnOrAfter(t + 1)) {
      const r = ohlcIn(bars, t, t + span); if (r) return r;
    }
    return null;
  }
  for (let t = startMs; t < limit; t += span) {
    const r = ohlcIn(bars, t, t + span); if (r) return r;
  }
  return null;
}

/**
 * Yearly opening range from the tape: first print of `year` in `bars`, then
 * high–low of that whole NY calendar day (Anchor Lab year_open).
 */
export function yearOpeningRange(bars, year) {
  let first = null;
  for (const b of bars) {
    if (nyParts(b.t).y !== year) continue;
    if (first == null || b.t < first) first = b.t;
  }
  if (first == null) return null;
  const p = nyParts(first), nx = nyDateAdd(p.y, p.mo, p.d, 1);
  return ohlcIn(bars, nyEpoch(p.y, p.mo, p.d, 0, 0), nyEpoch(nx.y, nx.mo, nx.d, 0, 0));
}

/** Price of a fib ratio on an opening-range bar (0 = low, 1 = high). */
export const fibPrice = (bar, f) => bar.l + f * (bar.h - bar.l);

// ---------------------------------------------------------------------------
// ONE anchor per scale.
//
// Each timeframe is anchored to exactly ONE bar, not to four session times a day:
//
//   1440m  the first trading day of the year
//    240m  the first 4h candle of the new month
//     60m  the 18:00 Sunday candle that opens the Globex week
//     15m  09:15 New York
//      5m  09:25 New York
//      1m  09:29 New York
//
// The three intraday ones nest into the 09:30 cash open — 15, 5 and 1 minutes before the bell, each
// the last bar of its own size to close before it. The three calendar ones nest the same way: the
// year's first day contains the month's first 4h contains the week's first hour.
export const SCALES = [1, 5, 15, 60, 240, 1440];
export const SCALE_ANCHOR = {
  1440: { kind: 'year', label: 'first trading day of the year' },
  240: { kind: 'month', label: 'first 4h candle of the month' },
  60: { kind: 'week', label: 'Sunday 18:00 NY' },
  15: { kind: 'day', ...DAY_ANCHOR.session, label: '09:15 NY' },
  5: { kind: 'day', ...DAY_ANCHOR.preopen, label: '09:25 NY' },
  1: { kind: 'day', ...DAY_ANCHOR.bell, label: '09:29 NY' },
};

const isWeekday = ms => { const d = DOW[nyParts(ms).dow]; return d >= 1 && d <= 5; };

/** Every anchor start time for scale `tf` inside [fromMs, toMs), in order. */
export function anchorStarts(tf, fromMs, toMs) {
  const spec = SCALE_ANCHOR[tf];
  if (!spec) throw new Error(`no anchor defined for ${tf}m`);
  const out = [];
  if (spec.kind === 'day') {
    const p = nyParts(fromMs);
    for (let i = 0; i < 400; i++) {
      const d = nyDateAdd(p.y, p.mo, p.d, i), t = nyEpoch(d.y, d.mo, d.d, spec.h, spec.mi);
      if (t >= toMs) break;
      if (t >= fromMs && isWeekday(t)) out.push(t);
    }
    return out;
  }
  if (spec.kind === 'week') {
    for (let t = globexWeekOpen(fromMs); t < toMs; ) {
      if (t >= fromMs) out.push(t);
      const p = nyParts(t), n = nyDateAdd(p.y, p.mo, p.d, 7);
      t = nyEpoch(n.y, n.mo, n.d, 18, 0);
    }
    return out;
  }
  if (spec.kind === 'month') {
    const p = nyParts(fromMs);
    let y = p.y, mo = p.mo;
    for (let i = 0; i < 240; i++) {
      const t = globex4hOnOrAfter(nyEpoch(y, mo, 1, 0, 0));
      if (t >= toMs) break;
      if (t >= fromMs) out.push(t);
      if (++mo > 12) { mo = 1; y++; }
    }
    return out;
  }
  for (let y = nyParts(fromMs).y; ; y++) {
    const t = firstTradingDay(y);
    if (t >= toMs) break;
    if (t >= fromMs) out.push(t);
  }
  return out;
}

/**
 * The anchor bar for `kind` as of `nowMs`, using a caller-supplied reader.
 *
 * `read(startMs, tfMin)` returns that bar or null — the sim reads its own live buffer, a backtest
 * reads the cache, and both then agree on WHICH bar is the anchor.
 *
 * A day anchor names a wall-clock bar, so when 09:29 did not print (a holiday, a data gap) the
 * fallback is the SAME clock time on an earlier trading day — never the next minute. Walking
 * forward by one bar, which is what the generic interval walk did, silently anchored the 1m scale
 * to 09:30 and the 5m scale to 09:30-09:35: bars that are after the bell, not before it, which is
 * the opposite of what every one of these anchors is for.
 *
 * `closedBy` keeps a backtest causal: an anchor whose bar has not finished printing by then is
 * stepped back to the previous interval, because nobody could have drawn it yet.
 */
export function anchorBarAt(kind, nowMs, read, { closedBy = null, back = 6 } = {}) {
  const tf = ANCHOR_TF[kind], span = tf * 60000;
  let iv = intervalAt(kind, nowMs);
  for (let i = 0; i <= back; i++) {
    if (closedBy == null || iv.startMs + span <= closedBy) {
      // month/year name the first slot that actually traded, so those still walk forward
      if (kind === 'month') {
        const limit = iv.startMs + 3 * 86400e3;
        for (let t = globex4hOnOrAfter(iv.startMs); t < limit; t = globex4hOnOrAfter(t + 1)) {
          if (closedBy != null && t + span > closedBy) break;
          const b = read(t, tf); if (b) return { ...iv, bar: b, barTf: tf };
        }
      } else if (kind === 'year') {
        const limit = iv.startMs + 5 * 86400e3;
        for (let t = iv.startMs; t < limit; t += span) {
          if (closedBy != null && t + span > closedBy) break;
          const b = read(t, tf); if (b) return { ...iv, bar: b, barTf: tf };
        }
      } else {
        const b = read(iv.startMs, tf);               // the stated bar, or step back a whole interval
        if (b) return { ...iv, bar: b, barTf: tf };
      }
    }
    iv = intervalAt(kind, iv.startMs - 1);
  }
  return { ...intervalAt(kind, nowMs), bar: null, barTf: tf };
}

// ---------------------------------------------------------------------------
// How long a fib set is LIVE, and the 2-hour cycles that mark the span.
//
// The three intraday anchors project from their own anchor time to 15:00 New York the SAME DAY and
// stop there — they are not levels for the whole session, and drawing them across the hours before
// their own anchor (which is what an edge-to-edge line did) shows a level nobody could have had.
// The week, month and year anchors are unchanged: those stay live across their whole interval.
export const FIB_END_H = 15, FIB_END_MI = 0;
export const CYCLE_MIN = 120;
export const INTRADAY_KINDS = ['session', 'preopen', 'bell'];

/**
 * The window an anchor's levels are live for, as [startMs, endMs).
 * Returns null for the calendar scales, which have no intraday cut-off.
 */
export function fibWindow(kind, anchorStartMs) {
  if (!INTRADAY_KINDS.includes(kind)) return null;
  const p = nyParts(anchorStartMs);
  const end = nyEpoch(p.y, p.mo, p.d, FIB_END_H, FIB_END_MI);
  return end > anchorStartMs ? { startMs: anchorStartMs, endMs: end } : null;
}

/**
 * The 2-hour cycle boundaries inside [startMs, endMs), on a grid whose phase is set by `originMs`.
 * Which origin is right is an open question — see scripts/cycles.mjs, which sweeps all 120 phases
 * rather than only the three that were proposed, because the three sit 14 minutes apart and a
 * 3-way comparison cannot tell a winner from the phase either side of it.
 */
export function cycleMarks(startMs, endMs, originMs) {
  const step = CYCLE_MIN * 60000, out = [];
  let t = originMs + Math.ceil((startMs - originMs) / step) * step;
  if (t === startMs) t += step;                       // the anchor itself is not a cycle mark
  for (; t < endMs && out.length < 64; t += step) out.push(t);
  return out;
}
