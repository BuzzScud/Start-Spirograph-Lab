// The Spirograph Lab's day player (16 Sep): one built session (lab/labDay.js) played back a minute at a time. The
// nested Daily set circles and the rail on top; under them one card with the controls, an overview of the whole day
// and a close-up chart of the hours around the playhead (design C of the player previews, 16 Sep).
//
// The pen is only ever HELD: from 6 pm, or from one other quarter-hour the viewer picks. Before its hold it has
// nothing to say, and the dashed line (the price at the hold, kept flat) is the yardstick it has to beat.
//
// The drawing is the day clock itself: each circle is half the one it rides on, its arm at speed × minutes since 6 pm,
// turning clockwise from 12 o'clock. Every period divides the day, so at 6 pm, start and end, every arm points straight up.
//
// THE FORECAST CARD (16 Sep, "build a forecast card, like the unrolled card next to the spirograph"): a third column
// beside the rail with the turns the circles call from the playhead on, each with its circle, kind, the level it
// points at (a peak at PDH, a trough at PDL), its kill zone and an EARNED confidence: that circle's hit rate in that
// zone on the graded record before this session (labTurns.js earnedRate). As the day plays, each call is graded the
// moment its window closes. The close-up draws PDH, PDL, the kill zones and the calls; the calls come from the newest
// turns result covering the session (server: dayturns), so a day with no grade over it has an empty card.
import { COLORS, TFS } from '../engine/constants.js';
import { fmtPeriod, fmtTF } from '../engine/format.js';
import { barsForPeriod } from '../engine/structure.js';
import { penAt, holdScore, normHold } from './labDay.js';
import { esc } from './util.js';

const TAU = Math.PI * 2, TOP = Math.PI / 2;   // 12 o'clock
const BG = '#0b0e14', INK = '#f4f7fb', MUTED = '#93a0b3', GRID = '#1b212c', PEN = '#4ea04e';
const SPEED = { slow: 180, fast: 30 };        // seconds a whole day takes
const ZOOMS = [120, 240, 480];
const SESSIONS = [{ n: 'Asia', a: 0, b: 540, c: '57 135 229' }, { n: 'London', a: 540, b: 930, c: '25 158 112' }, { n: 'New York', a: 930, b: 1380, c: '201 133 0' }];
const PRESETS = [[0, 'Globex open'], [540, 'London open'], [930, 'New York open'], [1320, 'New York close']];   // the hold menu's fixed times
const ZONE_C = '245 181 68';                   // the kill zones' colour (amber), apart from the sessions' three
const CAST_LIST = 9, CAST_DONE = 4;            // calls ahead, and graded calls behind, the Forecast card lists
const MINPS = [[6, 'All'], [24, '24m +'], [120, '2H +']];
const lift = (hex, t) => { const v = parseInt(hex.slice(1), 16), m = c => Math.round(c + (255 - c) * t); return `rgb(${m(v >> 16)},${m((v >> 8) & 255)},${m(v & 255)})`; };
const store = {
  get(k, d) { try { const v = localStorage.getItem('lab.player.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lab.player.' + k, JSON.stringify(v)); } catch { /* private window */ } },
};
// Lucide (ISC): turtle and rabbit
const ICON = {
  slow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 10 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a8 8 0 1 0-16 0v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3l2-4h4Z"/><path d="M4.82 7.9 8 10"/><path d="M15.18 7.9 12 10"/><path d="M16.93 10H20a2 2 0 0 1 0 4H2"/></svg>',
  fast: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 16a3 3 0 0 1 2.24 5"/><path d="M18 12h.01"/><path d="M18 21h-8a4 4 0 0 1-4-4 7 7 0 0 1 7-7h.2L9.6 6.4a1 1 0 1 1 2.8-2.8L15.8 7h.2c3.3 0 6 2.7 6 6v1a2 2 0 0 1-2 2h-1a3 3 0 0 0-3 3"/><path d="M20 8.54V4a2 2 0 1 0-4 0v3"/><path d="M7.612 12.524a3 3 0 1 0-1.6 4.3"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l14 8-14 8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
};

const MARKUP = `<div class="lpStage">
  <div class="lpSheet"><canvas data-r="sheet" aria-label="The Daily set's circles at the time shown"></canvas></div>
  <aside class="lpRail" data-r="rail"><div class="lpRailIn" data-r="railIn">
    <div class="lpClock"><b data-r="clk">6:00 pm</b><span data-r="clkDay"></span></div>
    <div><div class="lpDay"><i data-r="dayBar"></i></div><div class="lpLbl" data-r="dayTxt" style="margin-top:6px"></div></div>
    <div class="lpNote" data-r="note"></div>
    <div class="lpKv" data-r="px"></div>
    <h5>The six circles</h5>
    <div class="lpLbl" style="margin-top:-6px">lap so far · turn of the day · ▲ rises first after each restart, ▼ falls first · sizes as fitted at the hold</div>
    <div class="lpRows" data-r="rows"></div>
    <h5>How the held pen did</h5>
    <div class="lpKv" data-r="score"></div>
    <p class="lpWhy" data-r="why"></p>
  </div></aside>
  <aside class="lpCast" data-r="cast" aria-label="Forecast: the turns ahead">
    <div class="lpCastHead"><h5>Forecast · turns ahead</h5><span class="seg lpFam" data-k="fam"><button type="button" data-v="both">Both</button><button type="button" data-v="daily" title="The Daily set: phases locked to 6 pm">Daily</button><button type="button" data-v="kalman" title="The Kalman rungs: phases free">Kalman</button></span></div>
    <div class="lpCastLv" data-r="castLv"></div>
    <div class="lpCastBar"><span class="lpCap">Circles</span><span class="seg" data-k="minP">${MINPS.map(([v, w]) => `<button type="button" data-v="${v}">${w}</button>`).join('')}</span><span class="lpCastRec" data-r="castRec"></span></div>
    <div class="lpCastList" data-r="castList"></div>
    <div class="lpCastFoot" data-r="castFoot"></div>
  </aside>
</div>
<div class="lpDeck">
  <div class="lpBar">
    <button class="lpPlay" data-a="play" type="button" aria-label="Play"></button>
    <div class="lpNow"><b data-r="now">6:00 pm</b><span data-r="nowSub"></span></div>
    <div class="lpHold">
      <button type="button" class="lpHoldBtn" data-a="menu" aria-haspopup="menu" aria-expanded="false" title="The time the pen is fitted from"><span class="lpCapPen">Pen from</span><b data-r="holdTxt"></b><small data-r="holdName"></small>${ICON.down}</button>
      <div class="lpMenu" data-r="menu" role="menu" hidden>
        <div class="lpMenuHead">Hold the pen from</div>
        <div data-r="menuItems"></div>
        <label class="lpMenuTime"><span>Other time</span><input type="time" step="900" data-r="timeIn"></label>
        <p>The circles are fitted once at that time, on bars before it only, then kept to 6 pm. Quarter-hours up to 4:45 pm.</p>
      </div>
    </div>
    <div class="lpGrp"><span class="lpCap">Speed</span><span class="seg lpIcons" data-k="speed"><button type="button" data-v="slow" title="Slow: a day in 3 minutes" aria-label="Slow">${ICON.slow}</button><button type="button" data-v="fast" title="Fast: a day in 30 seconds" aria-label="Fast">${ICON.fast}</button></span></div>
    <div class="lpEnd">
      <div class="lpGrp"><span class="lpCap">Close-up</span><span class="seg" data-k="zoom">${ZOOMS.map(z => `<button type="button" data-v="${z}">${z / 60} h</button>`).join('')}</span></div>
      <div class="lpGrp"><span class="lpCap">Camera</span><span class="seg" data-k="view"><button type="button" data-v="whole">Whole</button><button type="button" data-v="fast" title="Follow the 24m circle and the two inside it">Fast circles</button></span></div>
      <button type="button" class="lpSwitch" data-k="trail" role="switch" aria-checked="true"><i></i>Trail</button>
    </div>
  </div>
  <div class="lpMini" data-r="mini" role="slider" tabindex="0" aria-label="Time of day" aria-valuemin="0" aria-valuemax="1440"><canvas></canvas><div class="lpWin" data-r="win"></div></div>
  <div class="lpChart" data-r="chart"><canvas></canvas><div class="lpLegend" data-r="legend"></div><div class="lpTip" data-r="tip"></div></div>
  <div class="lpFoot"><div class="lpRead" data-r="read"></div><div class="lpHint" data-r="hint"></div></div>
</div>`;

export function createLabPlayer(el) {
  el.innerHTML = MARKUP;
  const $ = k => el.querySelector(`[data-r="${k}"]`);
  const st = {
    s: 0, playing: false, speed: store.get('speed', 'slow'), zoom: store.get('zoom', 240), view: 'whole', trail: true,
    hold: normHold(store.get('hold', 0)), custom: store.get('custom', null), hover: null, last: 0, dirty: true, shown: false, raf: 0,
    fam: store.get('fam', 'both'), minP: store.get('minP', 24),
  };
  if (!['both', 'daily', 'kalman'].includes(st.fam)) st.fam = 'both';
  if (!MINPS.some(m => m[0] === st.minP)) st.minP = 24;
  if (!SPEED[st.speed]) st.speed = 'slow';
  if (!ZOOMS.includes(st.zoom)) st.zoom = 240;
  let D = null, N = 1440, L = 6, W = [], RAD = [], COL = [], TXT = [], LABELS = [], SCORE = null, scoreKey = '';
  let F = null, FMSG = '', FCALLS = [], castKey = '';   // the forecast: the session's calls (server dayturns), filtered

  const etTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const etDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', weekday: 'short', day: 'numeric', month: 'short' });
  const et24 = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const msAt = s => D.open + s * 60000;
  const clock = s => etTime.format((D ? D.open : 0) + s * 60000).replace(' AM', ' am').replace(' PM', ' pm');
  const px2 = v => v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sgn = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
  const fmtI = v => Math.round(v).toLocaleString('en-US');
  const niceStep = x => { const p = 10 ** Math.floor(Math.log10(x)), f = x / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; };
  const mono = () => getComputedStyle(document.body).getPropertyValue('--mono');
  const sessOf = s => (SESSIONS.find(c => s >= c.a && s < c.b) || { n: 'Break' }).n;
  const zoneOf = s => (F && F.zones || []).find(z => s >= z.a && s < z.b) || null;
  // a call's minute of the day, when its window closes (its grade can be shown), and whether the filters keep it
  const callMin = c => (c.at - D.open) / 60000;
  const callDone = c => callMin(c) + Math.max(Math.max(1, c.P / 8), Math.max(2, Math.round(c.P / 8)));
  const keepCall = c => (st.fam === 'both' || c.fam === st.fam) && c.P >= st.minP && c.state !== 'shut' && c.state !== 'late';
  const filterCalls = () => { FCALLS = F ? F.calls.filter(keepCall) : []; };
  const presetName = h => (PRESETS.find(p => p[0] === h) || [])[1] || '';
  const isPreset = h => PRESETS.some(p => p[0] === h);

  // ---------------------------------------------------------------- the day at any moment (s = minutes since 6 pm)
  const hold = () => (D && D.holds[st.hold] ? st.hold : 0);
  const H = () => D.holds[hold()];
  const pen = s => penAt(D, hold(), s);
  const mktAt = s => { let k = Math.min(N, Math.floor(s)); while (k >= 0 && D.mkt[k] == null) k--; return k >= 0 ? D.mkt[k] : null; };
  function chain(s) {
    const out = []; let x = 0, y = 0;
    for (let n = 0; n < L; n++) { const th = TOP + W[n] * s, cx = x, cy = y; x += RAD[n] * Math.cos(th); y += RAD[n] * Math.sin(th); out.push({ cx, cy, x, y, r: RAD[n] }); }
    return out;
  }
  function fit(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); return { ctx, w, h };
  }
  const halo = (ctx, t, x, y) => { ctx.lineWidth = 3; ctx.strokeStyle = BG; ctx.lineJoin = 'round'; ctx.strokeText(t, x, y); ctx.fillText(t, x, y); };

  // ---------------------------------------------------------------- the sheet
  function drawSheet() {
    const { ctx, w, h } = fit($('sheet'));
    if (!w || !h) return;
    const s = st.s, A = H().A, ch = chain(s), tip = ch[L - 1];
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
    const PENC = lift(COL[L - 1], .25);
    // the pen's trail: its rosette over the last two hours (one turn of the 2H), fading in toward now
    if (st.trail && s > 0.5) {
      const from = Math.max(0, s - 120);
      let prev = null;
      for (let j = 0; j <= 480; j++) {
        const t = from + (s - from) * j / 480, q = chain(t)[L - 1], pt = [X(q.x), Y(q.y)];
        if (prev) { const u = j / 480; ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(pt[0], pt[1]); ctx.strokeStyle = PENC; ctx.globalAlpha = .05 + .75 * u ** 2; ctx.lineWidth = 1 + u; ctx.stroke(); }
        prev = pt;
      }
      ctx.globalAlpha = 1;
    }
    for (let n = 0; n < L; n++) {
      const c = ch[n], cx = X(c.cx), cy = Y(c.cy), r = c.r * p, dim = fast && n < 3 ? .25 : 1;
      ctx.globalAlpha = dim;
      if (r >= .6) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.strokeStyle = COL[n]; ctx.lineWidth = 1.4; ctx.stroke(); }
      if (r >= 3) { const sy = cy - r; ctx.beginPath(); ctx.moveTo(cx, sy - 5); ctx.lineTo(cx, sy + 5); ctx.lineWidth = 2; ctx.strokeStyle = COL[n]; ctx.stroke(); }   // 12 o'clock: where the arm points at 6 pm
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(X(c.x), Y(c.y)); ctx.strokeStyle = COL[n]; ctx.globalAlpha = .7 * dim; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.globalAlpha = dim; ctx.beginPath(); ctx.arc(X(c.x), Y(c.y), 2, 0, TAU); ctx.fillStyle = COL[n]; ctx.fill();
      // only circles with room get a name, outside the rim at 10:30, clear of the stack that stands at 12 o'clock at 6 pm
      if (r >= 60 && A[n] !== 0) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = TXT[n]; halo(ctx, `${LABELS[n][0]} ${A[n] < 0 ? '▲' : '▼'} ±${Math.abs(A[n]).toFixed(1)}`, cx - r * Math.SQRT1_2 - 2, cy - r * Math.SQRT1_2 - 2); }
    }
    ctx.globalAlpha = 1;
    const m = mktAt(s), pv = pen(s);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = INK; ctx.font = '650 13px ' + mono();
    if (m != null && pv != null) halo(ctx, `market ${sgn(m - pv)} vs pen`, 14, 14);
    else if (pv == null) { ctx.fillStyle = MUTED; halo(ctx, `the pen holds from ${clock(hold())}`, 14, 14); }
    const px = X(tip.x), py = Y(tip.y);
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, TAU); ctx.fillStyle = INK; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 6.5, 0, TAU); ctx.strokeStyle = PENC; ctx.lineWidth = 1.6; ctx.stroke();
  }

  // ---------------------------------------------------------------- the overview: the whole day, the hold, the close-up's window
  const ML = 62, MR = 16;
  const range = () => { const half = st.zoom / 2; let a = st.s - half, b = st.s + half; if (a < 0) { b -= a; a = 0; } if (b > N) { a -= b - N; b = N; } return [Math.max(0, a), Math.min(N, b)]; };
  let mktLo = 0, mktHi = 1;
  function drawMini() {
    const { ctx, w, h } = fit($('mini').querySelector('canvas'));
    if (!w) return;
    const X = k => ML + (w - ML - MR) * k / N, Y = v => 5 + (h - 10) * (1 - (v - mktLo) / (mktHi - mktLo));
    for (const c of SESSIONS) { ctx.fillStyle = `rgb(${c.c} / 13%)`; ctx.fillRect(X(c.a), 0, X(c.b) - X(c.a), h); }
    ctx.fillStyle = 'rgba(240,238,230,.05)'; ctx.fillRect(X(1380), 0, X(N) - X(1380), h);
    for (const z of (F && F.zones) || []) { ctx.fillStyle = `rgb(${ZONE_C} / 60%)`; ctx.fillRect(X(z.a), 0, X(z.b) - X(z.a), 3); }
    ctx.font = '700 9.5px ' + mono(); ctx.textBaseline = 'bottom'; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,.38)';
    for (const c of SESSIONS) ctx.fillText(c.n.toUpperCase(), X(c.a) + 6, h - 4);
    ctx.beginPath(); let on = false;
    D.mkt.forEach((v, k) => { if (v == null) { on = false; return; } if (on) ctx.lineTo(X(k), Y(v)); else ctx.moveTo(X(k), Y(v)); on = true; });
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = MUTED; ctx.font = '500 10.5px ' + mono(); ctx.fillText('day', ML - 10, h / 2);
    // the hold: a pen-green flag
    const hx = Math.round(X(hold()));
    ctx.fillStyle = PEN; ctx.fillRect(hx - 1, 0, 2, h);
    ctx.beginPath(); ctx.moveTo(hx + 1, 0); ctx.lineTo(hx + 9, 4); ctx.lineTo(hx + 1, 8); ctx.fill();
    ctx.fillStyle = 'rgba(167,139,250,.95)'; ctx.fillRect(Math.round(X(st.s)) - 1, 0, 2, h);
    const [a, b] = range(), win = $('win'); win.style.left = `${X(a)}px`; win.style.width = `${Math.max(2, X(b) - X(a))}px`;
  }

  // ---------------------------------------------------------------- the close-up: market and pen around the playhead
  const P = { l: 62, r: 16, t: 34, b: 26 };
  let CX = null;
  function drawChart() {
    const { ctx, w, h } = fit($('chart').querySelector('canvas'));
    if (!w || !h) return;
    const [x0, x1] = range(), hh = hold(), hd = H();
    let lo = Infinity, hi = -Infinity;
    for (let k = Math.floor(x0); k <= Math.ceil(x1); k++) { const m = D.mkt[k]; if (m != null) { lo = Math.min(lo, m); hi = Math.max(hi, m); } const p = pen(k); if (p != null) { lo = Math.min(lo, p); hi = Math.max(hi, p); } }
    if (hh <= x1) { lo = Math.min(lo, hd.close); hi = Math.max(hi, hd.close); }
    if (!Number.isFinite(lo)) { lo = mktLo; hi = mktHi; }
    const lv = F && F.level, lo0 = lo, hi0 = hi, span0 = Math.max(hi - lo, 5);
    if (lv) for (const v of [lv.high, lv.low]) if (v > lo0 - 0.35 * span0 && v < hi0 + 0.35 * span0) { lo = Math.min(lo, v); hi = Math.max(hi, v); }   // a level near the view is kept in it; a far one gets an edge label
    const pad = (hi - lo) * 0.08 || 5; lo -= pad; hi += pad;
    const X = k => P.l + (w - P.l - P.r) * (k - x0) / (x1 - x0), Y = v => P.t + (h - P.t - P.b) * (1 - (v - lo) / (hi - lo));
    CX = { x0, x1, w };
    ctx.save(); ctx.beginPath(); ctx.rect(P.l, 0, w - P.l - P.r, h); ctx.clip();
    for (const c of SESSIONS) { ctx.fillStyle = `rgb(${c.c} / 6%)`; ctx.fillRect(X(c.a), P.t, X(c.b) - X(c.a), h - P.t - P.b); }
    ctx.fillStyle = 'rgba(240,238,230,.04)'; ctx.fillRect(X(1380), P.t, X(N) - X(1380), h - P.t - P.b);
    // the kill zones: an amber wash and a named strip under the top edge
    for (const z of (F && F.zones) || []) {
      if (z.b < x0 || z.a > x1) continue;
      ctx.fillStyle = `rgb(${ZONE_C} / 5%)`; ctx.fillRect(X(z.a), P.t, X(z.b) - X(z.a), h - P.t - P.b);
      ctx.fillStyle = `rgb(${ZONE_C} / 55%)`; ctx.fillRect(X(z.a), P.t, X(z.b) - X(z.a), 3);
      if (X(z.b) - X(Math.max(z.a, x0)) > 70) { ctx.font = '700 9.5px ' + mono(); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = `rgb(${ZONE_C} / 85%)`; ctx.fillText(`${z.name.toUpperCase()} KZ`, X(Math.max(z.a, x0)) + 6, P.t + 5); }
    }
    if (hh > x0) {   // before the hold: no pen yet
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(X(x0), P.t, X(Math.min(hh, x1)) - X(x0), h - P.t - P.b);
      if (hh <= x1 && X(hh) - P.l > 150) { ctx.font = '500 11px ' + mono(); ctx.fillStyle = MUTED; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(`no pen before ${clock(hh)}`, X(hh) - 8, h - P.b - 6); }
    }
    ctx.restore();
    ctx.font = '500 11.5px ' + mono(); ctx.fillStyle = MUTED;
    const ys = niceStep((hi - lo) / 4);
    ctx.beginPath(); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(lo / ys) * ys; v <= hi; v += ys) { const y = Math.round(Y(v)) + .5; ctx.moveTo(P.l, y); ctx.lineTo(w - P.r, y); ctx.fillText(v.toLocaleString('en-US'), P.l - 8, y); }
    ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.stroke();
    const span = x1 - x0, tstep = span > 300 ? 60 : 30;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let k = Math.ceil(x0 / tstep) * tstep; k <= x1; k += tstep) { const x = X(k); ctx.fillText(clock(k), Math.max(P.l + 24, Math.min(w - P.r - 24, x)), h - P.b + 7); ctx.fillRect(Math.round(x), h - P.b, 1, 4); }
    ctx.save(); ctx.beginPath(); ctx.rect(P.l, 0, w - P.l - P.r, h); ctx.clip();
    // the yardstick: the price at the hold, kept flat from the hold on
    if (hh <= x1) { const y = Math.round(Y(hd.close)) + .5; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(Math.max(hh, x0)), y); ctx.lineTo(X(x1), y); ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.stroke(); ctx.setLineDash([]); }
    // PDH and PDL: the previous day's high and low (midnight to 3 pm New York), dotted, named at the right edge
    if (lv) for (const [v, name] of [[lv.high, 'PDH'], [lv.low, 'PDL']]) {
      if (v < lo || v > hi) {   // out of view: say where it is from the edge it lies past
        const m = mktAt(st.s), up = v > hi;
        ctx.font = '700 10px ' + mono(); ctx.textAlign = 'right'; ctx.textBaseline = up ? 'top' : 'bottom'; ctx.fillStyle = 'rgba(245,181,68,.8)';
        halo(ctx, `${name} ${v.toLocaleString('en-US')} ${up ? '↑' : '↓'}${m == null ? '' : ` ${sgn(v - m)} from here`}`, w - P.r - 4, up ? P.t + 30 : h - P.b - 30);
        continue;
      }
      const y = Math.round(Y(v)) + .5;
      ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(w - P.r, y); ctx.strokeStyle = 'rgba(245,181,68,.7)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '700 10px ' + mono(); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = 'rgba(245,181,68,.95)'; halo(ctx, `${name} ${v.toLocaleString('en-US')}`, w - P.r - 4, y - 2);
    }
    // the calls: a peak ▼ under the top edge, a trough ▲ over the bottom, in the circle's colour; graded ones filled (hit) or crossed (miss), those still ahead of the playhead faint
    const s0 = st.s;
    for (const c of FCALLS) {
      const m = callMin(c); if (m < x0 || m > x1) continue;
      const x = X(m), peak = c.kind === 'peak', y = peak ? P.t + 22 : h - P.b - 14, col = COL[c.n] || INK, future = m > s0, done = !future && callDone(c) <= s0;
      ctx.globalAlpha = future ? .35 : 1;
      ctx.beginPath();
      if (peak) { ctx.moveTo(x - 5, y - 6); ctx.lineTo(x + 5, y - 6); ctx.lineTo(x, y + 2); } else { ctx.moveTo(x - 5, y + 6); ctx.lineTo(x + 5, y + 6); ctx.lineTo(x, y - 2); }
      ctx.closePath();
      if (done && c.state === 'hit') { ctx.fillStyle = col; ctx.fill(); }
      else { ctx.fillStyle = BG; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (done && c.state === 'miss') { ctx.beginPath(); ctx.moveTo(x - 4, peak ? y - 10 : y + 10); ctx.lineTo(x + 4, peak ? y - 2 : y + 2); ctx.moveTo(x + 4, peak ? y - 10 : y + 10); ctx.lineTo(x - 4, peak ? y - 2 : y + 2); ctx.strokeStyle = '#eb7b7b'; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    const line = (get, col, width, a, b, alpha) => {
      ctx.beginPath(); let on = false;
      for (let k = Math.max(Math.floor(a), Math.floor(x0)); k <= Math.min(Math.ceil(b), Math.ceil(x1), N); k++) { const v = get(k); if (v == null) { on = false; continue; } const x = X(k), y = Y(v); if (on) ctx.lineTo(x, y); else ctx.moveTo(x, y); on = true; }
      ctx.strokeStyle = col; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.lineJoin = 'round'; ctx.stroke(); ctx.globalAlpha = 1;
    };
    const s = st.s, mk = k => D.mkt[k];
    line(mk, INK, 1.5, x0, s, 1); line(mk, INK, 1.5, s, x1, .25);
    line(pen, PEN, 2, hh, Math.max(hh, s), 1); line(pen, PEN, 2, Math.max(hh, s), x1, .35);
    if (hh >= x0 && hh <= x1) { ctx.beginPath(); ctx.arc(X(hh), Y(hd.pen[0]), 4.5, 0, TAU); ctx.fillStyle = BG; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = PEN; ctx.stroke(); }
    const x = Math.round(X(s)) + .5; ctx.beginPath(); ctx.moveTo(x, P.t - 8); ctx.lineTo(x, h - P.b); ctx.strokeStyle = 'rgba(167,139,250,.9)'; ctx.lineWidth = 1.5; ctx.stroke();
    for (const [v, col] of [[pen(s), PEN], [mktAt(s), INK]]) if (v != null) { ctx.beginPath(); ctx.arc(X(s), Y(v), 4, 0, TAU); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = BG; ctx.stroke(); }
    if (st.hover != null) { const hx = Math.round(X(st.hover)) + .5; ctx.beginPath(); ctx.moveTo(hx, P.t); ctx.lineTo(hx, h - P.b); ctx.strokeStyle = 'rgba(240,238,230,.3)'; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.restore();
    const tip = $('tip');
    if (st.hover != null) {
      const k = Math.round(st.hover), m = D.mkt[k] ?? null, p = pen(k), z = zoneOf(k);
      const near = FCALLS.filter(c => Math.abs(callMin(c) - st.hover) <= Math.max(1.5, (x1 - x0) / 160)).slice(0, 4);
      tip.innerHTML = `<b>${clock(k)}</b> ET · ${sessOf(k)}${z ? ` · <span class="kz">${esc(z.name)} KZ</span>` : ''}<br>market <b>${px2(m)}</b><br>pen <b>${p == null ? `—</b> <span class="muted">holds from ${clock(hh)}</span>` : `${px2(p)}</b>`}${m != null && p != null ? `<br>gap <b class="${m - p >= 0 ? 'up' : 'dn'}">${sgn(m - p)}</b>` : ''}`
        + near.map(c => `<br><i style="color:${COL[c.n]}">●</i> ${LABELS[c.n][0]} ${c.kind === 'peak' ? '▼ peak' : '▲ trough'} ${c.fam === 'kalman' ? 'K' : 'D'} · ${callDone(c) <= st.s ? (c.state === 'hit' ? `<b class="up">hit</b> ${c.off > 0 ? '+' : ''}${Math.round(c.off)} min` : c.state === 'miss' ? '<b class="dn">miss</b>' : 'not graded') : 'due'}`).join('');
      tip.style.display = 'block';
      const hx = X(st.hover), tw = tip.offsetWidth; tip.style.left = `${hx + 14 + tw > w - 8 ? hx - tw - 14 : hx + 14}px`; tip.style.top = `${P.t + 4}px`;
    } else tip.style.display = 'none';
  }

  // ---------------------------------------------------------------- the rail and the bar
  let szEl = [], lapEl = [], turnEl = [];
  function buildRows() {
    const rows = $('rows');
    rows.innerHTML = LABELS.map((l, n) => `<div class="lpRow" title="The ${l[0]} circle, ≈ ${l[1]} bars a turn"><i class="lpDot" style="background:${COL[n]}"></i><span class="lpNm">${l[0]}</span><span class="lpLap"><i data-lap="${n}" style="background:${COL[n]}"></i></span><span class="lpTn" data-turn="${n}"></span><span class="lpSz" data-sz="${n}"></span></div>`).join('');
    const q = sel => [...rows.querySelectorAll(sel)];
    szEl = q('[data-sz]'); lapEl = q('[data-lap]'); turnEl = q('[data-turn]');
  }
  function drawRail() {
    const s = st.s, hh = hold(), hd = H(), A = hd.A, m = mktAt(s), pv = pen(s), ms = msAt(s), at = clock(hh);
    $('clk').textContent = clock(s);
    $('clkDay').textContent = `${etDay.format(ms)} · New York time`;
    $('dayBar').style.width = `${(100 * s / N).toFixed(2)}%`;
    $('dayTxt').textContent = `day ${Math.min(99, Math.floor(100 * s / N))}% since 6 pm · ${sessOf(s)}`;
    $('note').textContent = s >= 1380 ? 'break · the circles keep turning · reopens 6 pm' : pv == null ? `the pen holds from ${at}` : m == null ? 'no trade this minute' : '';
    const gap = m == null || pv == null ? null : m - pv;
    $('px').innerHTML = `<span>Market</span><b>${px2(m)}</b><span>Pen, held from ${at}</span><b>${pv == null ? '—' : px2(pv)}</b><span>Market − pen</span><b class="${gap == null ? '' : gap >= 0 ? 'up' : 'dn'}">${gap == null ? '—' : sgn(gap)}</b>`;
    for (let n = 0; n < L; n++) {
      const Pd = D.periods[n], frac = (s % Pd) / Pd, turns = Math.round(N / Pd);
      szEl[n].textContent = A[n] === 0 ? 'no bars' : `${A[n] < 0 ? '▲' : '▼'} ±${Math.abs(A[n]).toFixed(1)}`;
      szEl[n].classList.toggle('none', A[n] === 0);
      szEl[n].title = A[n] === 0 ? `No bars in this circle's fitting window (its last four laps) before ${at}: over a weekend only the 1D reaches back to Friday.` : '';
      lapEl[n].style.width = `${(frac * 100).toFixed(1)}%`;
      turnEl[n].textContent = `${Math.min(turns, Math.floor(s / Pd) + 1)}/${turns}`;
    }
    const key = `${D.open}|${hh}`;
    if (key !== scoreKey) {
      scoreKey = key; SCORE = holdScore(D, hh);
      $('score').innerHTML = `<span>Pen's miss, ${at} to 6 pm</span><b>±${SCORE.held.toFixed(1)}</b><span>The ${at} price kept flat</span><b>±${SCORE.flat.toFixed(1)}</b>`
        + `<span>Fit explains (held-out, at ${at})</span><b>${hd.explained == null ? '—' : Math.round(hd.explained * 100) + '%'}</b><span>Fit residual (at ${at})</span><b>${hd.rms == null ? '—' : '±' + hd.rms.toFixed(1)}</b>`;
      const better = SCORE.held < SCORE.flat;
      $('why').innerHTML = `At ${at} the pen stood at <b>${fmtI(hd.pen[0])}</b>: the last close before it, ${fmtI(hd.close)}, plus the fit's trend since that close (${hd.trend >= 0 ? '+' : '−'}${fmtI(Math.abs(hd.trend))}, traded minutes only), plus where the circles stood. `
        + (SCORE.move == null ? '' : `From there the market moved <b>${sgn(SCORE.move)}</b> and the pen <b>${sgn(SCORE.penMove)}</b>. `)
        + `The pen ${better ? 'beat' : 'did worse than'} the ${at} price kept flat.`;
    }
    $('now').textContent = clock(s);
    $('nowSub').textContent = `${etDay.format(ms)} · ${sessOf(s)}`;
    $('read').innerHTML = `<span>market<b>${px2(m)}</b></span><span>pen<b>${pv == null ? `waits for ${at}` : px2(pv)}</b></span>${gap == null ? '' : `<span>market − pen<b class="${gap >= 0 ? 'up' : 'dn'}">${sgn(gap)}</b></span>`}`;
    $('hint').textContent = `Pen fitted once at ${at} on bars before it, then kept to 6 pm. Dashed: the ${at} price kept flat.`;
    $('legend').innerHTML = `<span><i style="background:${INK}"></i>market (${esc(D.name)})</span><span><i style="background:${PEN}"></i>pen held from ${at}</span><span><i class="dash"></i>${at} price, kept flat</span>`;
    for (const e of el.querySelectorAll('[role=slider]')) { e.setAttribute('aria-valuenow', Math.round(s)); e.setAttribute('aria-valuetext', clock(s)); }
  }
  // ---------------------------------------------------------------- the Forecast card
  const famWord = c => (c.fam === 'kalman' ? 'Kalman' : 'Daily');
  const ZSHORT = { asia: 'Asia', london: 'London', nyam: 'NY AM', nypm: 'NY PM' };
  const zoneShort = m => { const z = (F && F.zones || []).find(q => m >= q.a && m < q.b); return z ? ZSHORT[z.id] || z.name : '—'; };
  function drawCast() {
    const s = st.s, m = mktAt(s), z = zoneOf(s), lv = F && F.level;
    if (!F) { $('castLv').innerHTML = ''; $('castList').innerHTML = `<div class="lpCastEmpty">${esc(FMSG || 'no forecast for this day')}</div>`; $('castRec').textContent = ''; $('castFoot').textContent = ''; return; }
    const dist = v => (m == null || !Number.isFinite(v) ? '' : `<small>${sgn(v - m)} from here</small>`);
    const hunt = lv && m != null ? (m > lv.high ? 'above PDH' : m < lv.low ? 'below PDL' : `between · ${Math.round(100 * (m - lv.low) / (lv.high - lv.low))}% of the way up`) : '';
    $('castLv').innerHTML = `<div class="lpLv"><span>PDH</span><b>${lv ? fmtI(lv.high) : '—'}</b>${lv ? dist(lv.high) : ''}</div>`
      + `<div class="lpLv"><span>PDL</span><b>${lv ? fmtI(lv.low) : '—'}</b>${lv ? dist(lv.low) : ''}</div>`
      + `<div class="lpLv kz"><span>Kill zone</span><b>${z ? esc(z.name) : 'none'}</b><small>${z ? z.hours : (F.zones.find(q => q.a > s) ? `next: ${esc(F.zones.find(q => q.a > s).name)} at ${clock(F.zones.find(q => q.a > s).a)}` : 'no more today')}</small></div>`
      + (hunt ? `<div class="lpLv"><span>Market</span><b>${px2(m)}</b><small>${hunt}</small></div>` : '');
    // graded behind the playhead (the last few) and calls ahead, nearest first
    const behind = FCALLS.filter(c => callDone(c) <= s && (c.state === 'hit' || c.state === 'miss')).slice(-CAST_DONE);
    const ahead = FCALLS.filter(c => callMin(c) >= s).slice(0, CAST_LIST);
    const pending = FCALLS.filter(c => callMin(c) < s && callDone(c) > s).length;
    const row = (c, past) => {
      const target = c.kind === 'peak' ? 'PDH' : 'PDL', tv = lv ? (c.kind === 'peak' ? lv.high : lv.low) : NaN;
      const conf = c.earned ? `${Math.round(100 * c.earned.rate)}%` : '—', confT = c.earned ? `${c.earned.n} earlier ${famWord(c)} ${LABELS[c.n][0]} calls${c.earned.level === 'zone' ? ' in this zone' : c.earned.level === 'circle' ? ' (any zone)' : ' (any circle)'}: ${Math.round(100 * c.earned.rate)}% hit a real turn` : 'no earlier calls to earn a confidence from';
      const grade = past ? (c.state === 'hit' ? `<b class="up">✓ hit</b><small>${c.off > 0 ? '+' : ''}${Math.round(c.off)} min</small>` : '<b class="dn">✗ miss</b>') : `<b>${conf}</b><small>${c.earned ? `${c.earned.n} calls` : 'no record'}</small>`;
      return `<div class="lpCastRow${past ? ' past' : ''}" title="${esc(confT)}"><span class="lpCastT">${clock(callMin(c))}</span><i class="lpDot" style="background:${COL[c.n]}"></i><span class="lpCastC">${LABELS[c.n][0]}<small>${famWord(c)}</small></span>`
        + `<span class="lpCastK ${c.kind}">${c.kind === 'peak' ? '▼ peak' : '▲ trough'}<small>${lv ? `${target} ${m != null && Number.isFinite(tv) ? sgn(tv - m) : ''}` : 'no levels'}</small></span>`
        + `<span class="lpCastZ" title="kill zone">${zoneShort(callMin(c))}</span><span class="lpCastG">${grade}</span></div>`;
    };
    $('castList').innerHTML = (behind.length ? `<div class="lpCastCap">graded</div>${behind.map(c => row(c, true)).join('')}` : '')
      + `<div class="lpCastCap">ahead${pending ? ` · ${pending} being graded` : ''}</div>` + (ahead.length ? ahead.map(c => row(c, false)).join('') : '<div class="lpCastEmpty">no more calls today for these circles</div>');
    const todayDone = FCALLS.filter(c => callDone(c) <= s && (c.state === 'hit' || c.state === 'miss')), todayHit = todayDone.filter(c => c.state === 'hit').length;
    $('castRec').innerHTML = todayDone.length ? `today <b>${todayHit}/${todayDone.length}</b>` : '';
    const rec = F.record, recWord = ['daily', 'kalman'].filter(k => rec[k] && rec[k].n).map(k => `${k === 'kalman' ? 'Kalman' : 'Daily'} ${Math.round(100 * rec[k].hits / rec[k].n)}% of ${rec[k].n}`).join(' · ');
    $('castFoot').innerHTML = `<span>Confidence = that circle’s hit rate in that zone on the record before this day${recWord ? ` (${recWord})` : ''}.</span><span>${F.verdict && F.verdict.any ? 'A family clears its null on this range.' : 'No family beats its null on this range: read the odds as a record, not a promise.'}</span>`;
  }
  function paintBar() {
    for (const g of el.querySelectorAll('.seg[data-k]')) for (const b of g.children) b.classList.toggle('on', String(st[g.dataset.k]) === b.dataset.v);
    const sw = el.querySelector('.lpSwitch'); sw.setAttribute('aria-checked', String(st.trail));
    const play = el.querySelector('[data-a="play"]'); play.innerHTML = st.playing ? ICON.pause : ICON.play; play.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
    const h = D ? hold() : st.hold;
    $('holdTxt').textContent = clock(h);
    $('holdName').textContent = presetName(h);
    const items = PRESETS.map(([k, name]) => [k, name]);
    if (st.custom != null && !isPreset(st.custom)) items.push([st.custom, 'Your time']);
    $('menuItems').innerHTML = items.map(([k, name]) => `<button type="button" class="lpMenuItem${k === h ? ' on' : ''}" role="menuitemradio" aria-checked="${k === h}" data-a="pick" data-k="${k}">${ICON.check}<span>${name}</span><b>${clock(k)}</b></button>`).join('');
    const ti = $('timeIn');
    if (document.activeElement !== ti && D) ti.value = et24.format(msAt(h));
  }

  // ---------------------------------------------------------------- acting
  function seek(s) { st.s = Math.max(0, Math.min(N, s)); markDirty(); }
  function setPlaying(on) { st.playing = on && !!D; if (st.playing && st.s >= N) st.s = 0; st.last = 0; paintBar(); kick(); }
  function setHold(h) {
    st.hold = normHold(h); store.set('hold', st.hold);
    paintBar(); markDirty();
  }
  const menu = $('menu'), menuBtn = el.querySelector('[data-a="menu"]');
  const openMenu = on => { menu.hidden = !on; menuBtn.setAttribute('aria-expanded', String(on)); if (on) (menu.querySelector('.lpMenuItem.on') || menu.querySelector('.lpMenuItem'))?.focus(); };
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
    const g = b.parentElement.closest('.seg[data-k]');
    if (g) { const k = g.dataset.k; st[k] = k === 'zoom' || k === 'minP' ? +b.dataset.v : b.dataset.v; if (k !== 'view') store.set(k, st[k]); if (k === 'fam' || k === 'minP') filterCalls(); paintBar(); markDirty(); return; }
    if (b.matches('.lpSwitch')) { st.trail = !st.trail; paintBar(); markDirty(); return; }
    switch (b.dataset.a) {
      case 'play': setPlaying(!st.playing); break;
      case 'menu': openMenu(menu.hidden); break;
      case 'pick': setHold(+b.dataset.k); openMenu(false); menuBtn.focus(); break;
    }
  });
  $('timeIn').addEventListener('change', e => {
    const v = e.target.value; if (!v) return;
    const [hh, mm] = v.split(':').map(Number);
    const h = normHold(((hh * 60 + mm) - 18 * 60 + 1440) % 1440);
    if (!isPreset(h)) { st.custom = h; store.set('custom', h); }   // the one other time, listed from now on
    setHold(h);
  });
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !e.target.closest('.lpHold')) openMenu(false); });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) { openMenu(false); menuBtn.focus(); return; }
    if (!menu.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {   // move through the menu's times
      const list = [...menu.querySelectorAll('.lpMenuItem')], i = list.indexOf(document.activeElement);
      e.preventDefault(); list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus(); return;
    }
    if (!D || e.target.closest('.lpMenu') || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); setPlaying(!st.playing); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target.tagName !== 'BUTTON') { e.preventDefault(); seek(st.s + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 15 : 1)); }
  });
  // the overview and the close-up: press and drag to move; hover the close-up to read a minute
  const drag = (node, toS, hover) => {
    let down = false;
    node.addEventListener('pointerdown', e => { if (!D) return; down = true; node.setPointerCapture(e.pointerId); seek(toS(e)); });
    node.addEventListener('pointermove', e => { if (!D) return; if (hover) { st.hover = toS(e); markDirty(); } if (down) seek(toS(e)); });
    node.addEventListener('pointerup', () => { down = false; });
    node.addEventListener('pointercancel', () => { down = false; });
    if (hover) node.addEventListener('pointerleave', () => { st.hover = null; markDirty(); });
  };
  const mini = $('mini'), chartEl = $('chart');
  drag(mini, e => { const r = mini.getBoundingClientRect(); return (e.clientX - r.left - ML) / (r.width - ML - MR) * N; });
  drag(chartEl, e => { const r = chartEl.getBoundingClientRect(), c = CX || { x0: 0, x1: N }; return Math.max(0, Math.min(N, c.x0 + (e.clientX - r.left - P.l) / (r.width - P.l - P.r) * (c.x1 - c.x0))); }, true);
  new ResizeObserver(() => { markDirty(); queueFit(); kick(); }).observe(el);

  function loop(ts) {
    st.raf = 0;
    if (!st.shown || !D) return;
    if (st.playing) {
      const dt = st.last ? Math.min(.1, (ts - st.last) / 1000) : 0; st.last = ts;
      st.s = Math.min(N, st.s + dt * N / SPEED[st.speed]);
      if (st.s >= N) setPlaying(false);
      st.dirty = true;
    }
    if (st.dirty) { st.dirty = false; drawSheet(); drawMini(); drawChart(); drawRail(); const ck = `${Math.floor(st.s)}|${st.fam}|${st.minP}|${F ? F.key : FMSG}`; if (ck !== castKey) { castKey = ck; drawCast(); } }
    if (st.playing) st.raf = requestAnimationFrame(loop);   // otherwise idle until markDirty asks again
  }
  function kick() { if (!st.raf && st.shown && D) st.raf = requestAnimationFrame(loop); }
  function markDirty() { st.dirty = true; kick(); }

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
  paintBar();

  return {
    /** Show `day` (labDay.js replayDay's, version 2), from its open. */
    set(day) {
      D = day; N = day.mkt.length - 1; L = day.periods.length;
      W = day.periods.map(p => -TAU / p); RAD = day.periods.map((_, n) => 0.5 ** n);
      COL = COLORS.slice(0, L); TXT = COL.map(c => lift(c, .25));
      LABELS = day.periods.map(Pd => [fmtPeriod(Pd), fmtTF(barsForPeriod(Pd, TFS))]);
      mktLo = Infinity; mktHi = -Infinity;
      for (const v of day.mkt) if (v != null) { mktLo = Math.min(mktLo, v); mktHi = Math.max(mktHi, v); }
      if (!Number.isFinite(mktLo)) { mktLo = 0; mktHi = 1; }
      scoreKey = ''; castKey = ''; F = null; FMSG = 'reading the forecast…'; FCALLS = [];
      buildRows();
      setPlaying(false); seek(0); paintBar(); queueFit(); kick();
    },
    /** The session's turn calls (server dayturns) for the day shown, or null with a message. */
    setForecast(data, msg = '') { F = data && D && data.open === D.open ? data : null; FMSG = F ? '' : msg; filterCalls(); castKey = ''; markDirty(); },
    clear() { D = null; F = null; FCALLS = []; setPlaying(false); },
    show() { st.shown = true; markDirty(); queueFit(); },
    hide() { st.shown = false; setPlaying(false); },
    get state() { return st; },
  };
}
