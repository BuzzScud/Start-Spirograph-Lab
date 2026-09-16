// A small bank for the tests: a temporary ladder.db-shaped file with synthetic one-minute bars.
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tradeMin } from '../engine/dayClock.js';

const M = 60000;
/** Bars every traded minute in [from, to): a sine day plus a slow drift, with `level` added and `vol` volume. `period` is the main cycle's, in minutes (240: the same times every day). */
export function synthBars(from, to, { level = 20000, vol = 100, seed = 1, period = 240 } = {}) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
  const out = []; let walk = 0;
  for (let t = from; t < to; t += M) {
    if (tradeMin(t + M) - tradeMin(t) < 0.5) continue;   // Globex shut
    walk += rnd() * 2;
    const c = level + walk + 20 * Math.sin(2 * Math.PI * t / (period * M)) + 5 * Math.sin(2 * Math.PI * t / (24 * M));
    out.push({ t, o: c - 0.25, h: c + 1, l: c - 1, c, v: vol });
  }
  return out;
}
export function makeBank(contracts) {
  const dir = mkdtempSync(join(tmpdir(), 'lab-test-')), file = join(dir, 'ladder.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE bars (contract TEXT NOT NULL, t INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v REAL, PRIMARY KEY (contract, t)) WITHOUT ROWID');
  const put = db.prepare('INSERT INTO bars VALUES (?, ?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  for (const [id, bars] of Object.entries(contracts)) for (const b of bars) put.run(id, b.t, b.o, b.h, b.l, b.c, b.v);
  db.exec('COMMIT');
  db.close();
  return { file, lab: join(dir, 'lab.db'), done: () => rmSync(dir, { recursive: true, force: true }) };
}
