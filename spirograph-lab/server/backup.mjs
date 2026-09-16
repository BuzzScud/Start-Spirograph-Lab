// lab.db copied to an external drive every night (16 Sep, on request: /Volumes/BAY2), the same way the Ladder backs up
// its own data. Run by scripts/backup.mjs (the nightly job, scripts/service.mjs, or `npm run backup` by hand).
//
//   <dest>/latest/     tonight's lab.db, a snapshot taken with VACUUM INTO (whole and consistent while the Lab is running,
//                      and checked with quick_check before it counts), plus backup.json (when, from where, how big)
//   <dest>/previous/   the night before's, in case tonight's is a copy of something already broken
//
// To restore: stop the Lab, copy latest/lab.db over data/lab.db (delete data/lab.db-wal and -shm first), start it again.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

export const BACKUP_DIR = process.env.LAB_BACKUP_DIR || '/Volumes/BAY2/SPIROGRAPH LAB BACKUP';

/** One SQLite file as a checked snapshot at `to`. */
function snapshot(from, to) {
  const src = new DatabaseSync(from, { readOnly: true });
  try { src.exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`); } finally { src.close(); }
  const copy = new DatabaseSync(to, { readOnly: true });
  try {
    const ok = copy.prepare('PRAGMA quick_check').get();
    if (!ok || Object.values(ok)[0] !== 'ok') throw new Error(`the copy of ${from} failed its check: ${JSON.stringify(ok)}`);
    const rows = copy.prepare("SELECT kind, COUNT(*) AS n FROM lab_results GROUP BY kind").all();
    return Object.fromEntries(rows.map(r => [r.kind, r.n]));
  } finally { copy.close(); }
}

/**
 * Copy the database at `db` to `dest`/latest, the last copy moving to `dest`/previous.
 * Returns { bytes, ms, results: { day: n, grade: n } }. Throws, leaving latest and previous as they were, if anything fails.
 */
export function backupLab({ db, dest }) {
  if (!existsSync(db)) throw new Error(`no database at ${db}`);
  const t0 = Date.now(), incoming = join(dest, 'incoming'), latest = join(dest, 'latest'), previous = join(dest, 'previous');
  rmSync(incoming, { recursive: true, force: true });
  mkdirSync(incoming, { recursive: true });
  try {
    const to = join(incoming, basename(db)), results = snapshot(db, to), bytes = statSync(to).size;
    writeFileSync(join(incoming, 'backup.json'), JSON.stringify({ at: new Date().toISOString(), from: db, bytes, results }, null, 2) + '\n');
    rmSync(previous, { recursive: true, force: true });
    if (existsSync(latest)) renameSync(latest, previous);
    renameSync(incoming, latest);
    return { bytes, ms: Date.now() - t0, results };
  } catch (e) {
    rmSync(incoming, { recursive: true, force: true });
    throw e;
  }
}
