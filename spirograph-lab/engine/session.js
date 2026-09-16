// When CME Globex is open, in New York time: Sunday 18:00 to Friday 17:00, with a daily halt from
// 17:00 to 18:00. Holidays are not modelled. The alerts' "only while the market is open" and the
// demo feed both read this.
//
// The desk's own marketShut (forecast.js) is stricter — it calls 15:00 to 18:00 shut, because its
// fire blocks end at 15:00 — and the copied Unrolled chart keeps that shading, as the desk draws it.
import { nyParts } from './levels.js';

const STEP = 15 * 60000;   // every boundary is on the hour, so one answer holds for a quarter hour
const memo = new Map();

/** Whether Globex is trading at epoch ms `ms`. */
export function globexOpen(ms) {
  const k = Math.floor(ms / STEP);
  let v = memo.get(k);
  if (v === undefined) {
    v = openAt(k * STEP);
    if (memo.size > 20000) memo.clear();
    memo.set(k, v);
  }
  return v;
}

function openAt(ms) {
  const p = nyParts(ms);
  if (p.dow === 'Sat') return false;
  if (p.dow === 'Sun') return p.h >= 18;
  if (p.dow === 'Fri') return p.h < 17;
  return p.h !== 17;
}
