# Spirograph Lab

A standalone app for the Spirograph's Daily set circles (1D · 4H · 2H · 24m · 12m · 6m). It has three views:

- **Day player:** pick any stored day and watch the circles replay it minute by minute.
  - The pen is always **held**: fitted once at the time on the green **Pen from** button: 6 pm (the Globex open) by default. Its menu offers the London open, the New York open and close, your own time, or a box to type any quarter-hour. It's fitted only on bars before that time, then kept to 6 pm.
  - Under the circles, an overview of the whole day and a 2/4/8-hour close-up that follows the playhead. Click or drag either to move; hover the close-up to read any minute. Slow (turtle) plays a day in 3 minutes, fast (rabbit) in 30 seconds.
- **Multi-day grade:** pick a date range. Every 3 hours in it, the circles forecast the next 3 hours using only earlier prices, and each forecast is checked against the market. The page gives one verdict: path vs a flat line, direction vs always guessing the usual way, turns vs a random market.
- **Edge check:** tests whether a small learner can find anything in those forecasts. If it can't, a neural network would only memorise noise.
  - Below it, a real **neural network** (12 inputs → 8 hidden → up and size) trains live in the page on the grade's forecasts. Its inputs are the circles' numbers and the time the pen was frozen. It learns only from forecasts before each call.
  - The server trains the same network when the grade is built. When the page finishes, it checks that its run matches the server's.
  - Grades built before the network show "Rebuild the grade": grade the same range again.

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
- **Results:** built days and grades are saved in `data/lab.db` in this folder (`LAB_DB` to move it). A day takes a few seconds to build the first time (a held pen from every quarter-hour) and opens at once after that. Days built by an older version are built again when opened.
- **Instruments:**
  - **Front month** stitches a product's contracts together. Each session uses whichever contract traded the most in the session before. At a roll, older prices are shifted by the gap between the two contracts, so price moves (and grades) are unchanged.
  - **Single contract** reads one contract only.

## The engine

`engine/` is a copy of the Ladder's own files (see `engine/FROM-LADDER-COMMIT`), so the circles are fitted exactly as the Ladder fits them. Later Ladder changes don't affect the Lab until you copy them in again:

```
cp ~/Desktop/MAIN2026/desks/ladder/src/{anchors,backtest,band,bandShadow,cmeHolidays,constants,dailySet,dailyTest,dayClock,fire,fit,forecast,format,freeze,ladderFilter,levels,rng,session,sim,stats,structure}.js engine/
npm test
```

## Layout

```
server/   server.mjs (http + static), lab.mjs (API + job queue), labJob.mjs, worker.mjs, labStore.mjs
lab/      labDay.js (day replay), labEdge.js (edge check), labNet.js (neural network), labSeries.js (front month), labPlayer.js, util.js
public/   index.html, app.js, net.js (network panel), style.css (turtle and rabbit icons: Lucide, ISC)
engine/   the Ladder's engine, copied
tests/    npm test
```
