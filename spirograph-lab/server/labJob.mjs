// One Spirograph Lab job, run in a worker (worker.mjs) or, in the tests, in place:
//
//   day    build one session with a held pen from every quarter-hour (lab/labDay.js) and keep it under its 6 pm open
//   grade  walk every 3-hour slot in [from, to) as the circles test does (engine/dailyTest.js walkDaily), score it, and run
//          the edge check (lab/labEdge.js) and the neural network (lab/labNet.js) on the graded forecasts; kept under "from-to".
//          Then the TURNS (16 Sep): every turn the Daily set's forecasts called and every turn the Kalman rungs called a
//          quarter lap ahead (lab/labKalman.js), graded against the market's real turns with the turn rule (lab/labTurns.js),
//          tagged by kill zone and PDH/PDL (lab/labLevels.js), scored against three nulls, and learned by the turn
//          network (lab/labTurnNet.js); kept as a 'turns' result under the same "from-to"
import { replayDay, holdScore, DAY_VERSION } from '../lab/labDay.js';
import { walkDaily, dailyScorecard, slotsBetween, slotOpen, HISTORY_WEEKS } from '../engine/dailyTest.js';
import { edgeRows, edgeCheck, headline } from '../lab/labEdge.js';
import { netRows, netCheck } from '../lab/labNet.js';
import { weekStartNy } from '../engine/anchors.js';
import { seriesName } from '../lab/labSeries.js';
import { closesFromBars } from '../engine/freeze.js';
import { DAILY_PERIODS } from '../engine/dailySet.js';
import { realTurnsByPeriod, dailyCalls, gradeCall, turnReport, TURNS_VERSION } from '../lab/labTurns.js';
import { sessionLevels } from '../lab/labLevels.js';
import { kalmanCalls } from '../lab/labKalman.js';
import { turnNetCheck } from '../lab/labTurnNet.js';

const M = 60000, H = 3600e3, DAY = 86400e3;
export const GRADE_VERSION = 4;   // 2: with the neural network · 3: the edge check keeps every call · 4: the turns result beside it
const WHY = { history: 'too few bars banked before them', 'no-bars': 'no bars before them', 'no-fit': 'no fit' };

export function runLabJob(lab, job, now = Date.now()) {
  const { id, kind, series } = job, p = job.params, name = seriesName(series);
  lab.setStatus(id, 'running');
  if (kind === 'day') {
    const open = p.open, { bars } = lab.bars(series, weekStartNy(open, HISTORY_WEEKS), open + 1440 * M);
    lab.progress(id, 0, 1380);
    const x = replayDay({ bars, open, name, progress: k => lab.progress(id, k, 1380) });
    if (x.refused) {
      const why = x.refused === 'no-bars' ? `only ${x.have} minutes traded that session` : x.refused === 'history' ? `only ${x.have} bars banked in the two weeks before it` : 'the circles could not be fitted';
      lab.finish(id, 'empty', why);
      return null;
    }
    const score = holdScore(x.day, 0);
    lab.putResult('day', series, open, { v: DAY_VERSION, held: score.held, flat: score.flat }, x.day);
    lab.progress(id, 1380, 1380);
    lab.finish(id, 'done', `the 6 pm pen missed by ±${score.held.toFixed(1)}; the 6 pm price kept flat by ±${score.flat.toFixed(1)}`);
    return x.day;
  }
  if (kind === 'grade') {
    const { from, to } = p;
    const { bars, rolls } = lab.bars(series, weekStartNy(from, HISTORY_WEEKS), to + 12 * H);
    const total = slotsBetween(from, to).filter(slotOpen).length, why = {}, items = [];
    let done = 0;
    lab.progress(id, 0, total);
    for (const x of walkDaily({ bars, contract: series, name, from, to, now })) {
      if (x.refused === 'shut') continue;
      done++;
      if (x.refused) why[x.refused] = (why[x.refused] || 0) + 1;
      else items.push({ run: x.run, grade: x.grade });
      if (done % 8 === 0) lab.progress(id, done, total + 1);
    }
    const sc = dailyScorecard(items), head = headline(sc);
    const edge = edgeCheck(edgeRows(items, bars)), nrows = netRows(items), net = netCheck(nrows);
    const skipped = Object.entries(why).map(([k, n]) => `${n} ${WHY[k] || k}`).join(', ');
    lab.putResult('grade', series, `${from}-${to}`, { ...head, runs: sc.runs, from, to, edgeWord: edge.ready ? (edge.edge ? 'maybe' : 'none') : 'too few' },
      { v: GRADE_VERSION, series, name, from, to, rolls, why, sc, head, edge, net, netRows: nrows, items });
    lab.progress(id, total + 1, total + 2);
    const turns = items.length ? turnsCheck({ bars, items, from, to, now, progress: () => lab.progress(id, total + 1, total + 2) }) : null;
    if (turns) lab.putResult('turns', series, `${from}-${to}`, { v: TURNS_VERSION, from, to, graded: turns.report.graded, any: turns.report.verdict.any, lucky: turns.report.verdict.lucky },
      { v: TURNS_VERSION, series, name, from, to, ...turns });
    lab.progress(id, total + 2, total + 2);
    const tw = turns ? ` · turns: ${turns.report.verdict.any ? 'a family clears its null' : 'no skill beyond the nulls'}` : '';
    lab.finish(id, items.length ? 'done' : 'empty', items.length ? `${sc.runs} forecasts graded${skipped ? ` · skipped ${skipped}` : ''} · ${head.word.toLowerCase()}${tw}` : `no slot could be frozen${skipped ? ` (${skipped})` : ''}`);
    return items.length;
  }
  lab.finish(id, 'failed', `unknown job ${kind}`);
  return null;
}

/**
 * The turns of both circle families over [from, to), graded and scored (the 'turns' result): { report, net, kalman
 * (the seed and how many closes it read, or why it was refused), levels (one pair per session), calls (every graded
 * call, compact) }. `bars` must reach from two weeks before `from` to at least 12 hours past `to`.
 */
export function turnsCheck({ bars, items, from, to, now = Date.now(), progress = () => {} }) {
  const closes = closesFromBars(bars, from - 2 * DAY, to + DAY), realByP = realTurnsByPeriod(closes, DAILY_PERIODS);
  const levels = sessionLevels(bars, from - DAY, to + DAY);
  const k = kalmanCalls({ bars, from, to, periods: DAILY_PERIODS, progress });
  const graded = [...dailyCalls(items), ...k.calls].map(c => gradeCall(c, realByP.get(c.P), closes, levels, now));
  const report = turnReport(graded, realByP, closes, levels), net = turnNetCheck(graded);
  const r2 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
  const calls = graded.map(c => ({ fam: c.fam, n: c.n, P: c.P, at: c.at, kind: c.kind, calledAt: c.calledAt, A: r2(c.A), sdMin: r2(c.sdMin), state: c.state, off: r2(c.off), turnPx: r2(c.turnPx), zone: c.zone, tag: c.tag || null, px: r2(c.px) }));
  return {
    report, net, kalman: k.refused ? { refused: k.refused } : { seed: k.seed, closes: k.closes, calls: k.calls.length },
    levels: [...levels].map(([day, lv]) => [day, lv && { high: lv.high, low: lv.low, highAt: lv.highAt, lowAt: lv.lowAt, day: lv.day }]),
    calls,
  };
}
