// The fire: a direction call at every two-hour boundary of the Globex day, graded later against
// the bar that printed. Pure, so the page, the relay's backfill and the tests share one rule.
//
// The day runs 18:00 → 15:00 New York and is cut into two-hour blocks from 18:00; the last block,
// 14:00 → 15:00, is an hour. Nothing fires between 15:00 and 18:00.
//
// FIRE RULE v1 — stated here before any result was read, and not changed to improve a number.
// A change is a committed diff with a reason, a new FIRE_RULE, and every earlier fire re-graded
// under its own version, never mixed into a table with this one.
//
//   when     the first frame at or after a block boundary, on a live instrument with a fit
//   side     the sign of the fitted ladder's own change from now to the end of the block
//            (its level is not used: the model's standing residual is not a call)
//   entry    the last price at the fire
//   horizon  to the end of the block: 120 min, 60 for the 14:00 block
//   graded   the close of the minute before the horizon, hit when its sign from entry matches
//   control  the previous block's direction, reversed — recorded with every fire and printed
//            beside the record, so a bracket that merely harvests reversion cannot pass as skill
//   edge     the card names a side always, but calls it thin unless the graded record's 95%
//            Wilson interval clears the majority class of the outcomes it was graded on
import { nyParts, nyEpoch } from './levels.js';
import { wilson } from './stats.js';

export { wilson };   // the fire card and the backfill script read it from here

export const FIRE_RULE = 'fire-v1';
export const BLOCK_MIN = 120;
export const DAY_OPEN_H = 18, DAY_CLOSE_H = 15;
export const MIN_RECORD = 30;   // graded fires before an edge may be claimed at all
const M = 60000, DAY = 86400e3;

/** The Globex day holding `ms`: {open, close} in ms, 18:00 NY the day before through 15:00 NY. */
export function globexDay(ms) {
  const p = nyParts(ms); let open = nyEpoch(p.y, p.mo, p.d, DAY_OPEN_H, 0);
  if (ms < open) open = nyEpoch(...ymd(open - DAY), DAY_OPEN_H, 0);
  const q = nyParts(open + DAY); return { open, close: nyEpoch(q.y, q.mo, q.d, DAY_CLOSE_H, 0) };
}
const ymd = ms => { const p = nyParts(ms); return [p.y, p.mo, p.d]; };
/** The block holding `ms`: {start, end, idx}, or null in the 15:00 → 18:00 gap. */
export function blockAt(ms) {
  const d = globexDay(ms); if (ms >= d.close) return null;
  const idx = Math.floor((ms - d.open) / (BLOCK_MIN * M)), start = d.open + idx * BLOCK_MIN * M;
  return { start, end: Math.min(start + BLOCK_MIN * M, d.close), idx, open: d.open, close: d.close };
}
/** The first boundary strictly after `ms` at which a fire is due. */
export function nextBoundary(ms) {
  const b = blockAt(ms);
  if (b && b.end < globexDay(ms).close) return b.end;
  const d = globexDay(ms); return b ? nyEpoch(...ymd(d.close), DAY_OPEN_H, 0) : d.open > ms ? d.open : nyEpoch(...ymd(d.open + DAY), DAY_OPEN_H, 0);
}
/** Whether `ms` sits on a boundary, to the minute. */
export function isBoundary(ms) { const b = blockAt(ms); return !!b && Math.floor(ms / M) === Math.floor(b.start / M); }

/** The traded price nearest `ms` in a live sim, walking forward through a closed stretch; null off the buffer. */
export function priceAt(sim, ms, tpm) {
  if (sim.mode !== 'live' || !sim.live) return null;
  let i = Math.round((ms - sim.live.t0) / M * tpm) - sim.tick0;
  for (let k = 0; k < 90 * tpm; k++, i++) { if (i < 0) continue; if (i >= sim.n) return null; if (sim.marketOpen(i)) return sim.MKT[i]; }
  return null;
}
/**
 * The call at `nowMs` for a live sim with a fit. Returns null when there is no block, no fit,
 * or no price. `move` is the model's own change over the horizon; the side is its sign, and
 * a model that does not move at all leans with its drift so a side is always named.
 */
export function decide(sim, nowMs, tpm) {
  const b = blockAt(nowMs); if (!b || sim.mode !== 'live' || !sim.live || !sim.live.fit) return null;
  const entry = sim.live.quoteAt ? sim.live.quote : (sim.n ? sim.MKT[sim.n - 1] : null); if (!Number.isFinite(entry)) return null;
  const horizon = Math.round((b.end - nowMs) / M); if (horizon < 5) return null;
  const now = sim.simMin, target = sim.modelAt(now + horizon), move = target - sim.modelAt(now);
  const side = move > 0 ? 1 : move < 0 ? -1 : (sim.G.drift >= 0 ? 1 : -1);
  return { rule: FIRE_RULE, t: nowMs, horizon, side, entry, target: entry + move, move, ctrlRev: controlReverse(sim, b, tpm), block: b };
}
/** The frozen control: the previous block's direction, reversed. 0 when the previous block did not trade. */
export function controlReverse(sim, block, tpm) {
  const a = priceAt(sim, block.start - BLOCK_MIN * M, tpm), z = priceAt(sim, block.start - M, tpm);
  return a === null || z === null ? 0 : -Math.sign(z - a);
}
/** The close that grades a fire: the last bar inside [t, t + horizon) — the minute before the horizon when it traded. Null when nothing traded. */
export function horizonClose(bars, fire) {
  const end = fire.t + fire.horizon * M; let c = null;
  for (const b of bars) { if (b.t < fire.t) continue; if (b.t >= end) break; c = b.c; }
  return c;
}
/**
 * Grade a fire against the close at its horizon.
 *
 * `hit` is FIRE RULE v1 unchanged: the sign of the move from entry, and a close that lands exactly
 * on the entry matches neither side and so is a miss. `up` is not part of the rule — it is the
 * bookkeeping the majority-class baseline is built from — and a flat close belongs to NEITHER
 * class, so it is null and drops out of that denominator instead of being counted as a down.
 * Folding it into "down" made the baseline the caller is measured against a different sample
 * from the one the caller was scored on.
 */
export function grade(fire, close) {
  const d = close - fire.entry, dir = Math.sign(d);
  return { close, pts: fire.side * d, hit: dir === 0 ? 0 : dir === fire.side ? 1 : 0, ctrlHit: fire.ctrlRev && dir ? (fire.ctrlRev === dir ? 1 : 0) : null, up: dir > 0 ? 1 : dir < 0 ? 0 : null };
}
/**
 * The majority class of a record's outcomes: the share the better of "up" and "down" holds among
 * the fires that HAD a direction. `upN` is that count; a record without it (an older row) falls
 * back to n, which is the same number whenever no close landed exactly on its entry.
 */
export function majorityOf(record) {
  if (!record) return NaN;
  const un = record.upN ?? record.n, ups = record.ups || 0;
  return un ? Math.max(ups, un - ups) / un : NaN;
}

/**
 * What the card may say about a record {n, hits, ups, upN}: the majority class of the graded
 * outcomes is the bar, and the call is thin until the record's Wilson low clears it on at least
 * MIN_RECORD fires. A thin call still names its side: it was asked for, and the sentence says
 * what it is worth.
 */
export function verdict(record) {
  const n = record ? record.n : 0; if (!n) return { thin: true, edge: false, majority: NaN, w: wilson(0, 0), text: 'no graded fires yet' };
  const majority = majorityOf(record), w = wilson(record.hits, n), pp = v => (100 * v).toFixed(0);
  const edge = n >= MIN_RECORD && Number.isFinite(majority) && w.lo > majority;
  const text = edge ? `${pp(w.p)}% right over ${n} fires · 95% interval ${pp(w.lo)}–${pp(w.hi)}% clears the ${pp(majority)}% majority` : n < MIN_RECORD ? `${record.hits} of ${n} right · fewer than ${MIN_RECORD} graded fires, so no edge can be claimed yet` : `${pp(w.p)}% right over ${n} fires · 95% interval ${pp(w.lo)}–${pp(w.hi)}% does not clear the ${pp(majority)}% majority · treat as a coin`;
  return { thin: !edge, edge, majority, w, text };
}
