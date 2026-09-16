// The Spirograph Lab's day player (16 Sep): one built session (lab/labDay.js) played back a minute at a time. The
// nested Daily set circles on the left, the clock, prices and the six circles in the rail, the controls, and the market
// against the pen over the whole day underneath. From the Monday 14 Sep replay page (15 Sep), made a component.
//
// The drawing is the day clock itself: each circle is half the one it rides on, its arm at speed × minutes since 6 pm.
// The fitted sizes (± pts) and which way each circle moves first (▲ ▼) are the numbers beside it.
import { COLORS, TFS } from '../engine/constants.js';
import { fmtPeriod, fmtTF } from '../engine/format.js';
import { barsForPeriod } from '../engine/structure.js';
import { dayScore } from './labDay.js';
import { esc } from './util.js';

const TAU = Math.PI * 2;
const BG = '#0b0e14', INK = '#f4f7fb', MUTED = '#93a0b3', GRID = '#1b212c';
const lift = (hex, t) => { const v = parseInt(hex.slice(1), 16), m = c => Math.round(c + (255 - c) * t); return `rgb(${m(v >> 16)},${m((v >> 8) & 255)},${m(v & 255)})`; };
const MARKUP = `<div class="lpStage">
  <div class="lpSheet"><canvas data-r="sheet" aria-label="The Daily set's circles at the time shown"></canvas></div>
  <aside class="lpRail" data-r="rail"><div class="lpRailIn" data-r="railIn">
    <div class="lpClock"><b data-r="clk">6:00 pm</b><span data-r="clkDay"></span></div>
    <div><div class="lpDay"><i data-r="dayBar"></i></div><div class="lpLbl" data-r="dayTxt" style="margin-top:6px"></div></div>
    <div class="lpNote" data-r="note"></div>
    <div class="lpKv" data-r="px"></div>
    <h5>The six circles</h5>
    <div class="lpLbl" style="margin-top:-6px">lap so far · turn of the day · ▲ rises first after each restart, ▼ falls first</div>
    <div class="lpRows" data-r="rows"></div>
    <h5>How the day went</h5>
    <div class="lpKv" data-r="score"></div>
    <p class="lpWhy" data-r="why"></p>
  </div></aside>
</div>
<div class="lpControls">
  <button class="lpPlay" data-r="play" type="button" aria-label="Play">▶</button>
  <input class="lpScrub" data-r="scrub" type="range" min="0" max="1440" step="1" value="0" aria-label="Time of day">
  <span class="lpGrp"><span class="lpLbl">24 hours in</span><span class="seg" data-r="speed"><button type="button" data-v="30">30 s</button><button type="button" data-v="60">1 min</button><button type="button" data-v="180">3 min</button><button type="button" data-v="600">10 min</button></span></span>
  <span class="lpGrp"><span class="lpLbl">Fit</span><span class="seg" data-r="mode"><button type="button" data-v="refit" title="What the Spirograph would have shown live: refitted as each minute closed">refit each minute</button><button type="button" data-v="held" title="The 6 pm circles, kept all day: a forward test">held from 6 pm</button></span></span>
  <span class="lpGrp"><span class="lpLbl">View</span><span class="seg" data-r="view"><button type="button" data-v="whole">whole figure</button><button type="button" data-v="fast" title="Follow the 24m circle and the two inside it">fast circles</button></span></span>
  <label class="chk"><input type="checkbox" data-r="trail" checked> pen trail</label>
</div>
<div class="lpStrip"><canvas data-r="strip" aria-label="Market and pen over the day"></canvas><div class="lpLegend" data-r="legend"></div><div class="lpTip" data-r="tip"></div></div>`;

export function createLabPlayer(el) {
  el.innerHTML = MARKUP;
  const $ = k => el.querySelector(`[data-r="${k}"]`);
  const st = { s: 0, playing: false, speed: 60, mode: 'refit', view: 'whole', trail: true, last: 0, hover: null, dirty: true, shown: false, raf: 0 };
  let D = null, F = null, N = 1440, L = 6, W = [], RAD = [], COL = [], TXT = [], PEN = '#fff', LABELS = [], SCORE = null, yLo = 0, yHi = 1;

  const etTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const etDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', weekday: 'short', day: 'numeric', month: 'short' });
  const msAt = s => D.open + s * 60000;
  const clock = s => etTime.format(msAt(s)).replace(' AM', ' am').replace(' PM', ' pm');
  const px2 = v => v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sgn = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
  const fmtI = v => Math.round(v).toLocaleString('en-US');
  const niceStep = x => { const p = 10 ** Math.floor(Math.log10(x)), f = x / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; };
  const mono = () => getComputedStyle(document.body).getPropertyValue('--mono');

  // ---------------------------------------------------------------- the data at any moment (s = minutes since 6 pm)
  const lerp = (arr, s) => { const k = Math.max(0, Math.min(N - 1, Math.floor(s))), f = Math.max(0, Math.min(1, s - k)); return arr[k] + (arr[k + 1] - arr[k]) * f; };
  const aAt = s => { if (st.mode === 'held') return D.held.A; const k = Math.max(0, Math.min(N - 1, Math.floor(s))), f = s - k, a = F.A[k], b = F.A[k + 1]; return a.map((v, n) => v + (b[n] - v) * f); };
  const penAt = s => lerp(st.mode === 'held' ? D.held.pen : F.pen, s);
  const mktAt = s => { let k = Math.min(N, Math.floor(s)); while (k >= 0 && F.mkt[k] == null) k--; return k >= 0 ? F.mkt[k] : null; };
  function chain(s) {
    const out = []; let x = 0, y = 0;
    for (let n = 0; n < L; n++) { const th = W[n] * s, cx = x, cy = y; x += RAD[n] * Math.cos(th); y += RAD[n] * Math.sin(th); out.push({ cx, cy, x, y, r: RAD[n] }); }
    return out;
  }
  function fit(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, w, h };
  }
  const halo = (ctx, t, x, y) => { ctx.lineWidth = 3; ctx.strokeStyle = BG; ctx.lineJoin = 'round'; ctx.strokeText(t, x, y); ctx.fillText(t, x, y); };

  // ---------------------------------------------------------------- the sheet
  function drawSheet() {
    const cv = $('sheet'), { ctx, w, h } = fit(cv); ctx.clearRect(0, 0, w, h);
    if (!w || !h) return;
    const s = st.s, A = aAt(s), ch = chain(s), pen = ch[L - 1];
    const fast = st.view === 'fast', R = RAD.slice(fast ? 3 : 0).reduce((a, b) => a + b, 0);
    const ox = fast ? ch[3].cx : 0, oy = fast ? ch[3].cy : 0, p = Math.min(w, h) / 2 / (R * 1.1);
    const X = v => w / 2 + (v - ox) * p, Y = v => h / 2 - (v - oy) * p;
    const step = niceStep(70 / p), xs = (0 - w / 2) / p + ox, xe = (w / 2) / p + ox, ys = oy - (h / 2) / p, ye = oy + (h / 2) / p;
    ctx.beginPath();
    for (let v = Math.ceil(xs / step) * step; v <= xe; v += step) { const x = Math.round(X(v)) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let v = Math.ceil(ys / step) * step; v <= ye; v += step) { const y = Math.round(Y(v)) + .5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); const ax = Math.round(X(0)) + .5, ay = Math.round(Y(0)) + .5;
    if (ax > 0 && ax < w) { ctx.moveTo(ax, 0); ctx.lineTo(ax, h); } if (ay > 0 && ay < h) { ctx.moveTo(0, ay); ctx.lineTo(w, ay); }
    ctx.strokeStyle = 'rgba(147,160,179,.4)'; ctx.stroke();
    ctx.font = '500 11.5px ' + mono();
    // the pen's trail: its rosette over the last two hours (one turn of the 2H), fading in toward now
    if (st.trail && s > 0.5) {
      const from = Math.max(0, s - 120);
      let prev = null;
      for (let j = 0; j <= 480; j++) {
        const t = from + (s - from) * j / 480, q = chain(t)[L - 1], pt = [X(q.x), Y(q.y)];
        if (prev) { const u = j / 480; ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(pt[0], pt[1]); ctx.strokeStyle = PEN; ctx.globalAlpha = .05 + .75 * u ** 2; ctx.lineWidth = 1 + u; ctx.stroke(); }
        prev = pt;
      }
      ctx.globalAlpha = 1;
    }
    for (let n = 0; n < L; n++) {
      const c = ch[n], cx = X(c.cx), cy = Y(c.cy), r = c.r * p, dim = fast && n < 3 ? .25 : 1;
      ctx.globalAlpha = dim;
      if (r >= .6) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.strokeStyle = COL[n]; ctx.lineWidth = 1.4; ctx.stroke(); }
      if (r >= 3) { const sx = cx + r; ctx.beginPath(); ctx.moveTo(sx - 5, cy); ctx.lineTo(sx + 5, cy); ctx.lineWidth = 2; ctx.strokeStyle = COL[n]; ctx.stroke(); }   // where the arm points at 6 pm
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(X(c.x), Y(c.y)); ctx.strokeStyle = COL[n]; ctx.globalAlpha = .7 * dim; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.globalAlpha = dim; ctx.beginPath(); ctx.arc(X(c.x), Y(c.y), 2, 0, TAU); ctx.fillStyle = COL[n]; ctx.fill();
      // only circles with room get a name: the small ones ride at the big ones' tops, where names collide; the rail names all six
      if (r >= 60) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = TXT[n]; halo(ctx, `${LABELS[n][0]} ${A[n] < 0 ? '▲' : '▼'} ±${Math.abs(A[n]).toFixed(1)}`, cx, cy - r - 6); }
    }
    ctx.globalAlpha = 1;
    const px = X(pen.x), py = Y(pen.y), m = mktAt(s);
    if (m != null) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = INK; ctx.font = '650 13px ' + mono();
      halo(ctx, `market ${sgn(m - penAt(s))} vs pen`, 14, 14);
    }
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, TAU); ctx.fillStyle = INK; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 6.5, 0, TAU); ctx.strokeStyle = PEN; ctx.lineWidth = 1.6; ctx.stroke();
  }

  // ---------------------------------------------------------------- the day strip: market and pen, one axis
  const SL = 62, SR = 16, ST = 34, SB = 26;
  function drawStrip() {
    const cv = $('strip'), { ctx, w, h } = fit(cv); ctx.clearRect(0, 0, w, h);
    if (!w || !h) return;
    const X = s => SL + (w - SL - SR) * s / N, Y = v => ST + (h - ST - SB) * (1 - (v - yLo) / (yHi - yLo));
    ctx.fillStyle = 'rgba(240,238,230,.035)'; ctx.fillRect(X(1380), ST, X(N) - X(1380), h - ST - SB);   // the 5–6 pm break
    ctx.font = '500 11.5px ' + mono(); ctx.fillStyle = MUTED;
    const step = niceStep((yHi - yLo) / 4);
    ctx.beginPath(); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(yLo / step) * step; v <= yHi; v += step) { const y = Math.round(Y(v)) + .5; ctx.moveTo(SL, y); ctx.lineTo(w - SR, y); ctx.fillText(v.toLocaleString('en-US'), SL - 8, y); }
    ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let s = 0; s <= N; s += 180) { const x = X(s); ctx.fillText(clock(s), Math.max(SL + 16, Math.min(w - SR - 16, x)), h - SB + 7); ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, h - SB); ctx.lineTo(Math.round(x) + .5, h - SB + 4); ctx.strokeStyle = MUTED; ctx.stroke(); }
    ctx.textAlign = 'right'; ctx.fillText('break', X(N) - 4, ST + 4);
    const line = (arr, col, width, until, after) => {
      for (const [a, b, al] of [[0, until, 1], [until, N, after]]) {
        if (b <= a) continue; ctx.beginPath(); let on = false;
        for (let k = Math.floor(a); k <= Math.min(N, Math.ceil(b)); k++) { const v = arr[k]; if (v == null) { on = false; continue; } const x = X(k), y = Y(v); if (on) ctx.lineTo(x, y); else ctx.moveTo(x, y); on = true; }
        ctx.strokeStyle = col; ctx.globalAlpha = al; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.stroke(); ctx.globalAlpha = 1;
      }
    };
    const penArr = st.mode === 'held' ? D.held.pen : F.pen;
    // the no-skill yardstick: the first print held all day
    if (SCORE.first != null) { const y = Math.round(Y(SCORE.first)) + .5; ctx.beginPath(); ctx.setLineDash([4, 4]); ctx.moveTo(SL, y); ctx.lineTo(w - SR, y); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
    line(F.mkt, INK, 1.5, st.s, .28);
    line(penArr, PEN, 2, st.s, .3);
    const x = X(st.s); ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, ST - 6); ctx.lineTo(Math.round(x) + .5, h - SB); ctx.strokeStyle = 'rgba(167,139,250,.8)'; ctx.lineWidth = 1; ctx.stroke();
    const m = mktAt(st.s), pv = penAt(st.s);
    for (const [v, col] of [[pv, PEN], [m, INK]]) if (v != null) { ctx.beginPath(); ctx.arc(x, Y(v), 4, 0, TAU); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = BG; ctx.stroke(); }
    const hv = st.hover, tip = $('tip');
    if (hv != null) {
      const hx = X(hv), k = Math.round(hv), mv = mktAt(k), pvv = penArr[k];
      ctx.beginPath(); ctx.moveTo(Math.round(hx) + .5, ST); ctx.lineTo(Math.round(hx) + .5, h - SB); ctx.strokeStyle = 'rgba(240,238,230,.35)'; ctx.stroke();
      tip.innerHTML = `<b>${clock(k)}</b> ET<br>market <b>${px2(mv)}</b><br>pen <b>${px2(pvv)}</b>${mv != null ? `<br>gap <b>${sgn(mv - pvv)}</b>` : ''}`;
      tip.style.display = 'block';
      const tw = tip.offsetWidth; tip.style.left = Math.min(w - tw - 8, hx + 12) + 'px'; tip.style.top = (ST + 6) + 'px';
    } else tip.style.display = 'none';
  }
  const strip = $('strip');
  const sOfEvent = e => { const b = strip.getBoundingClientRect(), x = e.clientX - b.left; return Math.max(0, Math.min(N, (x - SL) / (b.width - SL - SR) * N)); };
  let dragging = false;
  strip.addEventListener('pointermove', e => { if (!D) return; st.hover = sOfEvent(e); if (dragging) seek(st.hover); st.dirty = true; });
  strip.addEventListener('pointerleave', () => { st.hover = null; st.dirty = true; });
  strip.addEventListener('pointerdown', e => { if (!D) return; dragging = true; strip.setPointerCapture(e.pointerId); seek(sOfEvent(e)); });
  strip.addEventListener('pointerup', () => { dragging = false; });

  // ---------------------------------------------------------------- the rail
  let szEl = [], lapEl = [], turnEl = [];
  function buildRows() {
    const rows = $('rows');
    rows.innerHTML = LABELS.map((l, n) => `<div class="lpRow" title="The ${l[0]} circle, ≈ ${l[1]} bars a turn"><i class="lpDot" style="background:${COL[n]}"></i><span class="lpNm">${l[0]}</span><span class="lpLap"><i data-lap="${n}" style="background:${COL[n]}"></i></span><span class="lpTn" data-turn="${n}"></span><span class="lpSz" data-sz="${n}"></span></div>`).join('');
    const q = sel => [...rows.querySelectorAll(sel)];
    szEl = q('[data-sz]'); lapEl = q('[data-lap]'); turnEl = q('[data-turn]');
  }
  function drawRail() {
    const s = st.s, A = aAt(s), m = mktAt(s), pv = penAt(s), ms = msAt(s);
    $('clk').textContent = clock(s);
    $('clkDay').textContent = `${etDay.format(ms)} · New York time`;
    $('dayBar').style.width = `${(100 * s / N).toFixed(2)}%`;
    $('dayTxt').textContent = `day ${Math.min(99, Math.floor(100 * s / N))}% since 6 pm`;
    $('note').textContent = s >= 1380 ? 'break · the circles keep turning · reopens 6 pm' : s < 1 ? 'the open: every arm at its start' : m == null ? 'no trade this minute' : '';
    const gap = m == null ? null : m - pv;
    $('px').innerHTML = `<span>Market</span><b>${px2(m)}</b><span>Pen (${st.mode === 'held' ? 'held from 6 pm' : 'refit'})</span><b>${px2(pv)}</b><span>Market − pen</span><b class="${gap == null ? '' : gap >= 0 ? 'up' : 'dn'}">${gap == null ? '—' : sgn(gap)}</b>`;
    for (let n = 0; n < L; n++) {
      const P = D.periods[n], frac = (s % P) / P, turns = Math.round(N / P);
      szEl[n].textContent = `${A[n] < 0 ? '▲' : '▼'} ±${Math.abs(A[n]).toFixed(1)}`;
      lapEl[n].style.width = `${(frac * 100).toFixed(1)}%`;
      turnEl[n].textContent = `${Math.min(turns, Math.floor(s / P) + 1)}/${turns}`;
    }
    const k = Math.round(s), e = F.expl[k], r = F.rms[k];
    $('score').innerHTML = `<span>Held pen's miss</span><b>±${SCORE.held.toFixed(1)}</b><span>Flat at the close before 6 pm</span><b>±${SCORE.flatPrev.toFixed(1)}</b>`
      + `<span>Flat at the first print</span><b>±${SCORE.flatFirst.toFixed(1)}</b><span>Refit pen's miss</span><b>±${SCORE.refit.toFixed(1)}</b>`
      + `<span>Held-out explains now</span><b>${e == null ? '—' : Math.round(e * 100) + '%'}</b><span>Held-out resid now</span><b>${r == null ? '—' : '±' + r.toFixed(1)}</b>`;
  }

  // ---------------------------------------------------------------- controls and the clock
  function seek(s) { st.s = Math.max(0, Math.min(N, s)); $('scrub').value = Math.round(st.s); st.dirty = true; }
  function setPlaying(on) { st.playing = on && !!D; if (st.playing && st.s >= N) st.s = 0; $('play').textContent = st.playing ? '❚❚' : '▶'; $('play').setAttribute('aria-label', st.playing ? 'Pause' : 'Play'); st.last = 0; }
  $('play').addEventListener('click', () => setPlaying(!st.playing));
  $('scrub').addEventListener('input', e => seek(+e.target.value));
  const seg = (k, key, parse = v => v) => {
    const node = $(k), paint = () => { for (const b of node.children) b.classList.toggle('on', parse(b.dataset.v) === st[key]); };
    node.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st[key] = parse(b.dataset.v); paint(); st.dirty = true; });
    paint();
  };
  seg('speed', 'speed', Number); seg('mode', 'mode'); seg('view', 'view');
  $('trail').addEventListener('change', e => { st.trail = e.target.checked; st.dirty = true; });
  el.addEventListener('keydown', e => {
    if (!D || (e.target.tagName === 'SELECT')) return;
    if (e.target.tagName === 'INPUT' && e.target.type === 'range' && e.key !== ' ') return;
    if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); setPlaying(!st.playing); }
    else if (e.key === 'ArrowRight' && e.target.tagName !== 'BUTTON') { e.preventDefault(); seek(st.s + (e.shiftKey ? 15 : 1)); }
    else if (e.key === 'ArrowLeft' && e.target.tagName !== 'BUTTON') { e.preventDefault(); seek(st.s - (e.shiftKey ? 15 : 1)); }
  });
  new ResizeObserver(() => { st.dirty = true; queueFit(); }).observe(el);

  function loop(ts) {
    st.raf = 0;
    if (!st.shown || !D) return;
    if (st.playing) {
      const dt = st.last ? Math.min(.1, (ts - st.last) / 1000) : 0; st.last = ts;
      st.s = Math.min(N, st.s + dt * N / st.speed); $('scrub').value = Math.round(st.s);
      if (st.s >= N) setPlaying(false);
      st.dirty = true;
    }
    if (st.dirty) { st.dirty = false; drawSheet(); drawStrip(); drawRail(); }
    st.raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!st.raf && st.shown && D) st.raf = requestAnimationFrame(loop); };

  // Fit the rail to its box so nothing needs a scroll: shrink the note first, then scale the whole rail.
  let fitQueued = false;
  function fitRail() {
    fitQueued = false;
    const rail = $('rail'), inn = $('railIn'), why = $('why');
    if (!rail.clientHeight || getComputedStyle(rail).overflow === 'visible') { inn.style.transform = ''; inn.style.width = ''; return; }
    inn.style.transform = ''; inn.style.width = ''; why.style.fontSize = '';
    for (let s = 11; s >= 9.5; s -= 0.5) { why.style.fontSize = s + 'px'; if (rail.scrollHeight <= rail.clientHeight) return; }
    const cs = getComputedStyle(rail), avail = rail.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    let k = 1;
    for (let i = 0; i < 4; i++) { inn.style.width = (100 / k) + '%'; k = Math.max(0.5, Math.min(1, Math.floor(avail / inn.offsetHeight * 200) / 200)); }
    inn.style.width = (100 / k) + '%';
    while (k > 0.5 && inn.offsetHeight * k > avail) { k -= 0.005; inn.style.width = (100 / k) + '%'; }
    inn.style.transform = `scale(${k})`;
  }
  function queueFit() { if (!fitQueued) { fitQueued = true; requestAnimationFrame(fitRail); } }

  return {
    /** Show `day` (labDay.js replayDay's), from its open. */
    set(day) {
      D = day; F = day.frames; N = F.pen.length - 1; L = day.periods.length;
      W = day.periods.map(p => -TAU / p); RAD = day.periods.map((_, n) => 0.5 ** n);
      COL = COLORS.slice(0, L); TXT = COL.map(c => lift(c, .25)); PEN = lift(COL[L - 1], .25);
      LABELS = day.periods.map(P => [fmtPeriod(P), fmtTF(barsForPeriod(P, TFS))]);
      SCORE = dayScore(day);
      yLo = Infinity; yHi = -Infinity;
      for (const arr of [F.mkt, F.pen, day.held.pen]) for (const v of arr) if (v != null) { yLo = Math.min(yLo, v); yHi = Math.max(yHi, v); }
      const pad = (yHi - yLo) * .08 || 1; yLo -= pad; yHi += pad;
      $('scrub').max = N;
      buildRows();
      $('legend').innerHTML = `<span><i style="background:${INK}"></i>market (${esc(day.name)} closes)</span><span><i style="background:${PEN}"></i>pen</span><span><i class="dash"></i>first print, held all day</span>`;
      const p = day.pre, gapW = SCORE.first == null ? 0 : SCORE.first - p.close;
      $('why').innerHTML = `At 6 pm the held pen stood at <b>${fmtI(day.held.pen[0])}</b>: the last close before the open, ${fmtI(p.close)}, plus the fit's trend over the break (<b>${p.trend >= 0 ? '+' : '−'}${fmtI(Math.abs(p.trend))}</b>, which counts traded minutes only), plus where the circles stood. `
        + (SCORE.first == null ? '' : `The market's first print was <b>${fmtI(SCORE.first)}</b>, ${fmtI(Math.abs(gapW))} ${gapW < 0 ? 'below' : 'above'} that close: a gap no fit before the open could know. `)
        + 'The refit pen has seen every close up to each minute, so its miss is not a forecast.';
      setPlaying(false); seek(0); st.dirty = true; queueFit(); kick();
    },
    clear() { D = null; setPlaying(false); },
    show() { st.shown = true; st.dirty = true; queueFit(); kick(); },
    hide() { st.shown = false; setPlaying(false); },
    get state() { return st; },
  };
}
