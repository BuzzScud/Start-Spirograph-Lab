// The Spirograph Lab's instruments (16 Sep, on request: "both, as a choice"): a single banked contract, or a product's
// FRONT MONTH, one continuous series across its rolls.
//
// The front month is chosen per session by VOLUME: a session trades the contract that traded the most in the session
// before it (the first session known uses its own), and a roll never goes back to an earlier expiry. The bars are then
// BACK-ADJUSTED: at each roll the older contract's prices are shifted by the gap between the two at the last minute both
// printed before it, so a roll is not a jump. Moves, and so every grade, are the contract's own; levels before the last
// roll are shifted by that gap. Pure: no DOM, no database.
import { openBefore } from '../engine/dayClock.js';

export const FRONT = 'FRONT:';
const MONTHS = 'FGHJKMNQUVXZ';
// ProjectX's symbols (CON.F.US.<sym>.<month><yy>) and the exchange's roots they trade as
const ROOTS = { ENQ: 'NQ', EP: 'ES', TYA: 'ZN', FVA: 'ZF', TUA: 'ZT', BP6: '6B', CA6: '6C', DA6: '6A', EU6: '6E', JY6: '6J', MX6: '6M', NE6: '6N', SF6: '6S', MNQ: 'MNQ', MES: 'MES', RTY: 'RTY', YMA: 'YM' };

export const isFront = id => typeof id === 'string' && id.startsWith(FRONT);
export const frontId = sym => FRONT + sym;

/** A ProjectX contract id read: { sym: 'ENQ', root: 'NQ', month: 'Z', year: 2026, order, name: 'NQZ6' }; null if it is not one. */
export function parseContract(id) {
  const m = /^CON\.F\.[A-Z]+\.([A-Z0-9]+)\.([FGHJKMNQUVXZ])(\d{2})$/.exec(String(id || ''));
  if (!m) return null;
  const sym = m[1], root = ROOTS[sym] || sym, year = 2000 + +m[3];
  return { sym, root, month: m[2], year, order: year * 12 + MONTHS.indexOf(m[2]), name: `${root}${m[2]}${m[3].slice(1)}` };
}

/** What a series is called: "NQ front month", or the contract's short name. */
export function seriesName(id) {
  if (isFront(id)) { const sym = id.slice(FRONT.length); return `${ROOTS[sym] || sym} front month`; }
  const p = parseContract(id);
  return p ? p.name : String(id || '').replace(/^DEMO\./, '') + (String(id).startsWith('DEMO.') ? ' demo' : '');
}

/** The session (the 6 pm New York open it belongs to) of a bar at `t`, as a day number. */
export const sessionOf = t => openBefore(t).day;

/**
 * The front month per session. `vols` is { contractId: Map(session → volume) }. Returns an ascending list of
 * { session, contract }: each session trades the contract with the most volume in the session before it.
 */
export function frontSchedule(vols) {
  const ids = Object.keys(vols).filter(id => parseContract(id)).sort((a, b) => parseContract(a).order - parseContract(b).order);
  const sessions = [...new Set(ids.flatMap(id => [...vols[id].keys()]))].sort((a, b) => a - b);
  const out = [];
  let cur = null;
  for (let i = 0; i < sessions.length; i++) {
    const look = i ? sessions[i - 1] : sessions[0];   // the session before; the very first has only itself
    let best = null, bestV = -1;
    for (const id of ids) {
      if (cur && parseContract(id).order < parseContract(cur).order) continue;   // a roll never goes back
      const v = vols[id].get(look) || 0;
      if (v > bestV) { best = id; bestV = v; }
    }
    if (!cur || (best && best !== cur && bestV > (vols[cur].get(look) || 0))) cur = best;
    if (cur && vols[cur].has(sessions[i])) out.push({ session: sessions[i], contract: cur });
  }
  return out;
}

/**
 * One continuous, back-adjusted series from each contract's ascending bars `barsBy` { id: [{t, o, h, l, c, v}] }
 * and the schedule. Returns { bars, rolls: [{ at, from, to, gap }] }: `at` the first bar of the new contract.
 */
export function stitch(barsBy, schedule) {
  const bySession = new Map(schedule.map(s => [s.session, s.contract]));
  const merged = [];   // [{ contract, bars }] in time order: a roll never goes back, so each contract is one piece
  for (const id of Object.keys(barsBy)) {
    const bars = barsBy[id].filter(b => bySession.get(sessionOf(b.t)) === id);
    if (bars.length) merged.push({ contract: id, bars });
  }
  merged.sort((a, b) => a.bars[0].t - b.bars[0].t);
  const rolls = [];
  let shift = 0;
  const shifts = new Array(merged.length).fill(0);
  for (let k = merged.length - 1; k > 0; k--) {
    const older = merged[k - 1], newer = merged[k], at = newer.bars[0].t;
    const gap = gapAt(barsBy[older.contract], barsBy[newer.contract], at);
    shift += gap;
    shifts[k - 1] = shift;
    rolls.unshift({ at, from: older.contract, to: newer.contract, gap: Math.round(gap * 100) / 100 });
  }
  const bars = [];
  merged.forEach((p, k) => { const s = shifts[k]; for (const b of p.bars) bars.push(s ? { t: b.t, o: b.o + s, h: b.h + s, l: b.l + s, c: b.c + s, v: b.v } : b); });
  return { bars, rolls };
}

/** newer − older at the last minute before `at` when both printed; 0 if they never did. */
function gapAt(older, newer, at) {
  const o = new Map();
  for (const b of older) if (b.t < at) o.set(b.t, b.c);
  for (let i = newer.length - 1; i >= 0; i--) { const b = newer[i]; if (b.t < at && o.has(b.t)) return b.c - o.get(b.t); }
  return 0;
}

/** Volume per session per contract, from ascending bars. */
export function sessionVolumes(bars) {
  const m = new Map();
  for (const b of bars) { const s = sessionOf(b.t); m.set(s, (m.get(s) || 0) + (b.v || 0) + 1e-6); }   // a bar with no volume still marks the session as traded
  return m;
}
