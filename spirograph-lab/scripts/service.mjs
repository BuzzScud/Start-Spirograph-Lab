#!/usr/bin/env node
// The nightly backup as a launchd agent (com.spirograph-lab.backup, 23:30 every night; a Mac asleep then runs it on
// waking). npm run service:install | service:uninstall | service:status. The plist holds this Node's path: after a
// Node upgrade, install again.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BACKUP_DIR } from '../server/backup.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LABEL = 'com.spirograph-lab.backup', HOUR = 23, MINUTE = 30;
const file = join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
const log = join(homedir(), 'Library/Logs/spirograph-lab-agents.log');
const domain = `gui/${process.getuid()}`;
const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export const backupPlist = ({ nodePath, dir, backupDir }) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${x(nodePath)}</string>
    <string>${x(join(dir, 'scripts/agent.mjs'))}</string>
    <string>backup.log</string>
    <string>scripts/backup.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LAB_BACKUP_DIR</key>
    <string>${x(backupDir)}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${HOUR}</integer>
    <key>Minute</key>
    <integer>${MINUTE}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${x(log)}</string>
  <key>StandardErrorPath</key>
  <string>${x(log)}</string>
</dict>
</plist>
`;

const launchctl = (...a) => spawnSync('launchctl', a, { encoding: 'utf8' });
function state() {
  const r = launchctl('print', `${domain}/${LABEL}`);
  if (r.status !== 0) return { loaded: false };
  const m = k => (r.stdout.match(new RegExp(`\\n\\s*${k} = (.+)`)) || [])[1];
  return { loaded: true, state: m('state'), lastExit: m('last exit code') };
}

const cmd = process.argv[2];
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {   // run, not imported (the folder has a space: compare paths, not URLs)
  if (cmd === 'install') {
    mkdirSync(dirname(file), { recursive: true });
    if (state().loaded) launchctl('bootout', `${domain}/${LABEL}`);
    writeFileSync(file, backupPlist({ nodePath: process.execPath, dir: root, backupDir: BACKUP_DIR }));
    const r = launchctl('bootstrap', domain, file);
    if (r.status !== 0) { console.error(`launchctl bootstrap failed: ${(r.stderr || r.stdout).trim()}`); process.exit(1); }
    console.log(`${LABEL}: installed · lab.db → ${BACKUP_DIR} every night at ${HOUR}:${String(MINUTE).padStart(2, '0')} · log data/backup.log`);
  } else if (cmd === 'uninstall') {
    if (state().loaded) launchctl('bootout', `${domain}/${LABEL}`);
    rmSync(file, { force: true });
    console.log(`${LABEL}: removed`);
  } else if (cmd === 'status') {
    const s = state();
    console.log(`${LABEL}: ${!existsSync(file) ? 'not installed' : !s.loaded ? 'installed, NOT loaded (npm run service:install)' : `loaded · ${s.state}${s.lastExit ? ` · last exit ${s.lastExit}` : ''}`}`);
    const logf = join(root, 'data/backup.log');
    if (existsSync(logf)) console.log('last run: ' + readFileSync(logf, 'utf8').trim().split('\n').pop());
  } else {
    console.error('Usage: node scripts/service.mjs install|uninstall|status'); process.exit(64);
  }
}
