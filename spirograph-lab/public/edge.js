// The Edge check tab (16 Sep, design B "One panel", on request: "ensure the neural network is easy to use / simple").
//
//   main   the verdict, a race of every caller across the calls (right calls beyond always guessing the usual way,
//          inside the band luck alone reaches), and the scoreboard, which is also the race's legend
//   panel  the neural network in plain words: its result, four switches for what it looks at (flip one and it retrains
//          by itself into a dashed "test run" line), and the call under the pointer with what pushed it
//   pop-up "Full wiring and math": the network panel (public/net.js) in a big dialog, trained, on the call shown
//
// The small learners' calls come from the grade (lab/labEdge.js keeps every call); the network is trained here on the
// grade's rows with the same code the server ran, and its fingerprint is checked against the server's.
import { netWalk, snapshot, withMask, pUp, fingerprint } from '/lab/labNet.js';
import { esc, when, pct, sgn, dayMonth } from '/lab/util.js';

const NS = 'http://www.w3.org/2000/svg';
const CALLERS = [
  { key: 'usual', label: 'Always up', short: 'Always up', sub: 'the usual way', grp: 'Yardsticks', c: '#93a0b3' },
  { key: 'pen', label: 'The pen’s own call', short: 'Pen', sub: 'yardstick', grp: 'Yardsticks', c: '#f4f7fb' },
  { key: 'spiro', label: 'The circles’ numbers', short: 'Circles’ numbers', sub: 'small learner', grp: 'Small learners', c: '#a78bfa' },
  { key: 'mom', label: 'Recent moves only', short: 'Recent moves', sub: 'small learner', grp: 'Small learners', c: '#5ce1ff' },
  { key: 'both', label: 'Both', short: 'Both', sub: 'small learner', grp: 'Small learners', c: '#f5b544' },
  { key: 'net', label: 'Neural network', short: 'Network', sub: 'circles + pen + time', grp: 'Neural network', c: '#f472b6' },
];
// the network's 12 inputs as plain names ("time sin" and "time cos" are one thing: the time of day)
const FACTORS = [
  ['Day circle', [0]], ['4-hour circle', [1]], ['2-hour circle', [2]], ['24-min circle', [3]], ['12-min circle', [4]], ['6-min circle', [5]],
  ['How well they fit', [6]], ['Fit miss', [7]], ['Pen’s 3-hour move', [8]], ['Pen’s first hour', [9]], ['Time of day', [10, 11]],
];
const GROUPS = [
  { label: 'The six circles', desc: 'size and sign of 1D, 4H, 2H, 24m, 12m, 6m', js: [0, 1, 2, 3, 4, 5] },
  { label: 'How well they fit', desc: 'explained share and miss', js: [6, 7] },
  { label: 'The pen’s own move', desc: 'its 3-hour and first-hour move', js: [8, 9] },
  { label: 'Time of day', desc: 'when the pen was frozen', js: [10, 11] },
];
const ICON = {
  play: '<svg class="edI" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>',
  pause: '<svg class="edI" viewBox="0 0 24 24" aria-hidden="true"><rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/></svg>',
  wiring: '<svg class="edI" viewBox="0 0 24 24" aria-hidden="true"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></svg>',
  chev: '<svg class="edI" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
};
const nf = v => Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
const pts = v => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${nf(v)}`);
const signed = v => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
const luck = k => 1.96 * Math.sqrt(k + 1) / 2;   // the edge check's band in calls: ±1.96·√(¼/k) on the rate, times k
const cum = a => { const o = []; let s = 0; for (const v of a) o.push(s += v); return o; };

export function createEdgeView(el, { netPanel, wire, regrade }) {
  el.innerHTML = `
    <div class="edGrid">
      <div class="edMain">
        <div class="edVerdict"><b class="edWord" data-e="word"></b><span data-e="say"></span></div>
        <div class="edCard edRaceCard" data-e="raceCard">
          <h3>Calls right beyond the usual way <span>grey: where luck alone lands · hover to read a call · click a name to pick it out</span></h3>
          <svg class="edRace" data-e="race" role="img" aria-label="Every caller's right calls beyond always guessing the usual way, call by call"></svg>
        </div>
        <div class="edCard edBoard" data-e="board"></div>
        <details class="edHow"><summary>${ICON.chev}How this check works</summary><ol data-e="how"></ol></details>
      </div>
      <aside class="edCard edPanel" data-e="panel">
        <div>
          <div class="edPanelHead"><i class="dot" style="background:#f472b6"></i><h2>Neural network</h2><span class="edPill" data-e="state"></span></div>
          <div class="edTwo">
            <div class="edStat"><small>Right</small><b data-e="rate">—</b><span data-e="rateS"></span></div>
            <div class="edStat"><small>Always up</small><b data-e="base">—</b><span data-e="baseS"></span></div>
          </div>
          <div class="edRow"><button type="button" class="edGo" data-e="go"></button><span class="edMatch" data-e="match"></span></div>
          <div class="edProg" data-e="progW" hidden><i data-e="prog"></i></div>
        </div>
        <div data-e="secLooks">
          <h3>What it looks at <span>switch one off to test it</span></h3>
          <div data-e="switches"></div>
          <div class="edTest" data-e="test" hidden></div>
        </div>
        <div data-e="secCall">
          <h3>The call under your pointer</h3>
          <div class="edSaid" data-e="said"></div>
          <div class="edPushHead"><span></span><span>toward down</span><span>toward up</span><span></span></div>
          <div data-e="push"></div>
        </div>
        <div class="edRow" data-e="secWire">
          <button type="button" class="btn" data-e="wire">${ICON.wiring}Full wiring and math</button>
          <span class="hint">every weight and sum, for the call shown</span>
        </div>
      </aside>
    </div>`;
  const $ = k => el.querySelector(`[data-e="${k}"]`);
  const tip = document.createElement('div'); tip.className = 'edTip'; tip.hidden = true; document.body.appendChild(tip);
  const showTip = (e, html) => {
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14; if (y + h > innerHeight - 8) y = e.clientY - h - 14;
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  };
  const hideTip = () => { tip.hidden = true; };

  const S = { g: null, T: [], N: 0, callers: [], base: 0, noise: 0, full: null, fullFp: null, test: null, testScore: null,
    on: GROUPS.map(() => true), focus: null, hover: null, reveal: null, timer: 0, job: 0 };

  // ------------------------------------------------------------ the network, trained here
  function newRun(mask) { return { it: netWalk(S.g.netRows, mask ? withMask(mask) : undefined), calls: [], snaps: [], done: false }; }
  function stepRun(run, n) {
    for (let got = 0; got < n;) {
      const s = run.it.next();
      if (s.done) { run.done = true; return; }
      if (s.value.kind === 'fit') run.snaps.push(snapshot(s.value.net));
      else { run.calls.push({ i: s.value.i, p: s.value.p, size: s.value.size, snap: run.snaps.length - 1 }); got++; }
    }
  }
  /** Train `run` a slice at a time so the page keeps moving; `each` after every slice, `done` at the end. */
  function trainAsync(run, each, done) {
    const job = ++S.job;
    const go = () => {
      if (job !== S.job) return;
      const t0 = performance.now();
      while (!run.done && performance.now() - t0 < 30) stepRun(run, 4);
      each();
      if (run.done) done(); else S.timer = setTimeout(go, 0);
    };
    S.timer = setTimeout(go, 0);
  }
  const rightOf = run => run.calls.map((c, k) => ((c.p > 0.5 ? 1 : 0) === S.T[k].y ? 1 : 0));
  const excessOf = right => cum(right.map((r, k) => r - S.T[k].y));   // always up is right exactly when the market went up
  function pushes(run, k) {
    const c = run.calls[k], sn = run.snaps[c.snap], x = S.g.netRows[c.i].x;
    return FACTORS.filter(([, js]) => js.some(j => sn.mask[j]))
      .map(([name, js]) => { const xx = Array.from(x); for (const j of js) xx[j] = sn.mu[j]; return { name, v: c.p - pUp(sn, xx) }; })
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  }

  // ------------------------------------------------------------ set a grade
  function set(g) {
    clearTimeout(S.timer); S.job++;
    S.g = g; S.full = S.test = S.testScore = S.reveal = null; S.fullFp = null; S.focus = null; S.hover = null; S.on = GROUPS.map(() => true);
    if (!g) return;
    const e = g.edge;
    S.noise = e.noise;
    const byAt = new Map((g.netRows || []).map((r, i) => [r.at, i]));
    const calls = e.calls && e.calls.at ? e.calls : null;
    S.T = calls && !g.stale ? calls.at.map(at => g.netRows[byAt.get(at)]).filter(Boolean) : [];
    S.N = S.T.length === (calls ? calls.at.length : -1) ? S.T.length : 0;
    if (!S.N) S.T = [];
    const baseKey = e.baselines[0];
    S.base = baseKey ? baseKey.rate : 0.5;
    const agg = { usual: e.baselines[0], pen: e.baselines[1], ...Object.fromEntries(e.learners.map(l => [l.key, l])),
      net: g.net && g.net.tested ? { hits: g.net.hits, n: g.net.tested, rate: g.net.rate, points: g.net.points } : null };
    S.callers = CALLERS.map(C => {
      const a = agg[C.key], said = !S.N ? null : C.key === 'usual' ? '1'.repeat(S.N) : C.key === 'net' ? null : calls[C.key];
      const right = said ? [...said].map((u, k) => (Number(u) === S.T[k].y ? 1 : 0)) : null;
      return { ...C, hits: a ? a.hits : null, n: a ? a.n : null, rate: a ? a.rate : null, points: C.key === 'usual' ? null : a ? a.points : null,
        right, exc: right ? excessOf(right) : null };
    });
    paint();
    if (S.N && e.ready) {
      const run = newRun(null);
      trainAsync(run, () => { $('prog').style.width = `${100 * run.calls.length / S.N}%`; }, () => {
        S.full = run; S.fullFp = fingerprint(run.calls);
        const net = S.callers.find(c => c.key === 'net');
        net.right = rightOf(run); net.exc = excessOf(net.right);
        if (net.hits == null) { net.hits = net.right.reduce((a, b) => a + b, 0); net.n = S.N; net.rate = net.hits / S.N; }
        paint();
      });
    }
  }

  // ------------------------------------------------------------ painting
  function paint() {
    const g = S.g; if (!g) return;
    const e = g.edge, ready = e.ready && S.N > 0;
    const tops = S.callers.filter(c => c.key !== 'usual' && c.rate != null);
    const best = tops.reduce((a, b) => (b.rate > a.rate ? b : a), tops[0]);
    const net = S.callers.find(c => c.key === 'net');
    $('word').className = `edWord ${e.ready ? (e.edge ? 'ok' : 'bad') : ''}`;
    $('word').innerHTML = `<i class="dot ${e.ready ? (e.edge ? 'ok' : 'bad') : ''}"></i>${!e.ready ? 'Too few forecasts' : e.edge ? 'Something to look at' : 'No edge yet'}`;
    $('say').innerHTML = !e.ready ? esc(e.verdict)
      : `${e.edge ? 'A caller beat the usual way by more than luck allows.' : 'Nobody called the direction better than luck allows.'} Best: <b>${esc(tops.filter(c => c.rate === best.rate).map(c => c.label.toLowerCase()).join(' and '))}</b> at <b>${pct(best.rate)}</b>, against <b>${pct(S.base)}</b> for ${esc(e.baselines[0].label.replace(' (the usual way)', '').toLowerCase())} — luck alone reaches <b>${pct(S.base + S.noise)}</b> over ${e.tested} calls.${net.rate != null ? ` The neural network got <b>${pct(net.rate)}</b>.` : ''} <span class="hint">${esc(g.name)} · ${dayMonth(g.from + 12 * 3600e3)} → ${dayMonth(g.to)} · ${e.rows} forecasts</span>`;
    $('how').innerHTML = `<li>Each 3-hour forecast from the grade becomes one row, oldest first.</li><li>Every caller learns from the <b>first ${e.warm}</b> only, then calls the next one up or down, always seeing only the past.</li><li>Always guessing the usual way sets the bar. Over ${e.tested} calls, luck alone moves a rate about <b>±${Math.round(100 * S.noise)} points</b>: the grey band.</li><li>A caller that climbs clear of the grey and stays there is worth a closer look. Inside it, a bigger model would only memorise noise.</li><li><b>What would make a bigger network worth trying:</b> more examples (forecasts every 15 minutes, more instruments), this check as the pass mark, and a small learner finding something first.</li>`;
    $('raceCard').hidden = !ready;
    board(e);
    panel();
    if (ready) race();
  }

  function board(e) {
    if (!e.ready) { $('board').innerHTML = ''; $('board').hidden = true; return; }
    $('board').hidden = false;
    const LO = 0.35, HI = 0.65, X = v => `${(100 * (Math.max(LO, Math.min(HI, v)) - LO) / (HI - LO)).toFixed(2)}%`;
    const band = `left:${X(S.base - S.noise)};width:calc(${X(S.base + S.noise)} - ${X(S.base - S.noise)})`;
    let grp = '', html = `<div class="edBRow edBHead"><span>Who calls the direction</span><span class="r">Right</span><span class="edScale">${[0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65].map(v => `<i style="left:${X(v)}">${pct(v)}</i>`).join('')}</span><span class="r">vs usual</span><span class="r">Points, 1 lot</span><span>Every call, oldest → newest</span></div>`;
    for (const C of S.callers) {
      if (C.grp !== grp) { grp = C.grp; html += `<div class="edGrp">${grp}</div>`; }
      const has = C.rate != null, d = has ? Math.round(100 * (C.rate - S.base)) : 0, clear = has && C.key !== 'usual' && C.rate - S.base > S.noise;
      html += `<div class="edBRow edCaller${C.key === S.focus ? ' sel' : S.focus ? ' dim' : ''}" data-k="${C.key}" tabindex="0" role="button" aria-pressed="${C.key === S.focus}">
        <div class="edWho"><i class="edKey${C.key === 'usual' ? ' dash' : ''}" style="--c:${C.c}"></i><div>${esc(C.label)}<small>${esc(C.sub)}</small></div></div>
        <div class="r edNum">${has ? `${C.hits}<small> / ${C.n}</small>` : `<small>${S.N ? 'training…' : '—'}</small>`}</div>
        <div class="edAxis"><i class="ln"></i><i class="band" style="${band}"></i><i class="base" style="left:${X(S.base)}"></i>${has ? `<i class="v" style="left:${X(C.rate)};background:${C.c}"></i><b style="left:${X(C.rate)};color:${C.c}">${pct(C.rate)}</b>` : ''}</div>
        <div class="r edNum ${clear ? 'ok' : 'muted'}">${C.key === 'usual' || !has ? '—' : `${d >= 0 ? '+' : '−'}${Math.abs(d)} pts`}</div>
        <div class="r edNum ${C.points == null ? 'muted' : C.points >= 0 ? 'ok' : 'bad'}">${pts(C.points)}</div>
        <div class="edTape" data-k="${C.key}">${C.right ? C.right.map(r => `<i${r ? ' class="y"' : ''}></i>`).join('') : ''}</div>
      </div>`;
    }
    $('board').innerHTML = html;
  }

  function race() {
    if (!S.N) return;
    const svg = $('race'), W = 1300, H = 400, L = 52, R = 1150, TP = 12, B = H - 28, N = S.N, T = S.T;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.textContent = '';
    const mk = (tag, a, text) => { const x = document.createElementNS(NS, tag); for (const k in a) if (a[k] != null) x.setAttribute(k, a[k]); if (text != null) x.textContent = text; svg.appendChild(x); return x; };
    const xk = k => L + (R - L) * k / Math.max(1, N - 1);
    const lines = S.callers.filter(C => C.exc).map(C => {
      const vals = C.key === 'net' && S.reveal != null ? C.exc.slice(0, S.reveal) : C.exc;
      return { key: C.key, c: C.c, vals, label: C.short, w: C.key === 'net' ? 2.6 : 1.8, dash: C.key === 'usual' ? '4 4' : null,
        op: !S.focus || S.focus === C.key ? 1 : 0.13, head: C.key === 'net' && S.reveal != null };
    });
    if (S.testScore) lines.push({ key: 'test', c: '#f5b544', vals: S.testScore.exc, label: 'Test run', w: 2.2, dash: '6 4', op: 1 });
    lines.sort((a, b) => (a.key === S.focus) - (b.key === S.focus));
    let lo = -luck(N - 1), hi = luck(N - 1);
    for (const l of lines) for (const v of l.vals) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const y = v => B - (B - TP) * (v - lo) / (hi - lo);
    let last = '', lk = -99;
    T.forEach((r, k) => {
      const s = dayMonth(r.at), monday = new Date(r.at).getUTCDay() === 1;
      if (k === 0 || (s !== last && monday && k - lk > 12)) { lk = k; mk('line', { x1: xk(k), x2: xk(k), y1: TP, y2: B, class: 'grid' }); mk('text', { x: xk(k), y: B + 17, 'text-anchor': 'middle' }, s); }
      last = s;
    });
    const step = hi - lo > 60 ? 10 : 5;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { mk('line', { x1: L, x2: R, y1: y(v), y2: y(v), class: v === 0 ? 'zero' : 'grid' }); mk('text', { x: L - 8, y: y(v) + 3, 'text-anchor': 'end' }, signed(v)); }
    mk('path', { class: 'luck', d: `M${T.map((_, k) => `${xk(k).toFixed(1)},${y(luck(k)).toFixed(1)}`).join('L')}L${T.map((_, k) => `${xk(k).toFixed(1)},${y(-luck(k)).toFixed(1)}`).reverse().join('L')}Z` });
    const ends = [];
    for (const l of lines) {
      if (!l.vals.length) continue;
      mk('path', { d: `M${l.vals.map((v, k) => `${xk(k).toFixed(1)},${y(v).toFixed(1)}`).join('L')}`, fill: 'none', stroke: l.c, 'stroke-width': l.w, 'stroke-opacity': l.op, 'stroke-dasharray': l.dash, 'stroke-linejoin': 'round' });
      const k = l.vals.length - 1;
      ends.push({ l, x: k === N - 1 ? R : xk(k), v: l.vals[k] });
      if (l.head) mk('circle', { cx: xk(k), cy: y(l.vals[k]), r: 5, fill: l.c });
    }
    ends.sort((a, b) => y(a.v) - y(b.v));
    let prev = -1e9;
    for (const x of ends) { x.ly = Math.max(y(x.v), prev + 15); prev = x.ly; }
    for (const x of ends) {
      const t = mk('text', { x: x.x + 12, y: x.ly + 4, class: 'end', 'fill-opacity': Math.max(0.35, x.l.op), 'data-k': x.l.key }, `${x.l.label} ${signed(x.v)}`);
      t.style.fill = x.l.c;
    }
    const cur = mk('line', { y1: TP, y2: B, class: 'cursor', opacity: 0 });
    const hit = mk('rect', { x: L, y: 0, width: R - L, height: H, fill: 'transparent' });
    const at = e => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(svg.getScreenCTM().inverse()); return Math.max(0, Math.min(N - 1, Math.round((q.x - L) / (R - L) * (N - 1)))); };
    hit.addEventListener('pointermove', e => {
      const k = at(e);
      cur.setAttribute('opacity', 1); cur.setAttribute('x1', xk(k)); cur.setAttribute('x2', xk(k));
      if (S.hover !== k) { S.hover = k; said(); }
      const r = T[k], who = S.callers.filter(C => C.exc && k < C.exc.length && (!S.focus || C.key === S.focus));
      const rows = who.map(C => `<span style="color:${C.c}">●</span> ${esc(C.label)}: <b>${signed(C.exc[k])}</b>`);
      if (S.testScore) rows.push(`<span style="color:#f5b544">●</span> Test run: <b>${signed(S.testScore.exc[k])}</b>`);
      showTip(e, `<b>Call ${k + 1} · ${when(r.at)}</b><br>market went <b class="${r.y ? 'okT' : 'badT'}">${r.y ? 'up' : 'down'} ${sgn(r.move)}</b><br>${rows.join('<br>')}<br><span class="hint">click: open this call's full wiring</span>`);
    });
    hit.addEventListener('pointerleave', () => { cur.setAttribute('opacity', 0); hideTip(); });
    hit.addEventListener('click', e => openWire(at(e)));
  }

  function panel() {
    const g = S.g, e = g.edge, net = S.callers.find(c => c.key === 'net'), stale = g.stale || !S.N;
    const training = !stale && e.ready && !S.full;
    $('rate').textContent = net.rate != null ? pct(net.rate) : '—';
    $('rateS').textContent = net.rate != null ? `${net.hits} of ${net.n} · ${pts(net.points)} pts` : stale ? 'grade again to train it' : 'training…';
    $('base').textContent = e.ready ? pct(S.base) : '—';
    $('baseS').textContent = e.ready ? `luck allows up to ${pct(S.base + S.noise)}` : '';
    $('state').textContent = stale ? 'grade too old' : !e.ready ? 'too few forecasts' : training ? 'training…' : S.test && !S.testScore ? 'retraining…' : S.reveal != null ? 'replaying…' : e.edge && net.rate - S.base > S.noise ? 'trained · worth a look' : 'trained · no edge';
    $('progW').hidden = !training;
    $('secLooks').hidden = $('secCall').hidden = $('secWire').hidden = stale || !e.ready;
    const go = $('go');
    if (stale) { go.innerHTML = 'Grade this range again'; go.disabled = false; go.dataset.act = 'regrade'; }
    else { go.innerHTML = S.reveal != null ? `${ICON.pause}Stop` : `${ICON.play}Watch it learn`; go.disabled = !S.full || !!(S.test && !S.testScore); go.dataset.act = 'watch'; }
    const ref = g.net && g.net.fingerprint;
    $('match').innerHTML = !S.fullFp || !ref ? (stale ? '<span class="hint">this grade was built before the network could be shown here</span>' : '')
      : S.fullFp === ref ? '<span class="okT">✓ same as the Lab’s run</span>' : `<span class="badT">✗ differs from the Lab’s run (${esc(S.fullFp)} here, ${esc(ref)} there)</span>`;
    const busy = !!(S.test && !S.testScore);
    $('switches').innerHTML = GROUPS.map((x, i) => `<div class="edSwitch"><b>${esc(x.label)}</b><button type="button" class="edTog" role="switch" aria-checked="${S.on[i]}" aria-label="Use ${esc(x.label)}" data-i="${i}" ${busy || !S.full ? 'disabled' : ''}></button><span>${esc(x.desc)}</span></div>`).join('');
    const t = $('test'), off = GROUPS.filter((x, i) => !S.on[i]).map(x => x.label.toLowerCase()).join(', ');
    t.hidden = !S.test;
    if (busy) t.innerHTML = `<b>Retraining without ${esc(off)}…</b><div class="edProg amber"><i style="width:${100 * S.test.calls.length / S.N}%"></i></div>`;
    else if (S.testScore) {
      const d = S.testScore.hits - net.hits, within = Math.abs(d) <= Math.round(luck(S.N - 1));
      t.innerHTML = `<b>Test run</b> without ${esc(off)}: <b>${pct(S.testScore.hits / S.N)}</b> right (${signed(d)} calls against the full network). ${within ? 'That is within luck: this input made no real difference.' : 'That is more than luck: this input matters.'} <span class="hint">Not the saved result.</span><div><button type="button" class="btn sm" data-act="all">Use everything again</button></div>`;
    }
    said();
  }

  function said() {
    const run = S.testScore ? S.test : S.full;
    if (!run || !S.N) { $('said').innerHTML = '<span class="hint">hover the chart to read any call</span>'; $('push').innerHTML = ''; return; }
    const k = S.hover == null ? S.N - 1 : S.hover, c = run.calls[k], r = S.T[k], up = c.p > 0.5, right = (up ? 1 : 0) === r.y;
    $('said').innerHTML = `<b>${when(r.at)}</b>${S.hover == null ? ' <span class="hint">(the latest)</span>' : ''}<br>the network said <b class="${up ? 'okT' : 'badT'}">${up ? 'up' : 'down'}</b>, ${pct(up ? c.p : 1 - c.p)} sure. The market went <b class="${r.y ? 'okT' : 'badT'}">${r.y ? 'up' : 'down'} ${nf(r.move)} pts</b>: <b class="${right ? 'okT' : 'badT'}">${right ? 'right' : 'wrong'}</b>.${S.testScore ? ' <span class="hint">(test run)</span>' : ''}`;
    const list = pushes(run, k).slice(0, 5), mx = Math.max(0.05, ...list.map(f => Math.abs(f.v)));
    $('push').innerHTML = list.map(f => `<div class="edPush" title="the up chance on this call, minus what it would be with ${esc(f.name.toLowerCase())} at its usual value"><span class="nm">${esc(f.name)}</span><span class="l">${f.v < 0 ? `<i style="width:${(100 * -f.v / mx).toFixed(1)}%"></i>` : ''}</span><span class="rt">${f.v > 0 ? `<i style="width:${(100 * f.v / mx).toFixed(1)}%"></i>` : ''}</span><span class="v ${f.v >= 0 ? 'okT' : 'badT'}">${f.v >= 0 ? '+' : '−'}${Math.abs(Math.round(100 * f.v))}</span></div>`).join('');
  }

  // ------------------------------------------------------------ actions
  function pick(k) { S.focus = S.focus === k ? null : k; board(S.g.edge); race(); }
  function retrain() {
    clearTimeout(S.timer); S.job++;
    S.reveal = null;
    if (S.on.every(Boolean)) { S.test = S.testScore = null; panel(); race(); return; }
    const mask = []; GROUPS.forEach((x, i) => x.js.forEach(j => { mask[j] = S.on[i] ? 1 : 0; }));
    S.test = newRun(mask); S.testScore = null; panel();
    trainAsync(S.test, () => panel(), () => {
      const right = rightOf(S.test);
      S.testScore = { hits: right.reduce((a, b) => a + b, 0), exc: excessOf(right) };
      panel(); race();
    });
  }
  function watch() {
    if (S.reveal != null) { clearTimeout(S.timer); S.job++; S.reveal = null; panel(); race(); return; }
    const job = ++S.job;
    S.reveal = 0; panel();
    const tick = () => { if (job !== S.job) return; S.reveal = Math.min(S.N, S.reveal + 2); race(); if (S.reveal >= S.N) { S.reveal = null; panel(); race(); } else S.timer = setTimeout(tick, 24); };
    tick();
  }
  function openWire(k) {
    stop();
    if (!wire.open) wire.showModal();
    netPanel.showCall(k);
    const r = S.T[k == null ? S.N - 1 : k];
    wire.querySelector('[data-w="sub"]').textContent = r ? `call ${(k == null ? S.N - 1 : k) + 1} of ${S.N} · ${when(r.at)} · drag the call slider or click any node or line` : '';
  }
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-act], [data-e="wire"], .edTog, .edCaller, text[data-k]');
    if (!a) return;
    if (a.matches('.edTog')) {
      const i = +a.dataset.i; S.on[i] = !S.on[i];
      if (!S.on.some(Boolean)) { S.on[i] = true; return; }
      retrain(); return;
    }
    if (a.matches('.edCaller')) return pick(a.dataset.k);
    if (a.matches('text[data-k]')) { if (a.dataset.k !== 'test') pick(a.dataset.k); return; }
    if (a.dataset.e === 'wire') return openWire(S.hover);
    if (a.dataset.act === 'regrade') return regrade(S.g.from, S.g.to);
    if (a.dataset.act === 'watch') return watch();
    if (a.dataset.act === 'all') { S.on = GROUPS.map(() => true); retrain(); }
  });
  el.addEventListener('keydown', e => {
    const r = e.target.closest('.edCaller');
    if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const k = r.dataset.k; pick(k); el.querySelector(`.edCaller[data-k="${k}"]`)?.focus(); }
  });
  el.addEventListener('pointermove', e => {
    const t = e.target.closest('.edTape'); if (!t) return;
    if (e.target.tagName !== 'I') return hideTip();
    const k = [...t.children].indexOf(e.target), C = S.callers.find(c => c.key === t.dataset.k), r = S.T[k];
    const up = C.key === 'usual' ? true : C.key === 'net' ? S.full.calls[k].p > 0.5 : S.g.edge.calls[C.key][k] === '1';
    showTip(e, `<b>Call ${k + 1} · ${when(r.at)}</b><br>${esc(C.label)} called <b>${up ? 'up' : 'down'}</b> · the market went <b class="${r.y ? 'okT' : 'badT'}">${r.y ? 'up' : 'down'} ${sgn(r.move)}</b><br>${C.right[k] ? '<span class="okT">right</span>' : '<span class="badT">wrong</span>'}`);
  });
  el.addEventListener('pointerout', e => { if (e.target.closest('.edTape') && !e.relatedTarget?.closest?.('.edTape')) hideTip(); });

  wire.querySelector('[data-w="close"]').addEventListener('click', () => wire.close());
  wire.addEventListener('click', e => { if (e.target === wire) wire.close(); });
  wire.addEventListener('close', () => netPanel.stop());

  function stop() {
    if (S.reveal != null) { clearTimeout(S.timer); S.job++; S.reveal = null; if (S.g) { panel(); race(); } }
    hideTip();
  }
  return { set: g => { if (g !== S.g) set(g); }, stop };
}
