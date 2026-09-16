// The circles test (15 Sep, on request: "lets do that", after "what do professionals do?"): the Spirograph's Daily set
// frozen and graded forward, the way a forecast is judged: written down before the fact, graded only on what printed
// after it, against a no-skill guess, over many forecasts. The user's answers:
//   * freeze every 3 hours, on the New York clock: 6 pm, 9 pm, 12 am, 3 am, 6 am, 9 am, 12 pm, 3 pm;
//   * grade each one on the next 3 hours only, so no two share a minute and each is its own test;
//   * the pass mark is DIRECTION (the pen's move over the 3 hours called up or down, against the majority class of the
//     same forecasts, never 50%) and TURN TIMING (each circle's predicted turns inside the 3 hours, within an eighth of
//     its lap, against a random walk's rate: freeze.js gradeTurn and turnChance). Path error against a flat line is shown
//     too, but is not the verdict.
//
// A FREEZE IS THE DAILY SET THE APP DRAWS (dailySet.js): the same sim on the 6 pm day clock with the trend on Globex's
// traded minutes, fitted once on the one-minute bars whose minute had closed by the slot and on nothing later. The
// walk-forward, the relay's live slots and the tests all freeze with freezeAt, so they are the same forecast;
// tests/dailyTest.test.js changes every bar after a slot and checks the freeze does not move. Pure: no DOM, no database.
import { createSim } from './sim.js';
import { MAXL, TAU, FIT_LAPS } from './constants.js';
import { dayClockMin, tradeMin } from './dayClock.js';
import { DAILY_PERIODS } from './dailySet.js';
import { nyParts, nyEpoch } from './levels.js';
import { weekStartNy } from './anchors.js';
import { ticksFor } from './backtest.js';
import { gradeTurn, closesFromBars, turnChance } from './freeze.js';
import { wilson } from './stats.js';

const M = 60000, DAY = 86400e3;
export const SLOT_HOURS = [18, 21, 0, 3, 6, 9, 12, 15];   // New York; the 6 pm one is the day clock's own start
export const HORIZON_MIN = 180;
export const HISTORY_WEEKS = 2;       // the slowest circle (1D) fits on FIT_LAPS days; two weeks back covers it after any weekend
export const MIN_TRADED = 60;         // Globex minutes the 3 hours must hold for a slot to be frozen: none from Friday 5 pm to Sunday 6 pm
export const MIN_HISTORY = 0.6;       // share of the traded minutes of the last FIT_LAPS days the bank must hold, or the freeze is refused
export const MIN_CLOSES = 10;         // closes a forecast's 3 hours need before it is graded at all
export const MIN_RUNS = 30;           // forecasts (or graded turns) before a verdict is drawn: scorecard.js's bar
const FLAT = 0.05;                    // a circle smaller than this many points has no turns worth grading
const FINAL_AFTER_MS = 2 * DAY;       // a forecast is final this long after its end, whatever is missing
const r2 = v => Math.round(v * 100) / 100;
const two = n => String(n).padStart(2, '0');

function lowerBound(bars, t) { let lo = 0, hi = bars.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].t < t) lo = mid + 1; else hi = mid; } return lo; }

/** The slots in [fromMs, toMs), ascending: SLOT_HOURS on every New York day. Days are stepped at noon, so a daylight-saving change never skips or repeats one. */
export function slotsBetween(fromMs, toMs) {
  const out = [], p = nyParts(fromMs - DAY), noon0 = nyEpoch(p.y, p.mo, p.d, 12);
  for (let k = 0; ; k++) {
    const q = nyParts(noon0 + k * DAY);
    if (nyEpoch(q.y, q.mo, q.d, 0) >= toMs) break;
    for (const h of SLOT_HOURS) { const at = nyEpoch(q.y, q.mo, q.d, h, 0); if (at >= fromMs && at < toMs) out.push(at); }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
/** Whether Globex trades enough of the 3 hours after `at` for a forecast to mean anything (the calendar's word, never the bars'). */
export const slotOpen = at => tradeMin(at + HORIZON_MIN * M) - tradeMin(at) >= MIN_TRADED;
/** "Tue 15 Sep 21:00" style key parts: the slot's New York hour, as the card groups them. */
export const slotHour = at => nyParts(at).h;
export const slotLabel = at => { const p = nyParts(at); return `${p.dow} ${p.d}/${p.mo} ${two(p.h)}:${two(p.mi)}`; };
export const runId = (contract, at) => `${contract}|${at}`;

/** A sim on the Daily set's clocks, sized for HISTORY_WEEKS; freezeAt reuses one when handed it. */
export const dailySim = () => createSim({ maxTicks: ticksFor(HISTORY_WEEKS), periods: DAILY_PERIODS, clock: dayClockMin, driftClock: tradeMin });

/**
 * Freeze the Daily set at slot `at` (epoch ms) from ascending one-minute `bars`: only those whose minute has closed by
 * `at` are read. { run } or { refused }: 'shut' (the 3 hours barely trade), 'no-bars' (nothing before the slot),
 * 'history' (the bank holds under MIN_HISTORY of the last FIT_LAPS days), 'no-fit'.
 * The run keeps the pen's path minute by minute over the 3 hours, each circle's predicted turns in them and the
 * direction the pen moves, so it can be graded and drawn without the sim.
 */
export function freezeAt({ bars, contract, name = contract, at, sim = null }) {
  if (!slotOpen(at)) return { refused: 'shut' };
  const t0 = weekStartNy(at, HISTORY_WEEKS), i0 = lowerBound(bars, t0), i1 = lowerBound(bars, at - M + 1);   // t ≤ at − 1 min: closed by the slot
  if (i1 <= i0) return { refused: 'no-bars' };
  const need = tradeMin(at) - tradeMin(at - FIT_LAPS * DAY), held = i1 - lowerBound(bars, at - FIT_LAPS * DAY);
  if (held < MIN_HISTORY * need) return { refused: 'history', held, need };
  const s = sim || dailySim();
  s.startLive({ contract, name, t0, weeks: HISTORY_WEEKS });
  s.setLevels(MAXL);
  s.ingestBars(bars.slice(i0, i1));
  s.advanceLiveTo(at);
  const fit = s.refit();
  if (!fit) return { refused: 'no-fit' };
  const tAt = (at - t0) / M, H = HORIZON_MIN;
  const pen = Array.from({ length: H + 1 }, (_, k) => r2(s.modelAt(tAt + k, MAXL - 1)));
  const turns = [];
  for (let n = 0; n < MAXL; n++) {
    if (!(s.levelAmp(n) >= FLAT)) continue;
    const P = s.periodOf(n), u = k => (s.turnAngle(n, tAt + k) - Math.PI / 2) / Math.PI;   // a peak at every even whole u, a trough at every odd one
    let prev = u(0);
    for (let k = 1; k <= H; k++) {
      const cur = u(k), lo = Math.min(prev, cur), hi = Math.max(prev, cur);
      for (let j = Math.floor(lo) + 1; j <= hi; j++) {
        const f = (j - prev) / (cur - prev);
        if (k === 1 && !(f > 0)) continue;   // a turn on the slot itself is the 3 hours before's: the circles are locked to 6 pm, so turns land on slots
        turns.push({ n, P, at: Math.round(at + (k - 1 + f) * M), kind: ((j % 2) + 2) % 2 === 0 ? 'peak' : 'trough' });
      }
      prev = cur;
    }
  }
  turns.sort((a, b) => a.at - b.at);
  const last = bars[i1 - 1], move = r2(pen[H] - pen[0]);
  return {
    run: {
      v: 1, id: runId(contract, at), contract, name, at, end: at + H * M,
      anchor: last.c, anchorAt: last.t + M, pen, move, dir: Math.sign(move), turns,
      periods: DAILY_PERIODS.slice(), amps: Array.from({ length: MAXL }, (_, n) => r2(s.G.lever[n] * s.G.scale)),
      fit: { explained: fit.explained ?? null, rms: fit.rms ?? null, count: fit.count ?? null }, bars: i1 - i0,
    },
  };
}

/** The window of closes a run is graded on: from a quarter of its slowest turning circle's lap before it to as far after. */
export function gradeSpan(run) {
  let reach = 0; for (const t of run.turns) reach = Math.max(reach, t.P / 4);
  return { from: run.at - reach * M, to: run.end + reach * M + M };
}

/**
 * Grade a run on ascending one-minute `bars` covering gradeSpan(run), at `now`. Direction: the last close in the
 * 3 hours against the close at the slot, on the side the pen called (null while the 3 hours run, and when the pen or
 * the market did not move). Turns: each graded by freeze.js gradeTurn. Path: |close − pinned pen| against |close −
 * slot close| over the closes in the 3 hours.
 */
export function gradeDaily(run, bars, now) {
  const { from, to } = gradeSpan(run), closes = closesFromBars(bars, from, to);
  let n = 0, err = 0, flat = 0, endC = null, endAt = null;
  for (let i = 0; i < closes.n; i++) {
    const t = closes.t[i]; if (t <= run.at || t > run.end || t > now) continue;
    const k = Math.min(HORIZON_MIN, Math.max(0, Math.round((t - run.at) / M))), c = closes.p[i];
    err += Math.abs(c - (run.anchor + run.pen[k] - run.pen[0])); flat += Math.abs(c - run.anchor); n++;
    endC = c; endAt = t;
  }
  const over = now >= run.end;
  const actual = endC === null ? null : r2(endC - run.anchor);
  const dirHit = !over || actual === null || actual === 0 || !run.dir ? null : Math.sign(actual) === run.dir;
  const turns = run.turns.map(t => { const g = gradeTurn(t, t.P, closes, now); return { n: t.n, at: t.at, kind: t.kind, state: g.state, off: g.off ?? null }; });
  const done = turns.filter(t => t.state === 'hit' || t.state === 'miss' || t.state === 'none');
  const settled = turns.every(t => t.state !== 'open' && t.state !== 'ahead');
  return {
    n, actual, endAt, over, dirHit, mae: n ? r2(err / n) : null, flatMae: n ? r2(flat / n) : null,
    turns, graded: done.length, hits: done.filter(t => t.state === 'hit').length,
    complete: (over && settled && now >= run.end + 2 * M) || now > run.end + FINAL_AFTER_MS,
  };
}

/**
 * Walk forward over ascending one-minute `bars`: every slot in [from, to) whose 3 hours are over by `now`, frozen from
 * the bars before it and graded on the bars after. Yields { at, run, grade } or { at, refused }.
 */
export function* walkDaily({ bars, contract, name = contract, from, to, now = Infinity }) {
  if (!bars.length) return;
  const sim = dailySim(), last = bars[bars.length - 1].t + M;
  for (const at of slotsBetween(from, to)) {
    if (at + HORIZON_MIN * M > Math.min(last, now)) break;
    const x = freezeAt({ bars, contract, name, at, sim });
    if (x.refused) { yield { at, refused: x.refused }; continue; }
    const span = gradeSpan(x.run), lo = lowerBound(bars, span.from - M), hi = lowerBound(bars, span.to);
    yield { at, run: x.run, grade: gradeDaily(x.run, bars.slice(lo, hi), now) };
  }
}

/**
 * How the circles did over graded runs [{ run, grade }]: direction against the majority class of the same forecasts,
 * turns against a random walk per circle and pooled, path error against flat, and the same by slot hour. A run whose
 * 3 hours held fewer than MIN_CLOSES closes (a holiday the table does not know) is left out. Verdicts only at MIN_RUNS.
 */
export function dailyScorecard(items) {
  const set = items.filter(it => it && it.run && it.grade && it.grade.over && it.grade.n >= MIN_CLOSES);
  let dirN = 0, dirHit = 0, up = 0, err = 0, flat = 0, pn = 0;
  const circles = DAILY_PERIODS.map((P, n) => ({ n, P, graded: 0, hits: 0, none: 0, chance: turnChance(P) }));
  const hours = new Map(SLOT_HOURS.map(h => [h, { hour: h, runs: 0, dirN: 0, dirHit: 0, graded: 0, hits: 0 }]));
  for (const { run, grade: g } of set) {
    const h = hours.get(slotHour(run.at)) || { hour: slotHour(run.at), runs: 0, dirN: 0, dirHit: 0, graded: 0, hits: 0 };
    hours.set(h.hour, h); h.runs++;
    if (g.dirHit !== null) { dirN++; h.dirN++; if (g.dirHit) { dirHit++; h.dirHit++; } if (g.actual > 0) up++; }
    if (g.mae !== null) { err += g.mae * g.n; flat += g.flatMae * g.n; pn += g.n; }
    for (const t of g.turns) {
      const c = circles[t.n]; if (!c || !(t.state === 'hit' || t.state === 'miss' || t.state === 'none')) continue;
      c.graded++; h.graded++; if (t.state === 'hit') { c.hits++; h.hits++; } if (t.state === 'none') c.none++;
    }
  }
  const d = wilson(dirHit, dirN), majority = dirN ? Math.max(up, dirN - up) / dirN : NaN;
  const tg = circles.reduce((a, c) => a + c.graded, 0), th = circles.reduce((a, c) => a + c.hits, 0);
  const chance = tg ? circles.reduce((a, c) => a + c.graded * c.chance, 0) / tg : NaN, tw = wilson(th, tg);
  const out = {
    all: items.length, runs: set.length,
    dir: { n: dirN, hits: dirHit, rate: dirN ? dirHit / dirN : NaN, lo: d.lo, hi: d.hi, majority, upShare: dirN ? up / dirN : NaN },
    turns: { graded: tg, hits: th, rate: tg ? th / tg : NaN, lo: tw.lo, hi: tw.hi, chance,
      circles: circles.map(c => { const w = wilson(c.hits, c.graded); return { ...c, rate: c.graded ? c.hits / c.graded : NaN, lo: w.lo, hi: w.hi }; }) },
    path: { mae: pn ? err / pn : NaN, flat: pn ? flat / pn : NaN, ratio: flat ? err / flat : NaN },
    byHour: SLOT_HOURS.map(hh => hours.get(hh)),
  };
  const p = x => `${Math.round(100 * x)}%`;
  out.verdicts = {
    dir: dirN < MIN_RUNS ? `only ${dirN} forecasts graded on direction: at least ${MIN_RUNS} are needed to say`
      : d.lo > majority ? `the circles call the direction better than always guessing the usual way: ${p(out.dir.rate)} right, against ${p(majority)}`
      : `no shown edge on direction: ${p(out.dir.rate)} right, where always guessing the usual way gets ${p(majority)}`,
    turns: tg < MIN_RUNS ? `only ${tg} turns graded: at least ${MIN_RUNS} are needed to say`
      : tw.lo > chance ? `the turns beat a random walk: ${p(th / tg)} within ⅛ lap, where one makes about ${p(chance)}`
      : `no timing skill shown: ${p(th / tg)} within ⅛ lap, where a random walk makes about ${p(chance)}`,
  };
  return out;
}
