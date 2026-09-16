#!/usr/bin/env node
// Back lab.db up to the external drive (server/backup.mjs): what the nightly job runs (scripts/service.mjs), and
// `npm run backup` by hand. With the drive unplugged it writes nothing: /Volumes/BAY2 would then be a plain folder on
// this Mac's own disk, and a copy there is no backup.
//   LAB_BACKUP_DIR   where the copies go (default /Volumes/BAY2/SPIROGRAPH LAB BACKUP)
//   LAB_DB           the database (default data/lab.db)
import { existsSync, statSync, statfsSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupLab, BACKUP_DIR } from '../server/backup.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.LAB_DB || join(root, 'data/lab.db');
const stamp = () => new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' New York';
const mb = b => `${(b / 1e6).toFixed(1)} MB`, gb = b => `${(b / 1e9).toFixed(1)} GB`;

// the drive: /Volumes/<name>, and a different disk from the Mac's own
const parts = BACKUP_DIR.split(sep), volume = parts[1] === 'Volumes' ? sep + join(parts[1], parts[2]) : null;
if (volume && (!existsSync(volume) || statSync(volume).dev === statSync('/').dev)) {
  console.log(`${stamp()} · ${volume} is not plugged in: no backup tonight.`);
  process.exit(0);
}
try {
  const r = backupLab({ db: DB, dest: BACKUP_DIR });
  const fs = statfsSync(BACKUP_DIR), free = fs.bavail * fs.bsize;
  const what = Object.entries(r.results).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(', ') || 'no results yet';
  console.log(`${stamp()} · backed up lab.db ${mb(r.bytes)} (${what}) in ${(r.ms / 1000).toFixed(1)} s · ${gb(free)} free on the drive · ${BACKUP_DIR}/latest`);
  if (free < 3 * r.bytes) console.log(`${stamp()} · WARNING: the drive has room for fewer than three more copies this size.`);
} catch (e) {
  console.error(`${stamp()} · the backup failed, the last good copy is untouched: ${e.message}`);
  process.exitCode = 1;
}
