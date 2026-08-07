// What somebody is doing with a show, guessed from a history that arrived all at once.
//
// An import used to file every show it touched as "Watching", because a mark arriving is what
// starting a show looks like when it happens a tap at a time. A thousand of them arriving at
// once is not that. A real Trakt library holds shows finished in 2011, shows abandoned after
// two episodes, and shows genuinely mid-season, and calling all three "Watching" makes the
// Library say nothing at all.
//
// The order of the questions matters more than the thresholds do. Two exports measured while
// this was designed had a median last-watched date of three years: reading time first would
// file two thirds of a library as Dropped, and almost all of those are shows watched to the end
// years ago. Finished is not dropped. So the first question is whether anything is left, and
// time only decides between shows that do have something left.
//
// Nothing here is a claim to know. It is a better opening guess than "all of it is Watching",
// and every one of them is a tap away from being corrected.

/* Six months and eighteen. Chosen against real libraries rather than as round numbers: under
   six months a gap is a gap — a season break, a busy spring — and past eighteen the show has
   been sitting there through two of its own seasons. Between them is what "paused" means. */
export const STALE_DAYS = 183;    // beyond this, no longer something being watched
export const COLD_DAYS = 548;     // beyond this, no longer something being returned to

const DAY = 86_400_000;

/* Watched almost none of it. A show given up after two episodes of forty is not paused however
   recently it happened, and the number is deliberately generous: a single episode of a
   six-episode series is a sixth, and that is a real attempt at it. */
export const BARELY = 0.15;

/* The guess.
 *
 * `progress` is what domain/progress.js reports for this show against its catalogue entry, and
 * is optional — an import can reach a show whose metadata is not to hand, and a guess made from
 * the date alone is still better than none. `ended` says the catalogue considers the show over,
 * which is the difference between a gap and a finish.
 *
 * Returns null where there is nothing to say: no history, so nothing about this show has
 * changed and its status is not this function's business. */
export function guessStatus({ lastAt = 0, progress = null, ended = false, hidden = false, now = Date.now() } = {}) {
  // Hidden from progress on Trakt, or its history reset there. Not a guess: somebody said this
  // one is no longer on their list, in the only words that service has for it.
  if (hidden) return "dropped";

  const watched = progress ? progress.everWatched : (lastAt > 0 ? 1 : 0);
  if (!watched) return null;

  /* Caught up, whatever the date says. This is the case the whole ordering exists for: a show
     finished in 2014 and a show whose next season starts in March look identical from the
     history, and both are "nothing to do here" rather than "abandoned". Where a season is
     coming, Up next says so on its own. */
  if (progress && progress.remaining === 0) return "active";

  const days = lastAt > 0 ? (now - lastAt) / DAY : Infinity;

  if (days < STALE_DAYS) return "active";

  /* Past the first threshold with episodes still waiting, and two things bring the answer
     forward to dropped: the show is over, so nothing is coming to pull anybody back, and the
     history is barely a beginning. */
  if (ended) return "dropped";
  if (progress && progress.aired > 0 && progress.everWatched / progress.aired < BARELY) return "dropped";

  return days < COLD_DAYS ? "paused" : "dropped";
}
