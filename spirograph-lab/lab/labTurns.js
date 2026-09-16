// The turn rule (16 Sep, on request: "can we change the turn call rule? can we build one correctly?"). The old rule
// (freeze.js gradeTurn) never asked whether the market turned: it took the highest close in a half-lap window and
// checked it sat near the call, threw the window's edges away, and compared the rest with two fixed constants. This one:
//
//   1. REAL TURNS are found first, without the model: a swing high (low) on one-minute closes that no close within an
//      eighth of the circle's lap on either side beats, alternating high and low (structure.js's rule, on closes).
//   2. A CALL is a circle's next peak or trough, made at `calledAt` from bars before it and nothing later.
//   3. A HIT is a real turn of the same kind within an eighth of a lap of the call. The timing error is kept.
//   4. THE NULL IS MEASURED, three ways, each scored by the same rule on the same days: the same calls at random traded
//      minutes of their own session; the same calls at the same wall-clock times a session earlier and later (the
//      Daily set's phases are locked to 6 pm, so its times repeat every day: this is the hardest null for it); and the
//      real turns shifted round the session. Skill is the hit rate above the hardest of the three, with an interval
//      bootstrapped over sessions (stats.js clusterCI), since one session's turns are not independent trials.
//   5. Every call is tagged with its kill zone and where the market stood against PDH and PDL when the turn was due,
//      so the record can say where the circles work, if anywhere. The nulls are tagged the same way.
//
// Pure: no DOM, no database. The server grades with it; the page reads the report and the day's calls.
import { globexOpen } from '../engine/session.js';
import { openBefore } from '../engine/dayClock.js';
import { wilson, clusterCI } from '../engine/stats.js';
import { zoneAt, levelsAt, levelTag, tagWord, ZONE_IDS, TAG_KEYS } from './labLevels.js';

const M = 60000;
export const TURNS_VERSION = 1;
export const FAMILIES = [{ id: 'daily', name: 'Daily set', note: 'phases locked to 6 pm' }, { id: 'kalman', name: 'Kalman rungs', note: 'phases free, read every closed minute' }];
export const MIN_GRADED = 30;      // calls a cell needs before it is judged
export const NULL_REPS = 60;       // random draws behind the random and shift nulls
export const TOL_SHARE = 1 / 8;    // a hit is within this share of a lap of the call; a real turn beats every close this far either side
export const TOL_MIN = 1;          // minutes: the floor of that tolerance, one-minute closes cannot place a turn finer
export const FLAT = 0.5;           // points: a circle smaller than this calls no turns (filterRecord.js FLAT)
/** The swing's reach in minutes for a circle of P minutes: the closes either side a real turn must beat. */
export const swingMin = P => Math.max(2, Math.round(P * TOL_SHARE));
/** The tolerance in minutes for a circle of P minutes. */
export const tolMin = P => Math.max(TOL_MIN, P * TOL_SHARE);

function mulberry32(a) {
  return () => { let t = (a += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function lowerBound(arr, n, x) { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; } return lo; }

/**
 * The market's real turns for a circle of `P` minutes, from typed closes { t, p, n } (freeze.js closesFromBars): each
 * a close that no other close within P/8 minutes (at least 2) on either side beats (a tie is allowed), alternating peak
 * and trough, the more extreme kept when two of a kind meet with no shut market between them. { t: Float64Array, k: Uint8Array (1 peak), p: Float64Array, n }.
 */
export function realTurns(closes, P) {
  const s = swingMin(P), n = closes.n, t = closes.t, p = closes.p, piv = [];
  for (let i = s; i < n - s; i++) {
    if (t[i + s] - t[i - s] > (2 * s + 5) * M) continue;   // the window spans a shut market (more than five minutes missing): not a swing this data can show
    let isH = true, isL = true;
    for (let j = i - s; j <= i + s && (isH || isL); j++) { if (j === i) continue; if (p[j] > p[i]) isH = false; if (p[j] < p[i]) isL = false; }   // a tie with a neighbour is still a turn: the merge below keeps one
    if (isH && isL) continue;   // a flat stretch: no turn
    if (isH) piv.push({ t: t[i], k: 1, p: p[i], i }); else if (isL) piv.push({ t: t[i], k: 0, p: p[i], i });
  }
  // alternate: two of a kind in a row are one turn (the more extreme), unless a shut market lies between them, where
  // the turn of the other kind fell and could not be seen
  const alt = [];
  for (const q of piv) {
    const last = alt[alt.length - 1];
    if (last && last.k === q.k && q.t - last.t <= (q.i - last.i + 5) * M) { if (q.k ? q.p > last.p : q.p < last.p) alt[alt.length - 1] = q; } else alt.push(q);
  }
  return { t: Float64Array.from(alt, q => q.t), k: Uint8Array.from(alt, q => q.k), p: Float64Array.from(alt, q => q.p), n: alt.length };
}
/** realTurns for every period in `periods`: a Map P → turns. */
export function realTurnsByPeriod(closes, periods) { return new Map([...new Set(periods)].map(P => [P, realTurns(closes, P)])); }

/** The nearest real turn of `kind` (1 peak) to epoch ms `at` within `tolMs`, or null: { i, off (minutes, + late), price }. */
export function nearestTurn(real, at, kind, tolMs) {
  let best = null;
  const i0 = lowerBound(real.t, real.n, at - tolMs);
  for (let i = i0; i < real.n && real.t[i] <= at + tolMs; i++) {
    if (real.k[i] !== kind) continue;
    const off = (real.t[i] - at) / M;
    if (!best || Math.abs(off) < Math.abs(best.off)) best = { i, off, price: real.p[i] };
  }
  return best;
}
/** The last close at or before `at`, or NaN. */
export function closeAt(closes, at) { const i = lowerBound(closes.t, closes.n, at + 1) - 1; return i >= 0 ? closes.p[i] : NaN; }

/**
 * Grade one call { fam, n, P, at, kind ('peak' | 'trough'), calledAt, A } against the real turns of its period, the
 * closes and the levels, at `nowMs`. Adds state ('hit' | 'miss' | 'ahead' | 'shut' | 'late'), off, zone, tag (where
 * the market stood against PDH and PDL when the turn was due), px (that close) and level (the levels in force).
 * A call is LATE, and not graded, when it was made after the real turn's own window had opened (the model had read
 * closes the swing is judged on): the call must come at least swingMin(P) minutes before the turn.
 */
export function gradeCall(call, real, closes, levels, nowMs) {
  const tolMs = tolMin(call.P) * M, zone = zoneAt(call.at) || 'none';
  if (!globexOpen(call.at)) return { ...call, state: 'shut', zone };
  if (call.calledAt > call.at - swingMin(call.P) * M) return { ...call, state: 'late', zone };
  if (call.at + Math.max(tolMs, swingMin(call.P) * M) > nowMs) return { ...call, state: 'ahead', zone };
  const px = closeAt(closes, call.at), lv = levelsAt(levels, call.at), lt = levelTag(px, lv);
  const near = nearestTurn(real, call.at, call.kind === 'peak' ? 1 : 0, tolMs);
  return { ...call, state: near ? 'hit' : 'miss', off: near ? near.off : null, turnPx: near ? near.price : null, zone, tag: tagWord(lt), px, level: lv ? { high: lv.high, low: lv.low } : null };
}

/** The calls' sessions: a Map from day number → { open, i0, i1 } (the closes stamped in that session). */
function sessionsOf(closes) {
  const out = new Map();
  for (let i = 0; i < closes.n; i++) {
    const o = openBefore(closes.t[i]), s = out.get(o.day);
    if (s) s.i1 = i + 1; else out.set(o.day, { open: o.ms, i0: i, i1: i + 1 });
  }
  return out;
}

const cellKeys = (fam, n, zone, tag) => ['all', `f:${fam}`, `c:${fam}|${n}`, `z:${fam}|${zone}`, `zc:${fam}|${n}|${zone}`, `l:${fam}|${tag}`, `lc:${fam}|${n}|${tag}`];

/** Add one graded outcome to `cells` (key → Map session → { k, n }). */
function tally(cells, keys, session, hit) {
  for (const key of keys) {
    let m = cells.get(key); if (!m) { m = new Map(); cells.set(key, m); }
    const c = m.get(session) || { k: 0, n: 0 }; c.n++; if (hit) c.k++; m.set(session, c);
  }
}
const pooled = m => { let k = 0, n = 0; for (const c of m.values()) { k += c.k; n += c.n; } return { k, n }; };

/**
 * Score graded calls against the three nulls. `calls` are gradeCall's outputs (only hit/miss are used), `realByP`
 * realTurnsByPeriod's map, `closes` and `levels` the ones they were graded with. Returns the report: every cell
 * (family, circle, zone, level tag) with its rate, its interval, each null's rate and the verdict.
 */
export function turnReport(calls, realByP, closes, levels, { reps = NULL_REPS, seed = 7 } = {}) {
  const graded = calls.filter(c => c.state === 'hit' || c.state === 'miss'), sessions = sessionsOf(closes), rnd = mulberry32(seed);
  const real = new Map(), nulls = { random: new Map(), clock: new Map(), shift: new Map() };
  const sessionOf = at => openBefore(at).day;
  // the real outcome
  for (const c of graded) tally(real, cellKeys(c.fam, c.n, c.zone, c.tag), sessionOf(c.at), c.state === 'hit');
  // a null draw: the same call at another time, tagged and graded the same way
  const score = (c, at) => {
    if (!globexOpen(at)) return null;
    const px = closeAt(closes, at), tag = tagWord(levelTag(px, levelsAt(levels, at)));
    const near = nearestTurn(realByP.get(c.P), at, c.kind === 'peak' ? 1 : 0, tolMin(c.P) * M);
    return { keys: cellKeys(c.fam, c.n, zoneAt(at) || 'none', tag), hit: !!near };
  };
  const draws = { random: [], shift: [] };   // per rep: cells
  for (let r = 0; r < reps; r++) {
    const cellsR = new Map(), cellsS = new Map(), offs = new Map();
    for (const c of graded) {
      const day = sessionOf(c.at), s = sessions.get(day); if (!s) continue;
      const frac = ((c.at % M) + M) % M, at = closes.t[s.i0 + Math.floor(rnd() * (s.i1 - s.i0))] + frac, g = score(c, at);   // a random traded minute, the call's own fraction of a minute kept
      if (g) tally(cellsR, g.keys, day, g.hit);
      let u = offs.get(day); if (u === undefined) { u = 30 + Math.floor(rnd() * 1320); offs.set(day, u); }   // one shift a session, at least half an hour
      const span = 1380, m = ((c.at - s.open) / M + u) % span, at2 = s.open + m * M, g2 = score(c, at2);
      if (g2) tally(cellsS, g2.keys, day, g2.hit);
    }
    draws.random.push(cellsR); draws.shift.push(cellsS);
  }
  // the clock null: the same wall-clock minute a session earlier and later
  const cellsC = new Map();
  for (const c of graded) {
    for (const d of [-1, 1]) {
      const at = c.at + d * 86400e3, s = sessions.get(sessionOf(at)); if (!s || at < closes.t[s.i0] || at > closes.t[s.i1 - 1]) continue;
      const g = score(c, at); if (g) tally(cellsC, g.keys, sessionOf(c.at), g.hit);
    }
  }
  const NULLS = ['random', 'clock', 'shift'];
  const cells = {};
  for (const [key, m] of real) {
    const { k, n } = pooled(m), w = wilson(k, n), ci = m.size >= 2 ? clusterCI([...m.values()], 2000) : { lo: NaN, hi: NaN };
    const cell = { k, n, rate: n ? k / n : NaN, lo: Number.isFinite(ci.lo) ? ci.lo : w.lo, hi: Number.isFinite(ci.hi) ? ci.hi : w.hi, sessions: m.size, null: {} };
    for (const nm of NULLS) {
      if (nm === 'clock') { const c = cellsC.get(key); const p = c ? pooled(c) : { k: 0, n: 0 }; cell.null.clock = { mean: p.n ? p.k / p.n : NaN, n: p.n }; continue; }
      const rates = draws[nm].map(cs => { const c = cs.get(key); const p = c ? pooled(c) : { k: 0, n: 0 }; return p.n ? p.k / p.n : NaN; }).filter(Number.isFinite).sort((a, b) => a - b);
      cell.null[nm] = rates.length ? { mean: rates.reduce((a, b) => a + b, 0) / rates.length, hi: rates[Math.min(rates.length - 1, Math.floor(0.975 * rates.length))], lo: rates[Math.floor(0.025 * rates.length)] } : { mean: NaN };
    }
    const means = NULLS.map(nm => cell.null[nm].mean).filter(Number.isFinite);
    cell.hardest = means.length ? Math.max(...means) : NaN;
    cell.hardestName = NULLS.find(nm => cell.null[nm].mean === cell.hardest) || null;
    cell.skill = Number.isFinite(cell.hardest) ? cell.rate - cell.hardest : NaN;
    cell.judged = n >= MIN_GRADED && Number.isFinite(cell.hardest);
    cell.clears = cell.judged && cell.lo > cell.hardest;
    cell.worse = cell.judged && cell.hi < cell.hardest;
    cells[key] = cell;
  }
  const periods = [...new Set(graded.map(c => c.P))].sort((a, b) => b - a);
  const out = {
    v: TURNS_VERSION, reps, minGraded: MIN_GRADED, nulls: NULLS, zones: ZONE_IDS, tags: TAG_KEYS, periods,
    calls: Object.fromEntries(FAMILIES.map(f => [f.id, calls.filter(c => c.fam === f.id).length])),
    graded: Object.fromEntries(FAMILIES.map(f => [f.id, graded.filter(c => c.fam === f.id).length])),
    ahead: calls.filter(c => c.state === 'ahead').length, shut: calls.filter(c => c.state === 'shut').length, late: calls.filter(c => c.state === 'late').length,
    real: Object.fromEntries([...realByP].map(([P, r]) => [P, r.n])),
    cells,
  };
  out.verdict = verdictOf(out);
  return out;
}

const pct = x => `${Math.round(100 * x)}%`;
/** One line per family, and the cells that clear their null, if any. */
export function verdictOf(rep) {
  const lines = [], winners = [];
  for (const f of FAMILIES) {
    const c = rep.cells[`f:${f.id}`];
    if (!c) { lines.push(`${f.name}: no turns graded`); continue; }
    if (!c.judged) { lines.push(`${f.name}: only ${c.n} turns graded, ${rep.minGraded} are needed`); continue; }
    lines.push(`${f.name}: ${pct(c.rate)} of ${c.n} turns hit a real turn, against ${pct(c.hardest)} for the hardest null (${c.hardestName})${c.clears ? ': clears it' : c.worse ? ': worse than chance' : ': no skill shown'}`);
  }
  let judged = 0;
  for (const [key, c] of Object.entries(rep.cells)) {
    if (!(key.startsWith('c:') || key.startsWith('zc:') || key.startsWith('lc:')) || !c.judged) continue;
    judged++;
    if (c.clears) winners.push({ key, ...c });
  }
  winners.sort((a, b) => b.skill - a.skill);
  const byLuck = Math.round(judged * 0.025 * 10) / 10;   // cells expected to clear a 95% bar by luck alone, with this many tested
  lines.push(`${judged} cells (circle, circle × zone, circle × level) were judged: about ${byLuck} would clear the bar by luck alone; ${winners.length} did`);
  return { lines, judged, byLuck, winners: winners.slice(0, 12).map(w => ({ key: w.key, n: w.n, rate: w.rate, hardest: w.hardest, skill: w.skill })),
    any: FAMILIES.some(f => rep.cells[`f:${f.id}`]?.clears), lucky: winners.length <= Math.ceil(byLuck) };
}

/**
 * The Daily set's calls from graded forecasts [{ run }] (dailyTest.js): every turn a frozen pen put in its 3 hours,
 * called at the slot, with the circle's signed size as fitted there.
 */
export function dailyCalls(items) {
  const out = [];
  for (const { run } of items) for (const t of run.turns) if (Math.abs(run.amps[t.n]) >= FLAT) out.push({ fam: 'daily', n: t.n, P: t.P, at: t.at, kind: t.kind, calledAt: run.at, A: run.amps[t.n] });
  return out;
}

/**
 * The earned confidence of a call before `beforeMs`: the walk-forward hit rate of its family, circle and zone on the
 * graded calls made before that moment, falling back to the circle alone, then the family. { rate, n, level: 'zone'
 * | 'circle' | 'family' } or null with nothing to go on. `graded` is gradeCall output sorted any way.
 */
export function earnedRate(graded, call, beforeMs, min = 20) {
  const tries = [c => c.fam === call.fam && c.n === call.n && c.zone === call.zone, c => c.fam === call.fam && c.n === call.n, c => c.fam === call.fam];
  const names = ['zone', 'circle', 'family'];
  for (let i = 0; i < tries.length; i++) {
    let k = 0, n = 0;
    for (const c of graded) if (c.at < beforeMs && (c.state === 'hit' || c.state === 'miss') && tries[i](c)) { n++; if (c.state === 'hit') k++; }
    if (n >= min) return { rate: k / n, n, level: names[i] };
  }
  return null;
}
