// What a season's scores add up to.
//
// Both catalogues score episodes individually, and a season is where those numbers start to
// mean something: an average to compare seasons by, and the one episode people rate highest.
// Pure arithmetic over the records the catalogue gave us.

const scored = (episodes) => (episodes || []).filter((ep) => typeof ep.score === "number" && ep.score > 0);

/* The mean, to one decimal place, of the episodes that have a score. Episodes without one are
   left out rather than counted as zero — an unaired episode is not a bad episode. Null when
   nothing has been scored, because an average of nothing is not 0.0. */
export function avgScore(episodes) {
  const rows = scored(episodes);
  if (!rows.length) return null;
  return Math.round((rows.reduce((t, ep) => t + ep.score, 0) / rows.length) * 10) / 10;
}

/* The highest-scored episode. Ties go to the earlier one, since the first time a season hit
   that mark is the more interesting fact. */
export function bestScored(episodes) {
  let best = null;
  for (const ep of scored(episodes)) {
    if (!best || ep.score > best.score) best = ep;
  }
  return best;
}

// How much of the season has a score at all, so a page can say "from 8 of 10 episodes"
// instead of implying the whole season was judged.
export const scoredCount = (episodes) => scored(episodes).length;

/* The series to plot, and the window to plot it in.

   Not 0–10: every television season lives between about 7 and 9, and drawn against a full
   ten-point axis they are all the same flat line. The window is the season's own range, which
   is what makes the shape of a season visible at all — and the two figures on the axis say
   what that range is, so a line climbing the whole box can't overstate itself.

   Snapped to half points, so the axis reads 7.5 and 9.0 rather than 7.63 and 8.94, and
   widened to at least a point: a season where every episode scored 8.1 should draw as a flat
   line through the middle, not as rounding noise magnified to fill the box. */
const MIN_SPAN = 1;
const HALF_DOWN = (v) => Math.floor(v * 2) / 2;
const HALF_UP = (v) => Math.ceil(v * 2) / 2;

export function scoreSeries(episodes) {
  const points = (episodes || [])
    .filter((ep) => typeof ep.score === "number" && ep.score > 0)
    .map((ep) => ({ e: ep.e, name: ep.name || "", score: ep.score }));
  if (points.length < 2) return null;

  const scores = points.map((p) => p.score);
  let lo = HALF_DOWN(Math.min(...scores));
  let hi = HALF_UP(Math.max(...scores));

  // Scores are given on a ten-point scale, and an axis outside it would claim range that does
  // not exist. Widening stops at the ends rather than pushing past them.
  while (hi - lo < MIN_SPAN && (lo > 0 || hi < 10)) {
    lo = Math.max(0, lo - 0.5);
    hi = Math.min(10, hi + 0.5);
  }

  return { points, lo, hi, avg: avgScore(episodes) };
}
