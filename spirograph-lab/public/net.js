// The Edge check's neural network panel (16 Sep): the network in lab/labNet.js trained live in the page on a grade's
// rows, one walk-forward step at a time, drawn as the XOR demo draws its network. The server ran the same code on the
// same rows when the grade was built; at the end the page's fingerprint is checked against the server's.
//
// Every node and edge opens an audit: the call shown, worked through with the exact weights it was made with (a copy is
// kept after each fit). Two ways to tune, kept apart:
//   what-if   edit an input's raw value on the call shown; only that call's answer is recomputed, training is untouched
//   variant   leave an input out of training, shuffle it or negate it; the walk restarts, marked not comparable to the server's
//   presets   what-if: flip the call or set P(up), solving for this input's value; retrain: the variant modes above
// Edits are forgotten when the call, the grade or the training changes. Opening an audit pauses training.
import { netWalk, netScore, explain, snapshot, withMask, solveInput, tweakRows, pUp, INPUTS, WARM, NET } from '/lab/labNet.js';
import { esc, when, pct, sgn, int } from '/lab/util.js';

const NS = 'http://www.w3.org/2000/svg', POS = '#a78bfa', NEG = '#5ce1ff';
const W = 760, H = 460, XI = 118, XH = 390, XO = 650;
const yAt = (k, n) => 40 + (k + 0.5) * (H - 70) / n;
const OUT = ['P(up)', 'size'];
const f4 = v => (!Number.isFinite(v) ? '—' : (Math.abs(v) >= 1000 ? v.toFixed(1) : v.toFixed(4)).replace('-', '−'));
const sf = v => (!Number.isFinite(v) ? '—' : (v < 0 ? '−' : '+') + f4(Math.abs(v)));
const pf = v => (v < 0 ? `(−${f4(-v)})` : f4(v));   // a value after a minus sign
// Lucide icons (ISC licence)
const ICON = {
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  shuffle: '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  cross: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  calc: '<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  flip: '<path d="m3 7 5 5-5 5V7"/><path d="m21 7-5 5 5 5V7"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/>',
  sliders: '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
};
const ic = k => `<svg class="nmIcon" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

export function createNetPanel(el) {
  const $ = r => el.querySelector(`[data-n="${r}"]`);
  el.innerHTML = `
    <h3>Neural network <span>${INPUTS.length} inputs → ${NET.hidden} hidden → up and size · trains in this page on the grade's forecasts · click any node or line to audit it</span></h3>
    <div class="headline"><b class="word" data-n="word"></b><span data-n="verdict"></span></div>
    <div class="toolbar">
      <button type="button" class="btn pri" data-n="play">Train</button>
      <button type="button" class="btn" data-n="step">Step</button>
      <button type="button" class="btn" data-n="end">To the end</button>
      <button type="button" class="btn" data-n="reset">Reset</button>
      <div class="seg" data-n="speed"><button type="button" data-s="1">Slow</button><button type="button" data-s="4" class="on">Normal</button><button type="button" data-s="40">Fast</button></div>
      <span class="hint" data-n="match"></span>
    </div>
    <div class="netGrid">
      <div class="netCard"><svg class="netSvg" data-n="svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="The network: click a node or a line to audit it"></svg>
        <div class="legend"><span><i style="--c:${POS}"></i>positive weight</span><span><i style="--c:${NEG}"></i>negative weight</span><span><i style="--c:var(--amber)"></i>edited (what-if)</span><span>thickness: size · brightness: activation on the call shown</span></div>
      </div>
      <div class="netSide">
        <div class="tiles netTiles" data-n="tiles"></div>
        <div><h3>Training loss <span>after every 10 passes · falls as it learns the past</span></h3><canvas class="netLoss" data-n="loss"></canvas></div>
        <div><h3>Call shown <span data-n="callHint">drag to look back</span></h3>
          <input type="range" class="netScrub" data-n="scrub" min="0" max="0" value="0" aria-label="Which call to show">
          <div class="say" data-n="call"></div><div class="say netWhatif" data-n="whatif" hidden></div></div>
        <div class="table"><table><thead><tr><th>Who guesses the size</th><th>Average miss</th></tr></thead><tbody data-n="size"></tbody></table></div>
      </div>
    </div>
    <p class="note" data-n="note"></p>
    <dialog class="netModal" data-n="modal" aria-labelledby="netModalTitle">
      <div class="nmHead"><div class="nmName"><small data-n="mKind"></small><h2 id="netModalTitle" data-n="mTitle"></h2></div><div class="nmMeta" data-n="mSub"></div><button type="button" class="nmX" data-n="mClose" aria-label="Close">${ic('x')}</button></div>
      <div class="nmBody"><div class="nmTune" data-n="mCtl"></div><div class="netModalBody nmMain" data-n="mBody"></div></div>
    </dialog>`;

  // ------------------------------------------------------------ the diagram
  const svg = $('svg');
  const nodes = { in: INPUTS.map((_, k) => ({ x: XI, y: yAt(k, INPUTS.length) })), hid: Array.from({ length: NET.hidden }, (_, k) => ({ x: XH, y: yAt(k, NET.hidden) })), out: [{ x: XO, y: yAt(0, 2) - 40 }, { x: XO, y: yAt(1, 2) + 40 }] };
  const mk = (tag, attrs, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  const curve = (a, b) => { const m = (a.x + b.x) / 2; return `M${a.x},${a.y} C${m},${a.y} ${m},${b.y} ${b.x},${b.y}`; };
  const eg = mk('g', {}), hitg = mk('g', {});
  const edges = [];
  const edge = (a, b, info) => {
    const e = { ...info, el: mk('path', { d: curve(a, b), class: 'netEdge' }, eg) };
    mk('path', { d: curve(a, b), class: 'netHit' }, hitg).addEventListener('click', () => open({ kind: 'edge', ...info }));
    edges.push(e);
  };
  nodes.hid.forEach((b, k) => nodes.in.forEach((a, j) => edge(a, b, { layer: 1, k, j })));
  nodes.out.forEach((b, o) => nodes.hid.forEach((a, k) => edge(a, b, { layer: 2, o, k })));
  const circ = (n, label, left, target) => {
    const g = mk('g', { class: 'netNode', tabindex: '0', role: 'button', 'aria-label': `Audit ${label || `hidden neuron h${target.k + 1}`}` });
    const c = mk('circle', { cx: n.x, cy: n.y, r: 15 }, g), t = mk('text', { x: n.x, y: n.y + 4, class: 'netAct' }, g);
    mk('text', { x: left ? n.x - 24 : n.x + 24, y: n.y + 4, class: 'netLabel', 'text-anchor': left ? 'end' : 'start' }, g).textContent = label || `h${target.k + 1}`;
    g.addEventListener('click', () => open(target));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(target); } });
    return { g, c, t };
  };
  const vin = nodes.in.map((n, j) => circ(n, INPUTS[j], true, { kind: 'in', j }));
  const vhid = nodes.hid.map((n, k) => circ({ ...n, x: n.x }, null, false, { kind: 'hid', k }));
  const vout = nodes.out.map((n, o) => circ(n, OUT[o], false, { kind: 'out', o }));
  for (const [x, s] of [[XI, 'Inputs: circles + pen time'], [XH, 'Hidden (sigmoid)'], [XO, 'Outputs']]) mk('text', { x, y: 20, class: 'netHead', 'text-anchor': 'middle' }).textContent = s;

  // ------------------------------------------------------------ training
  const S = { grade: null, rows: [], gen: null, net: null, snaps: [], calls: [], losses: [], done: false, playing: false, speed: 4, pick: null, raf: 0,
    mask: INPUTS.map(() => 1), tweak: {}, base: [], edits: {}, editsFor: null, modal: null, preset: null, open: 1, drag: false, cw: 0 };
  const variant = () => S.mask.some(m => !m) || Object.keys(S.tweak).length > 0;
  const MODES = [['real', 'Real'], ['shuffle', 'Shuffled'], ['negate', 'Negated'], ['off', 'Left out']];
  const modeOf = j => (!S.mask[j] ? 'off' : S.tweak[j] || 'real');

  function reset() {
    clearTimeout(S.raf);
    S.rows = tweakRows(S.base, S.tweak); S.preset = null;
    S.gen = S.rows.length ? netWalk(S.rows, withMask(S.mask)) : null;
    S.net = null; S.snaps = []; S.calls = []; S.losses = []; S.done = !S.gen; S.playing = false; S.pick = null; S.edits = {};
    paint();
  }
  function step() {
    if (!S.gen || S.done) return false;
    const r = S.gen.next();
    if (r.done) { S.done = true; S.playing = false; return false; }
    const s = r.value; S.net = s.net;
    if (s.kind === 'fit') { S.losses.push(...s.losses); S.snaps.push({ snap: snapshot(s.net), upTo: s.upTo }); }
    else S.calls.push({ i: s.i, p: s.p, size: s.size, fit: S.snaps.length - 1 });
    return true;
  }
  function frame() {
    if (!S.playing) return;
    const t0 = performance.now();
    for (let k = 0; k < S.speed && performance.now() - t0 < 14; k++) if (!step()) break;
    paint();
    if (S.playing) S.raf = setTimeout(frame, 16);
  }
  const finish = () => { while (!S.done) step(); };
  const pause = () => { S.playing = false; clearTimeout(S.raf); };

  /** The call shown, the exact weights it was made with, and its forward pass: real, and with the what-if edits. */
  function current() {
    if (!S.snaps.length) return null;
    const calls = S.calls, at = S.pick == null ? calls.length - 1 : Math.min(S.pick, calls.length - 1), c = calls[at] || null;
    if (S.editsFor !== (c ? c.i : -1)) { S.edits = {}; S.editsFor = c ? c.i : -1; }   // edits belong to one call: a new call forgets them
    const fitAt = c ? c.fit : S.snaps.length - 1, fit = S.snaps[fitAt], prev = S.snaps[fitAt - 1] || null;
    const row = c ? S.rows[c.i] : S.rows[Math.min(S.rows.length, WARM) - 1];
    const x = row.x.map((v, j) => (j in S.edits ? S.edits[j] : v));
    const real = explain(fit.snap, row.x, row), edited = Object.keys(S.edits).length ? explain(fit.snap, x, row) : real;
    return { c, at, row, x, fit, fitAt, prev, real, ex: edited, edited: edited !== real };
  }

  // ------------------------------------------------------------ painting
  function paint() {
    const g = S.grade, ref = g && g.net, rows = S.rows, n = rows.length, calls = S.calls;
    $('play').textContent = S.playing ? 'Pause' : S.done && S.net ? 'Trained' : calls.length || S.losses.length ? 'Resume' : 'Train';
    $('play').disabled = $('step').disabled = $('end').disabled = S.done;
    const score = calls.length ? netScore(rows.slice(0, calls[calls.length - 1].i + 1), calls) : null;
    const final = S.done && S.net ? netScore(rows, calls) : null;

    const ready = n >= WARM + 30, good = final && (final.dirEdge || final.sizeEdge);
    const word = !g ? '' : g.stale ? 'Rebuild the grade' : !S.net ? 'Not trained yet' : !S.done ? 'Learning…' : !ready ? 'Too few to judge' : good ? 'Something to look at' : 'Nothing learned yet';
    const cls = S.done && ready ? (good ? 'ok' : 'bad') : '';
    $('word').className = `word ${cls}`;
    $('word').innerHTML = `<i class="dot ${cls}"></i>${esc(word)}`;
    $('verdict').textContent = !g ? '' : g.stale ? 'this grade was built before the network: grade the same range again on Multi-day grade'
      : final ? final.verdict : score ? `call ${calls.length} of ${Math.max(0, n - WARM)} · ${score.verdict}` : `${n} forecasts · it learns from the first ${Math.min(n, WARM)}, then calls each next one having seen only the ones before it`;
    const changed = INPUTS.map((name, j) => ({ off: 'left out', shuffle: 'shuffled', negate: 'negated' })[modeOf(j)] && `${name} ${({ off: 'left out', shuffle: 'shuffled', negate: 'negated' })[modeOf(j)]}`).filter(Boolean);
    $('match').innerHTML = variant()
      ? `<i class="dot amber"></i>variant: ${esc(changed.join(', '))} in training · not comparable to the server's run <button type="button" class="btn sm" data-a="restore">Use all inputs</button>`
      : !final || !ref ? '' : final.fingerprint === ref.fingerprint
        ? `<i class="dot ok"></i>matches the server's run (${final.fingerprint})` : `<i class="dot bad"></i>differs from the server's run (${final.fingerprint} here, ${esc(ref.fingerprint)} there)`;

    const tile = (k, v, s) => `<div class="tile"><small>${k}</small><b>${v}</b><span>${s}</span></div>`;
    $('tiles').innerHTML = score
      ? tile('Direction', pct(score.rate), `${score.hits} of ${score.tested} right · always ${score.usualWord} gets ${pct(score.usual)} · chance ±${pct(score.noise)}`)
        + tile('Size, average miss', score.mae.toFixed(1), `a flat line misses by ${score.flatMae.toFixed(1)} · the pen by ${score.penMae.toFixed(1)}`)
      : tile('Direction', '—', 'no calls yet') + tile('Size, average miss', '—', 'no calls yet');
    $('size').innerHTML = score ? [['A flat line (no move)', score.flatMae, false], ['The pen’s own move', score.penMae, false], ['The neural network', score.mae, true]]
      .map(([l, v, me]) => `<tr class="${me ? 'learner' : 'base'}"><td>${l}</td><td class="${me ? (score.gain > score.gainBand ? 'ok' : score.gain < 0 ? 'bad' : '') : ''}">${v.toFixed(1)}</td></tr>`).join('')
      : '<tr><td colspan="2" class="muted">no calls yet</td></tr>';

    const cur = current();
    const sc = $('scrub'); sc.max = String(Math.max(0, calls.length - 1));
    sc.value = String(Math.max(0, cur ? cur.at : 0)); sc.disabled = calls.length < 2;
    $('callHint').textContent = S.pick == null ? 'following the latest · drag to look back' : 'drag to the right end to follow again';
    if (cur && cur.c) {
      const r = cur.row, up = cur.real.p > 0.5, hit = (up ? 1 : 0) === r.y;
      $('call').innerHTML = `${when(r.at)} · it said <b>${up ? 'up' : 'down'}</b> (${pct(cur.real.p)}) by <b>${sgn(cur.real.size)}</b> · the market moved <b>${sgn(r.move)}</b> · <b class="${hit ? 'okT' : 'badT'}">${hit ? '✓ right way' : '✗ wrong way'}</b>`;
    } else $('call').textContent = S.net ? `training on the first ${Math.min(n, WARM)} forecasts… (click a node to audit the last of them)` : '';
    const wi = $('whatif');
    wi.hidden = !(cur && cur.edited);
    if (cur && cur.edited) wi.innerHTML = `<b>What-if</b> · ${Object.keys(S.edits).map(j => `${esc(INPUTS[j])} ${f4(cur.row.x[j])} → ${f4(S.edits[j])}`).join(' · ')} · P(up) ${pct(cur.real.p)} → <b>${pct(cur.ex.p)}</b> · size ${sgn(cur.real.size)} → <b>${sgn(cur.ex.size)}</b> <button type="button" class="btn sm" data-a="clearEdits">Reset edits</button>`;

    if (cur) {
      const { ex, fit } = cur, sn = fit.snap;
      for (const e of edges) {
        const w = e.layer === 1 ? sn.W1[e.k * sn.d + e.j] : sn.W2[e.o * sn.h + e.k], a = Math.abs(w), dead = e.layer === 1 && !sn.mask[e.j];
        e.el.setAttribute('stroke', w >= 0 ? POS : NEG);
        e.el.setAttribute('stroke-width', (0.4 + Math.min(4.5, a * 1.6)).toFixed(2));
        e.el.setAttribute('opacity', dead ? '0.05' : (0.12 + Math.min(0.8, a * 0.45)).toFixed(2));
      }
      vin.forEach((v, j) => {
        const z = ex.inputs[j].z; fill(v, 0.5 + Math.max(-2, Math.min(2, z)) / 4, S.mask[j] ? z.toFixed(1) : 'off');
        v.g.classList.toggle('edited', j in S.edits); v.g.classList.toggle('off', !S.mask[j]);
      });
      vhid.forEach((v, k) => fill(v, ex.hidden[k].a, ex.hidden[k].a.toFixed(2)));
      fill(vout[0], ex.p, ex.p.toFixed(2)); fill(vout[1], 0.5 + Math.max(-1, Math.min(1, ex.size / (2 * ex.msd))) / 2, ex.size.toFixed(0));
    } else {
      for (const e of edges) { e.el.setAttribute('stroke', 'rgb(255 255 255 / 12%)'); e.el.setAttribute('stroke-width', '0.6'); e.el.setAttribute('opacity', '1'); }
      for (const v of [...vin, ...vhid, ...vout]) fill(v, 0, '');
      vin.forEach((v, j) => { v.g.classList.remove('edited'); v.g.classList.toggle('off', !S.mask[j]); });
    }
    drawLoss();
    const every = Math.max(1, Math.ceil(Math.max(0, n - WARM) / NET.maxFits));
    $('note').innerHTML = `Inputs: the six circles' signed sizes, the fit's explained share and miss, the pen's 3-hour and first-hour move, and the time the pen was frozen (as a point on the 24-hour clock from 6 pm). Each call uses only forecasts before it: the network retrains every ${every} forecast${every > 1 ? 's' : ''}, starting from its last weights. Seeded, so every run of this grade trains the same network, here and on the server. With about ${int(INPUTS.length * NET.hidden + NET.hidden * 3 + 2)} weights and ${n} forecasts it can memorise the past easily: a falling loss is not an edge, only the calls are. Click any node or line to see its math on the call shown.`;
    if (S.modal) renderModalBody();
  }
  function fill(v, a, text) {
    const t = Math.max(0, Math.min(1, a));
    v.c.setAttribute('fill', `rgb(${Math.round(22 + t * 145)} ${Math.round(26 + t * 113)} ${Math.round(40 + t * 210)})`);
    v.c.setAttribute('class', t > 0.75 ? 'glow' : '');
    v.t.textContent = text;
  }
  function drawLoss() {
    const cv = $('loss'), dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 400, h = cv.clientHeight || 90;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    x.strokeStyle = 'rgb(255 255 255 / 6%)'; x.beginPath(); for (let i = 1; i < 4; i++) { x.moveTo(0, i * h / 4); x.lineTo(w, i * h / 4); } x.stroke();
    const L = S.losses; if (L.length < 2) return;
    const max = Math.max(...L), min = Math.min(...L), span = max - min || 1;
    x.strokeStyle = POS; x.lineWidth = 1.6; x.beginPath();
    L.forEach((v, i) => { const px = 4 + i / (L.length - 1) * (w - 8), py = h - 6 - (v - min) / span * (h - 12); i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke();
    x.fillStyle = '#93a0b3'; x.font = '500 11px ui-monospace, Menlo, monospace'; x.fillText(L[L.length - 1].toFixed(3), w - 44, 14);
  }

  // ------------------------------------------------------------ the audit
  // Design A "Bench" (16 Sep): for an input, tools in a left column (value, presets with where each lands, retrain) and,
  // on the right, the answer, P(up) along this input with each preset pinned on the curve, and the math as four steps.
  const dlg = $('modal');
  const nodeName = t => t.kind === 'in' ? INPUTS[t.j] : t.kind === 'hid' ? `h${t.k + 1}` : OUT[t.o];
  const pc1 = v => `${(100 * v).toFixed(1)}%`;
  const pts = v => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}`;
  const callOf = p => (p > 0.5 ? 'up' : 'down');
  function open(target) {
    pause();
    S.modal = target; S.open = 1; S.drag = false;
    $('mKind').textContent = target.kind === 'in' ? `Input ${target.j + 1} of ${INPUTS.length}` : { hid: 'Hidden neuron', out: 'Output', edge: 'Weight' }[target.kind];
    $('mTitle').textContent = target.kind === 'edge'
      ? (target.layer === 1 ? `${INPUTS[target.j]} → h${target.k + 1}` : `h${target.k + 1} → ${OUT[target.o]}`) : nodeName(target);
    dlg.classList.toggle('bench', target.kind === 'in');
    renderModalCtl();
    renderModalBody();
    paint();
    if (!dlg.open) dlg.showModal();
    renderModalBody();   // again, now it has a width: the curve is drawn to it
  }
  function close() { S.modal = null; if (dlg.open) dlg.close(); }
  dlg.addEventListener('close', () => { if (!dlg.open) S.modal = null; });   // the event lands late: a pop-up reopened meanwhile stays
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });   // the backdrop
  $('mClose').addEventListener('click', close);
  window.addEventListener('pointerup', () => { S.drag = false; });
  window.addEventListener('resize', () => { if (S.modal && S.modal.kind === 'in') { S.cw = 0; renderModalBody(); } });

  /** The value box: built once per open, so typing keeps focus while everything else redraws. Presets and retrain go in `dyn`. */
  function renderModalCtl() {
    const t = S.modal, ctl = $('mCtl');
    if (t.kind !== 'in') { ctl.innerHTML = ''; ctl.hidden = true; return; }
    ctl.hidden = false;
    const cur = current(), j = t.j;
    ctl.innerHTML = `
      <div class="nmGrp"><div class="nmKick">${ic('sliders')} Value <em>this call only · training untouched</em></div>
        <div class="nmVal" data-c="box"><button type="button" data-c="dn" title="−0.1 spread" aria-label="Down a tenth of a spread">−</button><input type="number" step="any" data-c="val" value="${cur ? +cur.x[j].toFixed(4) : ''}" aria-label="${esc(INPUTS[j])} on this call"><button type="button" data-c="up" title="+0.1 spread" aria-label="Up a tenth of a spread">+</button></div>
        <div class="nmValMeta"><span data-c="real"></span><button type="button" class="nmLink" data-c="resetVal">${ic('reset')} Reset</button></div></div>
      <div data-c="dyn" class="nmDyn"></div>`;
    const val = ctl.querySelector('[data-c="val"]');
    const setEdit = v => { const c = current(); if (!c || !c.c || !S.mask[j]) return; if (v === c.row.x[j]) delete S.edits[j]; else S.edits[j] = v; S.preset = null; paint(); };
    val.addEventListener('input', () => { const v = Number(val.value); if (val.value.trim() !== '' && Number.isFinite(v)) setEdit(v); });
    for (const [k, s] of [['dn', -1], ['up', 1]]) ctl.querySelector(`[data-c="${k}"]`).addEventListener('click', () => { const c = current(); if (c) setEdit(c.x[j] + s * 0.1 * c.fit.snap.sd[j]); });
    ctl.querySelector('[data-c="resetVal"]').addEventListener('click', () => { delete S.edits[j]; S.preset = null; const c = current(); if (c) val.value = String(c.row.x[j]); paint(); });
  }
  // the left column's buttons are redrawn often: one listener each, for the life of the panel
  $('mCtl').addEventListener('click', e => {
    if (!S.modal || S.modal.kind !== 'in') return;
    const j = S.modal.j, p = e.target.closest('[data-p]'), m = e.target.closest('[data-m]'), run = e.target.closest('[data-c="runEnd"]');
    if (p && !p.disabled) applyPreset(p.dataset.p);
    if (m && m.dataset.m !== modeOf(j)) {
      S.mask[j] = m.dataset.m === 'off' ? 0 : 1;
      if (m.dataset.m === 'shuffle' || m.dataset.m === 'negate') S.tweak[j] = m.dataset.m; else delete S.tweak[j];
      reset(); renderModalBody();
    }
    if (run) { run.disabled = true; run.textContent = 'Training…'; setTimeout(() => { pause(); finish(); paint(); }, 20); }
  });
  $('mCtl').addEventListener('pointerover', e => { const r = e.target.closest('.nmPreset'); lite(r && r.dataset.p); });
  $('mCtl').addEventListener('pointerleave', () => lite(null));
  const lite = key => dlg.querySelectorAll('.nmPin, .nmPreset').forEach(x => x.classList.toggle('hi', !!key && (x.dataset.pin || x.dataset.p) === key));

  /** Each preset for input j on the call shown: the value nearest the real one that gets P(up) there, the other edits kept. */
  function presetsFor(cur, j) {
    if (!cur || !S.mask[j]) return [];
    const sn = cur.fit.snap, xr = Array.from(cur.x); xr[j] = cur.row.x[j];
    const from = pUp(sn, xr);
    return [['flip', from > 0.5 ? 0.495 : 0.505], ...[0.1, 0.3, 0.5, 0.7, 0.9].map(t => [String(t), t])].map(([key, target]) => ({ key, target, from, ...solveInput(sn, cur.x, j, target, cur.row.x[j]) }));
  }
  const presetName = p => p.key === 'flip' ? 'Flip the call' : `P(up) ${Math.round(p.target * 100)}%`;
  function applyPreset(key) {
    const c = current(), j = S.modal.j;
    if (!c || !c.c || !S.mask[j]) return;
    const p = presetsFor(c, j).find(q => q.key === key);
    if (!p || !('v' in p)) return;
    if (p.v === c.row.x[j]) delete S.edits[j]; else S.edits[j] = p.v;
    S.preset = { key, j, call: c.c.i, v: p.v };
    const val = $('mCtl').querySelector('[data-c="val"]'); if (val) val.value = String(+p.v.toFixed(4));
    paint();
  }

  /** The left column's moving parts: the value box's state, the preset list, the retrain switch and its score. */
  function renderTune(cur, presets) {
    const ctl = $('mCtl'), j = S.modal.j, dyn = ctl.querySelector('[data-c="dyn"]');
    if (!dyn) return;
    const can = !!(cur && cur.c && S.mask[j]), edited = !!cur && j in S.edits, val = ctl.querySelector('[data-c="val"]');
    ctl.querySelector('[data-c="box"]').classList.toggle('edited', edited);
    val.disabled = !can; ctl.querySelector('[data-c="dn"]').disabled = ctl.querySelector('[data-c="up"]').disabled = !can;
    if (cur && document.activeElement !== val) val.value = String(+cur.x[j].toFixed(4));
    ctl.querySelector('[data-c="resetVal"]').disabled = !edited;
    ctl.querySelector('[data-c="real"]').textContent = cur ? `real ${f4(cur.row.x[j])} · z ${f4(cur.ex.inputs[j].z)}` : '';

    const why = !cur ? 'train until there is a call' : !cur.c ? 'this forecast was trained on: presets work on calls' : !S.mask[j] ? `${INPUTS[j]} is left out of training: no value moves the answer` : '';
    const sd = cur ? cur.fit.snap.sd[j] : 1, y = cur ? cur.row.y : 0;
    const rows = (can ? presets : [['flip'], ['0.1'], ['0.3'], ['0.5'], ['0.7'], ['0.9']].map(([key]) => ({ key, target: key === 'flip' ? 0.5 : +key }))).map(p => {
      const reach = 'v' in p, on = S.preset && S.preset.key === p.key && S.preset.j === j && cur && cur.c && S.preset.call === cur.c.i && S.edits[j] === S.preset.v;
      const res = !can ? '' : reach ? `<b>${f4(p.v)}</b><br>${((p.v - cur.row.x[j]) / sd).toFixed(2).replace('-', '−')} spreads` : `<span class="badT">out of reach</span><br>${pct(p.lo)}–${pct(p.hi)} only`;
      const sub = !can ? '' : p.key === 'flip' ? `→ ${callOf(1 - p.from)} · ${(p.from > 0.5 ? 0 : 1) === y ? 'makes it right' : 'makes it wrong'}`
        : reach ? `calls ${callOf(p.p)}${Math.abs(p.p - 0.5) < 1e-6 ? ' (on the line)' : ''} · ${(p.p > 0.5 ? 1 : 0) === y ? 'right way' : 'wrong way'}` : 'this input alone cannot get there';
      return `<button type="button" class="nmPreset ${on ? 'on' : ''}" data-p="${p.key}" ${can && reach ? '' : 'disabled'}>${ic(p.key === 'flip' ? 'flip' : 'target')}<span class="nmPl">${presetName(p)}${sub ? `<i>${sub}</i>` : ''}</span><span class="nmPr">${res}</span></button>`;
    }).join('');

    const mode = modeOf(j), ref = S.grade && S.grade.net, fin = mode !== 'real' && S.done && S.net ? netScore(S.rows, S.calls) : null;
    const WHY = { shuffle: 'mixed across the forecasts: values kept, any link to the outcome broken', negate: 'sign flipped: the network could learn it back, so any change is the luck of the seeded start', off: 'reaches the network as 0' };
    let score = '';
    if (mode !== 'real') {
      if (fin && fin.tested) {
        const dx = r => Math.max(0, Math.min(100, (r - 0.35) / 0.35 * 100)), bar = (lb, v, w, cls, band = '') => `<span class="lb">${lb}</span><span class="tr">${band}<i class="${cls}" style="width:${w}%"></i></span><span class="v">${v}</span>`;
        const band = ref && ref.tested ? `<span class="band" style="left:${dx(ref.rate - ref.noise)}%;width:${dx(ref.rate + ref.noise) - dx(ref.rate - ref.noise)}%"></span>` : '';
        score = `<div class="nmCmp">${bar('Direction', pct(fin.rate), dx(fin.rate), 'var', band)}${ref && ref.tested ? bar('Real run', pct(ref.rate), dx(ref.rate), 'ref') : ''}${bar('Size miss', fin.mae.toFixed(1), Math.min(100, fin.mae / 1.5), 'var')}${ref && ref.tested ? bar('Real run', ref.mae.toFixed(1), Math.min(100, ref.mae / 1.5), 'ref') : ''}</div>
          <div class="nmCap">${esc(INPUTS[j])} ${WHY[mode]}${ref && ref.tested ? ` · grey band ±${pct(ref.noise)} chance: ${Math.abs(fin.rate - ref.rate) <= ref.noise ? 'inside it, no real change' : 'outside it, worth a look'}` : ''} · not comparable to the server's run</div>`;
      } else score = `<div class="nmCap">${esc(INPUTS[j])} ${WHY[mode]} · retraining from the start</div><button type="button" class="btn sm" data-c="runEnd">${ic('play')} Train to the end</button>`;
    } else if (ref && ref.tested) score = `<div class="nmCap">the server's run: direction ${pct(ref.rate)} · size miss ${ref.mae.toFixed(1)} · ${ref.fingerprint}</div>`;

    dyn.innerHTML = `
      <div class="nmGrp"><div class="nmKick">${ic('target')} Presets <em>${why ? esc(why) : 'where each lands · pinned on the curve'}</em></div><div class="nmPresets">${rows}</div></div>
      <div class="nmGrp"><div class="nmKick">${ic('shuffle')} ${esc(INPUTS[j])} in training <em>retrains as a variant</em></div>
        <div class="seg nmSeg">${MODES.map(([m, l]) => `<button type="button" data-m="${m}" class="${mode === m ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${score ? `<div class="nmRetr">${score}</div>` : ''}</div>`;
  }

  /** P(up) along input j on the call shown, the other inputs as they are now; the real call, the what-if, a pin per preset. */
  function curveSVG(cur, j, presets, H) {
    const sn = cur.fit.snap, on = !!S.mask[j], sd = sn.sd[j], mu = sn.mu[j], real = cur.row.x[j], now = cur.x[j];
    const xr = Array.from(cur.x); xr[j] = real;
    const pReal = pUp(sn, xr), pins = cur.c ? presets.filter(p => 'v' in p) : [];
    let a = Math.min(mu - 6 * sd, real - 1.5 * sd, now - 1.5 * sd), b = Math.max(mu + 6 * sd, real + 1.5 * sd, now + 1.5 * sd);
    for (const p of pins) if (Math.abs(p.v - mu) <= 12 * sd) { a = Math.min(a, p.v - 0.8 * sd); b = Math.max(b, p.v + 0.8 * sd); }
    const Wd = Math.max(320, Math.round(S.cw || 760)), L = 42, R = 12, TP = 14, B = 26;
    const xs = v => L + (v - a) / (b - a) * (Wd - L - R), ys = p => TP + (1 - p) * (H - TP - B);
    const xx = Array.from(cur.x), line = [];
    for (let k = 0; k <= 360; k++) { const v = a + (b - a) * k / 360; xx[j] = v; line.push(`${xs(v).toFixed(1)},${ys(on ? pUp(sn, xx) : pReal).toFixed(1)}`); }
    const s0 = Math.pow(10, Math.floor(Math.log10((b - a) / 5))), st = [1, 2, 5, 10].map(m => m * s0).find(s => (b - a) / s <= 7);
    const ticks = []; for (let v = Math.ceil(a / st) * st; v <= b + 1e-9; v += st) ticks.push(v);
    const zone = cur.row.y ? [0.5, 1] : [0, 0.5];
    const txt = (x, y, s, anchor, cls = '') => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="nmAx ${cls}">${s}</text>`;
    const boxes = [], hit = q => boxes.some(o => q.x < o.x + o.w && o.x < q.x + q.w && q.y < o.y + o.h && o.y < q.y + q.h);
    const placed = pins.map(p => ({ p, x: xs(p.v), y: ys(p.p), lab: p.key === 'flip' ? 'flip' : `${Math.round(p.target * 100)}%` }))
      .sort((u, v) => (S.preset && u.p.key === S.preset.key ? -1 : S.preset && v.p.key === S.preset.key ? 1 : 0))
      .map(q => {
        const w = q.lab.length * 6.4 + 4, right = { x: q.x + 9, y: q.y - 7, w, h: 13 }, left = { x: q.x - 9 - w, y: q.y - 7, w, h: 13 };
        boxes.push({ x: q.x - 6, y: q.y - 6, w: 12, h: 12 });
        const side = !hit(right) && right.x + w < Wd - R ? right : !hit(left) && left.x > L ? left : null;
        if (side) boxes.push(side);
        return { ...q, side };
      });
    const onKey = S.preset && S.preset.j === j && cur.c && S.preset.call === cur.c.i && S.edits[j] === S.preset.v ? S.preset.key : null;
    const pinSvg = placed.map(({ p, x, y, lab, side }) => `<g class="nmPin ${onKey === p.key ? 'on' : ''}" data-pin="${p.key}"><title>${presetName(p)}: ${esc(INPUTS[j])} ${f4(p.v)} → P(up) ${pc1(p.p)}</title><circle cx="${x}" cy="${y}" r="11" fill="transparent"/><path d="M${x} ${y - 5.5} L${x + 5.5} ${y} L${x} ${y + 5.5} L${x - 5.5} ${y} Z"/>${side ? `<text x="${side.x + 2}" y="${side.y + 10}">${lab}</text>` : ''}</g>`).join('');
    const edited = j in S.edits;
    const html = `<svg class="nmCurve" viewBox="0 0 ${Wd} ${H}" style="height:${H}px" data-svg role="img" aria-label="P(up) for every value of ${esc(INPUTS[j])}">
      <rect x="${L}" y="${ys(zone[1])}" width="${Wd - L - R}" height="${ys(zone[0]) - ys(zone[1])}" class="nmZone"/>
      ${[0, 0.25, 0.5, 0.75, 1].map(p => `<line x1="${L}" x2="${Wd - R}" y1="${ys(p)}" y2="${ys(p)}" class="${p === 0.5 ? 'nmFlip' : 'nmGrid'}"/>${txt(L - 7, ys(p) + 3.5, `${p * 100}%`, 'end', p === 0.5 ? 'mid' : '')}`).join('')}
      ${ticks.map(v => `<line x1="${xs(v)}" x2="${xs(v)}" y1="${H - B}" y2="${H - B + 4}" class="nmTick"/>${txt(xs(v), H - B + 16, String(+v.toFixed(4)).replace('-', '−'), 'middle')}`).join('')}
      <polyline points="${line.join(' ')}" class="nmLine ${on ? '' : 'off'}"/>
      <line x1="${xs(real)}" x2="${xs(real)}" y1="${TP}" y2="${H - B}" class="nmRealLine"/>
      ${pinSvg}
      <circle cx="${xs(real)}" cy="${ys(pReal)}" r="5" class="nmReal"/>
      ${edited ? `<line x1="${xs(now)}" x2="${xs(now)}" y1="${TP}" y2="${H - B}" class="nmWiLine"/><circle cx="${xs(now)}" cy="${ys(cur.ex.p)}" r="6" class="nmWi"/>` : ''}
      <g data-hover style="display:none;pointer-events:none"><line y1="${TP}" y2="${H - B}" class="nmHovLine"/><circle r="4.5" class="nmHovDot"/></g>
    </svg><div class="nmTip" hidden></div>`;
    return { html, geo: { a, b, W: Wd, H, L, R, xs, ys, on } };
  }
  function wireCurve(cur, j, geo) {
    const svg = $('mBody').querySelector('[data-svg]'); if (!svg) return;
    const cw = svg.clientWidth; if (cw && Math.abs(cw - geo.W) > 2) { S.cw = cw; renderModalBody(); return; }
    const tip = svg.parentElement.querySelector('.nmTip'), hov = svg.querySelector('[data-hover]'), sn = cur.fit.snap, can = !!cur.c && geo.on;
    const valAt = e => { const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * geo.W; return Math.max(geo.a, Math.min(geo.b, geo.a + (px - geo.L) / (geo.W - geo.L - geo.R) * (geo.b - geo.a))); };
    const setAt = e => { const c = current(); if (!c) return; S.edits[j] = valAt(e); S.preset = null; paint(); };
    svg.onpointerdown = e => { const pin = e.target.closest('.nmPin'); if (pin) { applyPreset(pin.dataset.pin); return; } if (!can) return; S.drag = true; setAt(e); };
    svg.onpointermove = e => {
      if (S.drag && e.buttons && can) { setAt(e); return; }
      const pin = e.target.closest('.nmPin'); lite(pin && pin.dataset.pin);
      if (pin) { hov.style.display = 'none'; tip.hidden = true; return; }
      const v = valAt(e), xx = Array.from(cur.x); xx[j] = v;
      const p = geo.on ? pUp(sn, xx) : cur.real.p, x = geo.xs(v), y = geo.ys(p), right = (p > 0.5 ? 1 : 0) === cur.row.y;
      hov.style.display = ''; const ln = hov.querySelector('line'), dt = hov.querySelector('circle');
      ln.setAttribute('x1', x); ln.setAttribute('x2', x); dt.setAttribute('cx', x); dt.setAttribute('cy', y);
      tip.hidden = false; tip.style.left = `${x / geo.W * svg.clientWidth}px`; tip.style.top = `${y / geo.H * svg.clientHeight}px`;
      tip.innerHTML = `${esc(INPUTS[j])} <b>${f4(v)}</b> · P(up) <b>${pc1(p)}</b> · calls <b>${callOf(p)}</b> <span class="${right ? 'okT' : 'badT'}">${right ? '✓' : '✗'}</span><br><span class="nmFaint">${can ? 'click or drag to try it' : !geo.on ? 'left out: no value moves it' : 'presets and edits work on calls'}</span>`;
    };
    svg.onpointerleave = () => { hov.style.display = 'none'; tip.hidden = true; lite(null); };
  }
  // a drag that leaves the curve keeps going until the button is let go
  dlg.addEventListener('pointermove', e => { if (!S.drag || !e.buttons) return; const svg = $('mBody').querySelector('[data-svg]'); if (svg && !svg.contains(e.target)) svg.onpointermove(e); });

  function renderModalBody() {
    const t = S.modal, cur = current(), body = $('mBody');
    const presets = t.kind === 'in' ? presetsFor(cur && cur.c ? cur : null, t.j) : [];
    if (t.kind === 'in') renderTune(cur, presets);
    const meta = [];
    if (cur) {
      const { c, row, fit, fitAt } = cur;
      meta.push(c ? `<span>Call <b>${cur.at + 1}</b> of ${Math.max(0, S.rows.length - WARM)}</span><span><b>${when(row.at)}</b></span><span>market <b>${sgn(row.move)}</b></span>` : `<span>the last of the first ${WARM} (training) forecasts</span>`);
      meta.push(`<span>weights from fit <b>${fitAt + 1}</b> · forecasts 1–${fit.upTo}</span>`);
      if (cur.edited) meta.push('<span class="amberT">what-if on</span>');
    } else meta.push('<span>no call yet</span>');
    if (variant()) meta.push('<span class="amberT">variant</span>');
    $('mSub').innerHTML = meta.join('');
    if (!cur) {
      body.innerHTML = `<div class="nmEmpty">${ic('calc')}<b>Nothing to audit yet</b><span>The math${t.kind === 'in' ? ', the curve and the presets work' : ' works'} on a call. Train until the network has made its first one${variant() ? ' with this set of inputs' : ''}.</span><button type="button" class="btn pri" data-c="firstCall">${ic('play')} Train to the first call</button></div>`;
      body.querySelector('[data-c="firstCall"]').addEventListener('click', () => { while (!S.done && !S.calls.length) step(); paint(); if (S.modal) { renderModalBody(); } });
      return;
    }
    const { c, row, ex, real: rx, fit, prev } = cur, sn = fit.snap;
    const cmp = (a, b, fmt = f4) => (a === b || !cur.edited ? fmt(a) : `${fmt(b)} → <b class="amberT">${fmt(a)}</b>`);
    const table = (head, rows) => `<div class="table"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    const outs = `<h3>Outputs on this call</h3><div class="netEq">P(up) = ${cmp(ex.p, rx.p, v => pct(v))} · size = ${cmp(ex.size, rx.size, sgn)} points${c ? ` · it said <b>${ex.p > 0.5 ? 'up' : 'down'}</b>, the market went <b>${row.y ? 'up' : 'down'}</b>` : ''}</div>`;
    let html = '';

    if (t.kind === 'in') {
      const j = t.j, i = ex.inputs[j], sens = ex.sens[j], right = p => (p > 0.5 ? 1 : 0) === row.y;
      const mk = (cls, p) => `<i class="mk ${cls}" style="left:${(100 * p).toFixed(2)}%"></i>`;
      html += `<div class="nmAnswer">
        <div><div class="nmKick">P(up)</div><div class="nmBig">${cur.edited ? `<s>${pc1(rx.p)}</s><span class="amberT">${pc1(ex.p)}</span>` : pc1(ex.p)}</div><div class="nmBar"><i class="mid"></i>${mk('real', rx.p)}${cur.edited ? mk('wi', ex.p) : ''}</div><div class="nmScale"><span>0% · calls down</span><span>50%</span><span>calls up · 100%</span></div></div>
        <div><div class="nmKick">Call</div><div class="nmBig">${cur.edited && callOf(ex.p) !== callOf(rx.p) ? `<s>${callOf(rx.p)}</s>` : ''}<span class="${cur.edited ? 'amberT' : ''}">${callOf(ex.p)}</span> <span class="${right(ex.p) ? 'okT' : 'badT'}">${ic(right(ex.p) ? 'check' : 'cross')}</span></div><div class="nmCap">${c ? `market went ${row.y ? 'up' : 'down'} · ${right(ex.p) ? 'right way' : 'wrong way'}` : 'a training forecast, not a call'}</div></div>
        <div><div class="nmKick">Size</div><div class="nmBig">${cur.edited ? `<s>${pts(rx.size)}</s><span class="amberT">${pts(ex.size)}</span>` : pts(ex.size)}</div><div class="nmCap">points · moved ${pts(row.move)}</div></div></div>`;
      const C = curveSVG(cur, j, presets, 250);
      html += `<div class="nmBlockHead"><span class="nmKick">P(up) for every value of ${esc(INPUTS[j])}</span><span class="nmLegend"><span><i class="lg real"></i>real call</span><span><i class="lg wi"></i>what-if</span><span><i class="lg pin"></i>preset</span><span><i class="lg flip"></i>flips at 50%</span><span><i class="lg zone"></i>right way</span></span></div>
        <div class="nmChart">${C.html}</div>`;
      const most = ex.hidden.map(hd => [Math.abs(hd.terms[j].wz), hd.k]).sort((p, q) => q[0] - p[0])[0][1];
      const tot = ex.hidden.map(hd => hd.terms.reduce((s, q) => s + Math.abs(q.wz), Math.abs(hd.bias)));
      const shares = ex.hidden.map(hd => (tot[hd.k] ? Math.abs(hd.terms[j].wz) / tot[hd.k] : 0)), third = [...shares].sort((p, q) => q - p)[2];
      const steps = [
        ['Scale the input', i.on ? `z = ${f4(i.z)}` : 'left out', `<div class="netEq">${i.on
          ? `z = (raw − mean) ÷ spread = (${f4(i.raw)} − ${pf(i.mu)}) ÷ ${f4(i.sd)} = <b>${f4(i.z)}</b>`
          : `left out of training: z = <b>0</b> whatever the raw value (${f4(i.raw)})`}<small>mean and spread of ${esc(INPUTS[j])} over the ${fit.upTo} forecasts this fit trained on</small></div>`],
        ['Into the hidden neurons', `most in h${most + 1}`, table(['Neuron', 'Weight w', 'w · z', 'Share of its sum', 'Neuron sum', 'a = σ(sum)'],
          ex.hidden.map(hd => { const q = hd.terms[j], sh = shares[hd.k]; return `<tr class="${sh >= third && sh > 0 ? 'nmTop' : ''}"><td>h${hd.k + 1}</td><td class="${q.w >= 0 ? 'posT' : 'negT'}">${sf(q.w)}</td><td class="${q.wz >= 0 ? 'posT' : 'negT'}">${sf(q.wz)}</td><td><span class="nmShare"><i style="width:${(100 * sh).toFixed(0)}%"></i></span>${pct(sh)}</td><td>${cmp(hd.sum, rx.hidden[hd.k].sum, sf)}</td><td>${cmp(hd.a, rx.hidden[hd.k].a)}</td></tr>`; }))
          + `<p class="nmCap">each neuron adds w · z to its bias and the other inputs' terms, then squashes the sum to 0–1 · shaded: the three where ${esc(INPUTS[j])} weighs most</p>`],
        ['On to the outputs', `${pc1(ex.p)} · ${pts(ex.size)}`, `<div class="netEq">P(up) = σ(${sf(ex.outputs[0].bias)} + Σ w · a) = σ(${f4(ex.outputs[0].sum)}) = <b>${cmp(ex.p, rx.p, pc1)}</b> → calls <b>${callOf(ex.p)}</b><br>size = (${sf(ex.outputs[1].bias)} + Σ w · a) × move spread = ${f4(ex.outputs[1].sum)} × ${f4(sn.msd)} = <b>${cmp(ex.size, rx.size, sgn)}</b> points${ex.loss ? `<small>market went ${row.y ? 'up' : 'down'} (${sgn(row.move)}) · cross-entropy ${f4(ex.loss.ce)} · ½e² ${f4(ex.loss.sq)} · training minimises their average plus ${NET.decay}·½Σw²</small>` : ''}</div>`
          + table(['Neuron', 'a', 'w → P(up)', 'w · a', 'w → size', 'w · a'], ex.outputs[0].terms.map((q, k) => { const s = ex.outputs[1].terms[k]; return `<tr><td>h${k + 1}</td><td>${f4(q.a)}</td><td>${sf(q.w)}</td><td class="${q.wa >= 0 ? 'posT' : 'negT'}">${sf(q.wa)}</td><td>${sf(s.w)}</td><td class="${s.wa >= 0 ? 'posT' : 'negT'}">${sf(s.wa)}</td></tr>`; }))],
        ['Slopes', `${sf(sens.dp)} / unit`, table(['Neuron', 'σ′ = a(1 − a)', 'w in', 'Out-weight to P(up)', 'Out-weight to size', 'Via it to P(up) logit', 'Via it to size'],
          ex.hidden.map(hd => { const d1 = hd.a * (1 - hd.a), g = d1 * sn.W1[hd.k * sn.d + j] * sn.mask[j] / sn.sd[j]; return `<tr><td>h${hd.k + 1}</td><td>${f4(d1)}</td><td>${sf(sn.W1[hd.k * sn.d + j])}</td><td>${sf(sn.W2[hd.k])}</td><td>${sf(sn.W2[sn.h + hd.k])}</td><td>${sf(sn.W2[hd.k] * g)}</td><td>${sf(sn.W2[sn.h + hd.k] * g * sn.msd)}</td></tr>`; }))
          + `<div class="netEq">∂P(up)/∂${esc(INPUTS[j])} = p(1 − p) × Σ = ${f4(ex.p * (1 - ex.p))} × (sum of the column) = <b>${sf(sens.dp)}</b> per unit<br>∂size/∂${esc(INPUTS[j])} = Σ × move spread ${f4(sn.msd)} = <b>${sf(sens.dsize)}</b> points per unit<small>the slope right here: a small change in ${esc(INPUTS[j])} moves P(up) and the size by about this much per unit (the sigmoids bend, so large edits move them less or more)</small></div>`],
      ];
      html += `<div class="nmBlockHead"><span class="nmKick">The math on this call</span></div>` + steps.map(([title, key, inner], k) => `
        <div class="nmStep ${S.open === k + 1 ? 'open' : ''}"><button type="button" data-o="${k + 1}" aria-expanded="${S.open === k + 1}"><span class="n">${k + 1}</span><span class="t">${title}</span><span class="k">${key}</span>${ic('chev')}</button>${S.open === k + 1 ? `<div class="nmStepBody">${inner}</div>` : ''}</div>`).join('');
      const keep = body.scrollTop;
      body.innerHTML = html;
      body.scrollTop = keep;
      body.querySelectorAll('[data-o]').forEach(b => b.addEventListener('click', () => { S.open = S.open === +b.dataset.o ? 0 : +b.dataset.o; renderModalBody(); }));
      wireCurve(cur, j, C.geo);
      return;
    } else if (t.kind === 'hid') {
      const hd = ex.hidden[t.k];
      html += `<h3>1 · Its sum <span>each input's scaled value z times its weight, plus the bias</span></h3>` + table(['Input', 'Raw', 'z', 'Weight w', 'w · z'],
        hd.terms.map(q => `<tr class="${q.j in S.edits ? 'editedRow' : ''}"><td>${esc(INPUTS[q.j])}${S.mask[q.j] ? '' : ' <i>off</i>'}</td><td>${f4(ex.inputs[q.j].raw)}</td><td>${f4(q.z)}</td><td>${sf(q.w)}</td><td class="${q.wz >= 0 ? 'posT' : 'negT'}">${sf(q.wz)}</td></tr>`)
          .concat(`<tr class="base"><td>bias</td><td></td><td></td><td></td><td>${sf(hd.bias)}</td></tr>`));
      html += `<div class="netEq">sum = ${sf(hd.bias)} ${hd.terms.map(q => sf(q.wz)).join(' ')} = <b>${f4(hd.sum)}</b><br>a = σ(sum) = 1 ÷ (1 + e<sup>−sum</sup>) = 1 ÷ (1 + e<sup>${f4(-hd.sum)}</sup>) = <b>${cmp(hd.a, rx.hidden[t.k].a)}</b></div>`;
      html += `<h3>2 · Where it goes</h3>` + table(['Output', 'Out-weight', 'a × weight', 'Share of that output’s |terms|'],
        ex.outputs.map((o, oi) => { const q = o.terms[t.k], tot = o.terms.reduce((s, x) => s + Math.abs(x.wa), 0); return `<tr><td>${OUT[oi]}</td><td>${sf(q.w)}</td><td class="${q.wa >= 0 ? 'posT' : 'negT'}">${sf(q.wa)}</td><td>${pct(tot ? Math.abs(q.wa) / tot : 0)}</td></tr>`; }));
      html += outs;
    } else if (t.kind === 'out') {
      const o = ex.outputs[t.o];
      html += `<h3>1 · Its sum <span>each hidden neuron's activation a times its out-weight, plus the bias</span></h3>` + table(['Neuron', 'a', 'Weight w', 'a × w'],
        o.terms.map(q => `<tr><td>h${q.k + 1}</td><td>${f4(q.a)}</td><td>${sf(q.w)}</td><td class="${q.wa >= 0 ? 'posT' : 'negT'}">${sf(q.wa)}</td></tr>`)
          .concat(`<tr class="base"><td>bias</td><td></td><td></td><td>${sf(o.bias)}</td></tr>`));
      html += `<div class="netEq">sum = ${sf(o.bias)} ${o.terms.map(q => sf(q.wa)).join(' ')} = <b>${f4(o.sum)}</b><br>${t.o === 0
        ? `P(up) = σ(sum) = 1 ÷ (1 + e<sup>${f4(-o.sum)}</sup>) = <b>${cmp(ex.p, rx.p, v => pct(v))}</b> (${f4(ex.p)}) → calls <b>${ex.p > 0.5 ? 'up' : 'down'}</b>`
        : `size = sum × move spread = ${f4(o.sum)} × ${f4(ex.msd)} = <b>${cmp(ex.size, rx.size, sgn)}</b> points<small>the move spread is the root mean square of the 3-hour moves in the ${fit.upTo} training forecasts: the network learns the size in those units</small>`}</div>`;
      if (ex.loss) {
        const L = ex.loss;
        html += `<h3>2 · What training counts as wrong <span>${c ? 'this call was not trained on: this is the loss it would add' : 'this forecast was in training'}</span></h3><div class="netEq">${t.o === 0
          ? `market went ${L.y ? 'up (y = 1)' : 'down (y = 0)'} · cross-entropy = −ln(${L.y ? 'p' : '1 − p'}) = −ln(${f4(L.y ? ex.p : 1 - ex.p)}) = <b>${f4(L.ce)}</b>`
          : `target = move ÷ spread = ${sgn(L.move)} ÷ ${f4(ex.msd)} = ${f4(L.t)} · error e = sum − target = ${f4(o.sum)} − ${pf(L.t)} = ${f4(L.e1)} · ½e² = <b>${f4(L.sq)}</b>`}<small>training minimises the average of cross-entropy + ½e² over the forecasts it has seen (plus a small weight decay, ${NET.decay}·½Σw²)</small></div>`;
      }
    } else {
      const now = t.layer === 1 ? sn.W1[t.k * sn.d + t.j] : sn.W2[t.o * sn.h + t.k];
      const before = prev ? (t.layer === 1 ? prev.snap.W1[t.k * sn.d + t.j] : prev.snap.W2[t.o * sn.h + t.k]) : null;
      html += `<h3>1 · The weight</h3><div class="netEq">w = <b>${sf(now)}</b>${before == null ? ' · first fit: it started from a seeded random draw' : ` · after the fit before (${prev.upTo} forecasts) it was ${sf(before)} · this fit moved it by <b>${sf(now - before)}</b>`}</div>`;
      if (t.layer === 1) {
        const i = ex.inputs[t.j], hd = ex.hidden[t.k];
        html += `<h3>2 · On this call</h3><div class="netEq">z(${esc(INPUTS[t.j])}) = ${f4(i.z)}${i.on ? '' : ' (left out)'} · w · z = <b>${sf(now * i.z)}</b> of h${t.k + 1}'s sum ${f4(hd.sum)} → a = ${f4(hd.a)}</div>`;
      } else {
        const hd = ex.hidden[t.k], o = ex.outputs[t.o];
        html += `<h3>2 · On this call</h3><div class="netEq">a(h${t.k + 1}) = ${f4(hd.a)} · a × w = <b>${sf(now * hd.a)}</b> of ${OUT[t.o]}'s sum ${f4(o.sum)}</div>`;
      }
      html += outs;
    }
    body.innerHTML = html;
  }

  // ------------------------------------------------------------ controls
  $('play').addEventListener('click', () => { if (S.done) return; S.playing = !S.playing; paint(); if (S.playing) S.raf = setTimeout(frame, 16); });
  $('step').addEventListener('click', () => { pause(); step(); paint(); });
  $('end').addEventListener('click', () => { pause(); $('end').textContent = 'Training…'; setTimeout(() => { finish(); $('end').textContent = 'To the end'; paint(); }, 20); });
  $('reset').addEventListener('click', reset);
  $('speed').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (!b) return; S.speed = +b.dataset.s; for (const x of $('speed').children) x.classList.toggle('on', x === b); });
  $('scrub').addEventListener('input', e => { const v = +e.target.value; S.pick = v >= S.calls.length - 1 ? null : v; S.edits = {}; S.preset = null; paint(); });
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'clearEdits') { S.edits = {}; S.preset = null; paint(); }
    if (a.dataset.a === 'restore') { S.mask = INPUTS.map(() => 1); S.tweak = {}; reset(); }
  });
  window.addEventListener('resize', () => drawLoss());

  return {
    set(grade) {
      if (grade === S.grade) return;
      close();
      S.grade = grade; S.base = grade && !grade.stale ? grade.netRows || [] : []; S.mask = INPUTS.map(() => 1); S.tweak = {};
      reset();
    },
    stop() { pause(); if (S.grade) paint(); },
  };
}
