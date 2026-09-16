// Small browser helpers the Lab's pages share.
import { nyParts } from '../engine/levels.js';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const two = n => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Mon 14 Sep 09:00" in New York. */
export const when = ms => { const p = nyParts(ms); return `${p.dow} ${p.d} ${MON[p.mo - 1]} ${two(p.h)}:${two(p.mi)}`; };
export const hm = ms => { const p = nyParts(ms); return `${two(p.h)}:${two(p.mi)}`; };
/** A session's trading day ("Mon 14 Sep"): the day after its 6 pm open. */
export const tradeDay = open => { const p = nyParts(open + 7 * 3600e3); return `${p.dow} ${p.d} ${MON[p.mo - 1]}`; };
/** "14 Sep" in New York. */
export const dayMonth = ms => { const p = nyParts(ms); return `${p.d} ${MON[p.mo - 1]}`; };
/** A New York calendar date as "2026-09-14". */
export const isoDay = ms => { const p = nyParts(ms); return `${p.y}-${two(p.mo)}-${two(p.d)}`; };
export const pct = v => (Number.isFinite(v) ? `${Math.round(100 * v)}%` : '—');
export const sgn = v => (!Number.isFinite(v) ? '—' : v > 0 ? `+${v.toFixed(1)}` : v < 0 ? `−${Math.abs(v).toFixed(1)}` : '0.0');
export const int = v => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
export const arrow = d => (d > 0 ? '↑' : d < 0 ? '↓' : '→');
