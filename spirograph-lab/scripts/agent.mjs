#!/usr/bin/env node
// What the nightly job's launchd agent runs (scripts/service.mjs). The Ladder found (15 Sep) that launchd running Node on
// a script with the app's folder as its working folder and a log inside it can fail with exit 78 before a line runs; with
// launchd opening nothing in the app's folder it starts. So launchd runs this, and this runs the script from the app's
// folder, its output appended to data/<log>.
//   node scripts/agent.mjs <log file in data/> <script> [args…]
import { spawn } from 'node:child_process';
import { openSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [logName, script, ...args] = process.argv.slice(2);
if (!logName || !script) { console.error('Usage: node scripts/agent.mjs <log file> <script> [args…]'); process.exit(64); }
mkdirSync(join(root, 'data'), { recursive: true });
const out = openSync(join(root, 'data', logName), 'a');
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, script), ...args], { cwd: root, stdio: ['ignore', out, out] });
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
