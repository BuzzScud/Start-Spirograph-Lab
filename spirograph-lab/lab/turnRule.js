// The editable turn rule (16 Sep, on request: "can we make the rule editable? make the forecast modular, based on the
// neural network"). Every number the turn forecaster used to hold as a constant, in one object:
//
//   hit window     a call hits when a real turn of its kind falls within this share of a lap (never under a floor)
//   swing reach    a real turn is a close no other close this share of a lap either side beats (never under a floor)
//   Kalman lead    how far ahead of each closed minute the Kalman rungs call their turns, as a share of the lap
//   smallest circle  circles smaller than this, in points, call no turns
//   circles, families  which circles and which family are forecast at all
//   kill zones     the four ICT windows (on or off, start and end on the day clock)
//   PDH/PDL band   "at the level": within this share of the previous day's range, never under a floor in points
//   network inputs which groups of inputs the turn network may learn from
//
// A rule is known by its id, a hash of its settings (the name is only a label), so the same settings saved twice are
// one rule. Every result is kept under its rule's id. Pure: no DOM, no database.
import { KILL_ZONES } from './labLevels.js';

export const RULE_VERSION = 1;
export const CIRCLE_WORDS = ['1D', '4H', '2H', '24m', '12m', '6m'];
export const FAMILY_IDS = ['daily', 'kalman'];
/** The turn network's inputs in groups: a group switched off reaches the network as zeros (labNet.js mask). */
export const NET_GROUPS = [
  { id: 'circle', name: 'Circle', cols: [0], hint: 'which circle made the call' },
  { id: 'size', name: 'Size', cols: [1], hint: 'how big the circle was' },
  { id: 'lead', name: 'Lead', cols: [2], hint: 'how far ahead the call was made' },
  { id: 'time', name: 'Time of day', cols: [3, 4], hint: 'when the turn was due' },
  { id: 'zone', name: 'Kill zone', cols: [5, 6, 7, 8], hint: 'which kill zone the turn fell in' },
  { id: 'levels', name: 'PDH / PDL', cols: [9, 10], hint: 'where the market stood against the levels' },
  { id: 'kind', name: 'Peak or trough', cols: [11], hint: 'the kind of turn called' },
  { id: 'family', name: 'Family', cols: [12], hint: 'Daily set or Kalman rungs' },
];
export const HOLDOUT_DAYS = 14;   // the last two weeks of a range are held back: a preview never sees them

export const DEFAULT_RULE = Object.freeze({
  name: 'Default',
  tolShare: 1 / 8, tolFloor: 1,
  swingShare: 1 / 8, swingFloor: 2,
  leadShare: 1 / 4,
  flat: 0.5,
  circles: [true, true, true, true, true, true],
  families: { daily: true, kalman: true },
  zones: KILL_ZONES.map(z => ({ id: z.id, on: true, a: z.a, b: z.b })),
  levelShare: 0.05, levelFloor: 2,
  net: Object.fromEntries(NET_GROUPS.map(g => [g.id, true])),
});

/** The number settings: label, unit, bounds, and what a change costs to score. `pct` values are shown as percentages. */
export const RULE_FIELDS = [
  { key: 'tolShare', group: 'hit', label: 'Hit window', unit: '% of a lap', pct: true, min: 0.02, max: 0.5, step: 0.005 },
  { key: 'tolFloor', group: 'hit', label: 'Hit window floor', unit: 'min', min: 0.5, max: 60, step: 0.5 },
  { key: 'swingShare', group: 'swing', label: 'Swing reach', unit: '% of a lap', pct: true, min: 0.02, max: 0.5, step: 0.005 },
  { key: 'swingFloor', group: 'swing', label: 'Swing reach floor', unit: 'min', min: 1, max: 60, step: 1, int: true },
  { key: 'leadShare', group: 'lead', label: 'Kalman lead', unit: '% of a lap', pct: true, min: 0.05, max: 1, step: 0.01 },
  { key: 'flat', group: 'flat', label: 'Smallest circle', unit: 'pts', min: 0, max: 100, step: 0.5 },
  { key: 'levelShare', group: 'level', label: 'At the level', unit: '% of the day\'s range', pct: true, min: 0, max: 0.5, step: 0.005 },
  { key: 'levelFloor', group: 'level', label: 'At the level floor', unit: 'pts', min: 0, max: 200, step: 0.5 },
];

const num = (v, d, lo, hi, int = false) => { let x = Number(v); if (!Number.isFinite(x)) x = d; x = Math.max(lo, Math.min(hi, x)); return int ? Math.round(x) : Math.round(x * 1e6) / 1e6; };
const DAY_MIN = 1380;   // a session's traded minutes on the day clock (6 pm to 5 pm)

/** A clean rule from anything (the page's JSON): every setting in bounds, at least one circle, family and input group on. */
export function normRule(r = {}) {
  const d = DEFAULT_RULE, out = { name: String(r.name ?? d.name).trim().slice(0, 40) || 'Untitled' };
  for (const f of RULE_FIELDS) out[f.key] = num(r[f.key], d[f.key], f.min, f.max, f.int);
  out.circles = d.circles.map((v, i) => (Array.isArray(r.circles) && typeof r.circles[i] === 'boolean' ? r.circles[i] : v));
  if (!out.circles.some(Boolean)) out.circles = d.circles.slice();
  out.families = Object.fromEntries(FAMILY_IDS.map(f => [f, typeof r.families?.[f] === 'boolean' ? r.families[f] : true]));
  if (!FAMILY_IDS.some(f => out.families[f])) out.families = { ...d.families };
  out.zones = d.zones.map(z => {
    const g = Array.isArray(r.zones) ? r.zones.find(q => q && q.id === z.id) : null;
    const a = num(g?.a, z.a, 0, DAY_MIN - 5, true), b = num(g?.b, z.b, a + 5, DAY_MIN, true);
    return { id: z.id, on: typeof g?.on === 'boolean' ? g.on : true, a, b };
  });
  out.net = Object.fromEntries(NET_GROUPS.map(g => [g.id, typeof r.net?.[g.id] === 'boolean' ? r.net[g.id] : true]));
  if (!NET_GROUPS.some(g => out.net[g.id])) out.net = { ...d.net };
  return out;
}

/** The settings alone, in a fixed order (the name left out): what the id is made from. */
function canon(r) {
  const x = normRule(r);
  return JSON.stringify([RULE_FIELDS.map(f => x[f.key]), x.circles, FAMILY_IDS.map(f => x.families[f]), x.zones.map(z => [z.on, z.a, z.b]), NET_GROUPS.map(g => x.net[g.id])]);
}
/** A rule's id: 8 hex digits of FNV-1a over its settings. The same settings under two names are one rule. */
export function ruleId(r) {
  let h = 0x811c9dc5;
  const s = canon(r);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
export const DEFAULT_ID = ruleId(DEFAULT_RULE);
export const isDefault = r => ruleId(r) === DEFAULT_ID;

/** Keep a call? Its family and circle must be on. */
export const ruleKeeps = (rule, c) => !!rule.families[c.fam] && !!rule.circles[c.n];
/** The swing's reach in minutes for a circle of P minutes. */
export const swingOf = (rule, P) => Math.max(rule.swingFloor, Math.round(P * rule.swingShare));
/** The hit window in minutes for a circle of P minutes. */
export const tolOf = (rule, P) => Math.max(rule.tolFloor, P * rule.tolShare);
/** How far ahead the Kalman rungs call, in minutes: never inside the swing's own reach. */
export const leadOf = (rule, P) => Math.max(P * rule.leadShare, swingOf(rule, P) + 1);
/** The turn network's input mask (13 inputs): null when every group is on, so the walk is the one it always was. */
export function netMask(rule) {
  const on = NET_GROUPS.every(g => rule.net[g.id]);
  if (on) return null;
  const m = new Array(13).fill(1);
  for (const g of NET_GROUPS) if (!rule.net[g.id]) for (const c of g.cols) m[c] = 0;
  return m;
}

const pctW = x => `${+(100 * x).toFixed(1)}%`;
const hm = m => { const t = (m + 18 * 60) % 1440, h = Math.floor(t / 60), mm = t % 60, h12 = h % 12 || 12; return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`; };
/** A day-clock minute (since 6 pm New York) as New York time: 120 → "8 pm". */
export const clockWord = hm;
/** Two day-clock minutes as New York hours, the half of day said once when both share it: "2 – 5 am", "8 pm – 12 am". */
export function spanWord(a, b) {
  const x = hm(a), y = hm(b), sx = x.slice(-2), sy = y.slice(-2);
  return sx === sy ? `${x.slice(0, -3)} – ${y}` : `${x} – ${y}`;
}
/** How a rule differs from the default, one short phrase per change. */
export function ruleDiff(r) {
  const x = normRule(r), d = DEFAULT_RULE, out = [];
  for (const f of RULE_FIELDS) if (x[f.key] !== d[f.key]) out.push(`${f.label} ${f.pct ? pctW(x[f.key]) : x[f.key]}${f.pct ? '' : ` ${f.unit}`}`);
  const offC = CIRCLE_WORDS.filter((_, i) => !x.circles[i]);
  if (offC.length) out.push(`without ${offC.join(', ')}`);
  const offF = FAMILY_IDS.filter(f => !x.families[f]);
  if (offF.length) out.push(`${offF.map(f => (f === 'daily' ? 'Daily set' : 'Kalman rungs')).join(', ')} off`);
  for (const z of x.zones) {
    const dz = d.zones.find(q => q.id === z.id), name = KILL_ZONES.find(q => q.id === z.id).name;
    if (!z.on) out.push(`${name} zone off`);
    else if (z.a !== dz.a || z.b !== dz.b) out.push(`${name} ${spanWord(z.a, z.b)}`);
  }
  const offN = NET_GROUPS.filter(g => !x.net[g.id]);
  if (offN.length) out.push(`network without ${offN.map(g => g.name).join(', ')}`);
  return out;
}

/** The zones in force, as labLevels.js reads them: the ones switched on, with their names and New York hours. */
export function zonesOf(rule) {
  return rule.zones.filter(z => z.on).map(z => { const k = KILL_ZONES.find(q => q.id === z.id); return { id: z.id, name: k.name, a: z.a, b: z.b, hours: spanWord(z.a, z.b) }; });
}
