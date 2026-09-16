// The Spirograph Lab's storage (16 Sep):
//
//   the BANK     the Ladder's data/ladder.db, opened READ-ONLY: the one-minute bars the Ladder keeps. Nothing is written.
//   data/lab.db  the Lab's own file: lab_jobs (each day replay or multi-day grade, as it runs and how it ended) and
//                lab_results (the finished ones, kept until built again: a day by its 6 pm open, a grade by from–to)
//
// A series is a banked contract, or FRONT:<sym>, a product's front month stitched across its rolls (lab/labSeries.js).
// Opened by the server and, separately, by each worker.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseContract, isFront, frontSchedule, stitch, sessionVolumes, sessionOf, seriesName, frontId, FRONT } from '../lab/labSeries.js';

const DAY = 86400e3, HOUR = 3600e3;
const num = v => (v === null || v === undefined ? null : Number(v));
const parse = s => (s == null ? null : JSON.parse(s));

/** `bankFile` the Ladder's ladder.db (read-only), `labFile` the Lab's own database (':memory:' in the tests). */
export function openLabStore({ bankFile, labFile }) {
  const bank = new DatabaseSync(bankFile, { readOnly: bankFile !== ':memory:' });
  if (labFile !== ':memory:') mkdirSync(dirname(labFile), { recursive: true });
  const db = new DatabaseSync(labFile);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  bank.exec('PRAGMA busy_timeout = 5000;');
  const barsQ = bank.prepare('SELECT t, o, h, l, c, v FROM bars WHERE contract = ? AND t >= ? AND t < ? ORDER BY t');
  const store = { bars: (id, from, to) => barsQ.all(id, Math.floor(from), Math.ceil(Math.min(to, 8.64e15))).map(r => ({ t: Number(r.t), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v })) };
  db.exec(`
    CREATE TABLE IF NOT EXISTS lab_jobs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, series TEXT NOT NULL, key TEXT NOT NULL, params TEXT NOT NULL,
      status TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, done INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, detail TEXT);
    CREATE TABLE IF NOT EXISTS lab_results (kind TEXT NOT NULL, series TEXT NOT NULL, key TEXT NOT NULL, made INTEGER NOT NULL, head TEXT, data TEXT NOT NULL,
      PRIMARY KEY (kind, series, key)) WITHOUT ROWID;
  `);
  const q = {
    newJob: db.prepare("INSERT INTO lab_jobs (kind, series, key, params, status, started_at) VALUES (?, ?, ?, ?, 'queued', ?)"),
    setStatus: db.prepare('UPDATE lab_jobs SET status = ? WHERE id = ?'),
    progress: db.prepare('UPDATE lab_jobs SET done = ?, total = ? WHERE id = ?'),
    finish: db.prepare('UPDATE lab_jobs SET status = ?, detail = ?, finished_at = ? WHERE id = ?'),
    jobs: db.prepare('SELECT * FROM lab_jobs ORDER BY id DESC LIMIT ?'),
    job: db.prepare('SELECT * FROM lab_jobs WHERE id = ?'),
    interrupt: db.prepare("UPDATE lab_jobs SET status = 'stopped', detail = 'the relay stopped before it finished', finished_at = ? WHERE status IN ('running', 'queued')"),
    put: db.prepare(`INSERT INTO lab_results (kind, series, key, made, head, data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (kind, series, key) DO UPDATE SET made = excluded.made, head = excluded.head, data = excluded.data`),
    get: db.prepare('SELECT made, head, data FROM lab_results WHERE kind = ? AND series = ? AND key = ?'),
    list: db.prepare('SELECT key, made, head FROM lab_results WHERE kind = ? AND series = ? ORDER BY made DESC'),
    drop: db.prepare("DELETE FROM lab_results WHERE kind = ? AND series = ? AND substr(key, 1, length(?)) = ?"),
    hours: bank.prepare('SELECT t / 3600000 AS hr, COUNT(*) AS n, SUM(v) AS vol FROM bars WHERE contract = ? GROUP BY hr ORDER BY hr'),
    banked: bank.prepare('SELECT contract, COUNT(*) AS n, MIN(t) AS first, MAX(t) AS last FROM bars GROUP BY contract'),
  };
  const jobRow = r => r && ({ id: num(r.id), kind: r.kind, series: r.series, key: r.key, params: parse(r.params), status: r.status, startedAt: num(r.started_at),
    finishedAt: num(r.finished_at), done: num(r.done), total: num(r.total), detail: r.detail });

  /** Traded minutes and volume per session of one contract, from hourly counts (cheap on a big bank). */
  function sessionsOf(contract) {
    const m = new Map();
    for (const r of q.hours.all(contract)) {
      const s = sessionOf(num(r.hr) * HOUR), x = m.get(s) || { n: 0, v: 0 };
      x.n += num(r.n); x.v += (num(r.vol) || 0) + num(r.n) * 1e-6; m.set(s, x);
    }
    return m;
  }
  const siblings = sym => q.banked.all().map(r => r.contract).filter(id => parseContract(id)?.sym === sym);

  return {
    bank, db,
    close() { try { bank.close(); } catch { /* closed */ } try { db.close(); } catch { /* closed */ } },
    newJob(kind, series, key, params, now = Date.now()) { return num(q.newJob.run(kind, series, key, JSON.stringify(params), now).lastInsertRowid); },
    setStatus(id, status) { q.setStatus.run(status, id); },
    progress(id, done, total) { q.progress.run(done, total, id); },
    finish(id, status, detail = null, now = Date.now()) { q.finish.run(status, detail, now, id); },
    jobs(limit = 20) { return q.jobs.all(limit).map(jobRow); },
    job(id) { return jobRow(q.job.get(id)); },
    interrupt(now = Date.now()) { return Number(q.interrupt.run(now).changes); },
    putResult(kind, series, key, head, data, now = Date.now()) { q.put.run(kind, series, String(key), now, head ? JSON.stringify(head) : null, JSON.stringify(data)); },
    result(kind, series, key) { const r = q.get.get(kind, series, String(key)); return r ? { made: num(r.made), head: parse(r.head), data: parse(r.data) } : null; },
    /** Delete the results of `kind` whose key starts with `prefix`. */
    dropResults(kind, series, prefix) { return Number(q.drop.run(kind, series, prefix, prefix).changes); },
    results(kind, series) { return q.list.all(kind, series).map(r => ({ key: r.key, made: num(r.made), head: parse(r.head) })); },

    /** Every series the Lab can read: each product's front month (when it has two contracts or more), then each contract. */
    series() {
      const rows = q.banked.all().map(r => ({ id: r.contract, n: num(r.n), first: num(r.first), last: num(r.last) })).filter(r => r.n > 0 && !r.id.startsWith('DEMO.'));
      const bySym = new Map();
      for (const r of rows) { const p = parseContract(r.id); if (!p) continue; if (!bySym.has(p.sym)) bySym.set(p.sym, []); bySym.get(p.sym).push(r); }
      const out = [];
      for (const [sym, list] of [...bySym].sort((a, b) => b[1].reduce((s, r) => s + r.n, 0) - a[1].reduce((s, r) => s + r.n, 0))) {
        if (list.length > 1) out.push({ id: frontId(sym), name: seriesName(frontId(sym)), kind: 'front', n: list.reduce((s, r) => s + r.n, 0), first: Math.min(...list.map(r => r.first)), last: Math.max(...list.map(r => r.last)) });
        for (const r of list.sort((a, b) => parseContract(a.id).order - parseContract(b.id).order)) out.push({ ...r, name: seriesName(r.id), kind: 'contract' });
      }
      return out;
    },

    /** The sessions a series holds: [{ day (dayClock day number), n (traded minutes), contract }], ascending. */
    sessions(series) {
      if (!isFront(series)) return [...sessionsOf(series)].sort((a, b) => a[0] - b[0]).map(([s, x]) => ({ day: s, n: x.n, contract: series }));
      const ids = siblings(series.slice(FRONT.length)), per = {}, vols = {};
      for (const id of ids) { per[id] = sessionsOf(id); vols[id] = new Map([...per[id]].map(([s, x]) => [s, x.v])); }
      return frontSchedule(vols).map(({ session, contract }) => ({ day: session, n: per[contract].get(session).n, contract }));
    },

    /** Ascending bars of a series in [from, to): { bars, rolls }. A front month is stitched from a few days earlier, so a roll at `from` is seen. */
    bars(series, from, to) {
      if (!isFront(series)) return { bars: store.bars(series, from, to), rolls: [] };
      const barsBy = {}, vols = {};
      for (const id of siblings(series.slice(FRONT.length))) { barsBy[id] = store.bars(id, from - 4 * DAY, to); vols[id] = sessionVolumes(barsBy[id]); }
      const { bars, rolls } = stitch(barsBy, frontSchedule(vols));
      return { bars: bars.filter(b => b.t >= from), rolls: rolls.filter(r => r.at >= from) };
    },
  };
}
