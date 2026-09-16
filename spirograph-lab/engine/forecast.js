// A forecast run, the way the Trading Platform's card keeps one: the model's path and a measured
// band are cut at the last closed minute and frozen over thirteen bars of the higher candle
// timeframe, then graded bar by bar against what printed.
//
// THE BAND IS CENTRED ON THE CUT PRICE, NOT ON THE PATH. Centring it on the model path asserts that
// the path is the median of the distribution, and it is not: backtested over the cached history, a
// path-centred cone held 42% of closes against a promised 68%, while the same band around the cut
// price held 74%. The path is drawn inside the cone as what the cycles say; the cone is what this
// market has actually done from this kind of moment, and only the cone is graded. Pure, so the page (tracking live) and the relay
// (grading from the database) run the same code and can never read one run two ways.
//
// The disciplines copied from that desk, stated here so they are not lost in the code:
//   the cut is the last CLOSED minute, never the forming one;
//   step 0 is the join and grades nothing — scoring starts at step 1;
//   one bar grades one step: the close of the stamp's own minute, or the last traded minute
//   before it within a bar's length, and a stamp with no bar is unmatched, not nearest-matched;
//   the band graded is the one drawn (68%), and "inside" is the close, not the range;
//   done is decided by a bar landing on the last stamp, never by the clock.
import { bandFor, bandAt, nyHour, BAND_PCT, ENVELOPE_PCT, MIN_ORIGINS } from './band.js';
import { blockAt } from './fire.js';
import { nyParts } from './levels.js';

export const RUN_STEPS = 13;
/**
 * The run schema version, carried on every run so a card can say what it is reading.
 *   1  the original: path, 68% band and 80% envelope, no provenance
 *   2  adds `n` per step (how many origins the band's quantile came from), `bandHour`,
 *      `bandQuality`, `envelopePct` and a signed `fit.explainedRaw`
 *   3  adds `fit.t0` and `fit.pack`: the session start the fit's clock-locked phases are counted
 *      from, and the ladder's packing, so the run's own cycles can be rebuilt exactly (src/frozen.js)
 * A v1 row still reads, still grades and still draws; the card names it rather than guessing.
 */
export const RUN_SCHEMA = 3;
const M = 60000;

/** A twelve-hex id minted where the run is made, so a row can be matched before the relay answers. */
export function mintId() { let s = ''; for (let i = 0; i < 12; i++) s += Math.floor(Math.random() * 16).toString(16); return s; }

/**
 * The id of the run at this origin: FNV-1a over `contract|cut|tf`, widened to the twelve hex
 * characters the relay validates. Every run gets one — the desk's, the daemon's and the seeder's.
 *
 * A RUN'S IDENTITY IS ITS ORIGIN, NOT THE MOMENT SOMEBODY ASKED FOR IT. With random ids the same
 * origin minted twice wrote two rows: press Forecast twice inside one minute and the record holds
 * two runs whose cut, fit, path and band are identical, and which both count in any coverage
 * statistic taken over the table. Worse, `putRun` is `insert or replace` keyed on the id and keeps
 * the previous grade — but only when the id matches, so a daemon restart, a replayed boundary or a
 * second desk flushing its outbox each duplicated rather than converged. Deriving the id from the
 * origin makes all of that idempotent for nothing: the same origin is the same row, and re-saving it
 * keeps the grade it has already earned.
 */
export function runIdFor(contract, cut, tf) {
  let h = 0x811c9dc5, g = 0x01000193;   // two FNV-1a lanes, different offset bases, 24 bits taken from each
  const s = `${contract}|${cut}|${tf}`;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h = Math.imul(h ^ c, 16777619) >>> 0; g = Math.imul(g ^ c, 16777619) >>> 0; }
  return (h >>> 8).toString(16).padStart(6, '0') + (g >>> 8).toString(16).padStart(6, '0');
}

/** The last closed minute at `nowMs`: the minute before the one that is forming. */
export function lastClosedMinute(nowMs) { return Math.floor(nowMs / M) * M - M; }

/**
 * Freeze a run from a live sim with a fit: `tf` is the bar length in minutes, `tpm` ticks per minute.
 * Returns null without a fit or a traded cut. The path is the model's change from the cut added to the
 * cut's close; the band is the hour-of-day move distribution at the cut, laid around the CUT PRICE
 * with its own median at the centre — never around the path, for the reason set out at the top of
 * this file. The path is drawn inside the cone; it is not its middle.
 */
export function makeRun(sim, nowMs, tf, tpm, name, opts = {}) {
  const chk = checkRun(sim, nowMs, tf, tpm);
  if (!chk.ok && !opts.force) return null;
  const cut = lastClosedMinute(nowMs), anchor = closeAtFromSim(sim, tpm)(cut);
  if (anchor === null) return null;   // no traded cut: there is nothing to anchor to, forced or not
  const cutMin = (cut - sim.live.t0) / M, modelCut = sim.modelAt(cutMin), band = bandFor(sim, cut);
  const steps = [];
  for (let i = 0; i <= RUN_STEPS; i++) {
    const t = cut + i * tf * M, k = i * tf, path = anchor + (sim.modelAt(cutMin + k) - modelCut), o = i ? bandAt(band, k) : null;   // the join is the anchor exactly
    // `n` travels with the step: it is the only way to tell a cone measured from nine hundred origins
    // from one measured from forty-one after the fact, and a forced run keeps a step the band could
    // not reach so the card can draw exactly as far as the measurement goes and no further.
    steps.push({ i, t, path, lo: o ? anchor + o.lo : anchor, hi: o ? anchor + o.hi : anchor, outLo: o ? anchor + o.outLo : anchor, outHi: o ? anchor + o.outHi : anchor, n: o ? o.n : 0 });
  }
  const f = sim.live.fit;
  // statMin travels with the run because the residual it froze is only readable against its own
  // window: runs cut before the residual moved to minute closes carry a number measured another
  // way, and a card that prints both under one label cannot be read. A run without it is one of
  // those, and the card says so rather than guessing.
  return { v: RUN_SCHEMA, id: runIdFor(sim.live.contract, cut, tf), contract: sim.live.contract, name: name || runName(sim.live.name, cut), cut, tf, steps: RUN_STEPS, horizonMin: RUN_STEPS * tf, anchor,
    bandPct: BAND_PCT, envelopePct: ENVELOPE_PCT, bandHour: nyHour(cut), bandQuality: chk.ok ? 'measured' : chk.reason,
    fitQuality: (chk.warn || []).includes('flat-fit') ? 'flat' : 'ok', forced: chk.ok ? undefined : true,
    path: steps, savedAt: nowMs,
    fit: { p0: f.p0, drift: f.drift, A: f.A, phi: f.phi, off: f.off, tRef: f.tRef, t0: sim.live.t0, pack: sim.k, rms: f.rms, explained: f.explained, explainedRaw: f.explainedRaw ?? f.explained, statMin: f.statMin ?? null, statN: f.statN ?? null, scale: sim.G.scale } };
}

/**
 * Whether the market is shut at `ms`: the daily 15:00–18:00 NY halt, or the weekend.
 *
 * THE WEEKEND IS DECIDED BY THE SESSION'S OPEN, NOT BY THE CLOCK AT `ms`. globexDay hands back the
 * session containing a moment by rolling back to the previous 18:00 NY, so a Sunday morning — when
 * CME is emphatically shut — sits inside a notional session "opening" Saturday at 18:00. Read off
 * `ms`'s own weekday, Sunday 09:00 NY looks like an ordinary Sunday inside an open session, and the
 * seeder duly tried to mint at 104 of them. What settles it is the weekday of the OPEN: a session
 * that begins on a Friday or Saturday evening is not a session, because the week's last one closed
 * Friday at 15:00 and the next begins Sunday at 18:00.
 */
export function marketShut(ms) {
  if (nyParts(ms).dow === 'Sat') return true;   // never, at any hour
  const b = blockAt(ms); if (!b) return true;   // the 15:00 -> 18:00 halt, and everything past the close
  const open = nyParts(b.open).dow;
  return open === 'Fri' || open === 'Sat';      // Friday evening onwards is the weekend, not a new session
}

/**
 * Whether an honest run can be cut here: {ok: true, warn} or {ok: false, reason, detail}.
 * Reasons are the vocabulary the whole desk shares — the button's message, the relay's skip ledger,
 * and the `bandQuality` a forced run carries. Pure, so the page and the daemon refuse the same cuts.
 *
 *   no-fit      the ladder has not been fitted yet, so there is no path to draw at all
 *   no-bars     the cut minute never traded, so there is nothing to anchor to
 *   thin-band   some stamp's rung is unmeasured: too few origins at that offset from this hour
 *
 * WHETHER A STAMP CAN BE GRADED IS MEASURED, NOT ASSERTED FROM A CALENDAR. `moveQuantiles` counts
 * only minutes that actually traded, so an offset at which this market is habitually shut has no
 * origins and its rung has no answer — `thin-band` therefore already refuses a run whose stamps land
 * where nothing prints, drawn from the instrument's own record rather than from a hardcoded CME
 * timetable that a backtest replay or another instrument would not obey. The one case the
 * hour-of-day band cannot see is the day of the week — a Friday afternoon cut whose stamps run into
 * the weekend — and that is caught where the clock is real: the relay's daemon refuses to mint while
 * the market is shut, and `warn: ['shut']` rides on a manual run so the card can say so.
 *
 * WHAT IS REFUSED IS WHAT CANNOT BE GRADED — NOT WHAT IS MERELY UNFLATTERING. A fit that explains
 * nothing was very nearly on this list, and it does not belong on it: the cone is what is graded and
 * the cone is measured from the market's own history, not from the fit, so a hopeless fit leaves a
 * perfectly gradeable run. Refusing it would have thrown away the claim to punish the drawing.
 * It comes back as `warn: ['flat-fit']` and rides on the run as `fitQuality`, where the card can say
 * so plainly — which is the honest treatment, and is also what the record supports: over this
 * database the runs in the top half by explained share forecast no better (1.84x flat) than those in
 * the bottom half (1.73x), so the explained share does not predict anything worth gating on.
 *
 * A refusal is not a failure. It is the desk saying this origin could not be graded honestly, which
 * is worth more than a row that grades 0/13 for ever and cannot be told from a genuine miss.
 */
export function checkRun(sim, nowMs, tf, tpm) {
  if (sim.mode !== 'live' || !sim.live) return { ok: false, reason: 'no-fit', detail: 'not a live session' };
  if (!sim.live.fit) return { ok: false, reason: 'no-fit', detail: 'the ladder has not been fitted yet' };
  const cut = lastClosedMinute(nowMs);
  if (closeAtFromSim(sim, tpm)(cut) === null) return { ok: false, reason: 'no-bars', detail: 'the cut minute never traded' };
  // EVERY step's rung must be measurable, not merely the far one. The ladder can hole in the middle
  // — an offset at which this market is habitually shut has no origins at all — and a run with a
  // gradeable step 13 and an ungradeable step 4 is still a cone that cannot be read across.
  const band = bandFor(sim, cut), far = bandAt(band, RUN_STEPS * tf);
  let missing = 0; for (let i = 1; i <= RUN_STEPS; i++) if (!bandAt(band, i * tf)) missing++;
  if (!far || missing) {
    const reach = band ? band.rows.filter(r => Number.isFinite(r.lo)).map(r => r.k).pop() : null;
    return { ok: false, reason: 'thin-band', detail: !reach ? `fewer than ${MIN_ORIGINS} origins at NY hour ${nyHour(cut)}`
      : far ? `${missing} of ${RUN_STEPS} stamps sit at an offset this market has no history at` : `the band reaches ${reach} min; the horizon is ${RUN_STEPS * tf}` };
  }
  const f = sim.live.fit, raw = f.explainedRaw ?? f.explained, warn = [];
  if (Number.isFinite(raw) && raw <= 0) warn.push('flat-fit');
  let shut = 0; for (let i = 1; i <= RUN_STEPS; i++) if (marketShut(cut + i * tf * M)) shut++;
  if (shut) warn.push('shut');
  return { ok: true, far, warn, shut };
}
/** `NQU6 · Sep 08 08:07 NY` — built part by part, because a locale string puts an "at" in the middle on some builds. */
export function runName(symbol, cutMs) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(cutMs);
  const v = t => (p.find(x => x.type === t) || {}).value || '';
  return `${symbol || 'run'} · ${v('month')} ${v('day')} ${v('hour')}:${v('minute')} NY`;
}

/**
 * A close lookup over a live sim's minute bars: the close of `ms`'s minute, or the last traded minute
 * before it within `withinMin` minutes.
 *
 * THE WALK BACK IS A GAP FILL, NOT A PEEK AHEAD. gradeRun asks with withinMin = the bar length, so a
 * thin or shut minute can borrow the last one that traded. Without the guard below, a stamp that has
 * not happened yet walks back the same way and lands on NOW: a stamp an hour ahead was being graded
 * against the live quote, scored "inside the band", and moved on every tick. A time that has not
 * arrived has no verdict, so anything at or past the minute still forming returns null.
 */
export function closeAtFromSim(sim, tpm) {
  return (ms, withinMin = 1) => {
    if (sim.mode !== 'live' || !sim.live) return null;
    const m1 = sim.minutes(), base = sim.live.t0 + (sim.tick0 / tpm) * M; let m = Math.floor((ms - base) / M);
    if (m >= m1 - 1) return null;   // m1 - 1 is the minute still forming: its close is not final either
    for (let k = 0; k < withinMin; k++, m--) { if (m < 0 || m >= m1) continue; if (sim.MIN.has[m] === 1) return sim.MIN.c[m]; }
    return null;
  };
}
/**
 * A close lookup over ascending 1-minute bars [{t, c}]. The same rule as closeAtFromSim, stated
 * over bars: nothing past the newest bar can be graded, AND nothing at or past the minute still
 * forming at `nowMs`.
 *
 * THE SECOND GUARD IS WHAT MAKES THE TWO GRADERS AGREE. Without it the relay accepted the newest
 * bar — which is the forming minute whenever a feed hands back the minute in progress — while the
 * page's own grader refused it, so the same run read n/13 and complete on the relay and n−1/13 on
 * the desk at the moment a bar landed. A run is graded one way or it is not graded.
 */
export function closeAtFromBars(bars, nowMs = Date.now()) {
  const byT = new Map(bars.map(b => [b.t, b.c]));
  const newest = bars.length ? bars[bars.length - 1].t : -Infinity;
  const forming = Math.floor(nowMs / M) * M;
  return (ms, withinMin = 1) => {
    const m0 = Math.floor(ms / M) * M;
    if (m0 > newest || m0 >= forming) return null;
    for (let k = 0; k < withinMin; k++) { const c = byT.get(m0 - k * M); if (c !== undefined) return c; }
    return null;
  };
}
/**
 * Grade a run with a close lookup. Every step after the join is matched to its own bar (within one bar
 * length back), and only matched steps score. Returns { matched, complete, direction, bandCover, inside,
 * mae, miss, brokeAt, last, steps: [{i, actual, inside, err}] }: `miss` is the mean error in halves of
 * the band, the desk's "1.4× band" reading, since a percentage of an index future cannot leave 99–100.
 */
export function gradeRun(run, closeAt) {
  const out = [], within = run.tf; let matched = 0, inside = 0, insideOut = 0, errSum = 0, flatSum = 0, missSum = 0, brokeAt = null, last = null;
  for (const s of run.path) {
    if (s.i === 0) continue;
    const actual = closeAt(s.t, within); if (actual === null) { out.push({ i: s.i, actual: null, inside: null, err: null }); continue; }
    const half = Math.max(1e-9, (s.hi - s.lo) / 2), err = actual - s.path, ins = actual >= s.lo && actual <= s.hi;
    // The 80% envelope is frozen into every step and was never scored — a second calibration point,
    // on the same bars, for free. A cone can be right at 68% and wrong in its tails, and only this
    // catches that.
    const insOut = actual >= s.outLo && actual <= s.outHi;
    matched++; if (ins) inside++; else if (brokeAt === null) brokeAt = s.i; if (insOut) insideOut++;
    errSum += Math.abs(err); flatSum += Math.abs(actual - run.anchor); missSum += Math.abs(err) / half; last = { i: s.i, actual, err };
    out.push({ i: s.i, actual, inside: ins, insideOut: insOut, err });
  }
  const end = run.path[run.path.length - 1], complete = out[out.length - 1].actual !== null;
  const called = Math.sign(end.path - run.anchor), actualDir = last ? Math.sign(last.actual - run.anchor) : 0;
  // `flatMae` is the same steps scored against a flat line held at the cut price — the control the
  // backtest has always used and the card never showed. Over this database the drawn path runs about
  // 1.8x it, so a run that prints its own MAE without this beside it is claiming a skill the record
  // does not support.
  return { matched, complete, direction: { called, actual: actualDir, correct: called && actualDir ? called === actualDir : null },
    bandCover: matched ? inside / matched : null, inside, insideOut, envCover: matched ? insideOut / matched : null,
    mae: matched ? errSum / matched : null, flatMae: matched ? flatSum / matched : null, miss: matched ? missSum / matched : null, brokeAt, last, steps: out };
}
/**
 * The grade to show for a run. A run carries two: `grade`, what the relay wrote from the whole bar
 * database, and `g`, what the page just computed from the tape in its own buffer.
 *
 * TAKE WHICHEVER SAW MORE BARS, NOT WHICHEVER IS NEWER. The page was reading `g` for every run that
 * was not yet complete and `grade` only once it was — so a run older than the fit window, whose
 * stamps have fallen off the page's buffer, showed "no bars" for ever while the relay held it
 * graded 13/13; and in the moment between a sync and the next frame every open run read as ungraded.
 * The two are the same function of the same rule, so where both can see a stamp they agree, and the
 * one that matched more stamps is simply the one that had the bars.
 *
 * A TIE GOES TO THE DATABASE. This used to be `>=`, which handed a tie to the page. Both graders gap
 * fill by walking back `withinMin = run.tf` — up to fifty-nine minutes on a 1H run — so a hole in the
 * page's own tick buffer can match a step to an older close than the database would, agree on the
 * count, and disagree on the verdict. The database holds every bar the relay ever fetched; the page
 * holds a window. On equal evidence the one with the whole tape is right.
 */
export function gradeOf(run) {
  if (!run) return null;
  const a = run.g, b = run.grade;
  if (!a) return b || null; if (!b) return a;
  return (a.matched ?? 0) > (b.matched ?? 0) ? a : b;
}

/** armed before the first stamp, tracking until the last stamp has its bar, then expired. */
export function runState(run, grade, nowMs) {
  if (grade && grade.complete) return 'expired';
  if (nowMs < run.path[1].t) return 'armed';
  return nowMs > run.path[run.path.length - 1].t + run.tf * M * 2 && !(grade && grade.matched) ? 'expired' : 'tracking';
}
/** One line for a run: "4/13 steps · inside 68% 3/4 · dir ✓ · miss 0.6× band". */
export function gradeLabel(run, g) {
  if (!g || !g.matched) return '0/13 steps · waiting for the first bar';
  const dir = g.direction.correct === null ? 'dir —' : g.direction.correct ? 'dir ✓' : 'dir ✗';
  return `${g.matched}/${run.steps} steps · inside ${run.bandPct}% ${g.inside}/${g.matched} · ${dir} · miss ${g.miss.toFixed(1)}× band`;
}
