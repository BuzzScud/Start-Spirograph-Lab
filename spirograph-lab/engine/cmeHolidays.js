// CME Globex EQUITY INDEX futures (ES, NQ, YM, RTY) holiday hours, New York time (15 Sep, on request: a CME holiday table
// for the Spirograph's Daily set). Keyed by TRADE DATE: the date of the close a session ends at, so the session that opens
// at 6 pm belongs to the next day.
//   close: 'HH:MM'  that session halts early at HH:MM New York, and Globex reopens at 6 pm as usual
//   closed: true    there is no session for that trade date: the one before ends as it would, and Globex reopens at 6 pm
//
// Sources: CME's own page (cmegroup.com/trading-hours.html) timed out from here, so this is CME's standing pattern for
// equity index products - a 12:00 CT (1 pm New York) halt on the federal holidays it trades through, 12:15 CT (1:15 pm)
// on the day after Thanksgiving and Christmas Eve, closed on Good Friday, Christmas and New Year's Day - checked against
// CrossTrade's 2026 schedule and the dated 2027 holidays in a web search. `checked` marks an entry confirmed against the
// relay's own bars: only Labor Day 2026 could be, as ProjectX serves no bars for the earlier 2026 holidays on any NQ
// contract (MrTopStep's calendar was rejected: it lists Labor Day as a full closure, which those bars disprove). The rest
// are due a look at CME's calendar; the day clock does not depend on them (the circles keep
// turning either way), only the words the Spirograph shows.
import { nyParts } from './levels.js';
import { nyDateAdd } from './anchors.js';
import { globexOpen } from './session.js';

export const HOLIDAYS = {
  '2026-01-01': { name: "New Year's Day", closed: true },
  '2026-01-19': { name: 'MLK Day', close: '13:00' },
  '2026-02-16': { name: "Presidents' Day", close: '13:00' },
  '2026-04-03': { name: 'Good Friday', closed: true },   // payrolls fell on it: CME has opened equity products for a short morning in such years
  '2026-05-25': { name: 'Memorial Day', close: '13:00' },
  '2026-06-19': { name: 'Juneteenth', close: '13:00' },
  '2026-07-03': { name: 'Independence Day', close: '13:00' },   // observed: the 4th is a Saturday
  '2026-09-07': { name: 'Labor Day', close: '13:00', checked: true },   // NQZ6's last bar 12:55, next 18:00 (relay, 15 Sep)
  '2026-11-26': { name: 'Thanksgiving', close: '13:00' },
  '2026-11-27': { name: 'Day after Thanksgiving', close: '13:15' },
  '2026-12-24': { name: 'Christmas Eve', close: '13:15' },
  '2026-12-25': { name: 'Christmas', closed: true },
  '2027-01-01': { name: "New Year's Day", closed: true },
  '2027-01-18': { name: 'MLK Day', close: '13:00' },
  '2027-02-15': { name: "Presidents' Day", close: '13:00' },
  '2027-03-26': { name: 'Good Friday', closed: true },
  '2027-05-31': { name: 'Memorial Day', close: '13:00' },
  '2027-06-18': { name: 'Juneteenth', close: '13:00' },   // observed: the 19th is a Saturday
  '2027-07-05': { name: 'Independence Day', close: '13:00' },   // observed: the 4th is a Sunday
  '2027-09-06': { name: 'Labor Day', close: '13:00' },
  '2027-11-25': { name: 'Thanksgiving', close: '13:00' },
  '2027-11-26': { name: 'Day after Thanksgiving', close: '13:15' },
  '2027-12-24': { name: 'Christmas', closed: true },   // observed: the 25th is a Saturday (sources disagree: one lists a 12:15 CT close)
};

const pad = v => String(v).padStart(2, '0');
/** The trade date the session holding epoch ms `ms` closes on, 'YYYY-MM-DD': from 6 pm New York it is the next day's. */
export function tradeDateOf(ms) {
  const p = nyParts(ms), d = p.h >= 18 ? nyDateAdd(p.y, p.mo, p.d, 1) : p;
  return `${d.y}-${pad(d.mo)}-${pad(d.d)}`;
}
/** The holiday entry for the session holding `ms`, or null. */
export function holidayOf(ms) { return HOLIDAYS[tradeDateOf(ms)] || null; }
const clock12 = hhmm => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}${m ? `:${pad(m)}` : ''} ${h < 12 ? 'am' : 'pm'}`; };

/** A few words on the session at `ms` when it is not an ordinary one: a holiday, its early close, the break or the weekend. '' otherwise. */
export function sessionNote(ms) {
  const p = nyParts(ms), h = holidayOf(ms), now = p.h * 60 + p.mi;
  if (h && h.closed) return `${h.name} · closed`;
  if (h && h.close && p.h < 18) {
    const [ch, cm] = h.close.split(':').map(Number);
    return now < ch * 60 + cm ? `${h.name} · closes ${clock12(h.close)}` : `${h.name} · closed early, opens 6 pm`;
  }
  if (h && h.close) return `${h.name} · closes ${clock12(h.close)}`;   // its session has opened, the evening before
  if (!globexOpen(ms)) return p.dow === 'Sat' || p.dow === 'Sun' || (p.dow === 'Fri' && p.h >= 17) ? 'weekend · opens Sun 6 pm' : 'break · opens 6 pm';
  return '';
}
