// The Spirograph Lab's page (16 Sep): three views of the Daily set circles on one instrument.
//   Day player       any banked session replayed a minute at a time, refit and held (lab/labPlayer.js)
//   Multi-day grade  every 3-hour forecast in a range, scored against no-skill guesses (server/labJob.mjs)
//   Edge check       whether a small learner finds anything in those forecasts (lab/labEdge.js), and a neural network
//                    trained live on them (lab/labNet.js, public/net.js)
import { createLabPlayer } from '/lab/labPlayer.js';
import { createNetPanel } from '/net.js';
import { createEdgeView } from '/edge.js';
import { createGradeHelp } from '/gradeHelp.js';
import { createEdgeHelp } from '/edgeHelp.js';
import { createDayHelp } from '/dayHelp.js';
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
  grades: [], gradeKey: null, grade: null, runSel: null, runFilter: 'all',
  jobs: [], watching: new Map(), pollTimer: 0,
};
const player = createLabPlayer($('player'));
const netPanel = createNetPanel($('eNet'));
const edgeView = createEdgeView($('eView'), { netPanel, wire: $('eWire'), regrade: (from, to) => startGrade(from, to) });
const gradeHelp = createGradeHelp($('gHelp'), { getGrade: () => st.grade, show: showOnGrade });
const edgeHelp = createEdgeHelp($('eHelp'), { show: showOnEdge });
const dayHelp = createDayHelp($('dHelp'), { show: showOnDay });

// ---------------------------------------------------------------- tabs
function setTab(tab) {
  st.tab = TABS.includes(tab) ? tab : 'day';
  store.set('tab', st.tab);
  if (location.hash !== '#' + st.tab) history.replaceState(null, '', '#' + st.tab);
  for (const b of document.querySelectorAll('#tabs [data-tab]')) { const on = b.dataset.tab === st.tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
  for (const t of TABS) $('pane-' + t).hidden = t !== st.tab;
  if (st.tab === 'day' && st.day) player.show(); else player.hide();
  if (st.tab !== 'edge') { netPanel.stop(); edgeView.stop(); }
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
$('tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const next = TABS[(TABS.indexOf(st.tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
  setTab(next); document.querySelector(`#tabs [data-tab="${next}"]`).focus();
});
window.addEventListener('hashchange', () => setTab(location.hash.slice(1)));

// ---------------------------------------------------------------- help: the walkthrough's "show me"
// the button opens the walkthrough of the tab you are on
$('helpBtn').addEventListener('click', () => ({ day: dayHelp, grade: gradeHelp, edge: edgeHelp })[st.tab].open());
function showOnDay(where) {
  setTab('day');
  const p = $('player'), q = s => p.querySelector(s);
  const el = { toolbar: $('daySel').closest('.toolbar'), sheet: q('.lpSheet'), rail: q('.lpRail'), hold: q('.lpHold'), deck: q('.lpBar'), chart: q('.lpChart') }[where];
  const target = el && !el.closest('[hidden]') ? el : $('daySel').closest('.toolbar');
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
}
function showOnGrade(where) {
  setTab('grade');
  const el = { toolbar: $('gTools'), verdict: $('gVerdict'), grid: $('gCal').closest('.gCard'), circles: $('gCircles').closest('.gCard'), list: $('gRuns').closest('.gCard') }[where];
  const target = el && !el.closest('[hidden]') ? el : $('gTools');
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
}
function showOnEdge(where) {
  setTab('edge');
  const q = k => document.querySelector(`#eView [data-e="${k}"]`);
  if (where === 'wire' && q('wire') && !q('secWire').closest('[hidden]')) { q('wire').click(); return; }   // "Full wiring and math": open it
  const el = { verdict: document.querySelector('#eView .edVerdict'), race: q('raceCard'), board: q('board'), panel: q('panel'), looks: q('secLooks'), call: q('secCall'), wire: q('secWire') }[where];
  const target = el && !el.closest('[hidden]') ? el : q('panel') || $('pane-edge');
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
}

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
    ? `built ${when(d.built.made)} · the 6 pm pen missed by ±${d.built.held.toFixed(1)}, the 6 pm price kept flat by ±${d.built.flat.toFixed(1)}`
    : job ? 'a few seconds: the pen is fitted at every quarter-hour' : 'not built yet: Build fits the pen at every quarter-hour (a few seconds)';
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
    if (!st.day || st.dayOpen !== open) $('dayMsg').textContent = 'Building this day… a few seconds.';
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
$('gRun').addEventListener('click', () => {
  if (!$('gFrom').value || !$('gTo').value) return toast('Pick both dates', true);
  startGrade(fromOf($('gFrom').value), toOf($('gTo').value));
});
async function startGrade(from, to) {
  try {
    const r = await api('grade', { series: st.series, from, to });
    $('gMsg').textContent = 'Grading… every 3-hour slot is fitted and checked (about 15 seconds for two months).';
    watch(r.id, async job => {
      if (job.status !== 'done') { toast(`Grade: ${job.detail || job.status}`, true); $('gMsg').textContent = job.detail || job.status; return; }
      toast(`Grade done: ${job.detail}`);
      await loadGrades(job.key);
    });
    if (st.tab === 'edge') toast('Grading this range again… about 15 seconds for two months. The check refreshes when it is done.');
  } catch (e) { toast(e.message, true); }
}
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
const SLOTS = [18, 21, 0, 3, 6, 9, 12, 15];   // a session's 3-hour slots in New York, 6 pm open first
const hourWord = x => (x === 0 ? '12 am' : x < 12 ? `${x} am` : x === 12 ? '12 pm' : `${x - 12} pm`);
const nyHour = ms => Number(hm(ms).slice(0, 2));
/** A position along [lo, hi] as a percentage, clamped to the track. */
const pos = (v, lo, hi) => Math.max(0, Math.min(100, (100 * (v - lo)) / (hi - lo)));
/** A scale that holds every value with some room either side. */
function domain(vals, minSpan) {
  const ok = vals.filter(Number.isFinite); let lo = Math.min(...ok), hi = Math.max(...ok);
  const pad = Math.max(minSpan - (hi - lo), 0) / 2 + (hi - lo) * 0.12; return [lo - pad, hi + pad];
}

function paintGrade() {
  const g = st.grade, sc = g.sc, h = g.head, usual = sc.dir.upShare >= 0.5 ? 'up' : 'down';
  const skipped = Object.values(g.why || {}).reduce((a, n) => a + n, 0);
  const days = new Set(g.runs.map(r => tradeDay(r.at))).size;

  // the verdict, then each test: where the circles landed, the range luck allows around it, and the bar to clear
  const test = ({ name, why, you, band, bar, fmt, state, pill, detail, minSpan, info }) => {
    const [lo, hi] = domain([you, bar, ...(band || [])], minSpan), x = v => pos(v, lo, hi).toFixed(1);
    return `<div class="test ${state}"><div><h4>${name}${info ? `<em>${info}</em>` : ''}</h4><small>${why}</small></div>
      <div class="track"><div class="rail"></div>`
      + (band ? `<div class="band" style="left:${x(band[0])}%;width:${(pos(band[1], lo, hi) - pos(band[0], lo, hi)).toFixed(1)}%"></div>` : '')
      + `<div class="tick" style="left:${x(bar)}%"></div><span style="left:${x(bar)}%">${fmt(bar)}</span>`
      + `<div class="you" style="left:${x(you)}%"></div><b style="left:${x(you)}%">${fmt(you)}</b>`
      + `<span class="end" style="left:0">${fmt(lo)}</span><span class="end" style="left:auto;right:0">${fmt(hi)}</span></div>`
      + `<div class="res"><span class="pill ${state === 'flat' ? '' : state}">${pill}</span><small>${detail}</small></div></div>`;
  };
  const judged = (ready, edge, ahead) => (!ready ? ['flat', 'Too few to judge'] : edge ? ['ok', '✓ Beats it'] : ahead ? ['amber', 'Ahead, not proven'] : ['bad', '✕ Does not beat it']);
  const tests = [];
  if (Number.isFinite(sc.dir.rate)) {
    const [state, pill] = judged(h.ready, h.dirEdge, sc.dir.rate > sc.dir.majority);
    tests.push(test({ name: 'Direction', why: `Up or down called right, against always guessing ${usual}`, you: sc.dir.rate, band: [sc.dir.lo, sc.dir.hi], bar: sc.dir.majority, fmt: pct, minSpan: 0.15, state, pill,
      detail: `${sc.dir.hits} of ${sc.dir.n} right · always ${usual} gets ${pct(sc.dir.majority)}` }));
  }
  if (Number.isFinite(sc.turns.rate)) {
    const [state, pill] = judged(sc.turns.graded >= 30, h.turnEdge, sc.turns.rate > sc.turns.chance);
    tests.push(test({ name: 'Turns on time', why: 'Circle turns within ⅛ of a lap, against a random market', you: sc.turns.rate, band: [sc.turns.lo, sc.turns.hi], bar: sc.turns.chance, fmt: pct, minSpan: 0.1, state, pill,
      detail: `${int(sc.turns.hits)} of ${int(sc.turns.graded)} · a random market gets ${pct(sc.turns.chance)}` }));
  }
  if (Number.isFinite(sc.path.ratio)) {
    const better = sc.path.ratio < 1;
    tests.push(test({ name: 'Path', info: 'not in the verdict', why: 'Average miss against a flat line; below 1× is better', you: sc.path.ratio, bar: 1, fmt: v => `${v.toFixed(2)}×`, minSpan: 0.3,
      state: 'flat', pill: better ? 'Closer than flat' : 'Further than flat', detail: `miss ±${sc.path.mae.toFixed(1)} pts · flat ±${sc.path.flat.toFixed(1)}` }));
  }
  const passed = [h.dirEdge && 'direction', h.turnEdge && 'turns'].filter(Boolean);
  const say = !h.ready ? esc(h.text)
    : h.edge ? `The circles beat a no-skill guess on ${passed.join(' and ')}, by more than luck allows. Check it holds on a range they have not seen before trusting it.`
    : sc.dir.rate > sc.dir.majority || sc.turns.rate > sc.turns.chance ? 'Neither test cleared its bar. Where the circles came out ahead, it was by less than luck alone would give.'
    : `Neither test cleared its bar: the circles called direction no better than always guessing ${usual}, and their turns landed no more often than a random market’s.`;
  $('gVerdict').innerHTML = `<div class="vLeft ${h.edge ? 'ok' : h.ready ? 'bad' : ''}"><small>${esc(g.name)} · ${span(g.from, g.to)}</small>`
    + `<div class="vWord"><i></i>${esc(h.word)}</div><p>${say}</p>`
    + `<div class="vMeta"><div><b>${int(sc.runs)}</b>forecasts</div><div><b>${days}</b>trading days</div><div><b>${skipped}</b>skipped</div></div></div>`
    + `<div class="tests">${tests.join('')}</div>`;

  // every forecast on one grid, coloured by its direction call
  const cols = [...new Set(g.runs.map(r => tradeDay(r.at)))].reverse(), byCell = new Map(g.runs.map(r => [`${tradeDay(r.at)}|${nyHour(r.at)}`, r]));
  const moves = g.runs.map(r => Math.abs(r.actual)).filter(Number.isFinite).sort((a, b) => a - b), big = moves[Math.floor(moves.length * 0.9)] || 1;
  const slot = new Map(sc.byHour.filter(Boolean).map(x => [x.hour, x]));
  $('gCal').innerHTML = SLOTS.map(hh => {
    const x = slot.get(hh), rate = x && x.dirN ? x.dirHit / x.dirN : NaN;
    const tone = !Number.isFinite(rate) ? '' : rate >= sc.dir.majority + 0.05 ? 'ok' : rate <= sc.dir.majority - 0.05 ? 'bad' : '';
    return `<span class="rl">${hourWord(hh)}</span><div class="cells" style="--days:${cols.length}">` + cols.map(d => {
      const r = byCell.get(`${d}|${hh}`);
      if (!r) return '<div class="cell"></div>';
      const cls = r.dirHit === true ? 'r' : r.dirHit === false ? 'w' : '', a = (0.3 + 0.65 * Math.min(1, Math.abs(r.actual) / big)).toFixed(2);
      return `<div class="cell ${cls}" style="--a:${a}" data-at="${r.at}" title="${when(r.at)} · called ${arrow(r.dir)} ${sgn(r.move)} · market ${r.actual == null ? '—' : `${arrow(Math.sign(r.actual))} ${sgn(r.actual)}`}${r.dirHit == null ? '' : r.dirHit ? ' · right' : ' · wrong'}"></div>`;
    }).join('') + `</div><span class="rr ${tone}" title="${x ? `${x.dirHit} of ${x.dirN} right at ${hourWord(hh)}` : ''}">${pct(rate)}</span>`;
  }).join('')
    + `<span></span><div class="calDays" style="--days:${cols.length}">${cols.map((d, i) => `<span>${d.startsWith('Mon') || (i === 0 && cols.length < 8) ? d.slice(4) : ''}</span>`).join('')}</div><span class="rr cap">slot rate</span>`;

  // turns by circle
  const circles = sc.turns.circles.filter(c => c.graded);
  const [clo, chi] = domain(circles.flatMap(c => [c.rate, c.chance, ...(c.graded >= 30 ? [c.lo, c.hi] : [])]), 0.15), cx = v => pos(v, clo, chi).toFixed(1);
  const ticks = []; for (let v = Math.ceil(clo * 20) / 20; v <= chi; v += 0.05) ticks.push(v);
  $('gCircles').innerHTML = circles.map(c => {
    const thin = c.graded < 30, tone = thin ? 'muted' : c.lo > c.chance ? 'ok' : c.hi < c.chance ? 'bad' : '';
    return `<span class="nm"><i class="sw" style="--c:${COLORS[c.n]}"></i>${WORD[c.n]}</span>`
      + `<div class="dumb ${tone}"><div class="ax"></div>${thin ? '' : `<div class="band" style="left:${cx(c.lo)}%;width:${(pos(c.hi, clo, chi) - pos(c.lo, clo, chi)).toFixed(1)}%"></div>`}`
      + `<div class="tick" style="left:${cx(c.chance)}%"></div><div class="me${thin ? ' thin' : ''}" style="left:${cx(c.rate)}%;--c:${COLORS[c.n]}" title="${WORD[c.n]}: ${c.hits} of ${c.graded} on time · random ${pct(c.chance)}"></div></div>`
      + `<span class="v ${tone}">${pct(c.rate)} <i>/ ${pct(c.chance)}</i><small>${int(c.graded)} turns</small></span>`;
  }).join('') + `<span></span><div class="scale">${ticks.map(v => `<span style="left:${cx(v)}%">${pct(v)}</span>`).join('')}</div><span></span>`;

  $('gRolls').innerHTML = g.rolls && g.rolls.length ? `Rolls stitched: ${g.rolls.map(r => `${nameOf(r.from)} → ${nameOf(r.to)} on ${tradeDay(r.at)} (older prices shifted ${sgn(r.gap)} pts; moves unchanged)`).join(' · ')}` : '';
  paintRuns();
}
const FILTERS = [
  ['all', 'All', () => true],
  ['right', 'Right', r => r.dirHit === true],
  ['wrong', 'Wrong', r => r.dirHit === false],
  ['worse', 'Further than flat', r => r.mae != null && r.flatMae != null && r.mae > r.flatMae],
];
function paintRuns() {
  const g = st.grade, [, , keep] = FILTERS.find(f => f[0] === st.runFilter) || FILTERS[0];
  $('gFilter').innerHTML = FILTERS.map(([k, label, f]) => `<button type="button" data-f="${k}" class="${(st.runFilter || 'all') === k ? 'on' : ''}">${label} ${g.runs.filter(f).length}</button>`).join('');
  const w = (v, r) => `${((100 * v) / Math.max(r.mae, r.flatMae, 1e-9)).toFixed(0)}%`;   // each row against its own larger miss
  const move = (d, v) => `<span class="mv"><i class="${d > 0 ? 'u' : d < 0 ? 'd' : ''}">${arrow(d)}</i>${sgn(v)}</span>`;
  const rows = g.runs.filter(keep);
  $('gRuns').innerHTML = `<table><thead><tr><th>Frozen</th><th>Called <i>→</i> market did</th><th>Direction</th><th>Path miss <i>against flat</i></th><th>Turns on time</th><th>Fit explains</th></tr></thead><tbody>`
    + (rows.length ? rows.map(r => {
      const tone = r.mae == null || r.flatMae == null ? '' : r.mae < r.flatMae ? 'ok' : 'bad';
      return `<tr class="row${st.runSel === r.at ? ' on' : ''}" data-at="${r.at}" tabindex="0"><td class="when">${when(r.at)}</td>`
        + `<td>${move(r.dir, r.move)}<span class="to">→</span>${r.actual == null ? '—' : move(Math.sign(r.actual), r.actual)}</td>`
        + `<td><span class="pill ${r.dirHit === true ? 'ok' : r.dirHit === false ? 'bad' : ''}">${r.dirHit === true ? 'Right' : r.dirHit === false ? 'Wrong' : 'No call'}</span></td>`
        + `<td>${r.mae == null ? '—' : `<div class="pm"><span class="bars"><i class="${tone}" style="width:${w(r.mae, r)}"></i><i style="width:${w(r.flatMae, r)}"></i></span><b class="${tone}">±${r.mae.toFixed(1)}</b><span class="mut">/ ±${r.flatMae.toFixed(1)}</span></div>`}</td>`
        + `<td>${r.graded ? `<span class="mini"><i style="width:${((100 * r.hits) / r.graded).toFixed(0)}%"></i></span>${r.hits}/${r.graded}` : '—'}</td>`
        + `<td class="${Number.isFinite(r.explained) && r.explained > 0 ? '' : 'muted'}">${Number.isFinite(r.explained) ? pct(r.explained) : '—'}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="muted">no forecasts match</td></tr>') + '</tbody></table>';
  for (const c of document.querySelectorAll('#gCal .cell.on')) c.classList.remove('on');
  if (st.runSel != null) document.querySelector(`#gCal .cell[data-at="${st.runSel}"]`)?.classList.add('on');
}
$('gFilter').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { st.runFilter = b.dataset.f; paintRuns(); } });
$('gCal').addEventListener('click', e => { const c = e.target.closest('.cell[data-at]'); if (c) openRun(Number(c.dataset.at)); });
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

// ---------------------------------------------------------------- edge check (public/edge.js)
function paintEdge() {
  const g = st.grade;
  $('eMsg').textContent = g ? '' : 'No grade picked. Run one on Multi-day grade first: the check reads its forecasts.';
  $('eView').hidden = !g;
  netPanel.set(g);
  edgeView.set(g);
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
