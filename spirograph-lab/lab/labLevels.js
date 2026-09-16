// The session's levels and windows (16 Sep, on request: "attach price charts to the circles and identify ICT kill
// zones and PDH and PDL, use the math from the Trading Platform"). Two things the Trading Platform marks that a turn
// can be read against:
//
//   PDH / PDL   the previous day's high and low, THE CHART'S RULE (desks/chart views/app/chart.js prevDayLevels, and the
//               Ladder's levels.js): the last completed New York calendar day, midnight to 3 pm, never the session in
//               progress. Not the research tools' Globex-session rule (tools/pdh_ny.py: 6 pm roll). At a 6 pm open the
//               previous day is that same afternoon's 00:00–15:00, so one pair of levels serves a whole session.
//   Kill zones  the ICT windows, New York time: Asia 8 pm–12 am, London 2–5 am, New York AM 8:30–11 am, New York PM
//               1:30–4 pm. The Trading Platform has no kill-zone code; it studies 2-hour windows from 6 pm and the
//               8–10 and 10–12 windows, so these hours are the standard ones, kept here in one table.
//
// The hunt rule is the Trading Platform's own (pdh_ny.py pick, rule "untagged"): a level the session has not yet tagged
// is the one price is expected to run to. Pure: no DOM, no database.
import { nyParts, nyEpoch } from '../engine/levels.js';
import { nyDateAdd } from '../engine/anchors.js';
import { sinceOpenMin, openBefore } from '../engine/dayClock.js';

const M = 60000, DAY = 86400e3;
export const PD_END_H = 15;          // the previous day's window closes at 3 pm New York (the chart's PD_WINDOW_END_MIN)
export const PD_MIN_BARS = 60;       // a day with fewer traded minutes in its window has no levels (the chart's rule)
export const LEVEL_SHARE = 0.05;     // "at the level": within this share of the previous day's range, at least LEVEL_MIN_PTS
export const LEVEL_MIN_PTS = 2;

/** The kill zones on the day clock (minutes since 6 pm New York), with the New York hours they stand for. */
export const KILL_ZONES = [
  { id: 'asia', name: 'Asia', a: 120, b: 360, hours: '8 pm – 12 am' },
  { id: 'london', name: 'London', a: 480, b: 660, hours: '2 – 5 am' },
  { id: 'nyam', name: 'New York AM', a: 870, b: 1020, hours: '8:30 – 11 am' },
  { id: 'nypm', name: 'New York PM', a: 1170, b: 1320, hours: '1:30 – 4 pm' },
];
export const ZONE_IDS = [...KILL_ZONES.map(z => z.id), 'none'];
/** The kill zone minute `m` of the day clock falls in, or null. */
export const zoneOfMin = m => { for (const z of KILL_ZONES) if (m >= z.a && m < z.b) return z.id; return null; };
/** The kill zone epoch ms `ms` falls in, or null. */
export const zoneAt = ms => zoneOfMin(sinceOpenMin(ms));
export const zoneName = id => (KILL_ZONES.find(z => z.id === id) || { name: 'outside the zones' }).name;

function lowerBound(bars, t) { let lo = 0, hi = bars.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].t < t) lo = mid + 1; else hi = mid; } return lo; }

/**
 * The previous day's high and low as of epoch ms `atMs`, from ascending one-minute `bars`: the last completed New York
 * calendar day's 00:00–15:00 window that traded PD_MIN_BARS minutes or more, read from bars whose minute closed by
 * `atMs`. { high, low, highAt, lowAt, range, day (New York date key), start, end } or null.
 */
export function prevDayLevels(bars, atMs) {
  for (let back = 0; back < 8; back++) {
    const p = nyParts(atMs - back * DAY), start = nyEpoch(p.y, p.mo, p.d, 0), end = nyEpoch(p.y, p.mo, p.d, PD_END_H);
    if (end > atMs) continue;
    const i0 = lowerBound(bars, start), i1 = lowerBound(bars, end);
    if (i1 - i0 < PD_MIN_BARS) continue;
    let high = -Infinity, low = Infinity, highAt = 0, lowAt = 0;
    for (let i = i0; i < i1; i++) { const b = bars[i]; if (b.h > high) { high = b.h; highAt = b.t; } if (b.l < low) { low = b.l; lowAt = b.t; } }
    return { high, low, highAt, lowAt, range: high - low, day: `${p.y}-${p.mo}-${p.d}`, start, end };
  }
  return null;
}

/**
 * The levels of every session in [fromMs, toMs): a Map from the session's day number (dayClock.js openBefore) to its
 * prevDayLevels as of its 6 pm open. levelsAt reads it for any moment.
 */
export function sessionLevels(bars, fromMs, toMs) {
  const out = new Map();
  for (let ms = fromMs; ms < toMs + DAY; ms += DAY) {
    const o = openBefore(ms);
    if (!out.has(o.day)) out.set(o.day, prevDayLevels(bars, o.ms));
  }
  return out;
}
export const levelsAt = (map, ms) => map.get(openBefore(ms).day) || null;

/** Where `price` stands against the levels: { tag: 'PDH' | 'PDL' | null (at the level), side: 'above' | 'inside' | 'below' }. */
export function levelTag(price, lv) {
  if (!lv || !Number.isFinite(price)) return { tag: null, side: null };
  const tol = Math.max(LEVEL_MIN_PTS, LEVEL_SHARE * lv.range);
  const tag = Math.abs(price - lv.high) <= tol ? 'PDH' : Math.abs(price - lv.low) <= tol ? 'PDL' : null;
  return { tag, side: price > lv.high ? 'above' : price < lv.low ? 'below' : 'inside', tol };
}
/** The tag's word for a table: 'at PDH', 'at PDL', 'between', 'above PDH', 'below PDL'. */
export const tagWord = ({ tag, side }) => (tag ? `at ${tag}` : side === 'above' ? 'above PDH' : side === 'below' ? 'below PDL' : side === 'inside' ? 'between' : 'no levels');
export const TAG_KEYS = ['at PDH', 'at PDL', 'between', 'above PDH', 'below PDL'];

/**
 * The Trading Platform's "untagged" hunt (tools/pdh_ny.py pick): the level the session has not yet run to is the one
 * price is expected to reach. `runHi`/`runLo`: the session's high and low so far. { side: 'long' | 'short', target,
 * stop } or null when both are tagged or the levels are not usable.
 */
export function huntSide(px, lv, runHi, runLo) {
  if (!lv || !(lv.high > lv.low)) return null;
  const taggedH = runHi >= lv.high, taggedL = runLo <= lv.low;
  if (!taggedH && px < lv.high) return { side: 'long', target: lv.high, stop: lv.low };
  if (!taggedL && px > lv.low) return { side: 'short', target: lv.low, stop: lv.high };
  return null;
}

/** The New York date key of the day holding `ms`, stepped by `days` (noon-safe). */
export function dayKey(ms, days = 0) { const p = nyParts(ms); const q = days ? nyDateAdd(p.y, p.mo, p.d, days) : p; return `${q.y}-${q.mo}-${q.d}`; }
export { M as MINUTE };
