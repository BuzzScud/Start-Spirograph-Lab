import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupLab } from '../server/backup.mjs';
import { backupPlist } from '../scripts/service.mjs';

const labDb = (dir, grades) => {
  const db = new DatabaseSync(join(dir, 'lab.db'));
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE lab_results (kind TEXT, series TEXT, key TEXT, made INTEGER, head TEXT, data TEXT)');
  for (let i = 0; i < grades; i++) db.prepare("INSERT INTO lab_results VALUES ('grade', 'NQ', ?, 1, NULL, '{}')").run(String(i));
  return db;   // left open, as the running Lab keeps it: rows still in the WAL must reach the copy
};

test('backup: a checked snapshot in latest, the one before in previous, the live file untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'labbk-')), dest = join(dir, 'drive');
  try {
    const db = labDb(dir, 2);
    const a = backupLab({ db: join(dir, 'lab.db'), dest });
    assert.deepEqual(a.results, { grade: 2 });
    db.prepare("INSERT INTO lab_results VALUES ('day', 'NQ', 'x', 1, NULL, '{}')").run();
    const b = backupLab({ db: join(dir, 'lab.db'), dest });
    assert.deepEqual(b.results, { grade: 2, day: 1 });
    const read = p => new DatabaseSync(p, { readOnly: true }).prepare('SELECT COUNT(*) AS n FROM lab_results').get().n;
    assert.equal(read(join(dest, 'latest/lab.db')), 3);
    assert.equal(read(join(dest, 'previous/lab.db')), 2);
    assert.equal(JSON.parse(readFileSync(join(dest, 'latest/backup.json'), 'utf8')).results.day, 1);
    assert.ok(!existsSync(join(dest, 'incoming')));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lab_results').get().n, 3);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('backup: a missing database throws and leaves the last copies alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'labbk-')), dest = join(dir, 'drive');
  try {
    labDb(dir, 1).close();
    backupLab({ db: join(dir, 'lab.db'), dest });
    assert.throws(() => backupLab({ db: join(dir, 'gone.db'), dest }), /no database/);
    assert.ok(existsSync(join(dest, 'latest/lab.db')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('service: the plist runs the launcher at 23:30 with the drive folder', () => {
  const t = backupPlist({ nodePath: '/n/node', dir: '/app', backupDir: '/Volumes/BAY2/SPIROGRAPH LAB BACKUP' });
  assert.match(t, /<string>\/app\/scripts\/agent\.mjs<\/string>\s*<string>backup\.log<\/string>\s*<string>scripts\/backup\.mjs<\/string>/);
  assert.match(t, /<key>Hour<\/key>\s*<integer>23<\/integer>\s*<key>Minute<\/key>\s*<integer>30<\/integer>/);
  assert.match(t, /SPIROGRAPH LAB BACKUP/);
});
