// The Spirograph Lab's API (16 Sep), under /api/:
//
//   GET  series                          the series it can read: front months and banked contracts
//   GET  days?series=                    the sessions a series holds, and which are built
//   GET  status                          the jobs, newest first
//   GET  day?series=&open=               a built day (lab/labDay.js)
//   GET  grades?series=                  the saved multi-day grades, newest first
//   GET  grade?series=&key=              one grade: its scorecard, edge check, neural network rows and every forecast in brief
//   GET  forecast?series=&key=&at=       one forecast of a grade, with the closes around it
//   GET  turns?series=&key=&rule=        a grade's turns result under a rule (the default rule when none): the turn rule's report
//                                        for both circle families, its learning and held-back weeks, the turn network
//   GET  dayturns?series=&open=&rule=    one session's turn calls from the newest turns result covering it under that rule, with
//                                        its levels, the rule's kill zones, each call's earned confidence (the record before
//                                        that session) and the network's odds (as it stood before that session)
//   GET  rules?series=&key=              the RULE RANKING of a graded range: every rule scored on it, strongest first on the
//                                        held-back weeks, each held to a bar that rises with the number of rules tried
//   GET  rule?id=                        a saved rule
//   GET  preview?series=&key=&rule=      a finished preview (learning weeks only)
//   POST day {series, open, rebuild}     build a day (a built one is answered at once unless rebuild)
//   POST grade {series, from, to}        grade every 3-hour slot in [from, to)
//   POST turns {series, key, rule}       score a saved grade's turns under a rule and keep it (a try on the ranking)
//   POST preview {series, key, rule}     score a rule on the learning weeks only, not kept as a try
//
// Jobs run one at a time in a worker thread (worker.mjs), queued in order; `inline` runs them in place (the tests).
import { Worker } from 'node:worker_threads';
import { openLabStore } from './labStore.mjs';
import { runLabJob, GRADE_VERSION } from './labJob.mjs';
import { TURNS_VERSION, earnedRate, FAMILIES, unpackCalls, strictCI } from '../lab/labTurns.js';
import { normRule, ruleId, ruleDiff, zonesOf, DEFAULT_ID } from '../lab/turnRule.js';
import { pHit } from '../lab/labTurnNet.js';
import { openBefore } from '../engine/dayClock.js';
import { DAY_MIN, DAY_VERSION, MIN_DAY_BARS, sessionOpen } from '../lab/labDay.js';
import { HORIZON_MIN } from '../engine/dailyTest.js';
import { isFront, parseContract } from '../lab/labSeries.js';
import { nyEpoch } from '../engine/levels.js';

const M = 60000, DAY = 86400e3;
export const MAX_GRADE_DAYS = 120, QUEUE_MAX = 12;

/** A series id the Lab accepts: a front month or a ProjectX contract; null otherwise. */
export function normSeries(s) {
  const id = typeof s === 'string' ? s.trim() : '';
  if (!id || id.length > 80) return null;
  return isFront(id) || parseContract(id) ? id : null;
}

/** The 6 pm New York open of day number `day` (engine/dayClock.js openBefore's day). */
export function openOfDay(day) {
  const d = new Date(day * DAY);
  return nyEpoch(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 18, 0);
}

export function createLab({ bankFile, labFile, log = () => {}, inline = false, now: clock = () => Date.now() }) {
  const lab = openLabStore({ bankFile, labFile });
  const cut = lab.interrupt();
  if (cut) log(`${cut} job${cut > 1 ? 's' : ''} marked stopped: the server stopped first`);
  const queue = [];
  let worker = null, current = null, closed = false;

  function pump() {
    if (closed || current !== null || !queue.length) return;
    current = queue.shift();
    const job = lab.job(current);
    if (inline) {
      try { runLabJob(lab, job, clock()); } catch (e) { lab.finish(current, 'failed', e.message); }
      current = null; pump();
      return;
    }
    worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { bankFile, labFile, id: current } });
    worker.on('error', e => { log(`job ${job.id} failed:`, e.message); lab.finish(job.id, 'failed', e.message); });
    worker.on('exit', code => {
      const j = lab.job(job.id);
      if (j && (j.status === 'running' || j.status === 'queued')) lab.finish(job.id, code ? 'failed' : 'stopped', code ? `the worker exited (${code})` : 'stopped');
      log(`job ${job.id} (${job.kind} ${job.series}) ${lab.job(job.id)?.status}: ${lab.job(job.id)?.detail || ''}`);
      worker = null; current = null; pump();
    });
  }
  function enqueue(kind, series, key, params) {
    const same = [current, ...queue].map(id => id !== null && lab.job(id)).find(j => j && j.kind === kind && j.series === series && j.key === String(key));
    if (same) return same.id;
    if (queue.length >= QUEUE_MAX) throw new Error(`${QUEUE_MAX} jobs are already waiting: let some finish`);
    const id = lab.newJob(kind, series, String(key), params, clock());
    queue.push(id);
    pump();
    return id;
  }

  function startDay(b) {
    const series = normSeries(b.series), now = clock();
    if (!series) throw new Error('series required');
    const open = Number(b.open);
    if (!Number.isFinite(open) || sessionOpen(open) !== open) throw new Error('open must be a session’s 6 pm');
    if (open + DAY_MIN * M > now) throw new Error('that session has not ended yet');
    const had = lab.result('day', series, open);
    if (!b.rebuild && had && had.data.v === DAY_VERSION) return { cached: true };   // a day built the old way is built again
    return { id: enqueue('day', series, open, { open }) };
  }
  function startGrade(b) {
    const series = normSeries(b.series), now = clock();
    if (!series) throw new Error('series required');
    const from = Number(b.from), to = Math.min(Number(b.to), now - HORIZON_MIN * M);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error('from must be before to, and to before the last 3 hours');
    if (to - from > MAX_GRADE_DAYS * DAY) throw new Error(`at most ${MAX_GRADE_DAYS} days at a time`);
    return { id: enqueue('grade', series, `${from}-${to}`, { from, to }), key: `${from}-${to}` };
  }

  /** A saved grade's range from its key, or an error. */
  function gradeRange(series, key) {
    if (!series) throw new Error('series required');
    const m = /^(\d+)-(\d+)$/.exec(String(key || ''));
    if (!m || !lab.results('grade', series).some(r => r.key === key)) throw new Error('no such grade');
    return { from: Number(m[1]), to: Number(m[2]) };
  }
  const turnsKey = (key, rid) => `${key}|${rid}`;
  const currentTurns = (series, key, rid) => { const r = lab.result('turns', series, turnsKey(key, rid)); return r && r.data.v === TURNS_VERSION ? r : null; };
  function startTurns(b) {
    const series = normSeries(b.series), { from, to } = gradeRange(series, b.key), rule = normRule(b.rule), rid = ruleId(rule);
    if (!b.again && currentTurns(series, b.key, rid)) { lab.putResult('rule', '*', rid, { name: rule.name, diff: ruleDiff(rule) }, rule); return { cached: true, rule: rid }; }   // the same settings: a new name only
    return { id: enqueue('turns', series, turnsKey(b.key, rid), { from, to, rule }), rule: rid };
  }
  function startPreview(b) {
    const series = normSeries(b.series), { from, to } = gradeRange(series, b.key), rule = normRule(b.rule), rid = ruleId(rule);
    if (currentTurns(series, b.key, rid)) return { saved: true, rule: rid };
    if (lab.result('preview', series, turnsKey(b.key, rid))) return { cached: true, rule: rid };
    return { id: enqueue('preview', series, turnsKey(b.key, rid), { from, to, rule }), rule: rid };
  }
  /** The ranking: every rule scored on the range, the held-back skill first; each held to 95% / tries. */
  function ranking(series, key) {
    const heads = lab.results('turns', series).filter(r => r.key.startsWith(key + '|') && r.head && r.head.v === TURNS_VERSION);
    const tries = heads.length, names = new Map(lab.results('rule', '*').map(r => [r.key, r.head.name]));
    const rows = heads.map(({ made, head: h }) => {
      const ci = strictCI(h.hold.tallies, tries), all = h.hold.all;
      const { tallies, ...hold } = h.hold;
      return { id: h.rule, name: names.get(h.rule) || h.name, diff: h.diff, made, isDefault: h.rule === DEFAULT_ID, learn: h.learn, hold, net: h.net,
        strict: { lo: ci.lo, hi: ci.hi, level: ci.level, clears: !!all && all.n >= 30 && ci.lo > all.hardest } };
    });
    const skill = r => (r.hold.all && Number.isFinite(r.hold.all.skill) ? r.hold.all.skill : -Infinity);
    rows.sort((a, b) => skill(b) - skill(a) || a.made - b.made);
    const holdFrom = heads[0]?.head.holdFrom ?? null;
    return { key, tries, holdFrom, rows, saved: lab.results('rule', '*').map(r => ({ id: r.key, name: r.head.name, diff: r.head.diff, made: r.made })) };
  }

  const brief = ({ run, grade: g }) => ({ at: run.at, dir: run.dir, move: run.move, anchor: run.anchor, turnsDue: run.turns.length,
    explained: run.fit.explained, n: g.n, actual: g.actual, dirHit: g.dirHit, hits: g.hits, graded: g.graded, mae: g.mae, flatMae: g.flatMae });

  function days(series) {
    const built = new Map(lab.results('day', series).filter(r => r.head && r.head.v === DAY_VERSION).map(r => [Number(r.key), r])), now = clock();
    return lab.sessions(series).map(s => {
      const open = openOfDay(s.day), b = built.get(open);
      return { open, n: s.n, contract: s.contract, over: open + DAY_MIN * M <= now, ok: s.n >= MIN_DAY_BARS, built: b ? { made: b.made, ...b.head } : null };
    });
  }

  /** Answer `p` (the path after /api/) with { status, body }. */
  function get(p, q) {
    const series = normSeries(q.get('series'));
    switch (p) {
      case 'series': return { status: 200, body: { series: lab.series() } };
      case 'status': return { status: 200, body: { jobs: lab.jobs(), running: current, queued: queue.slice() } };
      case 'days': return series ? { status: 200, body: { series, days: days(series) } } : { status: 400, body: { error: 'series required' } };
      case 'day': {
        const r = series && lab.result('day', series, Number(q.get('open')));
        return r && r.data.v === DAY_VERSION ? { status: 200, body: { made: r.made, day: r.data } } : { status: 404, body: { error: 'that day is not built' } };
      }
      case 'grades': return series ? { status: 200, body: { grades: lab.results('grade', series) } } : { status: 400, body: { error: 'series required' } };
      case 'grade': {
        const r = series && lab.result('grade', series, q.get('key') || '');
        if (!r) return { status: 404, body: { error: 'no such grade' } };
        const { items, ...rest } = r.data;
        return { status: 200, body: { made: r.made, ...rest, stale: (rest.v || 1) < GRADE_VERSION, runs: items.map(brief).reverse() } };
      }
      case 'forecast': {
        const r = series && lab.result('grade', series, q.get('key') || ''), at = Number(q.get('at'));
        const it = r && r.data.items.find(x => x.run.at === at);
        if (!it) return { status: 404, body: { error: 'no such forecast' } };
        const { bars } = lab.bars(series, at - 60 * M, it.run.end + 30 * M);
        return { status: 200, body: { run: it.run, grade: it.grade, closes: bars.map(x => [x.t + M, x.c]) } };
      }
      case 'turns': {
        const key = q.get('key') || '', rid = q.get('rule') || DEFAULT_ID;
        const r = series && lab.result('turns', series, turnsKey(key, rid));
        if (!r) return { status: 404, body: { error: rid === DEFAULT_ID ? 'the turns of this grade are not scored yet: score them' : 'that rule is not scored on this grade', unscored: true } };
        const { calls, levels, net, ...rest } = r.data;
        const { snaps, ...netRest } = net;
        return { status: 200, body: { made: r.made, ...rest, net: netRest, isDefault: rid === DEFAULT_ID, stale: (rest.v || 0) < TURNS_VERSION } };
      }
      case 'preview': {
        const r = series && lab.result('preview', series, turnsKey(q.get('key') || '', q.get('rule') || ''));
        return { status: 200, body: r ? { made: r.made, ...r.data } : { none: true } };   // none yet is an answer, not an error
      }
      case 'rules': {
        const key = q.get('key') || '';
        if (!series || !lab.results('grade', series).some(r => r.key === key)) return { status: 404, body: { error: 'no such grade' } };
        return { status: 200, body: ranking(series, key) };
      }
      case 'rule': {
        const r = lab.result('rule', '*', q.get('id') || '');
        return r ? { status: 200, body: { id: q.get('id'), rule: normRule(r.data) } } : { status: 404, body: { error: 'no such rule' } };
      }
      case 'dayturns': {
        const open = Number(q.get('open')), want = q.get('rule') || DEFAULT_ID;
        if (!series || !Number.isFinite(open)) return { status: 400, body: { error: 'series and open required' } };
        const end = open + DAY_MIN * M;
        const covering = lab.results('turns', series).filter(x => x.head && x.head.v === TURNS_VERSION && x.head.from <= open && x.head.to >= end);
        const head = covering.find(x => x.head.rule === want) || covering.find(x => x.head.rule === DEFAULT_ID) || covering[0];
        if (!head) return { status: 404, body: { error: 'no turns result covers this session: grade a range that holds it (Multi-day grade)' } };
        const rules = [...new Map(covering.map(x => [x.head.rule, { id: x.head.rule, name: x.head.name, isDefault: x.head.rule === DEFAULT_ID }])).values()];
        const r = lab.result('turns', series, head.key), d = r.data, rule = normRule(d.rule), day = openBefore(open).day;
        const all = unpackCalls(d.calls), prior = all.filter(c => c.at < open && (c.state === 'hit' || c.state === 'miss'));
        const lv = (d.levels.find(([k]) => k === day) || [])[1] || null;
        const calls = all.filter(c => c.at >= open && c.at < end).map(c => ({ ...c, earned: earnedRate(prior, c, open), net: pHit(d.net.snaps, { ...c, level: lv }, open) }));
        const record = Object.fromEntries(FAMILIES.map(f => { const g = prior.filter(c => c.fam === f.id); return [f.id, { n: g.length, hits: g.filter(c => c.state === 'hit').length }]; }));
        return { status: 200, body: { key: head.key, from: head.head.from, to: head.head.to, made: r.made, open, level: lv, zones: zonesOf(rule), calls, record, verdict: d.report.verdict,
          rule: { id: head.head.rule, name: rule.name, tolShare: rule.tolShare, tolFloor: rule.tolFloor, swingShare: rule.swingShare, swingFloor: rule.swingFloor, net: rule.net },
          rules, held: open >= d.holdFrom, holdFrom: d.holdFrom, netReady: !!(d.net && d.net.snaps && d.net.snaps.length) } };
      }
      default: return { status: 404, body: { error: 'not found' } };
    }
  }
  function post(p, b) {
    try {
      if (p === 'day') return { status: 200, body: startDay(b) };
      if (p === 'grade') return { status: 200, body: startGrade(b) };
      if (p === 'turns') return { status: 200, body: startTurns(b) };
      if (p === 'preview') return { status: 200, body: startPreview(b) };
    } catch (e) { return { status: 400, body: { error: e.message } }; }
    return { status: 404, body: { error: 'not found' } };
  }

  return {
    get, post, lab, startDay, startGrade, startTurns, startPreview, days,
    get busy() { return current !== null || queue.length > 0; },
    close() {
      closed = true;
      if (worker) worker.terminate().catch(() => {});
      for (const id of queue) lab.finish(id, 'stopped', 'the server stopped before it ran');
      queue.length = 0;
      lab.close();
    },
  };
}
