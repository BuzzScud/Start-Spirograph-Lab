// The neural network retargeted to turns (16 Sep, "build it all"): the same network as lab/labNet.js (sigmoid hidden
// layer, backpropagation, Adam, walked forward), fed one graded turn call per row and asked two things: the odds the
// call hits a real turn, and how far off it will be. The inputs are the call's geometry and where it falls: the
// circle, its size, how far ahead it was called, the time of day, the kill zone, the market's place against PDH and
// PDL, the kind of turn and the family. Scored as a probability forecast is: its Brier score against always saying
// the base rate, paired call by call, and its calls at over 50% against the base rate. Pure: no DOM, no database.
//
// MODULAR (16 Sep, "make the forecast modular, based on the neural network"): a turn rule (lab/turnRule.js) says which
// groups of inputs the network may learn from; a group switched off reaches it as zeros. The weights after every fit
// are kept, so any call can be given the odds the network had learned before that call's session (pHit), and the
// score is split at the rule's held-back weeks.
import { createNet, train, forward, netWalk, fingerprint, snapshot, pUp, NET } from './labNet.js';
import { sinceOpenMin } from '../engine/dayClock.js';
import { ZONE_IDS } from './labLevels.js';
import { DEFAULT_RULE, netMask } from './turnRule.js';

export const TURN_NET_VERSION = 1;
export const MAX_ROWS = 3000;        // the walk retrains up to 60 times over every row before each call: capped for time
export const MIN_PERIOD = 24;        // the 12m and 6m circles call thousands of turns on two or three closes each; not learned from
export const TURN_INPUTS = ['circle', 'size', 'lead', 'time sin', 'time cos', ...ZONE_IDS.slice(0, 4).map(z => `zone ${z}`), 'vs PDH', 'vs PDL', 'peak', 'kalman'];
export const TURN_NET = { ...NET, hidden: 8 };
const clip = (v, a, b) => Math.max(a, Math.min(b, v));

/** One call's inputs (TURN_INPUTS): `c` needs n, A, at, calledAt, P, zone, kind, fam, and px + level { high, low } for the levels. */
export function turnRow(c) {
  const a = 2 * Math.PI * sinceOpenMin(c.at) / 1440, lv = c.level, rng = lv ? Math.max(1, lv.high - lv.low) : 0;
  return [c.n, Math.log1p(Math.abs(c.A || 0)), clip((c.at - c.calledAt) / (c.P * 60000), 0, 2), Math.sin(a), Math.cos(a),
    ...ZONE_IDS.slice(0, 4).map(z => (c.zone === z ? 1 : 0)),
    lv && Number.isFinite(c.px) ? clip((c.px - lv.high) / rng, -2, 2) : 0, lv && Number.isFinite(c.px) ? clip((c.px - lv.low) / rng, -2, 2) : 0,
    c.kind === 'peak' ? 1 : 0, c.fam === 'kalman' ? 1 : 0];
}

/** Rows from graded calls (labTurns.js gradeCall, hit or miss): { at, y (hit), move (timing miss in laps), x, fam, n }. */
export function turnRows(calls, rule = DEFAULT_RULE) {
  const rows = [];
  for (const c of calls) {
    if ((c.state !== 'hit' && c.state !== 'miss') || c.P < MIN_PERIOD) continue;
    rows.push({ at: c.at, fam: c.fam, n: c.n, y: c.state === 'hit' ? 1 : 0, move: c.state === 'hit' ? Math.abs(c.off) / c.P : 2 * rule.tolShare, x: turnRow(c) });
  }
  rows.sort((a, b) => a.at - b.at);
  if (rows.length <= MAX_ROWS) return rows;
  const every = rows.length / MAX_ROWS, out = [];   // thinned evenly, so the walk still spans the whole range
  for (let i = 0; i < MAX_ROWS; i++) out.push(rows[Math.floor(i * every)]);
  return out;
}

/**
 * Score the walk's calls as probability forecasts: Brier against the base rate (paired, with its standard error), the
 * calls at over 50% against the base rate, and five calibration bins.
 */
export function turnNetScore(rows, calls) {
  const tested = calls.length, out = { v: TURN_NET_VERSION, rows: rows.length, tested, fingerprint: fingerprint(calls) };
  if (tested < 30) return { ...out, ready: false, verdict: `only ${rows.length} rows: the network needs at least 110 (80 to learn from, 30 to call)` };
  let hits = 0, sum = 0;
  for (const c of calls) sum += rows[c.i].y;
  const base = sum / tested;
  let brier = 0, brierBase = 0, dsq = 0, said = 0, saidHit = 0, missSum = 0, missN = 0;
  const bins = Array.from({ length: 5 }, (_, b) => ({ lo: b / 5, hi: (b + 1) / 5, n: 0, p: 0, k: 0 }));
  for (const c of calls) {
    const y = rows[c.i].y, e = (c.p - y) ** 2, e0 = (base - y) ** 2, d = e0 - e;
    brier += e; brierBase += e0; dsq += d * d;
    if (c.p > 0.5) { said++; if (y) saidHit++; }
    if (y) hits++;
    const b = bins[Math.min(4, Math.floor(c.p * 5))]; b.n++; b.p += c.p; b.k += y;
    if (y) { missSum += Math.abs(c.size - rows[c.i].move); missN++; }
  }
  const gain = (brierBase - brier) / tested, se = Math.sqrt(Math.max(0, dsq / tested - gain * gain) / tested);
  Object.assign(out, {
    ready: true, base, brier: brier / tested, brierBase: brierBase / tested, gain, gainBand: 1.96 * se, edge: gain > 1.96 * se && se > 0,
    said, saidRate: said ? saidHit / said : NaN, missLap: missN ? missSum / missN : NaN,
    bins: bins.map(b => ({ lo: b.lo, hi: b.hi, n: b.n, p: b.n ? b.p / b.n : NaN, rate: b.n ? b.k / b.n : NaN })),
  });
  const pct = x => `${Math.round(100 * x)}%`;
  out.verdict = `Brier ${out.brier.toFixed(3)} against ${out.brierBase.toFixed(3)} for always saying the base rate (${pct(base)})`
    + (out.edge ? `: better by more than chance allows; ${said} calls over 50% hit ${pct(out.saidRate)}` : ': no better than the base rate');
  return out;
}

const r6 = v => Math.round(v * 1e6) / 1e6;
// the weights rounded to 1e-6; the scaling kept whole (a near-constant input's spread is tiny, and rounded to 0 it would divide by 0)
const packSnap = sn => ({ d: sn.d, h: sn.h, msd: sn.msd, mu: Array.from(sn.mu), sd: Array.from(sn.sd), ...Object.fromEntries(['W1', 'b1', 'W2', 'b2', 'mask'].map(k => [k, Array.from(sn[k], r6)])) });
/** A score in brief: what a ranking row and the rule page show. */
export const netBrief = s => (s && s.ready ? { ready: true, tested: s.tested, base: s.base, brier: s.brier, brierBase: s.brierBase, gain: s.gain, gainBand: s.gainBand, edge: s.edge, said: s.said, saidRate: s.saidRate }
  : { ready: false, tested: s ? s.tested : 0 });

/**
 * The whole walk at once (the server): rows, the score (all weeks, then the learning and held-back weeks apart), the
 * loss after each fit, and the weights after each fit with the time of the last row it had learned (`snaps`), so pHit
 * can give any later call the odds the network held then. `rule` picks the input groups; `holdFrom` splits the score.
 */
export function turnNetCheck(calls, { rule = DEFAULT_RULE, holdFrom = Infinity, keepSnaps = true } = {}) {
  const rows = turnRows(calls, rule), mask = netMask(rule), cfg = { ...TURN_NET, mask }, out = [], losses = [], snaps = [];
  for (const s of netWalk(rows, cfg)) {
    if (s.kind === 'fit') {
      losses.push(s.losses[s.losses.length - 1]);
      if (keepSnaps) snaps.push({ upTo: s.upTo, lastAt: rows[s.upTo - 1].at, net: packSnap(snapshot(s.net)) });
    } else out.push({ i: s.i, p: s.p, size: s.size });
  }
  const learn = turnNetScore(rows, out.filter(c => rows[c.i].at < holdFrom)), hold = turnNetScore(rows, out.filter(c => rows[c.i].at >= holdFrom));
  return { ...turnNetScore(rows, out), learn: netBrief(learn), hold: netBrief(hold), holdFrom: Number.isFinite(holdFrom) ? holdFrom : null,
    losses: losses.map(v => Math.round(v * 1e4) / 1e4), inputs: TURN_INPUTS, groups: { ...rule.net }, masked: mask ? mask.filter(m => !m).length : 0, snaps };
}

/**
 * The network's odds that call `c` hits (turnRow's fields), as it stood after the last fit on rows before `beforeMs`
 * (the call's session open): walk-forward, never a fit that saw the day. null for a circle it does not learn, or before
 * its first fit.
 */
export function pHit(snaps, c, beforeMs) {
  if (!snaps || !snaps.length || c.P < MIN_PERIOD) return null;
  let s = null;
  for (const q of snaps) if (q.lastAt < beforeMs) s = q; else break;
  return s ? pUp(s.net, turnRow(c)) : null;
}

export { createNet, train, forward };
