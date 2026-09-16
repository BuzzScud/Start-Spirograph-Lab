# Spirograph Lab

A standalone app for the Spirograph's Daily set circles (1D · 4H · 2H · 24m · 12m · 6m). It has three views:

- **Day player:** pick any stored day and watch the circles replay it minute by minute. Two fits:
  - *refit each minute* is what the Spirograph showed live.
  - *held from 6 pm* keeps the 6 pm circles all day, which makes it a real forward test.
- **Multi-day grade:** pick a date range. Every 3 hours in it, the circles forecast the next 3 hours using only earlier prices, and each forecast is checked against the market. The page gives one verdict: path vs a flat line, direction vs always guessing the usual way, turns vs a random market.
- **Edge check:** tests whether a small learner can find anything in those forecasts. If it can't, a neural network would only memorise noise.

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
- **Results:** built days and grades are saved in `data/lab.db` in this folder (`LAB_DB` to move it). A day takes about 15 s to build the first time and opens at once after that.
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
lab/      labDay.js (day replay), labEdge.js (edge check), labSeries.js (front month), labPlayer.js, util.js
public/   index.html, app.js, style.css
engine/   the Ladder's engine, copied
tests/    npm test
```
