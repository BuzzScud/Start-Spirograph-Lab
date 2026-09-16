# Start Spirograph Lab

A standalone app for the Spirograph's Daily set circles: replay any stored day minute by minute, grade the circles' 3-hour forecasts over many days, and check whether a learner can find anything in them.

- **Start:** double-click `Start Spirograph Lab.command` (macOS, Node 24+), or `cd spirograph-lab && npm run open`. It opens http://127.0.0.1:17480.
- **Details:** see [spirograph-lab/README.md](spirograph-lab/README.md).
- `spirograph-yesterday-2026-09-14.html` is the original one-day replay page the app grew from.

Prices come from the Ladder's stored 1-minute bars (`MAIN2026/desks/ladder/data/ladder.db`), read-only.

## Turn rules (editable turn rule, ranked)

The **Turn rules** tab makes every setting of the turn forecaster editable (`lab/turnRule.js`): the hit window, the swing reach,
the Kalman lead, the smallest circle, which circles and families are forecast, the four kill zones, the PDH/PDL band, and the
input groups the turn network learns from. A rule is known by a hash of its settings.

- **Preview** scores a rule on a grade's *learning weeks* only (about 6 s). It is not a try and never reads the held-back weeks.
- **Save and score** scores it on every week (about 15 s, no new grade) and adds it to the **Rule ranking**, which orders rules
  by skill (hit rate minus the hardest null) on the *held-back weeks*, the last two weeks of the range. Each saved rule is a try;
  a rule clears only if its range sits above the null at 95% ÷ tries.
- **Use on Forecast** makes a rule the Forecast card's: its calls, kill zones and grading windows, with the turn network's odds
  (trained under that rule, as it stood before the session) next to the earned confidence.

Turns results are kept per rule (`TURNS_VERSION` 2); a grade built before this shows a **Score the turns** button instead of
needing a new grade.
