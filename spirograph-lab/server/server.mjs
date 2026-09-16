// The Spirograph Lab (16 Sep): a standalone app beside the Ladder. It reads the Ladder's banked one-minute bars
// read-only and keeps its own results in data/lab.db.
//
//   node server/server.mjs [--open]      http://127.0.0.1:17480
//
// Env: LAB_PORT (17480), LAB_BANK (the Ladder's data/ladder.db), LAB_DB (./data/lab.db).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createLab } from './lab.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.LAB_PORT) || 17480;
const BANK = process.env.LAB_BANK || join(process.env.HOME || '', 'Desktop/MAIN2026/desks/ladder/data/ladder.db');
const LABDB = process.env.LAB_DB || join(ROOT, 'data/lab.db');
const STATIC = { '/': 'public', '/engine/': 'engine', '/lab/': 'lab' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

if (!existsSync(BANK)) { console.error(`The Ladder's bar bank was not found at ${BANK}. Set LAB_BANK to its ladder.db.`); process.exit(1); }
const lab = createLab({ bankFile: BANK, labFile: LABDB, log });

const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const localOrigin = o => !o || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(o);
async function readJSON(req, max = 1e5) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > max) throw new Error('body too large'); }
  return s ? JSON.parse(s) : {};
}

async function serveStatic(res, path) {
  const base = Object.keys(STATIC).filter(k => path.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  const rel = normalize(path.slice(base.length) || 'index.html');
  if (rel.startsWith('..')) return send(res, 403, { error: 'forbidden' });
  const file = join(ROOT, STATIC[base], rel);
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch { send(res, 404, { error: 'not found' }); }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname.startsWith('/api/')) {
      const p = url.pathname.slice(5);
      if (req.method === 'POST') {
        if (!localOrigin(req.headers.origin)) return send(res, 403, { error: 'forbidden origin' });
        let b; try { b = await readJSON(req); } catch (e) { return send(res, 400, { error: e.message }); }
        const r = lab.post(p, b || {}); return send(res, r.status, r.body);
      }
      if (req.method !== 'GET') return send(res, 405, { error: 'GET or POST' });
      if (p === 'health') return send(res, 200, { ok: true, bank: BANK, db: LABDB });
      const r = lab.get(p, url.searchParams); return send(res, r.status, r.body);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'GET only' });
    return serveStatic(res, url.pathname);
  } catch (e) {
    log('error', url.pathname, e.message);
    if (!res.headersSent) send(res, 500, { error: e.message }); else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Spirograph Lab on http://127.0.0.1:${PORT} · bars from ${BANK} (read-only) · results in ${LABDB}`);
  if (process.argv.includes('--open')) execFile('open', [`http://127.0.0.1:${PORT}`]);
});
const stop = () => { log('stopping'); lab.close(); server.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
