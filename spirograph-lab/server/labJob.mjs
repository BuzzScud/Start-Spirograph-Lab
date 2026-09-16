// One Spirograph Lab job, run in a worker (worker.mjs) or, in the tests, in place:
//
//   day    build one session with a held pen from every quarter-hour (lab/labDay.js) and keep it under its 6 pm open
//   grade  walk every 3-hour slot in [from, to) as the circles test does (engine/dailyTest.js walkDaily), score it, and run
//          the edge check (lab/labEdge.js) and the neural network (lab/labNet.js) on the graded forecasts; kept under "from-to"
import { replayDay, holdScore, DAY_VERSION } from '../lab/labDay.js';
import { walkDaily, dailyScorecard, slotsBetween, slotOpen, HISTORY_WEEKS } from '../engine/dailyTest.js';
import { edgeRows, edgeCheck, headline } from '../lab/labEdge.js';
import { netRows, netCheck } from '../lab/labNet.js';
import { weekStartNy } from '../engine/anchors.js';
import { seriesName } from '../lab/labSeries.js';

const M = 60000, H = 3600e3;
export const GRADE_VERSION = 3;   // 2: with the neural network · 3: the edge check keeps every call
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
    lab.progress(id, total + 1, total + 1);
    lab.finish(id, items.length ? 'done' : 'empty', items.length ? `${sc.runs} forecasts graded${skipped ? ` · skipped ${skipped}` : ''} · ${head.word.toLowerCase()}` : `no slot could be frozen${skipped ? ` (${skipped})` : ''}`);
    return items.length;
  }
  lab.finish(id, 'failed', `unknown job ${kind}`);
  return null;
}
