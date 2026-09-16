// The Turn rules tab (16 Sep, on request: "make the rule editable · make the forecast modular, based on the neural
// network · re-arrange rules by strength, as another grade"). Three parts on the grade picked on Multi-day grade:
//
//   Rule ranking   every rule scored on the range, strongest first on its HELD-BACK weeks (the last two weeks, which a
//                  preview never reads), each held to a luck bar that rises with the number of rules tried
//   The editor     every setting of the turn rule (lab/turnRule.js) and the network's input groups
//   The result     a PREVIEW on the learning weeks (not a try, the held-back weeks stay unread), or the saved result
//                  of a rule already scored, both against the default rule row by row
//
// Save scores the rule on every week and adds it to the ranking; "Use on Forecast" makes it the Forecast card's rule.
import { esc, pct, int, dayMonth, tradeDay } from '/lab/util.js';
import { normRule, ruleId, ruleDiff, DEFAULT_RULE, DEFAULT_ID, RULE_FIELDS, NET_GROUPS, CIRCLE_WORDS, FAMILY_IDS, spanWord } from '/lab/turnRule.js';
import { KILL_ZONES } from '/lab/labLevels.js';
import { COLORS } from '/engine/constants.js';

const FAMW = { daily: 'Daily set', kalman: 'Kalman rungs' };
const NULLW = { random: 'random minutes', clock: 'same clock, other day', shift: 'turns shifted' };
const pts = x => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(100 * x).toFixed(1)}` : '—');
const brier = x => (Number.isFinite(x) ? x.toFixed(3) : '—');
// a day-clock minute (since 6 pm New York) and the time box's "HH:MM" New York
const toTime = m => { const t = (m + 1080) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const fromTime = (v, end) => { const [h, mi] = String(v).split(':').map(Number); if (!Number.isFinite(h)) return null; const m = (h * 60 + (mi || 0) - 1080 + 1440) % 1440; return end && m === 0 ? 1380 : Math.min(m, 1380); };

export function createRulesView(el, { api, toast, watch, getSeries, useRule, getUsed, onSaved = () => {} }) {
  const S = { grade: null, rank: null, def: null, rule: normRule(DEFAULT_RULE), shown: null, busy: '', job: 0, err: '' };
  el.innerHTML = `
    <section class="gCard flush rRank" data-r="rank"></section>
    <div class="rGrid">
      <section class="gCard rEdit" data-r="edit" aria-label="Edit the turn rule"></section>
      <section class="gCard rOut" data-r="out" aria-live="polite"></section>
    </div>
    <details class="gCard rAbout" data-r="about"><summary><h3>How rules are tried and ranked</h3></summary>
      <ol>
        <li><b>Edit</b> any setting on the left. The id beside the name changes with the settings, so the same settings are always the same rule.</li>
        <li><b>Preview</b> scores the rule on the <b>learning weeks</b> only, about 6 seconds. It is free: it is not counted as a try, and it never reads the held-back weeks.</li>
        <li><b>Save and score</b> scores it on every week, about 15 seconds, and adds it to the ranking. Each saved rule is one <b>try</b>.</li>
        <li>The ranking puts the rules in order by their skill on the <b>held-back weeks</b>: the hit rate minus the hardest of the three nulls, on the last two weeks of the range.</li>
        <li>To <b>clear</b>, a rule's whole range on the held-back weeks must sit above that null at 95% ÷ tries. With 5 rules tried each needs 99%: trying many rules cannot make one of them win by luck.</li>
        <li><b>Use on Forecast</b> makes a rule the Day player's Forecast card rule: its calls, its kill zones, its earned confidence, and the network's odds with that rule's inputs.</li>
      </ol>
    </details>`;
  const $ = k => el.querySelector(`[data-r="${k}"]`);
  const series = () => getSeries();
  const q = o => new URLSearchParams({ series: series(), key: S.grade.key, ...o }).toString();

  // ------------------------------------------------------------ loading
  async function set(grade) {
    S.grade = grade ? { key: `${grade.from}-${grade.to}`, from: grade.from, to: grade.to, name: grade.name } : null;
    S.rank = null; S.def = null; S.shown = null; S.err = '';
    if (!S.grade) { $('rank').innerHTML = ''; paintOut(); return; }
    await refresh();
    show();
  }
  async function refresh() {
    const key = S.grade.key;
    try {
      const [rank, def] = await Promise.all([api(`rules?${q({})}`), api(`turns?${q({ rule: DEFAULT_ID })}`).catch(e => ({ error: e.message }))]);
      if (!S.grade || S.grade.key !== key) return;
      S.rank = rank; S.def = def.error ? null : def; S.err = '';
    } catch (e) { S.err = e.message; }
    paintRank(); paintEdit();
  }

  // ------------------------------------------------------------ the ranking
  function paintRank() {
    const box = $('rank'), r = S.rank;
    if (!r) { box.innerHTML = `<div class="msg">${esc(S.err || 'reading the ranking…')}</div>`; return; }
    const used = getUsed(), g = S.grade;
    const lvl = n => `${+(100 - 5 / Math.max(1, n)).toFixed(2)}%`;
    const head = `<div class="gCardHead"><h3>Rule ranking <span>the held-back grade · ${esc(g.name || '')} · learning ${dayMonth(g.from)} → ${r.holdFrom ? tradeDay(r.holdFrom - 86400e3) : '—'} · held back ${r.holdFrom ? `${tradeDay(r.holdFrom)} → ${dayMonth(g.to)}` : '—'}</span></h3>
      <span class="gKey"><span><b class="rTries">${r.tries}</b> rule${r.tries === 1 ? '' : 's'} tried</span><span>each must clear at <b>${lvl(r.tries)}</b></span></span></div>`;
    if (!r.rows.length) {
      box.innerHTML = head + `<div class="msg">No rule is scored on this range yet. <button type="button" class="btn sm pri" data-a="scoreDefault">Score the default rule</button> <span class="hint">about 15 seconds, and it becomes the first row</span></div>`;
      return;
    }
    const cell = (c, strong) => (c ? `<td class="num">${pct(c.rate)}</td><td class="num mut">${pct(c.hardest)}</td><td class="num ${!c.judged ? 'muted' : c.skill > 0 ? 'ok' : c.skill < 0 ? 'bad' : ''}">${strong ? '<b>' : ''}${pts(c.skill)}${strong ? '</b>' : ''}</td>` : '<td>—</td><td>—</td><td>—</td>');
    const verdict = x => (!x.hold.all || x.hold.all.n < 30 ? '<span class="pill">Too few to judge</span>' : x.strict.clears ? '<span class="pill ok">✓ Clears</span>' : x.hold.all.skill > 0 ? '<span class="pill amber">Ahead, within luck</span>' : '<span class="pill bad">✕ No skill</span>');
    const net = x => { const h = x.net && x.net.hold; return h && h.ready ? `<td class="num ${h.edge ? 'ok' : h.gain < 0 ? 'bad' : ''}">${brier(h.brier)} <i>vs ${brier(h.brierBase)}</i></td>` : '<td class="muted">—</td>'; };
    box.innerHTML = head + `<div class="table"><table>
      <colgroup><col style="width:44px"><col><col span="3" style="width:70px"><col span="3" style="width:70px"><col style="width:160px"><col style="width:150px"><col style="width:230px"></colgroup>
      <thead><tr class="grp"><th></th><th></th><th colspan="3">Learning weeks</th><th colspan="3">Held-back weeks</th><th>Luck bar</th><th>Network</th><th></th></tr>
      <tr><th>#</th><th>Rule</th><th>Hit</th><th>Null</th><th>Skill <i>pts</i></th><th>Hit</th><th>Null</th><th>Skill <i>pts</i></th><th>At ${lvl(r.tries)}</th><th>Held-back Brier</th><th></th></tr></thead>
      <tbody>${r.rows.map((x, i) => `<tr class="${S.rule && ruleId(S.rule) === x.id ? 'on' : ''}">
        <td class="num">${i + 1}</td>
        <td class="rName"><b>${esc(x.name)}</b>${x.isDefault ? ' <span class="pill">default</span>' : ''}${used === x.id ? ' <span class="pill ok">on Forecast</span>' : ''}<small>${x.diff && x.diff.length ? esc(x.diff.join(' · ')) : 'the turn rule as built'}</small></td>
        ${cell(x.learn.all)}${cell(x.hold.all, true)}
        <td>${verdict(x)}<small class="rLo">range from ${pct(x.strict.lo)}</small></td>${net(x)}
        <td class="rAct"><button type="button" class="btn sm" data-a="edit" data-id="${x.id}">Edit</button><button type="button" class="btn sm" data-a="use" data-id="${x.id}"${used === x.id ? ' disabled' : ''}>Use on Forecast</button></td></tr>`).join('')}</tbody></table></div>
      <p class="note rNote">Skill is the hit rate minus the hardest of three nulls (${Object.values(NULLW).join(', ')}), in points. The ranking reads the held-back weeks; previews never do.</p>`;
  }

  // ------------------------------------------------------------ the editor
  const numBox = f => {
    const v = S.rule[f.key], shown = f.pct ? +(100 * v).toFixed(2) : v, changed = v !== DEFAULT_RULE[f.key];
    return `<label class="rNum${changed ? ' changed' : ''}"><span>${esc(f.label)}${changed ? '<i class="rDot" title="changed from the default"></i>' : ''}</span>
      <input type="number" data-f="${f.key}" value="${shown}" min="${f.pct ? 100 * f.min : f.min}" max="${f.pct ? 100 * f.max : f.max}" step="${f.pct ? +(100 * f.step).toFixed(2) : f.step}"><em>${f.pct ? '%' : esc(f.unit)}</em></label>`;
  };
  const chip = (attr, on, label, extra = '') => `<button type="button" class="rChip${on ? ' on' : ''}" ${attr} aria-pressed="${on}"${extra}>${label}</button>`;
  const cost = (w, c) => `<span class="rCost ${c}">${w}</span>`;
  function paintEdit() {
    const r = S.rule, id = ruleId(r), saved = S.rank && S.rank.rows.find(x => x.id === id), fields = g => RULE_FIELDS.filter(f => f.group === g).map(numBox).join('');
    const diff = ruleDiff(r), active = document.activeElement, focusKey = active && el.contains(active) ? active.dataset.f || active.dataset.z : null;
    $('edit').innerHTML = `
      <div class="gCardHead"><h3>The rule <span>id ${id}${saved ? ' · saved' : ''}</span></h3>
        <label class="field">Start from <select data-a="load"><option value="">…</option><option value="${DEFAULT_ID}">Default</option>${(S.rank ? S.rank.saved : []).filter(x => x.id !== DEFAULT_ID).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label></div>
      <label class="rNameBox"><span>Name</span><input type="text" data-f="name" maxlength="40" value="${esc(r.name)}"></label>
      <div class="rSec"><h4>Turn rule ${cost('re-finds the turns', 'mid')}</h4><div class="rNums">${fields('hit')}${fields('swing')}</div>
        <p class="hint">A call hits when a real turn of its kind is within the hit window. A real turn is a close that no other close within the swing reach beats.</p></div>
      <div class="rSec"><h4>Kalman lead and smallest circle ${cost('re-runs the Kalman rungs', 'mid')}</h4><div class="rNums">${fields('lead')}${fields('flat')}</div></div>
      <div class="rSec"><h4>What is forecast ${cost('filters the calls', 'low')}</h4>
        <div class="rChips">${CIRCLE_WORDS.map((w, i) => chip(`data-c="${i}"`, r.circles[i], `<i class="sw" style="--c:${COLORS[i]}"></i>${w}`)).join('')}</div>
        <div class="rChips">${FAMILY_IDS.map(f => chip(`data-fam="${f}"`, r.families[f], FAMW[f])).join('')}</div></div>
      <div class="rSec"><h4>Kill zones <span>New York time</span> ${cost('re-tags the calls', 'low')}</h4>
        <div class="rZones">${r.zones.map(z => { const k = KILL_ZONES.find(x => x.id === z.id), dz = DEFAULT_RULE.zones.find(x => x.id === z.id), ch = !z.on || z.a !== dz.a || z.b !== dz.b;
          return `<div class="rZone${z.on ? '' : ' off'}">${chip(`data-zon="${z.id}"`, z.on, z.on ? 'On' : 'Off')}<b>${esc(k.name)}${ch ? '<i class="rDot"></i>' : ''}</b>
            <input type="time" step="300" data-z="${z.id}:a" value="${toTime(z.a)}" aria-label="${esc(k.name)} starts"${z.on ? '' : ' disabled'}><span>to</span><input type="time" step="300" data-z="${z.id}:b" value="${toTime(z.b)}" aria-label="${esc(k.name)} ends"${z.on ? '' : ' disabled'}><small>${spanWord(z.a, z.b)}</small></div>`; }).join('')}</div></div>
      <div class="rSec"><h4>At PDH / PDL ${cost('re-tags the calls', 'low')}</h4><div class="rNums">${fields('level')}</div></div>
      <div class="rSec"><h4>Network inputs ${cost('retrains the network', 'mid')}</h4>
        <div class="rChips">${NET_GROUPS.map(g => chip(`data-net="${g.id}"`, r.net[g.id], esc(g.name), ` title="${esc(g.hint)}"`)).join('')}</div>
        <p class="hint">A group switched off reaches the network as zeros. The Forecast card's network odds use the inputs of its rule.</p></div>
      <div class="rChanges">${diff.length ? `<b>Changed from the default:</b> ${esc(diff.join(' · '))}` : '<b>The default rule</b> · change any setting to try another'}</div>
      <div class="rBtns">
        <button type="button" class="btn" data-a="preview"${S.busy ? ' disabled' : ''}>${saved ? 'Show its result' : 'Preview'}</button>
        <button type="button" class="btn pri" data-a="save"${S.busy || !S.grade ? ' disabled' : ''}>${saved ? 'Save the name' : 'Save and score'}</button>
        <button type="button" class="btn" data-a="reset"${diff.length ? '' : ' disabled'}>Reset to default</button>
        <span class="hint">${S.busy ? `<span class="spin"></span> ${esc(S.busy)}` : saved ? 'Already scored: its result is on the right.' : 'Preview: learning weeks only, not a try.'}</span>
      </div>`;
    if (focusKey) { const again = el.querySelector(`[data-f="${focusKey}"],[data-z="${focusKey}"]`); if (again) { again.focus(); if (again.type === 'text') again.setSelectionRange(again.value.length, again.value.length); } }
  }
  function readForm(t) {
    const r = structuredClone(S.rule);
    if (t.dataset.f === 'name') r.name = t.value;
    else if (t.dataset.f) { const f = RULE_FIELDS.find(x => x.key === t.dataset.f); const v = Number(t.value); if (!Number.isFinite(v)) return null; r[f.key] = f.pct ? v / 100 : v; }
    else if (t.dataset.z) { const [id, side] = t.dataset.z.split(':'), z = r.zones.find(x => x.id === id), m = fromTime(t.value, side === 'b'); if (m == null) return null; z[side] = m; if (z.b <= z.a) { if (side === 'a') z.b = Math.min(1380, z.a + 30); else z.a = Math.max(0, z.b - 30); } }
    return normRule(r);
  }
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-a="load"]')) { if (t.value) load(t.value); return; }
    if (!t.matches('[data-f],[data-z]')) return;
    const r = readForm(t); if (!r) return;
    S.rule = named(r); paintEdit(); show();
  });
  el.addEventListener('input', e => { if (e.target.matches('[data-f="name"]')) S.rule = { ...S.rule, name: e.target.value }; });
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
    const r = structuredClone(S.rule);
    if (b.dataset.c != null) { r.circles[+b.dataset.c] = !r.circles[+b.dataset.c]; if (!r.circles.some(Boolean)) return toast('Keep at least one circle', true); }
    else if (b.dataset.fam) { r.families[b.dataset.fam] = !r.families[b.dataset.fam]; if (!FAMILY_IDS.some(f => r.families[f])) return toast('Keep at least one family', true); }
    else if (b.dataset.zon) { const z = r.zones.find(x => x.id === b.dataset.zon); z.on = !z.on; }
    else if (b.dataset.net) { r.net[b.dataset.net] = !r.net[b.dataset.net]; if (!NET_GROUPS.some(g => r.net[g.id])) return toast('Keep at least one input group', true); }
    else {
      switch (b.dataset.a) {
        case 'reset': S.rule = normRule({ ...DEFAULT_RULE, name: 'Default' }); paintEdit(); show(); return;
        case 'preview': preview(); return;
        case 'save': save(); return;
        case 'scoreDefault': S.rule = normRule(DEFAULT_RULE); save(); return;
        case 'edit': load(b.dataset.id); el.querySelector('[data-r="edit"]').scrollIntoView({ block: 'start', behavior: 'smooth' }); return;
        case 'use': useRule(b.dataset.id); paintRank(); toast('The Forecast card now uses this rule'); return;
        default: return;
      }
    }
    S.rule = named(normRule(r)); paintEdit(); show();
  });
  /** A rule whose settings left the default's but whose name did not gets a name of its own. */
  const named = r => (r.name === 'Default' && ruleId(r) !== DEFAULT_ID ? { ...r, name: 'My rule' } : r);
  async function load(id) {
    try { const x = await api(`rule?id=${encodeURIComponent(id)}`); S.rule = normRule(x.rule); paintRank(); paintEdit(); show(); }
    catch (e) { toast(e.message, true); }
  }

  // ------------------------------------------------------------ running
  const same = rid => S.grade && ruleId(S.rule) === rid;
  async function show() {
    const rid = ruleId(S.rule), saved = S.rank && S.rank.rows.some(x => x.id === rid);
    if (saved) {
      if (S.shown && S.shown.rid === rid && S.shown.kind === 'saved') { paintRank(); return paintOut(); }
      S.shown = { rid, kind: 'loading' }; paintOut();
      try { const t = rid === DEFAULT_ID && S.def ? S.def : await api(`turns?${q({ rule: rid })}`); if (same(rid)) { S.shown = { rid, kind: 'saved', t }; paintRank(); paintOut(); } }
      catch (e) { if (same(rid)) { S.shown = { rid, kind: 'error', msg: e.message }; paintOut(); } }
      return;
    }
    try { const p = await api(`preview?${q({ rule: rid })}`); if (same(rid)) { S.shown = p.none ? { rid, kind: 'none' } : { rid, kind: 'preview', t: p }; paintRank(); paintOut(); } }
    catch (e) { if (same(rid)) { S.shown = { rid, kind: 'error', msg: e.message }; paintRank(); paintOut(); } }
  }
  function busy(msg) { S.busy = msg; paintEdit(); paintOut(); }
  async function preview() {
    if (!S.grade) return;
    const rule = normRule(S.rule), rid = ruleId(rule);
    try {
      const r = await api('preview', { series: series(), key: S.grade.key, rule });
      if (r.saved || r.cached) return show();
      busy('Previewing on the learning weeks… about 6 seconds');
      watch(r.id, async job => {
        S.busy = ''; paintEdit();
        if (job.status !== 'done') { toast(`Preview: ${job.detail || job.status}`, true); paintOut(); return; }
        if (same(rid)) await show(); else paintOut();
      });
    } catch (e) { S.busy = ''; paintEdit(); toast(e.message, true); }
  }
  async function save() {
    if (!S.grade) return;
    const rule = normRule(S.rule), rid = ruleId(rule);
    try {
      const r = await api('turns', { series: series(), key: S.grade.key, rule });
      if (r.cached) { toast(`Saved as “${rule.name}”`); await refresh(); return show(); }
      busy(`Scoring “${rule.name}” on every week… about 15 seconds`);
      watch(r.id, async job => {
        S.busy = '';
        if (job.status !== 'done') { toast(`Save: ${job.detail || job.status}`, true); paintEdit(); paintOut(); return; }
        toast(`Scored: ${job.detail}`);
        await refresh(); onSaved();
        if (same(rid)) { S.shown = null; await show(); }
      });
    } catch (e) { S.busy = ''; paintEdit(); toast(e.message, true); }
  }

  // ------------------------------------------------------------ the result
  function paintOut() {
    const box = $('out'), sh = S.shown;
    if (!S.grade) { box.innerHTML = '<div class="msg">Pick a grade on Multi-day grade first: rules are tried on its range.</div>'; return; }
    const title = sh && sh.kind === 'saved' ? `Saved result <span>every week · held back from ${tradeDay(sh.t.holdFrom)}</span>` : `Preview <span>learning weeks only · the held-back weeks stay unread</span>`;
    if (!sh || sh.kind === 'none' || sh.kind === 'loading' || sh.kind === 'error') {
      const msg = S.busy || (sh && sh.kind === 'loading' ? 'reading…' : sh && sh.kind === 'error' ? sh.msg : 'Not previewed yet. Press Preview to score this rule on the learning weeks, or Save and score to add it to the ranking.');
      box.innerHTML = `<div class="gCardHead"><h3>${title}</h3></div><div class="msg">${S.busy ? '<span class="spin"></span> ' : ''}${esc(msg)}</div>${S.def ? '' : '<p class="note">The default rule is not scored on this range yet, so there is nothing to compare with. Score it from the ranking.</p>'}`;
      return;
    }
    const t = sh.t, L = t.learn, D = S.def && S.def.learn, isDef = sh.rid === DEFAULT_ID, saved = sh.kind === 'saved';
    const rows = [['all', '<b>All calls</b>'], ...FAMILY_IDS.map(f => [`f:${f}`, FAMW[f]]), ...FAMILY_IDS.flatMap(f => CIRCLE_WORDS.map((w, n) => [`c:${f}|${n}`, `<i class="sw" style="--c:${COLORS[n]}"></i>${w} <small>${f === 'daily' ? 'Daily' : 'Kalman'}</small>`]))];
    const td = (c, k) => (!c ? '<td class="muted">—</td>' : k === 'n' ? `<td class="num">${int(c.n)}</td>` : k === 'skill' ? `<td class="num ${!c.judged ? 'muted' : c.clears ? 'ok' : c.worse ? 'bad' : ''}">${pts(c.skill)}</td>` : `<td class="num${k === 'hardest' ? ' mut' : ''}">${pct(c[k])}</td>`);
    const cols = 5 + (isDef ? 0 : 3) + (saved ? 3 : 0);
    const body = rows.map(([key, label], i) => {
      const c = L.cells[key], d = D && D.cells[key], h = saved && t.hold.cells[key];
      if (!c && !d) return '';
      const delta = c && d && c.judged && d.judged ? c.skill - d.skill : NaN;
      return `${i === 3 || i === 9 ? `<tr class="sep"><td colspan="${cols}"></td></tr>` : ''}<tr><td>${label}</td>${td(c, 'n')}${td(c, 'rate')}${td(c, 'hardest')}${td(c, 'skill')}`
        + (isDef ? '' : `${td(d, 'rate')}${td(d, 'skill')}<td class="num ${delta > 0.005 ? 'ok' : delta < -0.005 ? 'bad' : 'mut'}">${Number.isFinite(delta) ? pts(delta) : '—'}</td>`)
        + (saved ? `${td(h, 'rate')}${td(h, 'hardest')}${td(h, 'skill')}` : '') + '</tr>';
    }).join('');
    const nl = t.net && t.net.learn, dn = S.def && S.def.net && S.def.net.learn, nh = saved && t.net.hold;
    const off = NET_GROUPS.filter(g => !(t.rule.net || {})[g.id]).map(g => g.name);
    const netLine = (s, w) => (s && s.ready ? `<div class="rNetRow"><span>${w}</span><b class="${s.edge ? 'ok' : s.gain < 0 ? 'bad' : ''}">${brier(s.brier)}</b><i>vs ${brier(s.brierBase)} for always ${pct(s.base)}</i><em>${s.edge ? 'better than the base rate' : 'no better than the base rate'} · ${int(s.tested)} calls</em></div>` : `<div class="rNetRow"><span>${w}</span><em>too few calls</em></div>`);
    box.innerHTML = `<div class="gCardHead"><h3>${title}</h3><span class="gKey">${saved ? '<span class="pill ok">in the ranking</span>' : '<span class="pill">not a try</span>'}<span>${esc(t.rule.name)} · id ${sh.rid}</span></span></div>
      <div class="tVerdict">${L.verdict.lines.slice(0, 2).map(l => `<p>${esc(l)}</p>`).join('')}</div>
      <div class="table rCmp"><table>
        <thead><tr class="grp"><th></th><th colspan="4">This rule · learning weeks</th>${isDef ? '' : '<th colspan="3">Default · learning weeks</th>'}${saved ? '<th colspan="3">This rule · held back</th>' : ''}</tr>
        <tr><th></th><th>Turns</th><th>Hit</th><th>Null</th><th>Skill</th>${isDef ? '' : '<th>Hit</th><th>Skill</th><th>Change</th>'}${saved ? '<th>Hit</th><th>Null</th><th>Skill</th>' : ''}</tr></thead>
        <tbody>${body}</tbody></table></div>
      <div class="rNet"><h4>Turn network <span>${off.length ? `without ${esc(off.join(', '))}` : 'every input group'} · Brier, lower is better</span></h4>
        ${netLine(nl, 'This rule, learning weeks')}${!isDef && dn ? netLine(dn, 'Default, learning weeks') : ''}${saved ? netLine(nh, 'This rule, held back') : ''}</div>
      <p class="note">Skill in points: the hit rate minus the hardest null${L.reps < 60 ? ` (a preview draws ${L.reps} nulls, a saved score 60, so small differences can move)` : ''}. ${saved ? 'This rule is one try on the ranking.' : 'Save and score to see the held-back weeks and add it to the ranking.'}</p>`;
  }

  return { set: g => { const key = g ? `${g.from}-${g.to}` : null; if (!S.grade || S.grade.key !== key) set(g); }, refresh: () => S.grade && refresh().then(show), paint: () => S.grade && paintRank() };
}
