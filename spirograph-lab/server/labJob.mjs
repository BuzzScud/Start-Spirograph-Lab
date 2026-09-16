// One Spirograph Lab job, run in a worker (worker.mjs) or, in the tests, in place:
//
//   day    build one session with a held pen from every quarter-hour (lab/labDay.js) and keep it under its 6 pm open
//   grade  walk every 3-hour slot in [from, to) as the circles test does (engine/dailyTest.js walkDaily), score it, and run
//          the edge check (lab/labEdge.js) and the neural network (lab/labNet.js) on the graded forecasts; kept under "from-to".
//          Then the TURNS (16 Sep): every turn the Daily set's forecasts called and every turn the Kalman rungs called a
//          quarter lap ahead (lab/labKalman.js), graded against the market's real turns with the turn rule (lab/labTurns.js),
//          tagged by kill zone and PDH/PDL (lab/labLevels.js), scored against three nulls, and learned by the turn
//          network (lab/labTurnNet.js); kept as a 'turns' result under "from-to|<rule id>" with the default rule
//   turns    (16 Sep, the editable rule) the same turns check for a saved grade under any rule (lab/turnRule.js), with
//            no fresh walk of the forecasts; kept under "from-to|<rule id>", the rule itself kept as a 'rule' result
//   preview  the turns check on a range's LEARNING weeks only (the held-back weeks are never read), fewer null draws;
//            kept as the one 'preview' result of that range
import { replayDay, holdScore, DAY_VERSION } from '../lab/labDay.js';
import { walkDaily, dailyScorecard, slotsBetween, slotOpen, HISTORY_WEEKS } from '../engine/dailyTest.js';
import { edgeRows, edgeCheck, headline } from '../lab/labEdge.js';
import { netRows, netCheck } from '../lab/labNet.js';
import { weekStartNy } from '../engine/anchors.js';
import { seriesName } from '../lab/labSeries.js';
import { closesFromBars } from '../engine/freeze.js';
import { DAILY_PERIODS } from '../engine/dailySet.js';
import { realTurnsByPeriod, dailyCalls, gradeCall, turnReport, holdStart, cellBrief, packCalls, TURNS_VERSION } from '../lab/labTurns.js';
import { normRule, ruleId, ruleDiff, ruleKeeps, DEFAULT_RULE } from '../lab/turnRule.js';
import { sessionLevels } from '../lab/labLevels.js';
import { kalmanCalls } from '../lab/labKalman.js';
import { turnNetCheck, netBrief } from '../lab/labTurnNet.js';

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
    if (turns) saveTurns(lab, series, name, from, to, turns);
    lab.progress(id, total + 2, total + 2);
    const tw = turns ? ` · turns: ${turns.report.verdict.any ? 'a family clears its null' : 'no skill beyond the nulls'}` : '';
    lab.finish(id, items.length ? 'done' : 'empty', items.length ? `${sc.runs} forecasts graded${skipped ? ` · skipped ${skipped}` : ''} · ${head.word.toLowerCase()}${tw}` : `no slot could be frozen${skipped ? ` (${skipped})` : ''}`);
    return items.length;
  }
  if (kind === 'turns' || kind === 'preview') {
    const { from, to } = p, rule = normRule(p.rule), rid = ruleId(rule), preview = kind === 'preview';
    const g = lab.result('grade', series, `${from}-${to}`);
    if (!g) { lab.finish(id, 'failed', 'no grade for that range: grade it first'); return null; }
    lab.progress(id, 0, 3);
    const { bars } = lab.bars(series, weekStartNy(from, HISTORY_WEEKS), to + 12 * H);
    lab.progress(id, 1, 3);
    const t = turnsCheck({ bars, items: g.data.items, from, to, now, rule, preview, progress: () => lab.progress(id, 2, 3) });
    if (preview) {
      lab.dropResults('preview', series, `${from}-${to}|`);
      lab.putResult('preview', series, `${from}-${to}|${rid}`, { from, to, rule: rid }, { series, name, from, to, ...t });
    } else saveTurns(lab, series, name, from, to, t);
    lab.progress(id, 3, 3);
    const f = t.learn.cells.all;
    lab.finish(id, 'done', `${rule.name}: ${f ? `${Math.round(100 * f.rate)}% of ${f.n} turns hit on the learning weeks, the hardest null ${Math.round(100 * f.hardest)}%` : 'no turns graded'}${preview ? ' (preview)' : ''}`);
    return rid;
  }
  lab.finish(id, 'failed', `unknown job ${kind}`);
  return null;
}

/** Keep a turns check under its rule: the head carries what a ranking row needs, the rule is kept on its own too. */
function saveTurns(lab, series, name, from, to, t) {
  const rid = t.ruleId, head3 = rep => ({ all: cellBrief(rep.cells.all), daily: cellBrief(rep.cells['f:daily']), kalman: cellBrief(rep.cells['f:kalman']) });
  lab.putResult('rule', '*', rid, { name: t.rule.name, diff: ruleDiff(t.rule) }, t.rule);
  lab.putResult('turns', series, `${from}-${to}|${rid}`, {
    v: TURNS_VERSION, from, to, rule: rid, name: t.rule.name, diff: ruleDiff(t.rule), holdFrom: t.holdFrom,
    graded: t.report.graded, any: t.report.verdict.any, lucky: t.report.verdict.lucky,
    learn: head3(t.learn), hold: { ...head3(t.hold), tallies: t.hold.tallies.all || [] }, net: { learn: t.net.learn, hold: t.net.hold },
  }, { v: TURNS_VERSION, series, name, from, to, ...t });
}

/**
 * The turns of both circle families over [from, to), graded and scored (the 'turns' result): { report, net, kalman
 * (the seed and how many closes it read, or why it was refused), levels (one pair per session), calls (every graded
 * call, compact) }. `bars` must reach from two weeks before `from` to at least 12 hours past `to`.
 */
export const PREVIEW_REPS = 20;
export function turnsCheck({ bars, items, from, to, now = Date.now(), rule = DEFAULT_RULE, preview = false, progress = () => {} }) {
  rule = normRule(rule);
  const holdFrom = holdStart(from, to), end = preview ? holdFrom : to;   // a preview never reads the held-back weeks' calls
  const closes = closesFromBars(bars, from - 2 * DAY, end + DAY), realByP = realTurnsByPeriod(closes, DAILY_PERIODS, rule);
  const levels = sessionLevels(bars, from - DAY, end + DAY);
  const k = kalmanCalls({ bars, from, to: end, periods: DAILY_PERIODS, rule, progress });
  const graded = [...dailyCalls(items, rule), ...k.calls].filter(c => (!preview || c.at < holdFrom) && ruleKeeps(rule, c)).map(c => gradeCall(c, realByP.get(c.P), closes, levels, now, rule));
  const learnCalls = graded.filter(c => c.at < holdFrom);
  const base = { rule, ruleId: ruleId(rule), holdFrom, kalman: k.refused ? { refused: k.refused } : { seed: k.seed, closes: k.closes, calls: k.calls.length } };
  if (preview) {
    const learn = turnReport(learnCalls, realByP, closes, levels, { rule, reps: PREVIEW_REPS }), net = turnNetCheck(learnCalls, { rule, keepSnaps: false });
    return { ...base, preview: true, learn, net: { ...net, learn: netBrief(net), hold: null, snaps: undefined } };
  }
  const report = turnReport(graded, realByP, closes, levels, { rule });
  const learn = turnReport(learnCalls, realByP, closes, levels, { rule });
  const hold = turnReport(graded.filter(c => c.at >= holdFrom), realByP, closes, levels, { rule });
  const net = turnNetCheck(graded, { rule, holdFrom });
  return {
    ...base, report, learn, hold, net,
    levels: [...levels].map(([day, lv]) => [day, lv && { high: lv.high, low: lv.low, highAt: lv.highAt, lowAt: lv.lowAt, day: lv.day }]),
    calls: packCalls(graded),
  };
}
