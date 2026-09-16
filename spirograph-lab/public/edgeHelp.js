// The Edge check walkthrough (16 Sep, on request: "explain like a tutorial or a step by step wizard for the entire edge
// check tab, even the Full wiring and math button"). The same pop-up as the Multi-day grade's (public/gradeHelp.js):
// each step says what you see, how it is made (which file does it), and something to try, with "Show me" on the page.
import { WARM, NET, INPUTS } from '/lab/labNet.js';

const code = s => `<code>${s}</code>`;
const f = s => `<span class="hpFile">${s}</span>`;
const STEPS = [
  { t: 'The big picture', short: 'Big picture', show: null, k: 'Start here', body: `
    <p>The Edge check answers one question: <b>do the circles know anything about where the market goes next?</b> It does not make new forecasts. It takes the 3-hour forecasts the <b>Multi-day grade</b> already made and checked, and asks several “callers” to call each one up or down, having seen only the ones before it.</p>
    <div class="hpFlow"><span>Instrument</span><i>→</i><span>Multi-day grade<small>a forecast every 3 hours</small></span><i>→</i><span>Rows<small>one per forecast</small></span><i>→</i><span>Callers<small>call each next row</small></span><i>→</i><span>Verdict</span></div>
    <p>If nobody calls the direction better than luck allows, there is nothing for a bigger model to learn yet. If someone does, it is worth a closer look.</p>
    <div class="hpTry"><b>The tab in three parts</b><ol><li>Left: the verdict, the race chart and the scoreboard.</li><li>Right: the neural network panel.</li><li>The <b>Full wiring and math</b> pop-up: every weight and sum of the network.</li></ol></div>` },

  { t: 'Pick an instrument and grade it', short: 'Instrument and grade', show: null, k: 'Where the data comes from', body: `
    <p>The <b>Instrument</b> menu at the top picks the market. The Edge check always shows the grade selected on the <b>Multi-day grade</b> tab for that instrument.</p>
    <ol class="ghList"><li>Choose an instrument.</li><li>Open <b>Multi-day grade</b>, pick a range (60 days is a good start) and press <b>Grade</b>.</li><li>Come back to <b>Edge check</b>.</li></ol>
    <p>It needs at least <b>${WARM + 30} forecasts</b>: the first <b>${WARM}</b> to learn from, then at least <b>30</b> calls before it says anything. Fewer, and the verdict reads <em>Too few forecasts</em>.</p>
    <div class="hpHow"><b>How it is made</b> ${f('app.js')} loads the grade from the server and hands it to ${f('edge.js')} with ${code('edgeView.set(grade)')}. The grade already holds the small learners' calls, worked out on the server by ${f('lab/labEdge.js')}.</div>
    <div class="hpTry"><b>If you see “grade too old”</b> the grade was built before the network existed. Press <b>Grade this range again</b> in the panel.</div>` },

  { t: 'The verdict line', short: 'Verdict', show: 'verdict', k: 'The answer in one sentence', body: `
    <p>The strip at the top gives the answer:</p>
    <ul class="ghList hpList"><li><i class="dot ok"></i><b>Something to look at</b>: a caller beat the usual way by more than luck allows.</li><li><i class="dot bad"></i><b>No edge yet</b>: nobody did.</li><li><i class="dot"></i><b>Too few forecasts</b>: grade a longer range.</li></ul>
    <p>It names the best caller and its hit rate, the “always up” rate it had to beat, and the rate luck alone could reach. Under the scoreboard, <b>How this check works</b> repeats the rules.</p>
    <div class="hpHow"><b>How it is made</b> ${code('paint()')} in ${f('edge.js')} reads ${code('grade.edge')}: ${code('ready')}, ${code('edge')}, ${code('noise')}, the baselines and the learners.</div>` },

  { t: 'The callers', short: 'The callers', show: 'board', k: 'Who is being tested', body: `
    <p>Six callers try to call each forecast's 3-hour direction:</p>
    <table class="ghTable hpTable"><tr><th>Caller</th><th>What it is</th></tr>
      <tr><td><i class="hpKey" style="--c:#93a0b3"></i>Always up</td><td>A yardstick: always guesses the way the market usually went. The bar to beat.</td></tr>
      <tr><td><i class="hpKey" style="--c:#f4f7fb"></i>The pen’s own call</td><td>A yardstick: the direction the spirograph pen itself pointed.</td></tr>
      <tr><td><i class="hpKey" style="--c:#a78bfa"></i>The circles’ numbers</td><td>A small learner (logistic regression) on the pen’s moves, the six circle sizes and how well they fit.</td></tr>
      <tr><td><i class="hpKey" style="--c:#5ce1ff"></i>Recent moves only</td><td>The same learner fed only the market’s last 3-hour and 1-hour moves. Tells you if the circles add anything.</td></tr>
      <tr><td><i class="hpKey" style="--c:#f5b544"></i>Both</td><td>The same learner fed both.</td></tr>
      <tr><td><i class="hpKey" style="--c:#f472b6"></i>Neural network</td><td>${INPUTS.length} inputs → ${NET.hidden} hidden neurons → P(up) and size. Trained live in your browser.</td></tr></table>
    <div class="hpHow"><b>How it is made</b> The small learners are ${code('trainLogit()')} in ${f('lab/labEdge.js')}: standardise each feature, then gradient descent on the log-loss with a ridge penalty. The network is ${f('lab/labNet.js')}.</div>` },

  { t: 'Walking forward, and luck', short: 'Walk-forward and luck', show: 'board', k: 'Why it is a fair test', body: `
    <p><b>Walk-forward:</b> rows are sorted oldest first. A caller learns from rows 1–${WARM}, calls row ${WARM + 1}, learns from 1–${WARM + 1}, calls row ${WARM + 2}, and so on. It never sees the answer before it calls.</p>
    <p><b>Luck:</b> even a coin gets some calls right. Over <i>n</i> calls, a hit rate wobbles by chance about</p>
    <div class="hpEq">luck = 1.96 × √(0.25 ÷ n)</div>
    <p>For 200 calls that is about ±7 points. A caller shows an edge only when</p>
    <div class="hpEq">its rate − always-up rate &gt; luck</div>
    <div class="hpHow"><b>How it is made</b> ${code('noise')} in ${f('lab/labEdge.js')}; the same number draws the grey band on the scoreboard. 1.96 is the 95% line of a normal curve and 0.25 is the most a yes/no outcome can vary.</div>` },

  { t: 'The race chart', short: 'Race chart', show: 'race', k: 'Calls right beyond the usual way', body: `
    <p>One line per caller. At each call the line steps:</p>
    <div class="hpEq">+1 if it was right and “always up” was wrong<br>−1 if it was wrong and “always up” was right<br>0 otherwise</div>
    <p>So “always up” is the flat zero line, and a line climbing means that caller is beating it. The <b>grey funnel</b> is where luck alone lands after <i>k</i> calls: ±1.96 × √(k+1) ÷ 2. A line that climbs clear of the grey and stays there is interesting.</p>
    <div class="hpTry"><b>Try it</b><ul><li>Hover the chart to read every caller on one call.</li><li>Click a caller’s name at the right end to pick it out.</li><li>Click anywhere on the chart to open <b>Full wiring and math</b> on that call.</li></ul></div>
    <div class="hpHow"><b>How it is made</b> ${code('race()')} in ${f('edge.js')} draws an SVG: ${code('excessOf()')} keeps the running total and ${code('luck(k)')} gives the funnel.</div>` },

  { t: 'The scoreboard', short: 'Scoreboard', show: 'board', k: 'One row per caller', body: `
    <p>The scoreboard is also the chart’s legend. Its columns:</p>
    <table class="ghTable hpTable"><tr><td><b>Right</b></td><td>calls right, out of calls made</td></tr>
      <tr><td><b>Rate bar</b></td><td>the hit rate on a 35–65% scale; the tick is always-up, the grey band is luck</td></tr>
      <tr><td><b>vs usual</b></td><td>points above always-up; green only when clear of luck</td></tr>
      <tr><td><b>Points, 1 lot</b></td><td>what trading each call for 3 hours would have made</td></tr>
      <tr><td><b>Every call</b></td><td>a tape, oldest to newest: green right, red wrong. Hover a stripe to read the call</td></tr></table>
    <div class="hpTry"><b>Try it</b> Click a row (or Tab to it and press Enter) to pick that caller out on the chart. Click it again to show all.</div>
    <div class="hpHow"><b>How it is made</b> ${code('board()')} in ${f('edge.js')}.</div>` },

  { t: 'The neural network panel', short: 'Network panel', show: 'panel', k: 'Right-hand side', body: `
    <p>When a grade opens, the page trains the network on it right away (the pink progress bar). Then it shows:</p>
    <ul class="ghList hpList"><li><b>Right</b>: the network’s hit rate, calls and points.</li><li><b>Always up</b>: the bar to beat, and how high luck reaches.</li><li><b>✓ same as the Lab’s run</b>: the server trained the same network when the grade was built. Training is seeded (seed ${NET.seed}), so the page must get exactly the same calls. The two fingerprints are compared.</li><li><b>Watch it learn</b>: replays the pink line on the chart call by call.</li></ul>
    <div class="hpHow"><b>How it is made</b> ${code('netWalk()')} from ${f('lab/labNet.js')} is a generator: it yields a <i>fit</i> each time it retrains and a <i>call</i> for each forecast. ${code('trainAsync()')} in ${f('edge.js')} runs it about 30 ms at a time so the page never freezes, then ${code('fingerprint()')} checks the result.</div>` },

  { t: 'What it looks at', short: 'The switches', show: 'looks', k: 'The four switches', body: `
    <p>The ${INPUTS.length} inputs come in four groups:</p>
    <table class="ghTable hpTable"><tr><td><b>The six circles</b></td><td>signed size of the 1D, 4H, 2H, 24m, 12m and 6m circles</td></tr>
      <tr><td><b>How well they fit</b></td><td>the share of the price the circles explain, and the miss</td></tr>
      <tr><td><b>The pen’s own move</b></td><td>its 3-hour and first-hour move</td></tr>
      <tr><td><b>Time of day</b></td><td>when the pen was frozen, as sine and cosine of the 24-hour clock</td></tr></table>
    <p>Switch one off and the network retrains from scratch without it (that input reaches the network as 0). The chart gets an amber dashed <b>Test run</b> line.</p>
    <div class="hpTry"><b>Reading the test</b> If the test run is within luck of the full network, that group made no real difference. If it is further, it matters. <b>Use everything again</b> goes back. The test run is never saved.</div>
    <div class="hpHow"><b>How it is made</b> ${code('retrain()')} builds a mask of 0s and 1s and calls ${code('netWalk(rows, withMask(mask))')}.</div>` },

  { t: 'The call under your pointer', short: 'Call under pointer', show: 'call', k: 'Why it said what it said', body: `
    <p>Hover the race chart and the panel explains that one call: what the network said, how sure it was, what the market did, and whether it was right. Not hovering, it shows the latest call.</p>
    <p>The bars show <b>what pushed it</b>. For each input:</p>
    <div class="hpEq">push = P(up) on this call − P(up) with that input set to its usual (mean) value</div>
    <p>Green bars pushed toward up, red toward down. The five biggest are shown.</p>
    <div class="hpHow"><b>How it is made</b> ${code('pushes()')} in ${f('edge.js')} reruns the forward pass ${code('pUp()')} once per input with the exact weights that call was made with (a copy is kept after every fit).</div>` },

  { t: 'Full wiring and math', short: 'Full wiring and math', show: 'wire', k: 'The big pop-up', body: `
    <p>Open it with the <b>Full wiring and math</b> button in the panel, or by clicking the race chart on a call. It fills the window with the whole network, trained, on that call.</p>
    <ul class="ghList hpList"><li><b>The diagram</b>: ${INPUTS.length} inputs on the left, ${NET.hidden} hidden neurons in the middle, <b>P(up)</b> and <b>size</b> on the right. Violet lines are positive weights, cyan negative; thicker means bigger. Node brightness is its value on this call.</li>
      <li><b>Toolbar</b>: <b>Train</b> / <b>Pause</b>, <b>Step</b> one step, <b>To the end</b>, <b>Reset</b>, and Slow / Normal / Fast.</li>
      <li><b>Tiles</b>: direction hit rate, and the size’s average miss against a flat line and the pen.</li>
      <li><b>Training loss</b>: should fall as it learns the past. A falling loss is <em>not</em> an edge: only the calls are.</li>
      <li><b>Call shown</b>: drag the slider to look at any past call. Drag to the right end to follow the latest again.</li>
      <li><b>About the inputs</b> (top right): what every input is and how often it retrains.</li></ul>
    <div class="hpTry"><b>Try it</b> Click <b>Reset</b>, then <b>Train</b> on Slow, and watch the lines change colour and thickness as it learns.</div>
    <div class="hpHow"><b>How it is made</b> ${code('createNetPanel()')} in ${f('net.js')} draws the SVG once, then ${code('paint()')} recolours every line and node from the snapshot the shown call was made with. The pop-up is a ${code('&lt;dialog id="eWire"&gt;')} in ${f('index.html')}.</div>` },

  { t: 'Auditing a node or line', short: 'Audits', show: 'wire', k: 'Click anything in the diagram', body: `
    <p>Every node and line opens an audit of the call shown, with the exact numbers. Opening one pauses training.</p>
    <ul class="ghList hpList"><li><b>A line</b>: its weight, and what it carries on this call.</li><li><b>A hidden neuron</b> or <b>an output</b>: every term of its sum, and the squash.</li><li><b>An input</b> opens the <b>bench</b>:</li></ul>
    <table class="ghTable hpTable"><tr><td><b>Value</b></td><td>a <em>what-if</em>: change this input on this call only. The answer recomputes; training is untouched. − / + move a tenth of a spread.</td></tr>
      <tr><td><b>Presets</b></td><td>“Flip the call” or “P(up) 10…90%”: solves for the value of this input that gets there, or says it is out of reach.</td></tr>
      <tr><td><b>The curve</b></td><td>P(up) for every value of this input. Click or drag on it to try a value.</td></tr>
      <tr><td><b>In training</b></td><td>Real, Shuffled (link to the outcome broken), Negated, or Left out. This retrains as a <em>variant</em>, marked not comparable to the server’s run.</td></tr>
      <tr><td><b>The math</b></td><td>four steps: scale the input, into the hidden neurons, on to the outputs, and the slopes.</td></tr></table>
    <div class="hpTry"><b>Try it</b> Open <b>pen 3h</b>, press <b>Flip the call</b>, and see how far the value had to move. A tiny move means the call was on a knife edge.</div>
    <div class="hpHow"><b>How it is made</b> ${code('open()')} and ${code('renderModalBody()')} in ${f('net.js')}; ${code('explain()')} and ${code('solveInput()')} in ${f('lab/labNet.js')}.</div>` },

  { t: 'The math, all of it', short: 'All the math', show: null, k: 'One page of formulas', body: `
    <p>For one call, with input values <i>x</i>:</p>
    <div class="hpEq"><b>1. Scale</b> z<sub>j</sub> = (x<sub>j</sub> − mean<sub>j</sub>) ÷ spread<sub>j</sub> <small>mean and spread over the forecasts it trained on</small>
      <b>2. Hidden</b> a<sub>k</sub> = σ(b<sub>k</sub> + Σ<sub>j</sub> w<sub>kj</sub> · z<sub>j</sub>) <small>σ(s) = 1 ÷ (1 + e<sup>−s</sup>), squashes to 0–1</small>
      <b>3. Direction</b> P(up) = σ(b + Σ<sub>k</sub> w<sub>k</sub> · a<sub>k</sub>) <small>calls up when above 50%</small>
      <b>4. Size</b> size = (b′ + Σ<sub>k</sub> w′<sub>k</sub> · a<sub>k</sub>) × move spread <small>in points</small>
      <b>5. Loss</b> cross-entropy of P(up) + ½ × (size error in spreads)² + ${NET.decay} × ½Σw² <small>averaged over the rows</small>
      <b>6. Slope</b> ∂P/∂x<sub>j</sub> = P(1 − P) × Σ<sub>k</sub> w<sub>k</sub> · a<sub>k</sub>(1 − a<sub>k</sub>) · w<sub>kj</sub> ÷ spread<sub>j</sub></div>
    <p><b>Training:</b> backpropagation with Adam (step ${NET.rate}). The first fit runs ${NET.firstEpochs} passes over the first ${WARM} rows; each later fit ${NET.epochs} more, starting from the last weights. It retrains at most ${NET.maxFits} times over the whole walk. Weights start from seed ${NET.seed}, so every run is identical.</p>
    <div class="hpTry"><b>Mind the size</b> About ${INPUTS.length * NET.hidden + NET.hidden * 3 + 2} weights against a few hundred forecasts: it can memorise the past easily. Only the walk-forward calls count.</div>` },

  { t: 'How the tab is built', short: 'Code map', show: null, k: 'The code map', body: `
    <table class="ghTable hpTable"><tr><th>File</th><th>Job</th></tr>
      <tr><td>${f('index.html')}</td><td>the tab’s empty ${code('#pane-edge')}, the ${code('#eWire')} pop-up, and this guide</td></tr>
      <tr><td>${f('app.js')}</td><td>tabs, the instrument menu, loading grades; creates the Edge view and the network panel and wires them together</td></tr>
      <tr><td>${f('edge.js')}</td><td>the whole tab: verdict, race, scoreboard, panel, switches, pushes, and opening the pop-up</td></tr>
      <tr><td>${f('net.js')}</td><td>the network panel inside the pop-up: diagram, training controls, loss, call slider, audits</td></tr>
      <tr><td>${f('lab/labNet.js')}</td><td>the network itself, pure math shared by server and page: ${code('netWalk')}, ${code('train')}, ${code('explain')}, ${code('fingerprint')}</td></tr>
      <tr><td>${f('lab/labEdge.js')}</td><td>server side: turns graded forecasts into rows, runs the small learners, works out luck and the verdict</td></tr>
      <tr><td>${f('edge.css')}</td><td>the look of the tab and the pop-up</td></tr></table>
    <div class="hpFlow"><span>Grade built<small>server</small></span><i>→</i><span>labEdge + labNet<small>calls, fingerprint</small></span><i>→</i><span>edge.js<small>retrains in page</small></span><i>→</i><span>fingerprints match?</span></div>
    <p>That’s the whole tab. Press <b>Done</b> and try it on a 60-day grade.</p>` },
];

/** Mount on `dialog`. show(where) brings that part of the Edge check into view. */
export const createEdgeHelp = (dialog, { show }) => mountWalkthrough(dialog, { title: 'How the Edge check is made', steps: STEPS, show });

/** A walkthrough pop-up in the Multi-day grade's look: steps { t, short, k, show, body } on the left, one page at a time. */
export function mountWalkthrough(dialog, { title, steps: STEPS, show }) {
  let i = 0;
  dialog.innerHTML = `
    <div class="ghHead"><div><small>Walkthrough</small><h2>${title}</h2></div><button type="button" class="nmX" data-g="close" aria-label="Close">✕</button></div>
    <div class="ghBody">
      <nav class="ghSteps" aria-label="Steps">${STEPS.map((s, k) => `<button type="button" data-step="${k}"><i>${k + 1}</i>${s.short}</button>`).join('')}</nav>
      <section class="ghMain" data-g="main" tabindex="-1"></section>
    </div>
    <div class="ghFoot"><div class="ghDots">${STEPS.map((_, k) => `<i data-dot="${k}"></i>`).join('')}</div>
      <span class="ghHint">← → to move · Esc to close</span>
      <button type="button" class="btn" data-g="show">Show me on the page</button>
      <button type="button" class="btn" data-g="back">Back</button>
      <button type="button" class="btn pri" data-g="next">Next</button></div>`;
  const q = s => dialog.querySelector(s), main = q('[data-g="main"]');
  function paint() {
    const s = STEPS[i];
    main.innerHTML = `<div class="ghKick">Step ${i + 1} of ${STEPS.length} · ${s.k}</div><h3 class="ghTitle">${s.t}</h3><div class="hpBody">${s.body}</div>`;
    main.scrollTop = 0;
    for (const b of dialog.querySelectorAll('[data-step]')) { const k = +b.dataset.step; b.classList.toggle('on', k === i); b.classList.toggle('done', k < i); b.setAttribute('aria-current', k === i ? 'step' : 'false'); }
    for (const d of dialog.querySelectorAll('[data-dot]')) d.classList.toggle('on', +d.dataset.dot <= i);
    q('[data-g="back"]').disabled = i === 0;
    q('[data-g="next"]').textContent = i === STEPS.length - 1 ? 'Done' : 'Next';
    q('[data-g="show"]').hidden = !s.show;
  }
  const go = k => { i = Math.max(0, Math.min(STEPS.length - 1, k)); paint(); };
  dialog.addEventListener('click', e => {
    if (e.target === dialog) return dialog.close();   // a click on the backdrop
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.step) go(+b.dataset.step);
    else if (b.dataset.g === 'close') dialog.close();
    else if (b.dataset.g === 'back') go(i - 1);
    else if (b.dataset.g === 'next') i === STEPS.length - 1 ? dialog.close() : go(i + 1);
    else if (b.dataset.g === 'show') { dialog.close(); show(STEPS[i].show); }
  });
  dialog.addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
  });
  return { open(step = i) { go(step); if (!dialog.open) dialog.showModal(); main.focus(); } };
}
