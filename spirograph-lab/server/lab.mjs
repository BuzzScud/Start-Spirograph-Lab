// The Spirograph Lab's API (16 Sep), under /api/:
//
//   GET  series                          the series it can read: front months and banked contracts
//   GET  days?series=                    the sessions a series holds, and which are built
//   GET  status                          the jobs, newest first
//   GET  day?series=&open=               a built day (lab/labDay.js)
//   GET  grades?series=                  the saved multi-day grades, newest first
//   GET  grade?series=&key=              one grade: its scorecard, edge check, neural network rows and every forecast in brief
//   GET  forecast?series=&key=&at=       one forecast of a grade, with the closes around it
//   POST day {series, open, rebuild}     build a day (a built one is answered at once unless rebuild)
//   POST grade {series, from, to}        grade every 3-hour slot in [from, to)
//
// Jobs run one at a time in a worker thread (worker.mjs), queued in order; `inline` runs them in place (the tests).
import { Worker } from 'node:worker_threads';
import { openLabStore } from './labStore.mjs';
import { runLabJob, GRADE_VERSION } from './labJob.mjs';
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
      default: return { status: 404, body: { error: 'not found' } };
    }
  }
  function post(p, b) {
    try {
      if (p === 'day') return { status: 200, body: startDay(b) };
      if (p === 'grade') return { status: 200, body: startGrade(b) };
    } catch (e) { return { status: 400, body: { error: e.message } }; }
    return { status: 404, body: { error: 'not found' } };
  }

  return {
    get, post, lab, startDay, startGrade, days,
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
