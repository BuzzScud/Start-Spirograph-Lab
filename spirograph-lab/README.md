# Spirograph Lab

A standalone app for the Spirograph's Daily set circles (1D · 4H · 2H · 24m · 12m · 6m). It has three views:

- **Day player:** pick any stored day and watch the circles replay it minute by minute.
  - The pen is always **held**: fitted once at the time on the green **Pen from** button: 6 pm (the Globex open) by default. Its menu offers the London open, the New York open and close, your own time, or a box to type any quarter-hour. It's fitted only on bars before that time, then kept to 6 pm.
  - Under the circles, an overview of the whole day and a 2/4/8-hour close-up that follows the playhead. Click or drag either to move; hover the close-up to read any minute. Slow (turtle) plays a day in 3 minutes, fast (rabbit) in 30 seconds.
  - **Forecast card** (third column): the turns the circles call from the playhead on, each with its circle, ▼ peak / ▲ trough, the level it points at (PDH for a peak, PDL for a trough), its ICT kill zone and an **earned confidence**: that circle's hit rate in that zone on the graded record before this day. Each call is graded as the day plays. Pick **Both / Daily / Kalman** for the circle family and **Circles** to hide the fastest ones. The close-up draws PDH and PDL (dotted amber), the kill zones (amber wash) and the calls (triangles: filled hit, crossed miss, faint ahead). The calls come from the newest Multi-day grade covering the day.
- **Multi-day grade:** pick a date range. Every 3 hours in it, the circles forecast the next 3 hours using only earlier prices, and each forecast is checked against the market. The page gives one verdict: path vs a flat line, direction vs always guessing the usual way, turns vs a random market.
  - **Turns at the levels:** every turn the circles called, graded with a rule that first finds the market's **real turns** (a swing high or low on one-minute closes that no close within ⅛ of the circle's lap beats): a hit is a real turn of the same kind within ⅛ lap (at least a minute) of the call, and a call made after the swing's window opened is not graded. Two circle families side by side: the **Daily set** (phases locked to 6 pm, called at each 3-hour slot) and the **Kalman rungs** (the Ladder's filter on the same six periods, phases free, each turn called a quarter lap ahead of every closed minute). Three measured nulls (the same calls at random minutes of their session; at the same clock time a session earlier and later; the real turns shifted round the session), skill above the hardest one, ranges bootstrapped over sessions. Every call is tagged with its **ICT kill zone** (Asia 8 pm–12 am, London 2–5 am, New York AM 8:30–11, New York PM 1:30–4, New York time) and where the market stood against **PDH and PDL** (the previous day's 00:00–15:00 high and low, the Trading Platform's chart rule) when the turn was due. The verdict says how many cells would clear the bar by luck. The **turn network** at the bottom is the Edge check's network retargeted to one graded call per row, scored by its Brier score against the base rate.
- **Edge check:** tests whether anything can learn from those forecasts. If a small learner can't, a bigger neural network would only memorise noise.
  - **The race:** every caller (always up, the pen, three small learners, the neural network) as right calls beyond always guessing the usual way, call by call, inside the grey band luck alone reaches. Hover to read a call; click one to open its full wiring.
  - **The scoreboard** doubles as the race's legend: each caller's rate against the luck band, points, and a strip of every call (green right, red wrong). Click a caller to pick out its line.
  - **The network panel** keeps the neural network (12 inputs → 8 hidden → up and size) simple:
    - its result, and **Watch it learn**, which replays its line on the race;
    - **What it looks at**: four switches (the six circles, how well they fit, the pen's own move, time of day). Turn one off and it retrains by itself into a dashed "test run" line, and says whether that input mattered;
    - **The call under your pointer**: what it said, what happened, and the inputs that pushed it most.
  - The page trains the network itself, with the same code the server ran when the grade was built, and checks that both runs match.
  - **Full wiring and math** opens a big pop-up: the network diagram with Train/Step, the loss and a call slider. Click any node or line for its math on the call shown. An input opens a two-column pop-up. On the left: a what-if value for that call, presets (flip the call, or P(up) 10–90%) that show the value each one needs, and a retrain switch (Real, Shuffled, Negated, Left out). On the right: the answer, a curve of P(up) for every value of that input with each preset pinned on it, and the math in four steps. What-if edits never touch training; a retrain is marked as not comparable to the server's run.
  - Grades built before this version show "grade too old": press **Grade this range again**.

### What the turn rule found (16 Sep 2026, NQ front month, 12 Jul – 16 Sep)

Both families sit exactly on their nulls: the Daily set hit 35% of 24,600 real turns against 35% for the hardest null, the Kalman rungs 34% of 25,900 against 34%. No circle, zone or level cell clears its null beyond what luck predicts across that many cells, and the turn network is no better than the base rate. The Forecast card's confidences are therefore a record, not a promise: read them as "this is how often this call has come true", which so far is as often as a random minute would.

## Start it

Double-click **Start Spirograph Lab.command**, or:

```
cd "~/Desktop/16SEP SPRIOGRAPHY/spirograph-lab"
npm run open        # starts http://127.0.0.1:17480 and opens it
```

It needs Node 24 or newer and has no packages to install. Stop it with Ctrl-C in its window.

## Where the data comes from

- **Prices:** the Ladder's stored 1-minute bars in `~/Desktop/MAIN2026/desks/ladder/data/ladder.db`, opened **read-only**. The Lab never writes there.
  - It sees new days as the Ladder stores them.
  - Set `LAB_BANK` to use another copy.
- **Results:** built days, grades and their turns results are saved in `data/lab.db` in this folder (`LAB_DB` to move it). A day takes a few seconds to build the first time (a held pen from every quarter-hour) and opens at once after that. Days built by an older version are built again when opened.
- **Instruments:**
  - **Front month** stitches a product's contracts together. Each session uses whichever contract traded the most in the session before. At a roll, older prices are shifted by the gap between the two contracts, so price moves (and grades) are unchanged.
  - **Single contract** reads one contract only.

## Nightly backup

`lab.db` is copied to the BAY2 drive every night at 23:30. If the Mac is asleep at that time, the copy runs when it wakes.

- **Where:** `/Volumes/BAY2/SPIROGRAPH LAB BACKUP/`
  - `latest/` holds tonight's copy.
  - `previous/` holds the night before's.
  - Each copy is a checked snapshot, safe to take while the Lab is running, with a `backup.json` beside it.
- **Drive unplugged:** it copies nothing and logs "not plugged in".
- **Log:** `data/backup.log`. Launcher errors go to `~/Library/Logs/spirograph-lab-agents.log`.
- **Commands:** `npm run backup` (now, by hand) · `npm run service:install` | `service:status` | `service:uninstall`. The job is saved with this Mac's Node path, so install it again after a Node upgrade.
- **Restore:**
  1. Stop the Lab.
  2. Delete `data/lab.db-wal` and `data/lab.db-shm`.
  3. Copy `latest/lab.db` over `data/lab.db`.
  4. Start the Lab.

## The engine

`engine/` is a copy of the Ladder's own files (see `engine/FROM-LADDER-COMMIT`), so the circles are fitted exactly as the Ladder fits them. Later Ladder changes don't affect the Lab until you copy them in again:

```
cp ~/Desktop/MAIN2026/desks/ladder/src/{anchors,backtest,band,bandShadow,cmeHolidays,constants,dailySet,dailyTest,dayClock,fire,fit,forecast,format,freeze,ladderFilter,levels,rng,session,sim,stats,structure}.js engine/
npm test
```

## Layout

```
server/   server.mjs (http + static), lab.mjs (API + job queue), labJob.mjs, worker.mjs, labStore.mjs, backup.mjs
scripts/  backup.mjs (the nightly copy), service.mjs (its launchd job), agent.mjs (launcher)
lab/      labDay.js (day replay), labEdge.js (edge check), labNet.js (neural network), labSeries.js (front month), labPlayer.js, util.js
public/   index.html, app.js, edge.js + edge.css (Edge check tab), net.js (network panel), style.css (turtle, rabbit, play and pop-up icons: Lucide, ISC)
engine/   the Ladder's engine, copied
tests/    npm test
```
