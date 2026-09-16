// The Edge check's neural network panel (16 Sep): the network in lab/labNet.js trained live in the page on a grade's
// rows, one walk-forward step at a time, drawn as the XOR demo draws its network. The server ran the same code on the
// same rows when the grade was built; at the end the page's fingerprint is checked against the server's.
//
// Every node and edge opens an audit: the call shown, worked through with the exact weights it was made with (a copy is
// kept after each fit). Two ways to tune, kept apart:
//   what-if   edit an input's raw value on the call shown; only that call's answer is recomputed, training is untouched
//   variant   leave inputs out of training; the walk restarts, and the run is marked as not comparable to the server's
// Edits are forgotten when the call, the grade or the training changes. Opening an audit pauses training.
import { netWalk, netScore, explain, snapshot, withMask, INPUTS, WARM, NET } from '/lab/labNet.js';
import { esc, when, pct, sgn, int } from '/lab/util.js';

const NS = 'http://www.w3.org/2000/svg', POS = '#a78bfa', NEG = '#5ce1ff';
const W = 760, H = 460, XI = 118, XH = 390, XO = 650;
const yAt = (k, n) => 40 + (k + 0.5) * (H - 70) / n;
const OUT = ['P(up)', 'size'];
const f4 = v => (!Number.isFinite(v) ? '—' : (Math.abs(v) >= 1000 ? v.toFixed(1) : v.toFixed(4)).replace('-', '−'));
const sf = v => (!Number.isFinite(v) ? '—' : (v < 0 ? '−' : '+') + f4(Math.abs(v)));
const pf = v => (v < 0 ? `(−${f4(-v)})` : f4(v));   // a value after a minus sign

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
      <div class="netModalHead"><div><small data-n="mKind"></small><h2 id="netModalTitle" data-n="mTitle"></h2><span data-n="mSub"></span></div><button type="button" class="btn sm" data-n="mClose" aria-label="Close">Close</button></div>
      <div class="netModalCtl" data-n="mCtl"></div>
      <div class="netModalBody" data-n="mBody"></div>
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
    mask: INPUTS.map(() => 1), edits: {}, editsFor: null, modal: null };
  const variant = () => S.mask.some(m => !m);

  function reset() {
    clearTimeout(S.raf);
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
    const off = INPUTS.filter((_, j) => !S.mask[j]);
    $('match').innerHTML = variant()
      ? `<i class="dot amber"></i>variant: ${esc(off.join(', '))} left out of training · not comparable to the server's run <button type="button" class="btn sm" data-a="restore">Use all inputs</button>`
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
  const dlg = $('modal');
  const nodeName = t => t.kind === 'in' ? INPUTS[t.j] : t.kind === 'hid' ? `h${t.k + 1}` : OUT[t.o];
  function open(target) {
    pause();
    S.modal = target;
    $('mKind').textContent = { in: 'Input', hid: 'Hidden neuron', out: 'Output', edge: 'Weight' }[target.kind];
    $('mTitle').textContent = target.kind === 'edge'
      ? (target.layer === 1 ? `${INPUTS[target.j]} → h${target.k + 1}` : `h${target.k + 1} → ${OUT[target.o]}`) : nodeName(target);
    renderModalCtl();
    renderModalBody();
    paint();
    if (!dlg.open) dlg.showModal();
  }
  function close() { S.modal = null; if (dlg.open) dlg.close(); }
  dlg.addEventListener('close', () => { S.modal = null; });
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });   // the backdrop
  $('mClose').addEventListener('click', close);

  /** The controls: built once per open, so typing into them keeps focus while the body below redraws. */
  function renderModalCtl() {
    const t = S.modal, ctl = $('mCtl');
    if (t.kind !== 'in') { ctl.innerHTML = ''; ctl.hidden = true; return; }
    ctl.hidden = false;
    const cur = current(), j = t.j;
    ctl.innerHTML = `
      <div class="netTune">
        <label><span>What-if value <i>this call only · training untouched</i></span>
          <input type="number" step="any" data-c="val" value="${cur ? cur.x[j] : ''}" ${cur && cur.c ? '' : 'disabled'}></label>
        <button type="button" class="btn sm" data-c="resetVal">Reset to real</button>
        <span class="hint" data-c="real"></span>
      </div>
      <div class="netTune">
        <label class="chk"><input type="checkbox" data-c="use" ${S.mask[j] ? 'checked' : ''}> Use ${esc(INPUTS[j])} in training <i>unchecking retrains from the start as a variant</i></label>
      </div>`;
    const val = ctl.querySelector('[data-c="val"]');
    val.addEventListener('input', () => {
      const v = Number(val.value), c = current();
      if (!c || val.value.trim() === '' || !Number.isFinite(v)) return;
      if (v === c.row.x[j]) delete S.edits[j]; else S.edits[j] = v;
      paint();
    });
    ctl.querySelector('[data-c="resetVal"]').addEventListener('click', () => { delete S.edits[j]; const c = current(); if (c) val.value = c.row.x[j]; paint(); });
    ctl.querySelector('[data-c="use"]').addEventListener('change', e => { S.mask[j] = e.target.checked ? 1 : 0; reset(); renderModalCtl(); renderModalBody(); });
  }

  function renderModalBody() {
    const t = S.modal, cur = current(), body = $('mBody');
    const real = $('mCtl').querySelector('[data-c="real"]');
    if (!cur) { $('mSub').textContent = ''; body.innerHTML = `<p class="note">Not trained yet${variant() ? ' with this set of inputs' : ''}: press Train or Step, then the math for the call shown appears here.</p>`; if (real) real.textContent = ''; return; }
    const { c, row, ex, real: rx, fit, fitAt, prev } = cur, sn = fit.snap;
    $('mSub').innerHTML = `${c ? `call ${cur.at + 1} · ${when(row.at)} · market moved ${sgn(row.move)}` : `the last of the first ${WARM} (training) forecasts`} · weights from fit ${fitAt + 1}, trained on forecasts 1–${fit.upTo}${cur.edited ? ' · <b class="amberT">with what-if edits</b>' : ''}`;
    if (real && t.kind === 'in') real.textContent = `real value ${f4(row.x[t.j])}`;
    const cmp = (a, b, fmt = f4) => (a === b || !cur.edited ? fmt(a) : `${fmt(b)} → <b class="amberT">${fmt(a)}</b>`);
    const table = (head, rows) => `<div class="table"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    const outs = `<h3>Outputs on this call</h3><div class="netEq">P(up) = ${cmp(ex.p, rx.p, v => pct(v))} · size = ${cmp(ex.size, rx.size, sgn)} points${c ? ` · it said <b>${ex.p > 0.5 ? 'up' : 'down'}</b>, the market went <b>${row.y ? 'up' : 'down'}</b>` : ''}</div>`;
    let html = '';

    if (t.kind === 'in') {
      const j = t.j, i = ex.inputs[j], sens = ex.sens[j];
      html += `<h3>1 · Scaling</h3><div class="netEq">${i.on
        ? `z = (raw − mean) ÷ spread = (${f4(i.raw)} − ${pf(i.mu)}) ÷ ${f4(i.sd)} = <b>${f4(i.z)}</b>`
        : `left out of training: z = <b>0</b> whatever the raw value (${f4(i.raw)})`}<small>mean and spread of ${esc(INPUTS[j])} over the ${fit.upTo} forecasts this fit trained on</small></div>`;
      const tot = ex.hidden.map(hd => hd.terms.reduce((s, q) => s + Math.abs(q.wz), 0));
      html += `<h3>2 · Into each hidden neuron <span>its term w·z joins the neuron's sum, and the sum goes through the sigmoid</span></h3>` + table(['Neuron', 'Weight w', 'w · z', 'Share of |terms|', 'Neuron sum', 'σ(sum)'],
        ex.hidden.map(hd => { const q = hd.terms[j]; return `<tr><td>h${hd.k + 1}</td><td>${sf(q.w)}</td><td class="${q.wz >= 0 ? 'posT' : 'negT'}">${sf(q.wz)}</td><td>${pct(tot[hd.k] ? Math.abs(q.wz) / tot[hd.k] : 0)}</td><td>${cmp(hd.sum, rx.hidden[hd.k].sum, sf)}</td><td>${cmp(hd.a, rx.hidden[hd.k].a)}</td></tr>`; }));
      html += `<h3>3 · On to the outputs <span>through each neuron: out-weight × σ′ × w ÷ spread, for one raw unit of ${esc(INPUTS[j])}</span></h3>` + table(['Neuron', 'σ′ = a(1 − a)', 'w in', 'Out-weight to P(up)', 'Out-weight to size', 'Via this neuron to P(up) logit', 'Via this neuron to size'],
        ex.hidden.map(hd => { const d1 = hd.a * (1 - hd.a), g = d1 * sn.W1[hd.k * sn.d + j] * sn.mask[j] / sn.sd[j]; return `<tr><td>h${hd.k + 1}</td><td>${f4(d1)}</td><td>${sf(sn.W1[hd.k * sn.d + j])}</td><td>${sf(sn.W2[hd.k])}</td><td>${sf(sn.W2[sn.h + hd.k])}</td><td>${sf(sn.W2[hd.k] * g)}</td><td>${sf(sn.W2[sn.h + hd.k] * g * sn.msd)}</td></tr>`; }));
      html += `<div class="netEq">∂P(up)/∂${esc(INPUTS[j])} = p(1 − p) × Σ = ${f4(ex.p * (1 - ex.p))} × (sum of the column) = <b>${sf(sens.dp)}</b> per unit<br>∂size/∂${esc(INPUTS[j])} = Σ × move spread ${f4(sn.msd)} = <b>${sf(sens.dsize)}</b> points per unit<small>the slope right here: a small change in ${esc(INPUTS[j])} moves P(up) and the size by about this much per unit (the sigmoids bend, so large edits move them less or more)</small></div>`;
      html += outs;
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
  $('scrub').addEventListener('input', e => { const v = +e.target.value; S.pick = v >= S.calls.length - 1 ? null : v; S.edits = {}; paint(); });
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'clearEdits') { S.edits = {}; paint(); }
    if (a.dataset.a === 'restore') { S.mask = INPUTS.map(() => 1); reset(); }
  });
  window.addEventListener('resize', () => drawLoss());

  return {
    set(grade) {
      if (grade === S.grade) return;
      close();
      S.grade = grade; S.rows = grade && !grade.stale ? grade.netRows || [] : []; S.mask = INPUTS.map(() => 1);
      reset();
    },
    stop() { pause(); if (S.grade) paint(); },
  };
}
