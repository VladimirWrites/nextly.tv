// Bringing a watch history in from somewhere else, and sending one back.
//
// Trakt holds the same thing this app holds: which episodes of which shows
// somebody has seen, and when. What they do not share is how a show is named. They answer in
// IMDb, TheTVDB and TMDB ids; this app keys shows by whichever catalogue is in use. The
// portable ids stored against every show are what bridges the two, which is the reason they
// are in the vault at all.
//
// Pure. Everything here takes a state and a normalized feed and returns a plan; nothing
// fetches, nothing writes, nothing reads a clock it was not handed. The services in
// io/services/ do the talking and hand over the shape below.
//
// A feed is:
//   { shows: [ { name, year, imdb, tvdb, tmdb, episodes: [ { s, e, at, plays } ] } ] }
//
// `at` is epoch milliseconds and may be 0 when the service does not say. `plays` is how many
// times that service thinks the episode has been seen, and may be absent.
import { findSameShow, findShow } from "./schema.js";
import { start } from "./model.js";
import { epKey, parseEpKey, levelOf, MOVIE_MARK } from "./constants.js";

// Absent is not zero. Only something that is actually a number counts as one.
const num = (v) => (v === null || v === undefined || v === "" ? NaN : Math.trunc(+v));

/* Which of a feed's shows this library already holds, and which it has never heard of.
   Matched on the portable ids rather than on names: two shows can share a title and a year,
   and an id is either the same show or it is not. */
export function matchFeed(state, feed) {
  const known = [];
  const unknown = [];
  for (const row of (feed && feed.shows) || []) {
    /* Which kind this row is, said out loud. Without it every row was matched as a series, so
       a movie already in the library could never be recognised — findSameShow guards on kind,
       and a movie record could not answer a question asked about a show.

       It went unnoticed because a first import does not need matching: an unmatched row is
       added, and adding one already held folds into the record that exists. A second import
       is where it shows, which is exactly what somebody does to pick up ratings for a library
       they already imported — and every movie in it was skipped.

       The key is built per kind too. TMDB numbers films and series separately, so 76600 is a
       different title in each, and a movie's key carries the m that says which. */
    const movie = row.kind === "movie";
    const show = findSameShow(state, {
      kind: movie ? "movie" : undefined,
      imdb: row.imdb || null,
      tvdb: movie ? null : row.tvdb || null,
      tmdb: row.tmdb || null,
      // A TMDB id is also a key here when TMDB is the catalogue in use, so it is offered as
      // one. findSameShow ignores a key it does not recognise.
      key: row.tmdb ? (movie ? `tmdb:m${row.tmdb}` : `tmdb:${row.tmdb}`) : null,
    });
    if (show) known.push({ show, row });
    else unknown.push(row);
  }
  return { known, unknown };
}

/* What marking this feed's episodes against one show would change.

   Only additions. A history held elsewhere is evidence that something was watched; it is not
   evidence that anything was *not* watched, so nothing here removes a mark. Someone who wants
   the other service to win can clear the show first — that is a decision, and it should look
   like one.

   `w` carries the date the service reports and `m` carries now, which is the distinction the
   schema draws: `m` is when this record changed and is what sync resolves conflicts with, `w`
   is when the episode was actually seen and is what the statistics read. Stamping `m` with an
   imported date would make this device's copy look older than every other device's and lose
   the merge. */
export function planMarks(show, episodes, now, row = null) {
  const have = new Map((show.entries || []).map((e) => [e.id, e]));

  /* A movie has one mark and no episodes, so the loop below has nothing to walk. What it carries
     instead is a play count and a date, which is the same pair every episode carries — so the
     plan is built by hand here and applied by exactly the same code. */
  if (row && row.kind === "movie") {
    const plays = Math.max(0, Math.trunc(+row.plays) || 0);
    const at = +row.at || 0;
    /* A movie row is not a claim to have seen it. A watchlisted film and a film rated without
       being watched both arrive as rows with no plays and no date, and marking those watched
       would put a film somebody means to see into the pile of films they have — the one place
       a tracker must not be wrong. Nothing to mark, so nothing is marked; the row still lands
       in the library, planned, carrying whatever rating came with it. */
    if (!plays && !at) return { add: [], raise: [] };
    const level = Math.max(1, plays);
    const held = have.get(MOVIE_MARK);
    if (!held) {
      return { add: [{ id: MOVIE_MARK, m: now, ...(level > 1 ? { n: level } : {}), ...(at > 0 ? { w: at } : {}) }], raise: [] };
    }
    const wantsDate = at > 0 && !held.w;
    const wantsLevel = level > levelOf(held);
    return {
      add: [],
      raise: wantsDate || wantsLevel
        ? [{ id: MOVIE_MARK, ...(wantsDate ? { w: at } : {}), ...(wantsLevel ? { n: level } : {}) }]
        : [],
    };
  }
  const add = [];
  const raise = [];
  for (const ep of episodes || []) {
    /* Coerced deliberately rather than with +, because +null is 0 and season 0 is a real
       season here — it is where specials live. A row with no season at all would have become
       a special, silently, which is worse than dropping it. */
    const s = num(ep.s);
    const e = num(ep.e);
    if (!(s >= 0) || !(e >= 0)) continue;
    const id = epKey(s, e);
    const at = +ep.at || 0;
    // A play count above one is the other service saying this was seen more than once, which
    // is what a pass level means here.
    const level = Math.max(1, Math.trunc(+ep.plays) || 1);
    const held = have.get(id);
    if (!held) {
      add.push({ id, m: now, ...(level > 1 ? { n: level } : {}), ...(at > 0 ? { w: at } : {}) });
      continue;
    }
    /* Already held. The only thing worth taking from the feed is a date this copy does not
       have, or a higher pass. Overwriting a `w` that is already set would let an import
       rewrite history somebody may have corrected by hand. */
    const wantsDate = at > 0 && !held.w;
    const wantsLevel = level > levelOf(held);
    if (wantsDate || wantsLevel) {
      raise.push({
        id,
        ...(wantsDate ? { w: at } : {}),
        ...(wantsLevel ? { n: level } : {}),
      });
    }
  }
  return { add, raise };
}

/* Apply a plan to one show. Separate from planning it so the counts can be shown before
   anything is written, and so the plan itself can be tested without a state to mutate. */
export function applyMarks(show, plan, now) {
  let changed = 0;
  for (const mark of plan.add || []) {
    show.entries.push({ ...mark });
    changed++;
  }
  const byId = new Map(show.entries.map((e) => [e.id, e]));
  for (const up of plan.raise || []) {
    const e = byId.get(up.id);
    if (!e) continue;
    if (up.w) e.w = up.w;
    if (up.n) e.n = up.n;
    e.m = now;
    changed++;
  }
  /* Marks arrived, so this is something being watched rather than something planned. The same
     rule the app applies to a tap, applied to a thousand of them: only from planned, so a show
     somebody paused or dropped is not dragged back into Up next by an import. */
  if (changed) start(show, now);
  if (changed) show.m = now;
  return changed;
}

/* What this library holds that the service does not.

   The mirror of an import, and deliberately not symmetrical with it: this returns episodes to
   send, never episodes to delete there. Removing somebody's history on another service
   because this copy lacks it is not a sync, it is a data loss with a progress bar.

   Shows the feed has never heard of are skipped rather than created. Adding a show to Trakt
   from here would mean deciding which of its ids to send and hoping; a show already in the
   feed has told us its ids itself. */
export function planPush(state, feed) {
  const out = [];
  for (const row of (feed && feed.shows) || []) {
    const show = findSameShow(state, {
      imdb: row.imdb || null,
      tvdb: row.tvdb || null,
      key: row.tmdb ? `tmdb:${row.tmdb}` : null,
    });
    if (!show) continue;
    const theirs = new Set((row.episodes || []).map((e) => epKey(e.s, e.e)));
    const episodes = [];
    for (const e of show.entries || []) {
      if (theirs.has(e.id)) continue;
      const parsed = parseEpKey(e.id);
      if (!parsed) continue;
      episodes.push({ s: parsed.s, e: parsed.e, at: e.w || 0 });
    }
    if (episodes.length) {
      out.push({ imdb: row.imdb || null, tvdb: row.tvdb || null, tmdb: row.tmdb || null,
        name: show.name, episodes });
    }
  }
  return out;
}

/* A count of what an import would do, for saying so before doing it. Nobody should press a
   button called Import and find out afterwards that it added four hundred marks. */
export function summarize(state, feed, now) {
  const { known, unknown } = matchFeed(state, feed);
  let add = 0;
  let raise = 0;
  for (const { show, row } of known) {
    const plan = planMarks(show, row.episodes, now, row);
    add += plan.add.length;
    raise += plan.raise.length;
  }
  /* Split by kind, because "596 shows" was counting 593 films among them. The button offered
     to import shows and their history and said nothing about the films it was about to add,
     which is a promise that does not match what happens. */
  const newMovies = unknown.filter((r) => r.kind === "movie").length;
  return {
    shows: known.length,
    newShows: unknown.length - newMovies,
    newMovies,
    marks: add,
    updated: raise,
    // Every episode the feed mentions, whether or not it changes anything here.
    seen: ((feed && feed.shows) || []).reduce((n, r) => n + ((r.episodes || []).length), 0),
  };
}

// The show a feed row would become, for the io layer to resolve against a catalogue.
export const feedIds = (row) => ({
  imdb: row.imdb || null,
  tvdb: row.tvdb || null,
  tmdb: row.tmdb || null,
  name: row.name || "",
  year: row.year || null,
});

// Whether a library already holds this show, by id alone. Used after a catalogue lookup has
// turned a feed row into a real key.
export const alreadyHeld = (state, key) => !!findShow(state, key);
