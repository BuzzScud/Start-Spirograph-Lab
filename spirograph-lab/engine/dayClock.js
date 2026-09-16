// The Daily set's clock (15 Sep, on request: "the daily circle starts at 6 pm … ensuring the circles rotate based on the
// day"): minutes on a clock where every 6 pm New York is a whole multiple of 1440, so a circle whose period divides a day
// is at its start at every 6 pm open. The 5–6 pm break and the weekend are counted: the user chose that the circles keep
// turning. The one day that is not 1440 minutes long is the Saturday-to-Sunday one across a daylight-saving change (23 or
// 25 hours); the clock re-anchors at the Sunday 6 pm open, while Globex is shut. Pure; runs in Node.
import { nyParts, nyEpoch } from './levels.js';
import { nyDateAdd } from './anchors.js';
import { HOLIDAYS } from './cmeHolidays.js';

const HOUR = 3600000, DAY_MS = 86400000;
const memo = new Map();   // New York's offsets are whole hours, so every UTC hour has one 6 pm at or before it

/** The 6 pm New York at or before `ms` (epoch ms), and its New York date as a day number. */
export function openBefore(ms) {
  const k = Math.floor(ms / HOUR);
  let a = memo.get(k);
  if (!a) {
    const p = nyParts(k * HOUR), d = p.h >= 18 ? p : nyDateAdd(p.y, p.mo, p.d, -1);
    a = { ms: nyEpoch(d.y, d.mo, d.d, 18, 0), day: Math.round(Date.UTC(d.y, d.mo - 1, d.d) / DAY_MS) };
    if (memo.size > 50000) memo.clear();
    memo.set(k, a);
  }
  return a;
}
/** Minutes on the day clock at `ms`: every 6 pm New York is a multiple of 1440. */
export function dayClockMin(ms) { const a = openBefore(ms); return a.day * 1440 + (ms - a.ms) / 60000; }
/** Minutes since the last 6 pm New York. */
export function sinceOpenMin(ms) { return (ms - openBefore(ms).ms) / 60000; }

// THE TREND'S CLOCK (15 Sep, the fix for "the fit's trend keeps running through the weekend"). The circles keep the 24h
// day, but a trend is a move per TRADED minute, so it counts Globex's minutes only: the weekend, the 5–6 pm break and a
// holiday's early halt add none. On the 24h clock the Mon 14 Sep replay opened the pen +187 pts above Friday's close, from
// 2,940 weekend minutes of trend. A session opens at 6 pm Sunday to Thursday and trades 23 h (1,380 min) to 5 pm, cut
// short or skipped by cmeHolidays.js; Friday and Saturday evenings open nothing.
const SESSION_MIN = 1380;
const DOW = day => (((day + 4) % 7) + 7) % 7;   // day 0 (1 Jan 1970) was a Thursday; 0 = Sunday
const HOL_BY_OPEN = new Map();   // day number of a holiday session's 6 pm open → the minutes it trades
for (const [date, h] of Object.entries(HOLIDAYS)) {
  const [y, mo, d] = date.split('-').map(Number), open = Math.round(Date.UTC(y, mo - 1, d) / DAY_MS) - 1;
  if (DOW(open) === 5 || DOW(open) === 6) continue;
  if (h.closed) { HOL_BY_OPEN.set(open, 0); continue; }
  const [ch, cm] = h.close.split(':').map(Number);
  HOL_BY_OPEN.set(open, 360 + ch * 60 + cm);   // 6 pm to midnight, then midnight to the halt
}
/** Minutes Globex trades in the session that opens at 6 pm New York on day number `day`. */
export function sessionMin(day) {
  const w = DOW(day);
  if (w === 5 || w === 6) return 0;
  const h = HOL_BY_OPEN.get(day);
  return h == null ? SESSION_MIN : h;
}
const cum = new Map();
/** Minutes traded in every session that opened before day number `day`. */
function tradedBefore(day) {
  let v = cum.get(day);
  if (v === undefined) {
    const wk = Math.floor(day / 7);
    let n = 5 * wk;   // each whole week holds five openings, Sunday to Thursday
    for (let d = wk * 7; d < day; d++) { const w = DOW(d); if (w !== 5 && w !== 6) n++; }
    v = n * SESSION_MIN;
    for (const [d, len] of HOL_BY_OPEN) if (d < day) v -= SESSION_MIN - len;
    if (cum.size > 50000) cum.clear();
    cum.set(day, v);
  }
  return v;
}
/** Globex trading minutes at `ms`: never falls, and stands still whenever Globex is shut. */
export function tradeMin(ms) {
  const a = openBefore(ms);
  return tradedBefore(a.day) + Math.min(sessionMin(a.day), Math.max(0, (ms - a.ms) / 60000));
}
