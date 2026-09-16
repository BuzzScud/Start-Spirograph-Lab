// The Spirograph Lab's page (16 Sep): three views of the Daily set circles on one instrument.
//   Day player       any banked session replayed a minute at a time, refit and held (lab/labPlayer.js)
//   Multi-day grade  every 3-hour forecast in a range, scored against no-skill guesses (server/labJob.mjs)
//   Edge check       whether a small learner finds anything in those forecasts (lab/labEdge.js)
import { createLabPlayer } from '/lab/labPlayer.js';
import { esc, when, hm, tradeDay, isoDay, dayMonth, pct, sgn, int, arrow } from '/lab/util.js';
import { COLORS } from '/engine/constants.js';
import { nyEpoch } from '/engine/levels.js';
import { nyDateAdd } from '/engine/anchors.js';

const $ = id => document.getElementById(id);
const WORD = ['1D', '4H', '2H', '24m', '12m', '6m'];
const TABS = ['day', 'grade', 'edge'];
const DAY = 86400e3, POLL_MS = 1500;
const store = {
  get: (k, d) => { try { return localStorage.getItem('lab.' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('lab.' + k, v); } catch { /* private window */ } },
};

async function api(path, body) {
  const r = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
let toastTimer = 0;
function toast(text, bad = false) {
  const t = $('toast'); t.textContent = text; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

const st = {
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : store.get('tab', 'day'),
  series: store.get('series', ''), list: [], days: [], day: null, dayOpen: null,
  grades: [], gradeKey: null, grade: null, runSel: null,
  jobs: [], watching: new Map(), pollTimer: 0,
};
const player = createLabPlayer($('player'));

// ---------------------------------------------------------------- tabs
function setTab(tab) {
  st.tab = TABS.includes(tab) ? tab : 'day';
  store.set('tab', st.tab);
  if (location.hash !== '#' + st.tab) history.replaceState(null, '', '#' + st.tab);
  for (const b of document.querySelectorAll('#tabs [data-tab]')) { const on = b.dataset.tab === st.tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
  for (const t of TABS) $('pane-' + t).hidden = t !== st.tab;
  if (st.tab === 'day' && st.day) player.show(); else player.hide();
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
$('tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const next = TABS[(TABS.indexOf(st.tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
  setTab(next); document.querySelector(`#tabs [data-tab="${next}"]`).focus();
});
window.addEventListener('hashchange', () => setTab(location.hash.slice(1)));

// ---------------------------------------------------------------- the instrument
async function loadSeries() {
  try { st.list = (await api('series')).series; } catch (e) { $('dayMsg').textContent = `Could not read the bank: ${e.message}`; return; }
  if (!st.list.some(s => s.id === st.series)) st.series = st.list[0]?.id || '';
  const groups = [['front', 'Front month (rolls stitched)'], ['contract', 'Single contract']];
  $('series').innerHTML = groups.map(([k, label]) => `<optgroup label="${label}">${st.list.filter(s => s.kind === k).map(s => `<option value="${esc(s.id)}"${s.id === st.series ? ' selected' : ''}>${esc(s.name)} · ${Math.round(s.n / 1380)} days</option>`).join('')}</optgroup>`).join('');
  await onSeries();
}
$('series').addEventListener('change', e => { st.series = e.target.value; store.set('series', st.series); onSeries(); });
async function onSeries() {
  store.set('series', st.series);
  st.day = null; st.dayOpen = null; st.grade = null; st.gradeKey = null; st.runSel = null;
  player.clear(); $('player').hidden = true;
  await Promise.all([loadDays(), loadGrades()]);
  const s = st.list.find(x => x.id === st.series);
  if (s) setRange(60);
}

// ---------------------------------------------------------------- day player
async function loadDays(pick) {
  const box = $('daySel');
  try { st.days = (await api(`days?series=${encodeURIComponent(st.series)}`)).days; } catch (e) { $('dayMsg').textContent = e.message; return; }
  const usable = st.days.filter(d => d.over && d.ok).reverse();
  const saved = Number(store.get('day.' + st.series, 0));
  const sel = pick ?? (usable.some(d => d.open === st.dayOpen) ? st.dayOpen : usable.some(d => d.open === saved) ? saved : (usable.find(d => d.built) || usable[0])?.open ?? null);
  box.innerHTML = usable.length ? usable.map(d => `<option value="${d.open}"${d.open === sel ? ' selected' : ''}>${tradeDay(d.open)} · ${int(d.n)} min${d.built ? ' · built' : ''}${st.series.startsWith('FRONT:') ? ` · ${esc(nameOf(d.contract))}` : ''}</option>`).join('') : '<option value="">no complete session banked</option>';
  st.dayOpen = sel;
  paintDayBar();
  if (sel != null) await openDay(sel);
}
// a grade's range as the dates picked: its first session's trading day to the day its last slot fell on
const span = (from, to) => `${dayMonth(from + 7 * 3600e3)} → ${dayMonth(to - 60000)}`;
const nameOf = id => st.list.find(s => s.id === id)?.name || id.split('.').slice(-2).join('.');
function paintDayBar() {
  const d = st.days.find(x => x.open === st.dayOpen), job = jobFor('day', st.dayOpen);
  const btn = $('dayBuild');
  btn.disabled = !d || !!job;
  btn.textContent = job ? (job.status === 'queued' ? 'Waiting…' : `Building ${Math.round(100 * job.done / Math.max(1, job.total))}%`) : d && d.built ? 'Rebuild' : 'Build';
  $('dayHint').textContent = !d ? '' : d.built
    ? `built ${when(d.built.made)} · held pen missed by ±${d.built.held.toFixed(1)}, a flat line at the first print by ±${d.built.flatFirst.toFixed(1)}`
    : job ? 'about 15 seconds: every minute of the day is refitted' : 'not built yet: Build replays it (about 15 seconds)';
}
$('daySel').addEventListener('change', e => { const v = Number(e.target.value); if (!v) return; store.set('day.' + st.series, v); openDay(v); });
async function openDay(open) {
  st.dayOpen = open; paintDayBar();
  const d = st.days.find(x => x.open === open);
  if (!d || !d.built) {
    st.day = null; player.clear(); $('player').hidden = true;
    $('dayMsg').textContent = jobFor('day', open) ? 'Building this day…' : `${tradeDay(open)} is not built yet. Press Build.`;
    return;
  }
  try {
    const r = await api(`day?series=${encodeURIComponent(st.series)}&open=${open}`);
    if (st.dayOpen !== open) return;
    st.day = r.day; $('dayMsg').textContent = ''; $('player').hidden = false;
    player.set(r.day);
    if (st.tab === 'day') player.show();
  } catch (e) { $('dayMsg').textContent = e.message; }
}
$('dayBuild').addEventListener('click', async () => {
  const open = st.dayOpen; if (open == null) return;
  const d = st.days.find(x => x.open === open);
  try {
    const r = await api('day', { series: st.series, open, rebuild: !!(d && d.built) });
    if (r.cached) return openDay(open);
    if (!st.day || st.dayOpen !== open) $('dayMsg').textContent = 'Building this day… about 15 seconds.';
    watch(r.id, async job => { if (job.status === 'done') { await loadDays(open); } else toast(`${tradeDay(open)}: ${job.detail || job.status}`, true); paintDayBar(); });
  } catch (e) { toast(e.message, true); }
});

// ---------------------------------------------------------------- multi-day grade
function setRange(days) {
  const s = st.list.find(x => x.id === st.series); if (!s) return;
  const last = Math.min(Date.now(), s.last), first = s.first + 14 * DAY;   // the fit needs about two weeks behind the first slot
  const from = days === 'all' ? first : Math.max(first, last - days * DAY);
  $('gFrom').value = isoDay(from); $('gTo').value = isoDay(last);
  $('gFrom').min = $('gTo').min = isoDay(s.first); $('gFrom').max = $('gTo').max = isoDay(last);
}
$('gQuick').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setRange(b.dataset.d === 'all' ? 'all' : +b.dataset.d); });
// From = the first session traded on that date (its 6 pm open the evening before); To = through that date's session
const fromOf = iso => { const [y, m, d] = iso.split('-').map(Number), p = nyDateAdd(y, m, d, -1); return nyEpoch(p.y, p.mo, p.d, 18, 0); };
const toOf = iso => { const [y, m, d] = iso.split('-').map(Number); return nyEpoch(y, m, d, 18, 0); };
$('gRun').addEventListener('click', async () => {
  if (!$('gFrom').value || !$('gTo').value) return toast('Pick both dates', true);
  try {
    const r = await api('grade', { series: st.series, from: fromOf($('gFrom').value), to: toOf($('gTo').value) });
    $('gMsg').textContent = 'Grading… every 3-hour slot is fitted and checked (about 15 seconds for two months).';
    watch(r.id, async job => {
      if (job.status !== 'done') { toast(`Grade: ${job.detail || job.status}`, true); $('gMsg').textContent = job.detail || job.status; return; }
      toast(`Grade done: ${job.detail}`);
      await loadGrades(job.key);
    });
  } catch (e) { toast(e.message, true); }
});
async function loadGrades(pick) {
  try { st.grades = (await api(`grades?series=${encodeURIComponent(st.series)}`)).grades; } catch (e) { $('gMsg').textContent = e.message; return; }
  const saved = store.get('grade.' + st.series, '');
  const key = pick ?? (st.grades.some(g => g.key === saved) ? saved : st.grades[0]?.key ?? null);
  $('gSaved').innerHTML = st.grades.length
    ? st.grades.map(g => `<option value="${esc(g.key)}"${g.key === key ? ' selected' : ''}>${span(g.head.from, g.head.to)} · ${g.head.runs} forecasts · ${esc(g.head.word)}</option>`).join('')
    : '<option value="">none yet</option>';
  $('gSaved').disabled = !st.grades.length;
  if (key) await openGrade(key);
  else { st.grade = null; $('gBody').hidden = true; $('gMsg').textContent = 'No grade for this instrument yet. Pick a range and press Grade.'; paintEdge(); }
}
$('gSaved').addEventListener('change', e => { if (e.target.value) openGrade(e.target.value); });
async function openGrade(key) {
  st.gradeKey = key; store.set('grade.' + st.series, key); st.runSel = null; $('gReplay').hidden = true;
  try {
    const g = await api(`grade?series=${encodeURIComponent(st.series)}&key=${encodeURIComponent(key)}`);
    if (st.gradeKey !== key) return;
    st.grade = g; $('gMsg').textContent = ''; $('gBody').hidden = false;
    paintGrade(); paintEdge();
  } catch (e) { $('gMsg').textContent = e.message; }
}
const dot = ok => `<i class="dot ${ok === true ? 'ok' : ok === false ? 'bad' : ''}"></i>`;
function paintGrade() {
  const g = st.grade, sc = g.sc, h = g.head;
  $('gHead').innerHTML = `<b class="word ${h.edge ? 'ok' : h.ready ? 'bad' : ''}">${dot(h.ready ? h.edge : null)}${esc(h.word)}</b><span>${esc(g.name)} · ${span(g.from, g.to)} · ${sc.runs} forecasts · ${esc(h.text)}</span>`;
  const tile = (label, big, sub, ok) => `<div class="tile"><small>${label}</small><b>${big}</b><span>${dot(ok)}${sub}</span></div>`;
  $('gTiles').innerHTML = [
    tile('Forecasts graded', int(sc.runs), `${Object.entries(g.why || {}).map(([k, n]) => `${n} skipped (${k === 'history' ? 'too little history' : k})`).join(', ') || 'none skipped'}`, null),
    tile('Direction', pct(sc.dir.rate), `${sc.dir.hits} of ${sc.dir.n} right · always ${sc.dir.upShare >= 0.5 ? 'up' : 'down'} gets ${pct(sc.dir.majority)}`, h.ready ? h.dirEdge : null),
    tile('Path vs a flat line', Number.isFinite(sc.path.ratio) ? `${sc.path.ratio.toFixed(2)}×` : '—', Number.isFinite(sc.path.mae) ? `average miss ±${sc.path.mae.toFixed(1)} pts · flat ±${sc.path.flat.toFixed(1)} · below 1× is better` : 'no closes to grade', Number.isFinite(sc.path.ratio) ? sc.path.ratio < 1 : null),
    tile('Turns on time', pct(sc.turns.rate), `${int(sc.turns.hits)} of ${int(sc.turns.graded)} · a random market gets ${pct(sc.turns.chance)}`, sc.turns.graded >= 30 ? h.turnEdge : null),
  ].join('');
  $('gCircles').innerHTML = `<table><thead><tr><th>Circle</th><th>Turns graded</th><th>On time</th><th>Rate</th><th>Random</th></tr></thead><tbody>`
    + sc.turns.circles.map(c => `<tr><td><i class="sw" style="--c:${COLORS[c.n]}"></i>${WORD[c.n]}</td><td>${int(c.graded)}</td><td>${int(c.hits)}</td><td class="${c.graded >= 30 ? (c.lo > c.chance ? 'ok' : c.hi < c.chance ? 'bad' : '') : 'muted'}">${pct(c.rate)}</td><td>${pct(c.chance)}</td></tr>`).join('') + '</tbody></table>';
  const hourWord = x => (x === 0 ? '12 am' : x < 12 ? `${x} am` : x === 12 ? '12 pm' : `${x - 12} pm`);
  $('gHours').innerHTML = `<table><thead><tr><th>Slot</th><th>Forecasts</th><th>Direction</th><th>Turns on time</th></tr></thead><tbody>`
    + sc.byHour.map(x => `<tr><td>${hourWord(x.hour)}</td><td>${x.runs}</td><td>${x.dirN ? `${pct(x.dirHit / x.dirN)} <i>${x.dirHit}/${x.dirN}</i>` : '—'}</td><td>${x.graded ? `${pct(x.hits / x.graded)} <i>${x.hits}/${x.graded}</i>` : '—'}</td></tr>`).join('') + '</tbody></table>';
  $('gRolls').innerHTML = g.rolls && g.rolls.length ? `Rolls stitched: ${g.rolls.map(r => `${nameOf(r.from)} → ${nameOf(r.to)} on ${tradeDay(r.at)} (older prices shifted ${sgn(r.gap)} pts; moves unchanged)`).join(' · ')}` : '';
  paintRuns();
}
function paintRuns() {
  const g = st.grade;
  $('gRuns').innerHTML = `<table><thead><tr><th>Frozen</th><th>Pen called</th><th>Market did</th><th>Direction</th><th>Path miss</th><th>Flat miss</th><th>Turns</th><th>Fit explains</th></tr></thead><tbody>`
    + g.runs.map(r => `<tr class="row${st.runSel === r.at ? ' on' : ''}" data-at="${r.at}" tabindex="0"><td>${when(r.at)}</td><td>${arrow(r.dir)} ${sgn(r.move)}</td><td>${r.actual == null ? '—' : `${arrow(Math.sign(r.actual))} ${sgn(r.actual)}`}</td>`
      + `<td class="${r.dirHit === true ? 'ok' : r.dirHit === false ? 'bad' : 'muted'}">${r.dirHit === true ? 'right' : r.dirHit === false ? 'wrong' : '—'}</td>`
      + `<td class="${r.mae != null && r.mae < r.flatMae ? 'ok' : ''}">${r.mae == null ? '—' : '±' + r.mae.toFixed(1)}</td><td>${r.flatMae == null ? '—' : '±' + r.flatMae.toFixed(1)}</td>`
      + `<td>${r.graded ? `${r.hits}/${r.graded}` : '—'}</td><td>${Number.isFinite(r.explained) ? pct(r.explained) : '—'}</td></tr>`).join('') + '</tbody></table>';
}
function pickRun(e) {
  const tr = e.target.closest('tr[data-at]'); if (!tr) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault(); openRun(Number(tr.dataset.at));
}
$('gRuns').addEventListener('click', pickRun);
$('gRuns').addEventListener('keydown', pickRun);
async function openRun(at) {
  st.runSel = at; paintRuns();
  const box = $('gReplay'); box.hidden = false; box.innerHTML = '<div class="msg">reading…</div>';
  try {
    const r = await api(`forecast?series=${encodeURIComponent(st.series)}&key=${encodeURIComponent(st.gradeKey)}&at=${at}`);
    if (st.runSel !== at) return;
    paintReplay(r);
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (e) { box.innerHTML = `<div class="msg">${esc(e.message)}</div>`; }
}
/** The market against the pen as it was frozen, the 3 hours shaded, the 24m and slower circles' turns on the pen. */
function paintReplay({ run, grade: g, closes: all }) {
  const W = 1400, H = 300, L = 62, R = 16, T = 18, B = 30, x0 = run.at - 3600e3, x1 = run.end + 1800e3;
  const pen = run.pen.map((v, k) => [run.at + k * 60000, run.anchor + v - run.pen[0]]);
  const closes = all.filter(([t]) => t >= x0 && t <= x1);
  const ys = [...closes.map(c => c[1]), ...pen.map(p => p[1]), run.anchor];
  let lo = Math.min(...ys), hi = Math.max(...ys); const pad = Math.max(2, (hi - lo) * 0.08); lo -= pad; hi += pad;
  const X = t => L + (W - L - R) * (t - x0) / (x1 - x0), Y = v => T + (H - T - B) * (hi - v) / (hi - lo);
  const line = pts => pts.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const xt = []; for (let t = Math.ceil(x0 / 1800e3) * 1800e3; t <= x1; t += 1800e3) xt.push(t);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find(s => (hi - lo) / s <= 6) || 1000, yt = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) yt.push(v);
  const mark = { hit: '✓', miss: '✗', none: '–', nodata: '·', open: '…', ahead: '…' };
  const turns = run.turns.map((t, i) => ({ t, s: g.turns[i]?.state || 'ahead', off: g.turns[i]?.off })).filter(x => x.t.P >= 24).map(({ t, s, off }) => {
    const k = Math.max(0, Math.min(run.pen.length - 1, Math.round((t.at - run.at) / 60000))), v = pen[k][1];
    return `<g class="turn ${s}"><circle cx="${X(t.at).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="5" style="--c:${COLORS[t.n]}"/><text x="${X(t.at).toFixed(1)}" y="${(Y(v) + (t.kind === 'peak' ? -10 : 18)).toFixed(1)}">${mark[s]}</text><title>${WORD[t.n]} ${t.kind} due ${hm(t.at)} · ${s}${off != null ? ` · market turned ${Math.abs(off).toFixed(0)} min ${off > 0 ? 'late' : 'early'}` : ''}</title></g>`;
  }).join('');
  const verdict = g.dirHit === null ? 'no direction to grade' : g.dirHit ? 'right' : 'wrong';
  $('gReplay').innerHTML = `<div class="replayHead"><h3>Replay <span>frozen ${when(run.at)} · graded to ${hm(run.end)}</span></h3><button type="button" class="btn sm" id="gReplayClose">Close</button></div>`
    + `<p class="say">The circles called <b>${arrow(run.dir)} ${sgn(run.move)} pts</b>; the market went <b>${g.actual == null ? '—' : `${arrow(Math.sign(g.actual))} ${sgn(g.actual)} pts`}</b>: ${verdict}. Turns: <b>${g.hits} of ${g.graded}</b> within ⅛ of a lap.</p>`
    + `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="The market against the frozen pen">`
    + `<rect class="hz" x="${X(run.at).toFixed(1)}" y="${T}" width="${(X(run.end) - X(run.at)).toFixed(1)}" height="${H - T - B}"/>`
    + yt.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v.toLocaleString('en-US')}</text>`).join('')
    + xt.map(t => `<text class="ax" x="${X(t).toFixed(1)}" y="${H - 10}" text-anchor="middle">${hm(t)}</text>`).join('')
    + `<line class="anchor" x1="${X(run.at).toFixed(1)}" x2="${X(run.end).toFixed(1)}" y1="${Y(run.anchor).toFixed(1)}" y2="${Y(run.anchor).toFixed(1)}"/>`
    + `<path class="mkt" d="${line(closes)}"/><path class="pen" d="${line(pen)}"/>${turns}</svg>`
    + `<div class="legend"><span><i style="--c:var(--ink)"></i>market</span><span><i style="--c:var(--violet)"></i>pen, frozen at ${hm(run.at)}</span><span><i class="dash"></i>price at the freeze (the flat line)</span><span>✓ turn on time · ✗ missed · – no turn · the 12m and 6m turns are graded, not drawn</span></div>`;
  $('gReplayClose').addEventListener('click', () => { st.runSel = null; $('gReplay').hidden = true; paintRuns(); });
}

// ---------------------------------------------------------------- edge check
function paintEdge() {
  const g = st.grade;
  if (!g) { $('eBody').hidden = true; $('eMsg').textContent = 'No grade picked. Run one on Multi-day grade first: the check reads its forecasts.'; return; }
  const e = g.edge;
  $('eMsg').textContent = ''; $('eBody').hidden = false;
  $('eHead').innerHTML = `<b class="word ${e.ready ? (e.edge ? 'ok' : 'bad') : ''}">${dot(e.ready ? e.edge : null)}${!e.ready ? 'Too few forecasts' : e.edge ? 'Something to look at' : 'Nothing to learn yet'}</b><span>${esc(g.name)} · ${span(g.from, g.to)} · ${esc(e.verdict)}</span>`;
  if (!e.ready) { $('eTable').innerHTML = ''; $('eNote').textContent = ''; return; }
  const base = e.baselines[0].rate, lo = 0.3, hi = 0.7, P = v => `${(100 * (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)).toFixed(1)}%`;
  const bar = r => `<div class="rate" title="${pct(r)}"><i class="band" style="left:${P(base - e.noise)};width:calc(${P(base + e.noise)} - ${P(base - e.noise)})"></i><i class="base" style="left:${P(base)}"></i><i class="val" style="left:${P(r)}"></i></div>`;
  const row = (x, kind) => `<tr class="${kind}"><td>${esc(x.label)}${kind === 'base' ? ' <i>yardstick</i>' : ''}</td><td>${x.hits} / ${x.n}</td><td>${pct(x.rate)}</td><td>${bar(x.rate)}</td>`
    + `<td class="${kind === 'base' && x.key === 'usual' ? 'muted' : x.rate - base > e.noise ? 'ok' : ''}">${x.key === 'usual' ? '—' : `${x.rate >= base ? '+' : '−'}${Math.abs(Math.round(100 * (x.rate - base)))} pts`}</td><td class="${x.points == null ? 'muted' : x.points >= 0 ? 'ok' : 'bad'}">${x.points == null ? '—' : sgn(x.points)}</td></tr>`;
  $('eTable').innerHTML = `<table><thead><tr><th>Who calls the direction</th><th>Right</th><th>Rate</th><th>Against the usual way <i>(band: chance)</i></th><th>Beyond usual way</th><th>Points, 1 lot</th></tr></thead><tbody>`
    + e.baselines.map(x => row(x, 'base')).join('') + e.learners.map(x => row(x, 'learner')).join('') + '</tbody></table>';
  $('eNote').innerHTML = `Each learner calls ${e.tested} forecasts, after learning from the first ${e.warm}. With that many calls, chance alone moves a rate by about <b>±${Math.round(100 * e.noise)} points</b> (the shaded band). A learner shows an edge only outside it. “Points, 1 lot” adds up the 3-hour moves each caller would have caught or lost.`;
}

// ---------------------------------------------------------------- jobs
const jobFor = (kind, key) => st.jobs.find(j => j.kind === kind && j.series === st.series && j.key === String(key) && (j.status === 'running' || j.status === 'queued'));
function watch(id, done) { st.watching.set(id, done); poll(); }
async function poll() {
  clearTimeout(st.pollTimer);
  try {
    const s = await api('status'); st.jobs = s.jobs;
    for (const [id, cb] of [...st.watching]) {
      const j = s.jobs.find(x => x.id === id);
      if (j && j.status !== 'running' && j.status !== 'queued') { st.watching.delete(id); try { await cb(j); } catch (e) { toast(e.message, true); } }
    }
    const live = s.jobs.filter(j => j.status === 'running' || j.status === 'queued');
    const chip = $('jobChip'); chip.hidden = !live.length;
    if (live.length) {
      const j = live[live.length - 1];
      chip.innerHTML = `<span class="spin"></span>${j.kind === 'day' ? `Building ${tradeDay(Number(j.key))}` : 'Grading'} · ${Math.round(100 * j.done / Math.max(1, j.total))}%${live.length > 1 ? ` · ${live.length - 1} waiting` : ''}`;
    }
    paintDayBar();
    if (live.length || st.watching.size) st.pollTimer = setTimeout(poll, POLL_MS);
  } catch { st.pollTimer = setTimeout(poll, POLL_MS * 3); }
}

setTab(st.tab);
loadSeries().then(poll);
