// The session's levels and kill zones: PDH/PDL by the chart's rule, the zones on the day clock, the tags and the hunt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prevDayLevels, sessionLevels, levelsAt, levelTag, tagWord, huntSide, zoneAt, zoneOfMin, KILL_ZONES } from '../lab/labLevels.js';
import { nyEpoch } from '../engine/levels.js';
import { synthBars } from './helpers.mjs';

const M = 60000;

test('PDH and PDL are the last completed midnight-to-3pm New York window, never the afternoon after it', () => {
  const from = nyEpoch(2026, 9, 3, 18), to = nyEpoch(2026, 9, 11, 17);
  const bars = synthBars(from, to);
  const hiAt = nyEpoch(2026, 9, 9, 10, 30), lowAt = nyEpoch(2026, 9, 9, 13, 0), spikeAt = nyEpoch(2026, 9, 9, 16, 0);
  for (const b of bars) { if (b.t === hiAt) b.h = 20500; if (b.t === lowAt) b.l = 19500; if (b.t === spikeAt) b.h = 21000; }   // a 4 pm spike is outside the window
  const lv = prevDayLevels(bars, nyEpoch(2026, 9, 9, 18));
  assert.equal(lv.high, 20500); assert.equal(lv.highAt, hiAt);
  assert.equal(lv.low, 19500); assert.equal(lv.lowAt, lowAt);
  assert.equal(lv.day, '2026-9-9');
  assert.equal(prevDayLevels(bars, nyEpoch(2026, 9, 9, 14)).day, '2026-9-8', 'before 3 pm the previous day is still yesterday');
  const map = sessionLevels(bars, from, to);
  assert.equal(levelsAt(map, nyEpoch(2026, 9, 10, 2)).day, '2026-9-9', 'the session that opened Wed 6 pm reads Wednesday\'s window');
  assert.equal(prevDayLevels(bars.slice(0, 10), nyEpoch(2026, 9, 9, 18)), null, 'too few bars: no levels');
});

test('tags, the hunt and the kill zones', () => {
  const lv = { high: 20500, low: 19500, range: 1000 };
  assert.deepEqual([levelTag(20480, lv).tag, levelTag(19530, lv).tag, levelTag(20000, lv).tag, levelTag(20600, lv).side], ['PDH', 'PDL', null, 'above']);
  assert.equal(tagWord(levelTag(20000, lv)), 'between');
  assert.equal(tagWord(levelTag(19400, lv)), 'below PDL');
  assert.equal(tagWord(levelTag(20000, null)), 'no levels');
  assert.deepEqual(huntSide(20000, lv, 20100, 19900), { side: 'long', target: 20500, stop: 19500 }, 'neither tagged: the high is hunted first');
  assert.deepEqual(huntSide(20000, lv, 20600, 19900), { side: 'short', target: 19500, stop: 20500 }, 'the high tagged: the low');
  assert.equal(huntSide(20000, lv, 20600, 19400), null, 'both tagged');
  const at = (h, mi = 0) => nyEpoch(2026, 9, 9, h, mi);
  assert.equal(zoneAt(at(21)), 'asia'); assert.equal(zoneAt(at(3)), 'london'); assert.equal(zoneAt(at(9)), 'nyam'); assert.equal(zoneAt(at(14)), 'nypm');
  assert.equal(zoneAt(at(12)), null); assert.equal(zoneAt(at(19)), null);
  assert.equal(zoneOfMin(120), 'asia'); assert.equal(zoneOfMin(360), null);
  assert.equal(KILL_ZONES.length, 4);
});
