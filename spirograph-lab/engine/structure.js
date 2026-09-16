// Swing detection on a candle series: pivots (HH / HL / LH / LL), BOS and CHoCH events.
// `cd` is a candle set from sim.candles(tf); [j0, j1) is the bar range; s is the pivot strength.
export function detectStructure(cd, j0, j1, s) {
  const piv = [];
  for (let i = j0 + s; i < j1 - s; i++) {
    let isH = true, isL = true;
    for (let j = i - s; j <= i + s; j++) { if (j === i) continue; if (cd.h[j] >= cd.h[i]) isH = false; if (cd.l[j] <= cd.l[i]) isL = false; if (!isH && !isL) break; }
    if (isH) piv.push({ i, p: cd.h[i], t: 'H' }); if (isL) piv.push({ i, p: cd.l[i], t: 'L' });
  }
  const alt = [];
  for (const p of piv) { const last = alt[alt.length - 1]; if (last && last.t === p.t) { if ((p.t === 'H' && p.p > last.p) || (p.t === 'L' && p.p < last.p)) alt[alt.length - 1] = p; } else alt.push(p); }
  let lastH = null, lastL = null;
  for (const p of alt) { if (p.t === 'H') { p.label = lastH ? (p.p > lastH.p ? 'HH' : 'LH') : 'H'; lastH = p; } else { p.label = lastL ? (p.p > lastL.p ? 'HL' : 'LL') : 'L'; lastL = p; } }
  const events = []; let trend = 0, refH = null, refL = null, pi = 0;
  for (let i = j0; i < j1; i++) {
    while (pi < alt.length && alt[pi].i + s <= i) { const p = alt[pi++]; if (p.t === 'H') refH = p; else refL = p; }
    if (refH && cd.c[i] > refH.p) { events.push({ from: refH.i, to: i, p: refH.p, dir: 1, kind: trend === -1 ? 'CHoCH' : 'BOS' }); trend = 1; refH = null; }
    if (refL && cd.c[i] < refL.p) { events.push({ from: refL.i, to: i, p: refL.p, dir: -1, kind: trend === 1 ? 'CHoCH' : 'BOS' }); trend = -1; refL = null; }
  }
  return { pivots: alt, events };
}

/** The coarsest candle timeframe (minutes) a cycle of P minutes shapes: six or more bars per turn (a week cycle ≈ daily bars). */
export function barsForPeriod(P, tfs) { let best = tfs[0]; for (const tf of tfs) if (P >= 6 * tf) best = tf; return best; }

/** The deepest active level whose cycle is long enough to shape swings on a timeframe of `tf` minutes. */
export function structureLevel(sim, tf) { let best = 0; for (let n = 0; n < sim.L; n++) if (sim.periodOf(n) >= 8 * tf) best = n; return best; }
