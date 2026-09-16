// Number, time and timeframe formatting used by the charts, tooltips and exports.
export function trim1(x) { return (Math.round(x * 10) / 10).toString(); }
export function fmtPeriod(P) {
  if (P >= 80 * 1440) return trim1(P / (365.25 * 1440)) + 'y';
  const weeks = P / 10080;
  if (P >= 20 * 1440 && P < 50 * 1440 && Math.abs(weeks - Math.round(weeks)) > 0.15) return trim1(P / (30.437 * 1440)) + 'mo';
  if (P >= 10080) return Math.abs(weeks - Math.round(weeks)) <= 0.08 ? trim1(weeks) + 'w' : trim1(P / 1440) + 'd';
  if (P >= 1440) return trim1(P / 1440) + 'd'; if (P >= 60) return trim1(P / 60) + 'h'; if (P >= 1) return trim1(P) + 'm'; return Math.round(P * 60) + 's';
}
export function fmtInt(p) { return Math.round(p).toLocaleString('en-US'); }
export function fmtPx(p) { return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export function fmtTF(tf) { return tf === 1440 ? 'D' : tf >= 60 ? (tf / 60) + 'H' : tf + 'm'; }
export function fmtTime(m) { const wk = Math.floor(m / 10080) + 1, d = Math.floor(m / 1440) % 7 + 1, hh = Math.floor((m % 1440) / 60), mm = Math.floor(m % 60); return `W${wk} D${d} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }
export function fmtSecs(s) { return s >= 60 ? trim1(s / 60) + ' min' : Math.round(s) + ' s'; }
export function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= x) return m * p; return 10 * p; }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
// Real time for live sessions: `t0` is the epoch ms of tick 0, `m` minutes after it.
//
// NEW YORK, NOT THE BROWSER'S CLOCK. The Globex day, the fire's two-hour blocks, the band's
// hour-of-day and the previous session's high and low are all New York; axis labels drawn in
// whatever zone the reader happened to be in put the cash open at 14:30 on the chart beside a
// card that called it 09:30. One session, one clock. Memoised per minute, because these are
// asked for once per axis label per frame and Intl is not free.
import { nyParts } from './levels.js';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = n => String(n).padStart(2, '0');
const partsCache = new Map();
function nyAt(ms) {
  const key = Math.floor(ms / 60000); let p = partsCache.get(key);
  if (p === undefined) { p = nyParts(ms); if (partsCache.size > 1 << 16) partsCache.clear(); partsCache.set(key, p); }
  return p;
}
export function fmtRealDay(t0, m) { const p = nyAt(t0 + m * 60000); return `${p.dow} ${p.d} ${MONTHS[p.mo - 1]}`; }
export function fmtRealClock(t0, m) { const p = nyAt(t0 + m * 60000); return `${two(p.h)}:${two(p.mi)}`; }
export function fmtRealTime(t0, m) { return `${fmtRealDay(t0, m)} ${fmtRealClock(t0, m)}`; }
export function fmtAgo(ms) { if (ms < 0 || !Number.isFinite(ms)) return '—'; const s = Math.round(ms / 1000); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`; }
// Rounded to the unit it shows before it is split in two: rounding the remainder after the split printed 59.6 min as
// "60m", 20h 59.6m as "20h 60m" and 2d 23.6h as "2d 24h".
export function fmtDur(min) { if (!Number.isFinite(min)) return '—'; const s = Math.round(min * 60); if (s < 60) return s + 's'; const m = Math.round(min); if (m < 60) return m + 'm'; if (m < 1440) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h`; } const hrs = Math.round(min / 60), d = Math.floor(hrs / 24), h = hrs % 24; return h ? `${d}d ${h}h` : `${d}d`; }
