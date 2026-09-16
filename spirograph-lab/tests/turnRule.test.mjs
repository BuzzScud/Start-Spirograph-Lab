// The editable turn rule: settings kept in bounds, one id per settings, the default rule unchanged, each setting doing
// what it says, the luck bar, the held-back weeks, the network's input groups, and the routes on a synthetic bank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normRule, ruleId, ruleDiff, netMask, zonesOf, leadOf, DEFAULT_RULE, DEFAULT_ID, NET_GROUPS } from '../lab/turnRule.js';
import { realTurns, realTurnsByPeriod, gradeCall, turnReport, strictCI, holdStart, packCalls, unpackCalls } from '../lab/labTurns.js';
import { turnNetCheck, pHit, turnRow, TURN_INPUTS } from '../lab/labTurnNet.js';
import { sessionLevels, levelTag, zoneAt } from '../lab/labLevels.js';
import { closesFromBars } from '../engine/freeze.js';
import { nyEpoch } from '../engine/levels.js';
import { openBefore } from '../engine/dayClock.js';
import { createLab } from '../server/lab.mjs';
import { synthBars, makeBank } from './helpers.mjs';

const M = 60000, DAY = 86400e3;
const q = o => new URLSearchParams(o);

test('a rule is kept in bounds, and known by its settings, not its name', () => {
  const r = normRule({ name: '  Wide  ', tolShare: 9, swingFloor: 2.6, circles: [false, false, false, false, false, false], families: { daily: false, kalman: false }, zones: [{ id: 'asia', a: 300, b: 100, on: false }], net: { circle: false } });
  assert.equal(r.name, 'Wide');
  assert.equal(r.tolShare, 0.5, 'clamped'); assert.equal(r.swingFloor, 3, 'whole minutes');
  assert.ok(r.circles.every(Boolean) && r.families.daily && r.families.kalman, 'at least one circle and family: all back on');
  const asia = r.zones.find(z => z.id === 'asia');
  assert.equal(asia.on, false); assert.ok(asia.b > asia.a, 'an end before the start is moved past it');
  assert.equal(r.net.circle, false); assert.equal(r.net.size, true);
  assert.equal(ruleId({ ...DEFAULT_RULE, name: 'Anything' }), DEFAULT_ID, 'the name is only a label');
  assert.notEqual(ruleId({ ...DEFAULT_RULE, tolShare: 0.1 }), DEFAULT_ID);
  assert.equal(ruleId(normRule(JSON.parse(JSON.stringify(normRule({ tolShare: 0.1 }))))), ruleId({ tolShare: 0.1 }), 'survives JSON');
  assert.deepEqual(ruleDiff(DEFAULT_RULE), []);
  assert.deepEqual(ruleDiff({ tolShare: 0.1, circles: [true, true, true, true, false, false], zones: [{ id: 'london', on: false }], net: { levels: false } }),
    ['Hit window 10%', 'without 12m, 6m', 'London zone off', 'network without PDH / PDL']);
  assert.equal(netMask(DEFAULT_RULE), null, 'every group on: the walk the network always made');
  const m = netMask(normRule({ net: { zone: false } }));
  assert.deepEqual(m, TURN_INPUTS.map((_, j) => (j >= 5 && j <= 8 ? 0 : 1)));
  assert.equal(NET_GROUPS.flatMap(g => g.cols).length, TURN_INPUTS.length, 'every input is in one group');
  assert.equal(leadOf(DEFAULT_RULE, 240), 60); assert.equal(leadOf(DEFAULT_RULE, 6), 3, 'never inside the swing');
  assert.deepEqual(zonesOf(DEFAULT_RULE).map(z => z.hours), ['8 pm – 12 am', '2 – 5 am', '8:30 – 11 am', '1:30 – 4 pm']);
});

const from = nyEpoch(2026, 8, 24, 18), to = nyEpoch(2026, 9, 11, 17);
test('the default rule is the rule as built; each setting changes what it says', () => {
  const bars = synthBars(from, to), closes = closesFromBars(bars, from, to), levels = sessionLevels(bars, from, to), now = to + DAY;
  const base = realTurns(closes, 240), same = realTurns(closes, 240, normRule({}));
  assert.deepEqual([...same.t], [...base.t], 'default rule = no rule');
  assert.ok(realTurns(closes, 240, normRule({ swingShare: 0.3 })).n < base.n, 'a longer reach finds fewer turns');
  let s = 9; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const calls = Array.from({ length: 300 }, () => { const at = from + DAY + Math.floor(rnd() * (to - from - 2 * DAY) / M) * M; return { fam: 'daily', n: 1, P: 240, at, kind: rnd() < 0.5 ? 'peak' : 'trough', calledAt: at - 60 * M, A: 20 }; });
  const grade = rule => { const byP = realTurnsByPeriod(closes, [240], rule); return calls.map(c => gradeCall(c, byP.get(240), closes, levels, now, rule)); };
  const d0 = grade(undefined), d1 = grade(normRule({}));
  assert.deepEqual(d1, d0);
  const hits = g => g.filter(c => c.state === 'hit').length;
  assert.ok(hits(grade(normRule({ tolShare: 0.3 }))) > hits(d0), 'a wider window hits more');
  const late = grade(normRule({ swingShare: 0.5 })).filter(c => c.state === 'late').length;
  assert.ok(late > 0, 'a reach past the lead makes calls late');
  const noAsia = grade(normRule({ zones: [{ id: 'asia', on: false }] }));
  assert.ok(d0.some(c => c.zone === 'asia') && !noAsia.some(c => c.zone === 'asia'), 'a zone switched off tags nothing');
  const moved = normRule({ zones: [{ id: 'nyam', a: 900, b: 960 }] });
  assert.equal(zoneAt(nyEpoch(2026, 9, 2, 8, 45)), 'nyam'); assert.equal(zoneAt(nyEpoch(2026, 9, 2, 8, 45), zonesOf(moved)), null, 'nyam now starts at 9 am');
  const lv = { high: 20500, low: 19500, range: 1000 };
  assert.equal(levelTag(20460, lv).tag, 'PDH'); assert.equal(levelTag(20460, lv, normRule({ levelShare: 0.01, levelFloor: 1 })).tag, null, 'a narrower band');
  const rep = turnReport(d0.filter(c => c.state === 'hit' || c.state === 'miss'), realTurnsByPeriod(closes, [240]), closes, levels, { reps: 5 });
  assert.ok(rep.tallies.all.length >= 5 && rep.tallies.all.reduce((a, c) => a + c.n, 0) === rep.cells.all.n, 'the sessions behind the headline');
});

test('the luck bar rises with tries; the held-back weeks start at a 6 pm open; calls pack and unpack', () => {
  const tallies = Array.from({ length: 12 }, (_, i) => ({ k: 30 + (i % 5), n: 80 }));
  const one = strictCI(tallies, 1), ten = strictCI(tallies, 10);
  assert.ok(ten.lo < one.lo && ten.hi > one.hi, `wider with ten tries: ${JSON.stringify([one, ten])}`);
  assert.equal(one.level, 0.95); assert.equal(ten.level, 0.995);
  assert.ok(Number.isFinite(strictCI([{ k: 5, n: 10 }], 3).lo), 'one session: Wilson at the same level');
  const f = nyEpoch(2026, 7, 26, 18), t = nyEpoch(2026, 9, 16, 8);
  const h = holdStart(f, t);
  assert.equal(openBefore(h).ms, h); assert.ok(t - h >= 14 * DAY && t - h < 15 * DAY, 'two weeks held back');
  const short = holdStart(f, f + 9 * DAY);
  assert.ok(short > f + 5 * DAY, 'a short range holds back a third');
  const calls = [{ fam: 'kalman', n: 2, P: 120, at: 1e12, kind: 'trough', calledAt: 1e12 - 3e6, A: 3.14159, sdMin: 4.2, state: 'hit', off: -2.5, turnPx: 20001.25, zone: 'nyam', tag: 'at PDL', px: 20000.5 },
    { fam: 'daily', n: 0, P: 1440, at: 2e12, kind: 'peak', calledAt: 2e12 - 1e6, A: -12, state: 'ahead', zone: 'none', tag: null }];
  const back = unpackCalls(JSON.parse(JSON.stringify(packCalls(calls))));
  assert.deepEqual(back[0], { ...calls[0], A: 3.14 });
  assert.equal(back[1].state, 'ahead'); assert.equal(back[1].tag, null); assert.equal(back[1].off, null);
});

test('the network\'s input groups: off reaches it as zeros; its odds come from a fit before the session', () => {
  let s = 3; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const zones = ['asia', 'london', 'nyam', 'nypm', 'none'], t0 = nyEpoch(2026, 8, 3, 18);
  const calls = Array.from({ length: 500 }, (_, i) => {
    const zone = zones[Math.floor(rnd() * 5)], at = t0 + i * 47 * M, hit = zone === 'nyam' || rnd() < 0.2;
    return { fam: 'daily', n: 1, P: 240, at, kind: 'peak', calledAt: at - 60 * M, A: 10, zone, px: 20000, level: { high: 20100, low: 19900 }, state: hit ? 'hit' : 'miss', off: hit ? 3 : null };
  });
  const holdFrom = calls[400].at;
  const all = turnNetCheck(calls, { holdFrom }), blind = turnNetCheck(calls, { rule: normRule({ net: { zone: false } }), holdFrom });
  assert.ok(all.edge, all.verdict); assert.ok(!blind.edge, `without the zone it cannot see the pattern: ${blind.verdict}`);
  assert.equal(blind.masked, 4);
  assert.ok(all.learn.ready && all.hold.ready && all.learn.tested + all.hold.tested === all.tested, 'the score split at the held-back weeks');
  assert.ok(all.snaps.length > 1 && all.snaps.every((q, i) => !i || q.lastAt >= all.snaps[i - 1].lastAt));
  const snaps = JSON.parse(JSON.stringify(all.snaps));
  const late = calls[499], nyam = { ...late, zone: 'nyam' }, asia = { ...late, zone: 'asia' };
  assert.ok(pHit(snaps, nyam, late.at) > pHit(snaps, asia, late.at) + 0.2, 'the odds carry what it learned');
  assert.equal(pHit(snaps, late, t0), null, 'nothing before its first fit');
  assert.equal(pHit(snaps, { ...late, P: 6 }, late.at), null, 'the 6m circle is not learned');
  assert.equal(turnRow(late).length, TURN_INPUTS.length);
});

test('routes: preview, save, the ranking, the Forecast card under a rule', async t => {
  const U = 'CON.F.US.ENQ.U26', f0 = nyEpoch(2026, 8, 9, 18), t0 = nyEpoch(2026, 9, 4, 17);
  const bank = makeBank({ [U]: synthBars(f0, t0, { vol: 500 }) });
  t.after(bank.done);
  const lab = createLab({ bankFile: bank.file, labFile: bank.lab, inline: true, now: () => nyEpoch(2026, 9, 5, 12) });
  t.after(() => lab.close());
  const g = lab.startGrade({ series: U, from: nyEpoch(2026, 8, 30, 18), to: nyEpoch(2026, 9, 3, 18) });
  assert.equal(lab.lab.job(g.id).status, 'done', lab.lab.job(g.id).detail);
  let rank = lab.get('rules', q({ series: U, key: g.key })).body;
  assert.equal(rank.tries, 1, 'the grade scored the default rule');
  assert.equal(rank.rows[0].id, DEFAULT_ID); assert.ok(rank.rows[0].isDefault && rank.rows[0].strict.level === 0.95);
  const holdFrom = rank.holdFrom;
  assert.ok(holdFrom > nyEpoch(2026, 8, 30, 18) && holdFrom < nyEpoch(2026, 9, 3, 18));

  const wide = { name: 'Wide', tolShare: 0.25 };
  assert.throws(() => lab.startPreview({ series: U, key: 'nope', rule: wide }), /no such grade/);
  const p = lab.startPreview({ series: U, key: g.key, rule: wide });
  assert.equal(lab.lab.job(p.id).status, 'done', lab.lab.job(p.id).detail);
  assert.deepEqual(lab.get('preview', q({ series: U, key: g.key, rule: 'ffffffff' })).body, { none: true });
  const pv = lab.get('preview', q({ series: U, key: g.key, rule: p.rule })).body;
  assert.ok(pv.preview && pv.learn.cells.all.n > 0 && pv.learn.reps === 20);
  assert.equal(pv.hold, undefined, 'a preview has no held-back part');
  assert.equal(pv.calls, undefined);
  assert.equal(lab.get('rules', q({ series: U, key: g.key })).body.tries, 1, 'a preview is not a try');
  assert.deepEqual(lab.startPreview({ series: U, key: g.key, rule: wide }), { cached: true, rule: p.rule });

  const s = lab.startTurns({ series: U, key: g.key, rule: wide });
  assert.equal(s.rule, p.rule);
  assert.equal(lab.lab.job(s.id).status, 'done', lab.lab.job(s.id).detail);
  assert.deepEqual(lab.startPreview({ series: U, key: g.key, rule: wide }), { saved: true, rule: p.rule });
  assert.deepEqual(lab.startTurns({ series: U, key: g.key, rule: { ...wide, name: 'Wider' } }), { cached: true, rule: p.rule }, 'the same settings: renamed, not scored again');
  rank = lab.get('rules', q({ series: U, key: g.key })).body;
  assert.equal(rank.tries, 2);
  assert.ok(rank.rows.every(r => r.strict.level === 0.975), 'the bar rose');
  const w = rank.rows.find(r => r.id === p.rule);
  assert.equal(w.name, 'Wider'); assert.deepEqual(w.diff, ['Hit window 25%']);
  assert.ok(w.learn.all.rate > rank.rows.find(r => r.isDefault).learn.all.rate, 'a wider window hits more');
  assert.ok(w.hold.all && w.hold.all.n > 0 && !('tallies' in w.hold));
  const rs = rank.rows.map(r => (r.hold.all ? r.hold.all.skill : -Infinity));
  assert.ok(rs.every((v, i) => !i || v <= rs[i - 1]), 'strongest first');
  assert.ok(rank.saved.some(x => x.id === p.rule && x.name === 'Wider'));
  assert.equal(lab.get('rule', q({ id: p.rule })).body.rule.tolShare, 0.25);

  const tw = lab.get('turns', q({ series: U, key: g.key, rule: p.rule })).body;
  assert.ok(tw.learn && tw.hold && tw.report && tw.net.hold && !tw.net.snaps && !tw.calls, 'the report, without the calls or weights');
  assert.equal(tw.rule.tolShare, 0.25);
  assert.equal(lab.get('turns', q({ series: U, key: g.key, rule: 'ffffffff' })).status, 404);

  const open = nyEpoch(2026, 9, 2, 18);
  const dd = lab.get('dayturns', q({ series: U, open })).body, dw = lab.get('dayturns', q({ series: U, open, rule: p.rule })).body;
  assert.equal(dd.rule.id, DEFAULT_ID); assert.equal(dw.rule.id, p.rule); assert.equal(dw.rule.tolShare, 0.25);
  assert.equal(dw.rules.length, 2);
  assert.equal(dw.held, open >= holdFrom);
  assert.ok(dw.calls.length > 50 && dw.calls.every(c => 'net' in c && 'earned' in c));
  assert.ok(dw.calls.filter(c => c.P < 24).every(c => c.net === null), 'no odds for circles the network does not learn');
  assert.equal(lab.get('dayturns', q({ series: U, open, rule: 'ffffffff' })).body.rule.id, DEFAULT_ID, 'an unknown rule falls back to the default');
  const noKal = lab.startTurns({ series: U, key: g.key, rule: { name: 'Daily only', families: { kalman: false }, zones: [{ id: 'london', on: false }] } });
  assert.equal(lab.lab.job(noKal.id).status, 'done');
  const dk = lab.get('dayturns', q({ series: U, open, rule: noKal.rule })).body;
  assert.ok(dk.calls.length && dk.calls.every(c => c.fam === 'daily'), 'a family switched off calls nothing');
  assert.deepEqual(dk.zones.map(z => z.id), ['asia', 'nyam', 'nypm']);
  assert.equal(lab.post('turns', { series: U, key: 'nope' }).status, 400);
});
