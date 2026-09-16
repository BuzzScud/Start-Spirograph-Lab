// The Day player walkthrough (16 Sep, on request: "ensure the day player has one too"). Same pop-up as the Edge check's
// (public/edgeHelp.js mountWalkthrough): what you see, how it is made, and something to try, with "Show me" on the page.
import { mountWalkthrough } from '/edgeHelp.js';

const code = s => `<code>${s}</code>`;
const f = s => `<span class="hpFile">${s}</span>`;
const STEPS = [
  { t: 'The big picture', short: 'Big picture', k: 'Start here', show: null, body: `
    <p>The Day player replays <b>one trading session</b>, 6 pm to 6 pm New York, a minute at a time. It shows the Daily set’s six nested circles turning, and a <b>pen</b> drawing where they say the price should be, beside what the market really did.</p>
    <div class="hpFlow"><span>Instrument</span><i>→</i><span>Day<small>one session</small></span><i>→</i><span>Build<small>fit the pen every 15 min</small></span><i>→</i><span>Play<small>minute by minute</small></span><i>→</i><span>Score<small>pen vs flat price</small></span></div>
    <div class="hpTry"><b>The tab in three parts</b><ol><li>Top left: the circles themselves.</li><li>Top right: the rail, with the clock, prices and the score.</li><li>Below: the controls, an overview of the whole day, and a close-up chart.</li></ol></div>` },

  { t: 'Pick a day and build it', short: 'Pick and build', k: 'Where the data comes from', show: 'toolbar', body: `
    <p>Choose an <b>Instrument</b> at the top, then a <b>Day</b>. Days marked <em>built</em> open straight away. Otherwise press <b>Build</b> (a few seconds).</p>
    <p><b>Building</b> fits the circles at <b>every quarter-hour</b> of the day, each time only on bars that closed before that moment. It keeps each fit and the pen it draws for the rest of the day. That way you can hold the pen from any quarter-hour later without building again.</p>
    <p>A day needs at least 60 traded minutes, and about two weeks of bars before it (the slowest circle, 1D, fits over several days).</p>
    <div class="hpHow"><b>How it is made</b> ${f('app.js')} asks the server to build; the server runs ${code('replayDay()')} in ${f('lab/labDay.js')}, which drives the Daily set’s own sim (${f('engine/dailyTest.js')}). The finished day is handed to ${code('player.set(day)')} in ${f('lab/labPlayer.js')}.</div>
    <div class="hpTry"><b>Rebuild</b> appears on a built day: use it after the engine changes.</div>` },

  { t: 'The circles', short: 'The circles', k: 'The drawing', show: 'sheet', body: `
    <p>Six circles, each riding on the rim of the one before, each <b>half the size</b> of its parent:</p>
    <table class="ghTable hpTable"><tr><th>Circle</th><th>One turn takes</th></tr>
      <tr><td>1D</td><td>the whole day (1440 minutes)</td></tr><tr><td>4H</td><td>4 hours</td></tr><tr><td>2H</td><td>2 hours</td></tr>
      <tr><td>24m</td><td>24 minutes</td></tr><tr><td>12m</td><td>12 minutes</td></tr><tr><td>6m</td><td>6 minutes</td></tr></table>
    <p>Each arm points at <b>speed × minutes since 6 pm</b>, turning clockwise from 12 o’clock. Every period divides the day evenly, so at 6 pm, start and end, <b>every arm points straight up</b>. The dot on the last rim is the pen.</p>
    <div class="hpHow"><b>How it is made</b> A canvas in ${f('lab/labPlayer.js')}, redrawn every frame. The circles’ colours come from ${code('COLORS')} in ${f('engine/constants.js')}.</div>` },

  { t: 'The rail', short: 'The rail', k: 'Numbers beside the drawing', show: 'rail', body: `
    <ul class="ghList hpList"><li><b>Clock</b> and a bar for how far through the day you are.</li>
      <li><b>Market, Pen, Market − pen</b> at the time shown. Green gap: the market is above the pen; red: below.</li>
      <li><b>The six circles</b>: how far through its current lap each is, which turn of the day it is on (e.g. 3/6), and its size as fitted at the hold. <b>▲</b> rises first after each restart, <b>▼</b> falls first. “no bars” means that circle had nothing to fit on (weekends).</li>
      <li><b>How the held pen did</b>: see step 7.</li></ul>` },

  { t: 'The held pen', short: 'Pen from', k: 'The one idea to get', show: 'hold', body: `
    <p>The pen is only ever <b>held</b>: the circles are fitted <b>once</b>, at the hold time, then kept unchanged for the rest of the day. Before the hold the pen has nothing to say.</p>
    <p>The <b>Pen from</b> button picks the hold: Globex open (6 pm), London open, New York open, New York close, or any other quarter-hour up to 4:45 pm.</p>
    <p>The pen starts at: <b>the last close before the hold</b> + <b>the fit’s trend</b> since that close (traded minutes only) + <b>where the circles stand</b>.</p>
    <div class="hpTry"><b>Try it</b> Hold from <b>New York open</b> and play the afternoon. Does the green pen track the white market better than the dashed flat line?</div>
    <div class="hpHow"><b>How it is made</b> ${code('penAt(day, hold, minute)')} in ${f('lab/labDay.js')} reads the stored pen (a point every 5 minutes) and blends between points.</div>` },

  { t: 'Playing it', short: 'Controls', k: 'The control bar', show: 'deck', body: `
    <table class="ghTable hpTable"><tr><td><b>Play / Pause</b></td><td>or press Space</td></tr>
      <tr><td><b>Speed</b></td><td>turtle: a day in 3 minutes · rabbit: a day in 30 seconds</td></tr>
      <tr><td><b>Close-up</b></td><td>how many hours around the playhead the lower chart shows: 2, 4 or 8</td></tr>
      <tr><td><b>Camera</b></td><td>Whole shows every circle; Fast circles follows the 24m and the two inside it</td></tr>
      <tr><td><b>Trail</b></td><td>the pen’s path over the last two hours, fading in toward now</td></tr>
      <tr><td><b>← →</b></td><td>a minute back or forward; hold Shift for 15 minutes</td></tr></table>` },

  { t: 'Overview and close-up', short: 'The charts', k: 'Market vs pen', show: 'chart', body: `
    <p>The thin <b>overview</b> strip is the whole day, with Asia, London and New York shaded. Click or drag it to jump; the box shows what the close-up covers.</p>
    <p>The <b>close-up</b> chart shows the hours around the playhead:</p>
    <ul class="ghList hpList"><li><b>White</b>: the market.</li><li><b>Green</b>: the pen, from its hold on.</li><li><b>Dashed</b>: the price at the hold, kept flat. The yardstick.</li></ul>
    <div class="hpTry"><b>Try it</b> Hover the close-up to read the market, the pen and the gap at any minute.</div>` },

  { t: 'The score', short: 'The score', k: 'Did the pen help?', show: 'rail', body: `
    <p>Under <b>How the held pen did</b>, from the hold to 6 pm:</p>
    <div class="hpEq"><b>Pen’s miss</b> √( average of (market − pen)² )
      <b>Flat miss</b> √( average of (market − hold price)² )</div>
    <p>If the pen’s miss is <b>smaller</b> than the flat miss, the circles beat simply assuming the price stays put. <b>Fit explains</b> is how much of the recent price movement the fit captured (on data it held out), and <b>Fit residual</b> is its typical miss.</p>
    <div class="hpTry"><b>Mind the sample</b> One day is one day. To see if the pen beats flat regularly, use the <b>Multi-day grade</b> tab.</div>
    <div class="hpHow"><b>How it is made</b> ${code('holdScore()')} in ${f('lab/labDay.js')}.</div>` },

  { t: 'The Forecast card', short: 'Forecast', k: 'The turns ahead', show: 'cast', body: `
    <p>The third card beside the circles lists the <b>turns the circles call</b> from the playhead on, and grades each one the moment its window closes as the day plays.</p>
    <ul class="ghList hpList"><li><b>PDH / PDL</b>: the previous day's high and low (midnight to 3 pm New York, the Trading Platform's rule), with the distance from the market now. <b>Kill zone</b>: the ICT window you are in, or the next one.</li>
      <li><b>Each row</b>: the time, the circle, ▼ peak or ▲ trough with the level it points at (a peak at PDH, a trough at PDL), the kill zone, and a <b>confidence</b>. That confidence is <b>earned</b>: the hit rate of that circle in that zone on the graded record before this day. No record, no number.</li>
      <li><b>Both / Daily / Kalman</b> picks the circle family; <b>Circles</b> hides the fastest ones, which call a turn every few minutes.</li>
      <li>On the close-up, PDH and PDL are dotted amber lines, the kill zones an amber wash with a named strip, and each call a small triangle: filled when it hit, crossed when it missed, faint while still ahead.</li></ul>
    <p>The calls come from the newest <b>Multi-day grade</b> whose range holds this day. A day with no grade over it shows an empty card: grade a range that includes it.</p>
    <div class="hpHow"><b>How it is made</b> The server answers ${code('dayturns')} from the grade's turns result (${f('lab/labTurns.js')}, ${f('lab/labKalman.js')}, ${f('lab/labLevels.js')}); ${code('drawCast()')} in ${f('lab/labPlayer.js')} paints it.</div>` },

  { t: 'How the tab is built', short: 'Code map', k: 'The code map', show: null, body: `
    <table class="ghTable hpTable"><tr><th>File</th><th>Job</th></tr>
      <tr><td>${f('index.html')}</td><td>the Day toolbar and the empty ${code('#player')}</td></tr>
      <tr><td>${f('app.js')}</td><td>lists days, starts builds and watches them, loads a built day</td></tr>
      <tr><td>${f('lab/labDay.js')}</td><td>pure: builds a day (a fit every quarter-hour), ${code('penAt')}, ${code('holdScore')}</td></tr>
      <tr><td>${f('lab/labPlayer.js')}</td><td>the whole player: circles, rail, controls, overview, close-up</td></tr>
      <tr><td>${f('engine/dailyTest.js')}</td><td>the Daily set’s sim the build drives</td></tr></table>
    <p>That’s the whole tab. Press <b>Done</b>, pick a day and press play.</p>` },
];

export const createDayHelp = (dialog, { show }) => mountWalkthrough(dialog, { title: 'How the Day player works', steps: STEPS, show });
