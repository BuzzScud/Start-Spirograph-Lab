// Previous-day levels: the swing high and low of the last completed session,
// the way a New York desk marks them (PDH · SH, PDL · SL).
//   live       the last completed 00:00–15:00 New York window that traded
//   synthetic  the previous synthetic day (D1–D7)
import { TPM } from './constants.js';

const NY = 'America/New_York';
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: NY, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
/** New York wall-clock parts of an epoch ms. */
export function nyParts(ms) {
  const o = {}; for (const p of fmt.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, dow: o.weekday };
}
/** Epoch ms of a New York wall-clock time. */
export function nyEpoch(y, mo, d, h = 0, mi = 0) {
  const want = Date.UTC(y, mo - 1, d, h, mi); let guess = want;
  for (let k = 0; k < 2; k++) { const p = nyParts(guess); guess -= Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - want; }
  return guess;
}

/** High and low (with their minutes) of the 1-minute candles whose time is in [mStart, mEnd); null if none. */
function scan(cd, mStart, mEnd) {
  let high = -Infinity, low = Infinity, highMin = 0, lowMin = 0, bars = 0;
  for (let j = cd.n - 1; j >= 0 && cd.t[j] >= mStart; j--) {
    const t = cd.t[j]; if (t >= mEnd) continue; bars++;
    if (cd.h[j] > high) { high = cd.h[j]; highMin = t; }
    if (cd.l[j] < low) { low = cd.l[j]; lowMin = t; }
  }
  return bars ? { high, low, highMin, lowMin, bars } : null;
}

/**
 * The previous session's levels for a simulation, or null before there is one.
 * `nowMs` is wall-clock time (live only). Result: { high, low, highMin, lowMin, label, startMin, endMin }.
 */
export function prevDayLevels(sim, nowMs = Date.now()) {
  const cd = sim.candles(1); if (!cd.n) return null;
  if (sim.mode !== 'live') {
    const day = Math.floor(sim.ticks() / TPM / 1440); if (day < 1) return null;
    const mStart = (day - 1) * 1440, r = scan(cd, mStart, day * 1440);
    return r && { ...r, label: `D${(day - 1) % 7 + 1}`, startMin: mStart, endMin: day * 1440 };
  }
  const t0 = sim.live.t0;
  for (let back = 0; back < 8; back++) {
    const p = nyParts(nowMs - back * 86400e3);
    const start = nyEpoch(p.y, p.mo, p.d, 0), end = nyEpoch(p.y, p.mo, p.d, 15);
    if (end > nowMs) continue;
    const r = scan(cd, (start - t0) / 60000, (end - t0) / 60000);
    if (r && r.bars >= 60) return { ...r, label: `${p.dow} ${p.d}`, startMin: (start - t0) / 60000, endMin: (end - t0) / 60000 };
  }
  return null;
}
