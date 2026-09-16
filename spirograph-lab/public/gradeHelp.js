// The Multi-day grade walkthrough (16 Sep, on request: "explain like a tutorial or a step by step wizard"): how a grade
// is made, from the range picked to the verdict, in the order the server does it (server/labJob.mjs, engine/dailyTest.js).
// Numbers come from the grade on screen when there is one, so each step reads as "here is what happened to yours".
import { esc, pct, int } from '/lab/util.js';

/** The Wilson 95% range the page draws (engine/stats.js), so the walkthrough's example matches it. */
function wilson(k, n, z = 1.96) {
  if (!n) return { lo: NaN, hi: NaN };
  const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return { lo: c - h, hi: c + h };
}
/** The smallest hit rate whose whole luck range clears `bar` with `n` forecasts. */
function needed(bar, n) {
  for (let k = 0; k <= n; k++) if (wilson(k, n).lo > bar) return k / n;
  return NaN;
}

/** The numbers the steps quote: the grade on screen's, or a plain example when none is open. */
function facts(g) {
  const sc = g && g.sc;
  if (!sc || !sc.dir.n) return {
    live: false, name: 'NQ front month', runs: 300, dirN: 300, hits: 160, rate: 0.533, bar: 0.52, usual: 'up',
    tg: 27577, th: 9896, trate: 0.359, chance: 0.38, mae: 64.3, flat: 59.2, ratio: 1.09, word: 'No edge', slotN: 38,
  };
  const x = sc.byHour.filter(Boolean);
  return {
    live: true, name: g.name, runs: sc.runs, dirN: sc.dir.n, hits: sc.dir.hits, rate: sc.dir.rate, bar: sc.dir.majority,
    usual: sc.dir.upShare >= 0.5 ? 'up' : 'down', tg: sc.turns.graded, th: sc.turns.hits, trate: sc.turns.rate, chance: sc.turns.chance,
    mae: sc.path.mae, flat: sc.path.flat, ratio: sc.path.ratio, word: g.head.word, slotN: x.length ? Math.round(x.reduce((a, s) => a + s.dirN, 0) / x.length) : 0,
  };
}

const fig = (svg, cap) => `<figure class="ghFig">${svg}<figcaption>${cap}</figcaption></figure>`;

/** A luck-range bar in the same marks the verdict panel uses. */
function luckBar(rate, lo, hi, bar, fmt = pct) {
  const a = Math.min(lo, bar) - 0.04, b = Math.max(hi, bar) + 0.04, x = v => (100 * (v - a) / (b - a)).toFixed(1);
  const state = lo > bar ? 'ok' : rate > bar ? 'amber' : 'bad';
  return `<div class="test ${state} ghTest"><div class="track"><div class="rail"></div>`
    + `<div class="band" style="left:${x(lo)}%;width:${(x(hi) - x(lo)).toFixed(1)}%"></div>`
    + `<div class="tick" style="left:${x(bar)}%"></div><span style="left:${x(bar)}%">bar ${fmt(bar)}</span>`
    + `<div class="you" style="left:${x(rate)}%"></div><b style="left:${x(rate)}%">${fmt(rate)}</b>`
    + `<span class="end" style="left:0">${fmt(a)}</span><span class="end" style="left:auto;right:0">${fmt(b)}</span></div></div>`;
}

const STEPS = [
  {
    title: 'What this tab answers', short: 'The question',
    body: f => `
      <p class="ghLead">Do the circles know where the market goes next <b>better than a guess that needs no skill at all</b>?</p>
      <p>A chart that fits past prices well can still be useless for what comes next. So the grade never lets the circles see the future. It makes them commit to a forecast, waits, then checks it. It repeats that hundreds of times and asks whether the hit rate is too good to be luck.</p>
      <ol class="ghFlow">
        <li><b>Pick a range</b><span>dates to test</span></li>
        <li><b>Freeze</b><span>every 3 hours, fit on the past only</span></li>
        <li><b>Grade</b><span>check the next 3 hours</span></li>
        <li><b>Compare</b><span>against a no-skill guess</span></li>
        <li><b>Allow for luck</b><span>a range around each rate</span></li>
        <li><b>Verdict</b><span>edge or no edge</span></li>
      </ol>
      <p class="ghNote">${f.live ? `The examples in these steps use the grade on screen: <b>${esc(f.name)}</b>, ${int(f.runs)} forecasts, verdict <b>${esc(f.word)}</b>.` : 'No grade is open, so the examples use sample numbers. Open a grade and the steps quote its own.'}</p>`,
  },
  {
    title: 'Pick a range and press Grade', short: 'Pick a range', show: 'toolbar',
    body: () => `
      <p>Choose <b>From</b> and <b>To</b>, or a preset: 14, 30 or 60 days, or <b>All banked</b>. Then press <b>Grade</b>.</p>
      <ul class="ghList">
        <li><b>From</b> means the first session traded on that date, which opens at 6 pm the evening before. <b>To</b> runs through that date's session.</li>
        <li><b>All banked</b> starts <b>two weeks after</b> the first banked bar, because every forecast needs two weeks of prices behind it. Earlier slots are skipped as “too little history”.</li>
        <li>Grading runs in the background on the server, taking about 15 seconds for two months. The chip in the header shows progress.</li>
        <li>Every finished grade is kept. Pick an older one from <b>Saved</b> to open it again without re-running it.</li>
        <li><b>Front month</b> instruments stitch contracts together. At a roll, older prices are shifted by the gap between contracts, so moves and grades are unchanged. The shift is noted under the grid.</li>
      </ul>`,
  },
  {
    title: 'Freeze a forecast every 3 hours', short: 'Freeze',
    body: () => `
      <p>The server steps through the range on the New York clock and stops at eight slots a day: <b>6 pm, 9 pm, 12 am, 3 am, 6 am, 9 am, 12 pm, 3 pm</b>. At each slot it does this:</p>
      ${fig(`<svg viewBox="0 0 640 170" class="ghSvg" role="img" aria-label="A freeze: fitted on the past, graded on the next 3 hours">
        <rect x="20" y="20" width="400" height="110" rx="6" class="ghPast"/><rect x="420" y="20" width="200" height="110" rx="6" class="ghNext"/>
        <path class="ghMkt" d="M20,96 C60,70 90,110 130,88 S200,50 240,76 S310,112 350,84 S400,60 420,72"/>
        <path class="ghMkt ghFaint" d="M420,72 C450,88 480,58 520,66 S580,98 620,84"/>
        <path class="ghPen" d="M420,72 C460,62 500,58 540,66 S600,84 620,90"/>
        <line x1="420" x2="620" y1="72" y2="72" class="ghFlat"/>
        <line x1="420" x2="420" y1="12" y2="140" class="ghSlot"/>
        <text x="220" y="152" class="ghT">fitted on these prices only (last 2 weeks)</text>
        <text x="520" y="152" class="ghT">next 3 hours: graded</text>
        <text x="420" y="10" class="ghT ghStrong">slot, e.g. 9 pm: freeze</text>
        <text x="610" y="104" class="ghT ghPenT" text-anchor="end">pen</text>
        <text x="610" y="64" class="ghT" text-anchor="end">flat line</text>
      </svg>`, 'Only one-minute bars that had closed before the slot are read. Nothing after it can leak in.')}
      <ol class="ghList">
        <li><b>Read the past only.</b> Load the one-minute bars from the two weeks before the slot.</li>
        <li><b>Fit the six circles</b> (1D, 4H, 2H, 24m, 12m, 6m) to those prices, the same fit the Day player draws.</li>
        <li><b>Write the forecast down</b>, with no changes allowed later:
          <ul><li>the <b>pen's path</b> for each of the next 180 minutes</li>
          <li>its <b>direction</b>: up if the pen ends higher than it starts, down if lower</li>
          <li>every <b>peak and trough</b> each circle predicts inside those 3 hours</li></ul></li>
      </ol>
      <p class="ghNote">Slots are passed over when the market trades <b>under an hour</b> of the 3 hours (Friday 5 pm to Sunday 6 pm), which doesn't count as a skip. They are also skipped when the bank holds <b>too little history</b>, meaning under 60% of the minutes of the last 4 days. That second kind shows as “skipped” in the verdict panel.</p>`,
  },
  {
    title: 'Grade each forecast on what happened', short: 'Grade', show: 'list',
    body: () => `
      <p>Once the 3 hours are over, each forecast gets three checks, all against the <b>price at the slot</b>:</p>
      <div class="ghCards">
        <div><h5>1 · Direction</h5><p>The last close in the 3 hours minus the price at the slot. <b>Right</b> if that move has the same sign as the pen's. If the pen or the market ended flat, there's <b>no call</b> and the forecast doesn't count for direction.</p></div>
        <div><h5>2 · Path</h5><p>At every minute, how far the close is from the pen (<b>path miss</b>) and from the slot's price held flat (<b>flat miss</b>). Both are averaged. A miss under the flat line's means the pen helped.</p></div>
        <div><h5>3 · Turns</h5><p>For every predicted peak or trough, the grader looks for the real high or low near it. It counts as <b>on time</b> if it lands within ⅛ of that circle's lap.</p></div>
      </div>
      ${fig(`<svg viewBox="0 0 640 150" class="ghSvg" role="img" aria-label="How one turn is graded">
        <rect x="140" y="24" width="360" height="92" rx="6" class="ghWin"/>
        <rect x="230" y="24" width="180" height="92" class="ghOnTime"/>
        <path class="ghMkt" d="M140,98 C180,90 220,70 260,52 S300,36 344,40 S420,70 460,86 S490,100 500,102"/>
        <circle cx="330" cy="38" r="5" class="ghHit"/>
        <line x1="320" x2="320" y1="18" y2="122" class="ghSlot"/>
        <text x="320" y="12" class="ghT ghStrong">predicted peak</text>
        <text x="320" y="138" class="ghT">on time: within ⅛ lap</text>
        <text x="148" y="138" class="ghT" text-anchor="start">search: ±¼ lap</text>
        <text x="420" y="58" class="ghT ghOkT" text-anchor="start">← real high: ✓ on time</text>
      </svg>`, 'For the 24m circle, ⅛ of a lap is 3 minutes, so a peak predicted for 9:40 is on time if the real high is between 9:37 and 9:43.')}
      <ul class="ghList">
        <li>If the highest (or lowest) close sits on the <b>edge</b> of the search window, the market ran straight through, so there's <b>no turn</b>. That counts against the circles.</li>
        <li>A forecast whose 3 hours hold fewer than <b>10 closes</b> is left out entirely. This usually means a holiday.</li>
      </ul>`,
  },
  {
    title: 'Compare against a no-skill guess', short: 'The bar to beat', show: 'verdict',
    body: f => `
      <p>A 53% hit rate sounds good until you ask what a guess with no skill would get. Each check has its own bar:</p>
      <table class="ghTable"><thead><tr><th>Check</th><th>The circles</th><th>Bar to beat</th><th>Why that bar</th></tr></thead><tbody>
        <tr><td>Direction</td><td>${pct(f.rate)}</td><td>${pct(f.bar)}</td><td><b>Always guess ${f.usual}.</b> Not 50%: in this range the market went ${f.usual} ${pct(f.bar)} of the time, and a guess that always says so gets that rate for free.</td></tr>
        <tr><td>Turns on time</td><td>${pct(f.trate)}</td><td>${pct(f.chance)}</td><td><b>A random market.</b> Even with no cycles at all, a random walk's high or low lands in the middle of a window about a third of the time. The bar is worked out per circle, then weighted by how many turns each one had.</td></tr>
        <tr><td>Path</td><td>±${f.mae.toFixed(1)}</td><td>±${f.flat.toFixed(1)}</td><td><b>A flat line</b> at the slot's price. The ratio is ${f.ratio.toFixed(2)}×, and below 1× is better. It's shown for context but <b>isn't part of the verdict</b>.</td></tr>
      </tbody></table>`,
  },
  {
    title: 'Allow for luck', short: 'The luck range', show: 'verdict',
    body: f => {
      const w = wilson(f.hits, f.dirN), need = needed(f.bar, f.dirN), slotW = f.slotN ? wilson(Math.round(f.slotN / 2), f.slotN) : null;
      return `
      <p>Flip a fair coin 300 times and you won't get exactly 150 heads. A small lead over the bar can be pure chance. So around each rate the page draws the <b>range luck allows</b>: a 95% range, called a Wilson interval, that shrinks as forecasts pile up.</p>
      ${luckBar(f.rate, w.lo, w.hi, f.bar)}
      <p>Direction: <b>${f.hits} of ${f.dirN}</b> right is ${pct(f.rate)}, and luck allows anywhere from <b>${pct(w.lo)} to ${pct(w.hi)}</b>. The bar, ${pct(f.bar)}, sits ${w.lo > f.bar ? '<b class="ghOkT">below the whole range</b>, so the lead is real' : '<b>inside that range</b>, so the lead could be luck'}.</p>
      <div class="ghRule"><b>The rule:</b> a check passes only when the <b>whole shaded range</b> clears the bar. There must also be at least <b>30</b> forecasts (or 30 graded turns) before anything is said.</div>
      <p class="ghNote">With ${int(f.dirN)} forecasts, direction would need about <b>${pct(need)}</b> to pass. ${slotW ? `The same maths is why the slot rates at the end of each grid row mean little on their own: with about ${f.slotN} forecasts per slot, luck alone spans roughly ${pct(slotW.lo)} to ${pct(slotW.hi)}.` : ''}</p>`;
    },
  },
  {
    title: 'The verdict', short: 'Verdict', show: 'verdict',
    body: f => `
      <p>The verdict panel puts it together:</p>
      <div class="ghVerdicts">
        <div class="ok"><i></i><b>An edge</b><span>Direction <em>or</em> turns cleared its bar with the whole luck range.</span></div>
        <div class="bad"><i></i><b>No edge</b><span>Neither did. Path doesn't change this.</span></div>
        <div><i></i><b>Too few forecasts</b><span>Under 30 forecasts were graded on direction.</span></div>
      </div>
      <p>Each check also gets its own label:</p>
      <ul class="ghList ghPills">
        <li><span class="pill ok">✓ Beats it</span> the whole luck range is above the bar</li>
        <li><span class="pill amber">Ahead, not proven</span> above the bar, but the bar is still inside the luck range</li>
        <li><span class="pill bad">✕ Does not beat it</span> at or below the bar</li>
        <li><span class="pill">Too few to judge</span> under 30</li>
      </ul>
      ${f.live ? `<p class="ghNote">Yours says <b>${esc(f.word)}</b>: direction ${pct(f.rate)} against ${pct(f.bar)}, turns ${pct(f.trate)} against ${pct(f.chance)}.</p>` : ''}`,
  },
  {
    title: 'Read the evidence', short: 'Read the page', show: 'grid',
    body: () => `
      <p>Under the verdict, three views show where it came from. Use <b>Show me</b> to jump to each one.</p>
      <div class="ghCards ghCards2">
        <div><h5>Every forecast <button type="button" class="nmLink" data-show="grid">Show me →</button></h5><p>One square per forecast. Trading days run across, and the 3-hour slots run down from the 6 pm open. <b>Green</b> is right and <b>red</b> is wrong. Brighter squares had bigger market moves. Grey means no call, or a slot that didn't trade. The number at the end of each row is that slot's hit rate. Click a square to replay it.</p></div>
        <div><h5>Turns on time, by circle <button type="button" class="nmLink" data-show="circles">Show me →</button></h5><p>For each circle, the dot is its on-time rate, the shading is its luck range, and the white tick is a random market's rate. It's green when the whole range is right of the tick and red when it's all left. Hollow dots have under 30 turns.</p></div>
        <div><h5>Forecasts <button type="button" class="nmLink" data-show="list">Show me →</button></h5><p>Every forecast, newest first. It shows the pen's call and the market's move, right or wrong, path miss against the flat line (coloured bar against grey bar), and turns on time. <b>Fit explains</b> is how much of the recent price movement the circles' fit captured at that freeze. Filter by right, wrong, or further than flat.</p></div>
        <div><h5>Replay <button type="button" class="nmLink" data-show="list">Show me →</button></h5><p>Click any row or square. You'll see the market (white) against the pen as it was frozen (violet), the slot's price as a dashed flat line, and the 3 hours shaded. Turns from the 24m and slower circles are marked ✓ on time, ✗ missed, – no turn.</p></div>
      </div>`,
  },
  {
    title: 'Before you trust a result', short: 'Caveats',
    body: () => `
      <ul class="ghList">
        <li><b>One range is one sample.</b> An edge found on one range should be checked on dates it wasn't found on. Grade a different stretch and see if it holds.</li>
        <li><b>Don't cherry-pick slices.</b> With 8 slots and 6 circles, one of them will look good by luck. Slot and circle rates are clues, not verdicts.</li>
        <li><b>Path is context.</b> A pen can hug prices well and still call direction no better than a guess, or the other way round.</li>
        <li><b>The Edge check tab</b> reuses these same forecasts. It asks whether a small learner or neural network can find anything in them that the pen alone doesn't.</li>
        <li><b>Rolls.</b> On front-month instruments, check the roll note under the grid when a forecast near a roll looks odd.</li>
      </ul>
      <p class="ghLead ghDone">That's the whole tab. Close this and press <b>Grade</b>, or open a saved grade.</p>`,
  },
];

/** Mount the walkthrough on `dialog`. getGrade() is the grade on screen (or null); show(where) brings that part of the tab into view. */
export function createGradeHelp(dialog, { getGrade, show }) {
  let i = 0;
  dialog.innerHTML = `
    <div class="ghHead"><div><small>Walkthrough</small><h2>How the Multi-day grade is made</h2></div><button type="button" class="nmX" data-g="close" aria-label="Close">✕</button></div>
    <div class="ghBody">
      <nav class="ghSteps" aria-label="Steps">${STEPS.map((s, k) => `<button type="button" data-step="${k}"><i>${k + 1}</i>${esc(s.short)}</button>`).join('')}</nav>
      <section class="ghMain" data-g="main" tabindex="-1"></section>
    </div>
    <div class="ghFoot"><div class="ghDots">${STEPS.map((_, k) => `<i data-dot="${k}"></i>`).join('')}</div>
      <span class="ghHint">← → to move · Esc to close</span>
      <button type="button" class="btn" data-g="show">Show me on the page</button>
      <button type="button" class="btn" data-g="back">Back</button>
      <button type="button" class="btn pri" data-g="next">Next</button></div>`;
  const q = s => dialog.querySelector(s), main = q('[data-g="main"]');

  function paint() {
    const s = STEPS[i], f = facts(getGrade());
    main.innerHTML = `<div class="ghKick">Step ${i + 1} of ${STEPS.length}</div><h3 class="ghTitle">${esc(s.title)}</h3>${s.body(f)}`;
    main.scrollTop = 0;
    for (const b of dialog.querySelectorAll('[data-step]')) { const k = +b.dataset.step; b.classList.toggle('on', k === i); b.classList.toggle('done', k < i); b.setAttribute('aria-current', k === i ? 'step' : 'false'); }
    for (const d of dialog.querySelectorAll('[data-dot]')) d.classList.toggle('on', +d.dataset.dot <= i);
    q('[data-g="back"]').disabled = i === 0;
    q('[data-g="next"]').textContent = i === STEPS.length - 1 ? 'Done' : 'Next';
    q('[data-g="show"]').hidden = !s.show;
  }
  const go = k => { i = Math.max(0, Math.min(STEPS.length - 1, k)); paint(); };
  const jump = where => { dialog.close(); show(where); };

  dialog.addEventListener('click', e => {
    if (e.target === dialog) return dialog.close();   // a click on the backdrop
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.step) go(+b.dataset.step);
    else if (b.dataset.show) jump(b.dataset.show);
    else if (b.dataset.g === 'close') dialog.close();
    else if (b.dataset.g === 'back') go(i - 1);
    else if (b.dataset.g === 'next') i === STEPS.length - 1 ? dialog.close() : go(i + 1);
    else if (b.dataset.g === 'show') jump(STEPS[i].show);
  });
  dialog.addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
  });
  return { open(step = 0) { go(step); if (!dialog.open) dialog.showModal(); main.focus(); } };
}
