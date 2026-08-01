// Watch progress: what you've seen, what's next, and what the barcode strip draws.
//
// Pure functions over a vault show record plus its cached metadata. Nothing here touches the
// store, the DOM, or the network — callers pass both halves in, which is what makes the file
// directly testable.
//
// The metadata shape (see io/cache.js) is:
//   { id, name, status, seasons: [ { n, episodes: [ { e, name, air, runtime } ] } ] }
import { epKey, passOf, levelOf } from "./constants.js";
import { isUpcoming } from "./dates.js";

// The set of episode keys watched at least once, ever — across every pass.
export const watchedSet = (show) => new Set(((show && show.entries) || []).map((e) => e.id));

// Episode key -> the pass it was last watched in. The number the whole file compares
// against `passOf(show)`: an episode counts as watched *now* when its level has caught up
// with the pass in progress.
export const levelMap = (show) =>
  new Map(((show && show.entries) || []).map((e) => [e.id, levelOf(e)]));

// Re-exported so views can ask about passes without importing two modules.
export { passOf, levelOf } from "./constants.js";

// Every episode of a show as a flat, ordered list. Specials are excluded unless asked for:
// most people don't count them towards a show's run, and letting them into up-next would
// surface a christmas special ahead of the episode you actually wanted.
//
// Which episodes count as specials is a provider question — TMDB collects them into season
// 0, TVmaze flags them by type — so providers normalize it to a per-episode `special` flag
// and this file never has to know the difference.
export function episodeList(meta, specials = false) {
  if (!meta || !Array.isArray(meta.seasons)) return [];
  const out = [];
  for (const se of meta.seasons) {
    for (const ep of se.episodes || []) {
      if (!specials && ep.special) continue;
      out.push({
        s: se.n,
        e: ep.e,
        key: epKey(se.n, ep.e),
        name: ep.name || "",
        air: ep.air || null,
        runtime: ep.runtime || null,
        special: !!ep.special,
      });
    }
  }
  return out.sort((a, b) => a.s - b.s || a.e - b.e);
}

// Counts for one show, measured against the pass in progress.
//
// Every "watched" number here means watched *in the current pass*. On a first watch that's
// the same thing as watched at all; on a rewatch it's the distinction that makes the screen
// useful — 5/19 on your second time through, not 19/19 forever.
export function showProgress(show, meta, { specials = false, now = Date.now() } = {}) {
  const eps = episodeList(meta, specials);
  const levels = levelMap(show);
  const pass = passOf(show);

  let watched = 0;      // at the current pass
  let everWatched = 0;  // at least once, in any pass
  let aired = 0;
  let fullPasses = Infinity;
  // Minutes of aired, unwatched episodes: the honest answer to "how much is left".
  // An episode with no runtime of its own falls back to the show's average, which is the
  // number TVmaze publishes when it doesn't have per-episode times.
  const fallback = Math.max(0, +(meta && meta.runtime) || 0);
  let minutesLeft = 0;

  for (const ep of eps) {
    // A mark only counts if the episode still exists in the metadata, so a show renumbered
    // upstream can't report 41/40.
    const n = levels.get(ep.key) || 0;
    if (n >= pass) watched++;
    if (n >= 1) everWatched++;
    /* Anything the catalogue does not place in the future counts as out — including an episode
       it has no date for at all. "No date" is a gap in its records, not a claim that the episode
       has yet to happen, and an episode you have watched and marked should not be missing from
       the count of what there is to watch. */
    if (isUpcoming(ep.air, now)) continue;
    aired++;
    if (n < pass) minutesLeft += Math.max(0, +ep.runtime || 0) || fallback;
    // "Times through" counts passes over what has actually aired. Measuring it against
    // episodes that don't exist yet would mean a running show could never report having
    // been watched once, however many times you'd been through it.
    fullPasses = Math.min(fullPasses, n);
  }

  const unaired = eps.length - aired;
  const remaining = Math.max(0, countRemaining(eps, levels, pass, now));
  const ended = meta && /ended|canceled|cancelled/i.test(meta.status || "");
  const completed = aired ? Math.max(0, fullPasses) : 0;   // whole times through what's out

  return {
    watched,
    everWatched,
    aired,
    total: eps.length,
    unaired,
    remaining,                                   // aired but unwatched this pass — the actionable number
    minutesLeft,                                 // how long that would take
    pct: aired ? Math.round((watched / aired) * 100) : 0,
    pass,
    completed,                                   // passes finished end to end
    rewatching: pass > 1,
    started: watched > 0,
    caughtUp: aired > 0 && remaining === 0,      // nothing left to watch right now
    done: completed >= 1 && !!ended,             // been all the way through a finished show
  };
}

function countRemaining(eps, levels, pass, now) {
  let n = 0;
  for (const ep of eps) {
    if ((levels.get(ep.key) || 0) >= pass) continue;
    if (!isUpcoming(ep.air, now)) n++;
  }
  return n;
}

// The next episode to watch: the lowest-numbered aired episode not yet watched in the
// current pass. Gaps are deliberately respected — if you skipped S02E03, that's what comes
// next, because the alternative is silently hiding an episode you never saw.
export function nextUp(show, meta, { specials = false, now = Date.now() } = {}) {
  const levels = levelMap(show);
  const pass = passOf(show);
  for (const ep of episodeList(meta, specials)) {
    if ((levels.get(ep.key) || 0) >= pass) continue;
    // Ordered list: once something is genuinely still to come, nothing after it is watchable
    // either. An episode with no date is not that, and can be the one you are up to.
    if (isUpcoming(ep.air, now)) return null;
    return ep;
  }
  return null;
}

// When this show was last touched — the newest watch mark. Drives up-next ordering.
export const lastWatchedAt = (show) =>
  ((show && show.entries) || []).reduce((m, e) => Math.max(m, +e.m || 0), 0);

// The up-next queue: one row per active show that has something to watch right now.
//
// Ordered by your own most recent activity, so whatever you're currently bingeing sits at
// the top and a weekly show rises again each time you watch it. Shows you've never started
// sort last, newest-added first, so a fresh addition doesn't get buried under an old one.
export function upNextList(shows, metaOf, { specials = false, now = Date.now() } = {}) {
  const rows = [];
  for (const show of shows || []) {
    if (show.st !== "active") continue;
    const meta = metaOf(show.id);
    if (!meta) continue;                          // metadata not fetched yet; row appears once it is
    const ep = nextUp(show, meta, { specials, now });
    if (!ep) continue;
    rows.push({ show, meta, ep, progress: showProgress(show, meta, { specials, now }), last: lastWatchedAt(show) });
  }
  return rows.sort((a, b) => b.last - a.last || b.show.added - a.show.added || a.show.name.localeCompare(b.show.name));
}

/* ---- the barcode strip ----
   One tick per episode, grouped by season. This is the app's signature element: it makes a
   show's entire history legible at a glance — where you stopped, what you skipped, how much
   is left — in the space a progress bar would use to say a single number. */

// SEEN is what makes a rewatch legible: an episode you've watched before but not yet on
// this pass draws as a shorter bar, so the previous run shows through underneath the
// current one instead of vanishing the moment you start again.
export const TICK = { WATCHED: "w", SEEN: "s", UNWATCHED: "u", UNAIRED: "x" };

export function barcode(show, meta, { specials = false, now = Date.now() } = {}) {
  const levels = levelMap(show);
  const pass = passOf(show);
  const bySeason = new Map();
  for (const ep of episodeList(meta, specials)) {
    if (!bySeason.has(ep.s)) bySeason.set(ep.s, []);
    const n = levels.get(ep.key) || 0;
    bySeason.get(ep.s).push({
      ...ep,
      n,
      t: n >= pass ? TICK.WATCHED
        : n >= 1 ? TICK.SEEN
        : isUpcoming(ep.air, now) ? TICK.UNAIRED
        : TICK.UNWATCHED,
    });
  }
  return [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, episodes]) => ({ n, episodes, block: uniform(episodes) }));
}

/* A season with nothing to say episode by episode. The Big Bang Theory is 279 ticks, and
   most of them carry no information: twelve seasons you have watched are twelve identical
   runs of amber. When every tick in a season is the same state, that state is the whole
   season, and the strip can say so in one block instead of twenty-four bars.

   Uniform means uniform: a season part-watched, or one you are midway through with episodes
   still to air, has a shape worth drawing and stays as ticks. */
function uniform(episodes) {
  if (!episodes.length) return null;
  const first = episodes[0].t;
  return episodes.every((ep) => ep.t === first) ? first : null;
}

/* ---- what a strip decides to draw ----
   The rules below say what shape a barcode takes, which is a question about the show rather
   than about the elements it turns into. They live here so they can be checked directly: what
   the strip draws is the thing worth being sure of, and reading it back out of a rendered
   page is a poor way to be sure of anything. */

export const episodeCount = (seasons) => seasons.reduce((n, se) => n + se.episodes.length, 0);

/* The season holding next-up never collapses to a block, whatever state it is in: it is the
   one being worked through, and its cyan tick is the thing the strip exists to show. */
export const holdsNext = (se, nextKey) => !!nextKey && se.episodes.some((ep) => ep.key === nextKey);

export const isBlock = (se, nextKey) => se.block !== null && !holdsNext(se, nextKey);

/* A barcode is a picture of a show's shape, and past a certain length there is no shape to
   see: Tagesschau is 21,349 episodes across 75 seasons, and any honest drawing of that is a
   solid smear. Past the limit the strip is left out and the counts beside it carry the answer.

   Two limits because the two strips have different room — a library card is 130px and a
   glance, the show page has the width and the attention. */
export const STRIP_MAX = { mini: 320, full: 900 };

export const fitsStrip = (seasons, limit) => episodeCount(seasons) <= limit;

/* What one tick means. Named rather than styled: the state is a fact about the episode, and
   which colour says so is the stylesheet's business. */
export function tickState(ep, nextKey) {
  if (ep.key === nextKey) return "next";
  if (ep.t === TICK.WATCHED) return "watched";
  if (ep.t === TICK.SEEN) return "seen";
  if (ep.t === TICK.UNAIRED) return "unaired";
  return "unwatched";
}

// Counts for a single season, for the season header line. Also measured against the
// current pass, so a season header agrees with the show header during a rewatch.
export function seasonProgress(show, season, { specials = false, now = Date.now() } = {}) {
  const levels = levelMap(show);
  const pass = passOf(show);
  const eps = (season.episodes || []).filter((ep) => specials || !ep.special);
  let watched = 0;
  let aired = 0;
  for (const ep of eps) {
    if (!isUpcoming(ep.air, now)) aired++;
    if ((levels.get(epKey(season.n, ep.e)) || 0) >= pass) watched++;
  }
  return { watched, aired, total: eps.length };
}

/* ---- finishing something ----
   Reaching the end of a season, or of a whole show, is the only thing in here worth marking
   with more than a number — and it can only be noticed by comparing: "watched" says nothing
   about whether this mark was the one that closed a season.

   So the state is photographed either side of a mark and the two are compared. Pure, and
   deliberately not "is it complete" but "did it just become complete", which is a different
   question and the only one worth answering out loud. */
export function completion(show, meta, opts = {}) {
  const seasons = new Map();
  for (const se of (meta && meta.seasons) || []) {
    const p = seasonProgress(show, se, opts);
    seasons.set(se.n, p.aired > 0 && p.watched >= p.aired);
  }
  const p = showProgress(show, meta, opts);
  return { seasons, series: p.done, pass: p.pass };
}

// What crossed the line between two photographs. A rewatch starting is not a finish, so a
// change of pass rules everything out: every season "un-finishes" at once and none of it is
// news.
export function newlyFinished(before, after) {
  const none = { seasons: [], series: false };
  if (!before || !after || before.pass !== after.pass) return none;
  const seasons = [];
  after.seasons.forEach((done, n) => {
    if (done && before.seasons.get(n) === false) seasons.push(n);
  });
  return { seasons, series: after.series && !before.series };
}
