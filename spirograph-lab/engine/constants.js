// Simulation clock, geometry, palette and presets shared by every module.
export const TAU = Math.PI * 2;
export const TPM = 3;                        // ticks per minute (20-second ticks)
export const DT = 1 / TPM;                   // minutes per tick
export const T1 = 10080;                     // level-1 cycle = one synthetic week, in minutes
export const MAXL = 6;                       // levels available
// Live clock: 24 one-minute candles from 9:29 NY, five of those = 2 hours, tiling the day.
// Level n's period is CYCLE_BAR × pack^(MAXL-2-n), so with pack 5 the rungs are
// 10.4d, 2.08d, 10h, 2h, 24m, 4.8m — L5 is the unit, L4 is the two-hour pack.
export const CYCLE_BAR = 24;
export const CYCLE_PACK = 5;
export const CYCLE_BLOCK = CYCLE_BAR * CYCLE_PACK;   // 120 minutes
export const CYCLE_OPEN_H = 9, CYCLE_OPEN_MI = 29;
/** Live period of level `n` (0 = slowest) in minutes. */
export function livePeriod(n, levels = MAXL, pack = CYCLE_PACK) {
  return CYCLE_BAR * pack ** (levels - 2 - n);
}
export const MAX_TICKS = 12 * T1 * TPM;      // 12 weeks of history kept
export const P0 = 20000;                     // price at the centre of the fixed circle
export const AMP1 = 400;                     // points for the level-1 lever
export const BAR_MIN = 1;                    // the finest bar the history is built from: one minute
// A cycle shorter than two bars cannot be told from its aliases in one-minute data (Nyquist), so
// the ladder stops there. On the live 24-minute unit, pack 5 keeps L6 at 4.8 min (resolvable);
// a pack large enough to push L6 under two minutes holds that level at zero rather than fitting
// an alias. Levels below this are named as unresolved.
export const MIN_PERIOD = 2 * BAR_MIN;
export const FIT_STAT_MIN = 30;              // minutes of closes the residual and explained share are measured over
// Laps of its OWN cycle each level is fitted over. The fit is greedy coarse-to-fine: the slowest
// level is fitted first and SUBTRACTED, so if its window cannot cover this many laps it is
// under-determined, absorbs the trend, and every finer level is starved of the residual it needed.
// The slowest rung is 10.4d, so four laps needs ~41.7 days. The desk defaults to 4 weeks all the
// same, so out of the box L1 is fitted over ~2.7 laps and says so; 8 weeks covers it.
export const FIT_LAPS = 4;
export const TFS = [1, 5, 15, 60, 240, 1440];                             // candle timeframes, minutes
export const PAIRS = [[1440, 240], [240, 60], [60, 15], [15, 5], [5, 1]];   // [HTF, LTF]

export const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const BG = '#0b0c10', SURFACE = '#12131a', BORDER = 'rgba(240,238,230,.09)';
export const INK = '#f3f1ea', INK2 = '#c7c5bb', MUTED = '#84837c', GRID = '#24262e', AXIS = '#33353f';
export const UP = '#c7c5bb', DOWN = '#66655f';
export const FONT = '11px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const FONT_B = '500 11px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
// The figure tabs' own canvas type: Cycles, Spirograph, Modular, Price ring and Waves. The same 11px as
// everything else until the Ledger layout raises it; its dock is a wide, short strip read from across a
// desk, and 11px there was the complaint. `let`, so every renderer importing it sees the new size on its
// next frame. deskView.mount sets 13px.
export let FIG_PX = 11, FIG_FONT = FONT, FIG_FONT_B = FONT_B;
export function setFigFont(px) {
  const face = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  FIG_PX = px; FIG_FONT = `${px}px ${face}`; FIG_FONT_B = `500 ${px}px ${face}`;
}

// Playback rate: minutes of market per real second. Fixed — there is no speed control and no link
// parameter for it, so a week sweeps in the same 30 seconds for everyone.
export const SPEED = 240;
export const PRESETS = { video: { ratio: 3, k: 4, alt: true, noise: 0 }, market: { ratio: 2, k: 4, alt: true, noise: 0.35 } };

// Ranges the sliders allow; URL parameters are validated against the same limits.
export const RATIO = { min: 2, max: 4, step: 0.5 };
export const KRATIO = { min: 2, max: 6, step: 1 };

// Starting state. Anything equal to a default is left out of shared links.
// showPaths is the CENTRE paths of every circle below the pen, off by default: the pen's own path is
// the figure, and five more over it is what made the sheet unreadable. The toggle still turns them on.
export const DEFAULTS = { ratio: 3, k: 4, alt: true, noise: 0, seed: 7, L: 1, pair: 2, showPaths: false, swings: false, fibs: true };
