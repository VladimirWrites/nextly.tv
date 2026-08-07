// Applying somebody else's watch history to this library.
//
// The deciding is all in domain/external.js and none of it is here: this is the part that has
// to touch the catalogue and the store. What arrives is a feed — the shape that file
// documents — and where it came from is not this file's business. Today that is a Trakt
// export read out of a zip; a connected account would hand over the same thing.
//
// Nothing here talks to this app's server. The catalogue lookups go from the browser to
// whichever catalogue is in use, exactly as every other lookup in the app does.
import { state } from "../domain/store.js";
import { addShow, setRating, ratingOf, setStatus } from "../domain/model.js";
import { matchFeed, planMarks, applyMarks, summarize } from "../domain/external.js";
import { showProgress } from "../domain/progress.js";
import { guessStatus } from "../domain/status-guess.js";
import { isOver } from "../domain/constants.js";
import { activeProvider, movieProvider } from "./meta.js";
import * as cache from "./cache.js";
import { scheduleSync } from "./storage.js";

// What an import would do, without doing any of it.
export const previewFeed = (feed, now = Date.now()) => summarize(state, feed, now);

/* Apply a feed to the library.

   `addMissing` is the expensive half: matching what is already tracked is free, because the
   portable ids are already in the vault, while looking up everything else is one request per
   show against the catalogue.

   The screen used to offer that as a choice and no longer does — the emphasis landed on the
   cheap half, and people imported a Trakt library and got a handful of marks. It stays an
   option here because it is a real distinction and the io layer is not the place to decide it
   is uninteresting; every caller today passes true. */
/* Which catalogue can place a row this library has never seen.

   Not the same one for both: TVmaze has no movies at all, so asking the television catalogue to
   find a movie by its IMDb id gets a 404 and the row is written off as one nothing could place.
   That is what happened to every one of five hundred imported movies — they were read out of the
   export correctly, looked up against the wrong catalogue, and counted as missing.

   Injectable so the choice can be tested without a network. */
export const lookupFor = (row) =>
  (row && row.kind === "movie" ? movieProvider() : activeProvider());

export async function importFeed(feed, { addMissing = false, onProgress = () => {}, now = Date.now(), pick = lookupFor } = {}) {
  const { known, unknown } = matchFeed(state, feed);
  let marks = 0;
  let added = 0;
  let missed = 0;
  let rated = 0;
  /* Shows filed as something other than "Watching" — paused, dropped, or watched to the end.
     Counted for the same reason the marks are: it is a change the import made. */
  let filed = 0;
  /* Ratings that went nowhere, because a rating can only be written against a record and the
     catalogue could not place the title to make one. Counted rather than swallowed: an import
     that quietly drops six hundred numbers and reports success is indistinguishable from one
     where rating is broken, which is exactly the report this came from. */
  let lost = 0;

  for (const { show, row } of known) {
    const was = show.st;
    marks += applyMarks(show, planMarks(show, row.episodes, now, row), now);
    rated += applyRatings(show, row, now);
    if (fileStatus(show, row, was, cache.getMeta(show.id), now)) filed++;
  }
  onProgress({ phase: "matched", done: known.length, total: known.length });

  if (addMissing && unknown.length) {
    let done = 0;
    const place = async (row) => {
      try {
        /* A catalogue that files films and series apart answers about them apart. TMDB's find
           endpoint returns movie_results and tv_results, and its lookup reads the second — so
           asking it about a film with the show lookup searched the television half and came
           back with nothing, every time, for every film. Cinemeta has one lookup because it
           has only movies, which is why the keyless path worked and the keyed one did not. */
        const at = pick(row);
        const find = row.kind === "movie" && at.lookupMovie ? at.lookupMovie : at.lookup;
        const meta = await find({ imdb: row.imdb, tvdb: row.tvdb });
        if (meta) {
          /* Kept, not just used. The lookup returns the whole record — episodes, artwork,
             scores — and dropping it meant every imported show arrived blank: no poster in the
             library, no scores, and nothing on Up next, because what Up next ranks is episodes
             this never wrote down. The request has already been paid for. */
          await cache.putMeta(meta);
          const show = addShow(state, meta, now);
          const was = show.st;
          added++;
          marks += applyMarks(show, planMarks(show, row.episodes, now, row), now);
          rated += applyRatings(show, row, now);
          if (fileStatus(show, row, was, meta, now)) filed++;
        } else { missed++; lost += ratingsIn(row); }
      } catch (e) {
        // One show the catalogue cannot place must not abandon the other nine hundred.
        missed++;
        lost += ratingsIn(row);
      }
      onProgress({ phase: "adding", done: ++done, total: unknown.length });
    };

    /* One queue per catalogue, run at the same time.
     *
     * They were one queue, and a queue is only as fast as whatever is at the front of it.
     * TVmaze rate-limits a large import — 429, which arrives without CORS headers and so looks
     * like a network error — and the client answers by pausing every request for up to eight
     * seconds. Movies go to a different catalogue entirely and are not throttled, but they sat
     * behind five hundred TVmaze lookups and never came up: an import of six hundred films made
     * not one request for a film, and every rating that belonged to one was discarded with its
     * row. Two queues means the throttled catalogue slows only itself. */
    const movies = unknown.filter((r) => r.kind === "movie");
    const series = unknown.filter((r) => r.kind !== "movie");
    await Promise.all([pool(series, place), pool(movies, place)]);
  }

  // Nothing was even attempted for these, so their ratings are unaccounted for too.
  if (!addMissing) lost += unknown.reduce((n, r) => n + ratingsIn(r), 0);

  if (marks || added || rated || filed) scheduleSync();
  return { shows: known.length, added, marks, rated, filed, lost, missed, skipped: addMissing ? 0 : unknown.length };
}

/* Where a show lands, once its marks are in.
 *
 * applyMarks has already promoted it from "planned" to "active", which is the right answer for
 * a tap and the wrong one for a history: a library imported whole arrived entirely as
 * "Watching", including shows finished in 2011 and shows abandoned after two episodes.
 *
 * `was` is the status before the marks landed, and the guard is the same one applyMarks uses —
 * only a show that was still "planned" is filed here. So a show somebody paused or dropped
 * themselves keeps their answer, and a second import of the same zip changes nothing.
 *
 * The metadata is what makes "is there anything left" answerable, and it is not always there:
 * a show already in the library has whatever the cache holds, which may be nothing until it is
 * next opened. The guess falls back to the dates alone in that case rather than being skipped. */
function fileStatus(show, row, was, meta, now) {
  if (was !== "planned" || show.kind === "movie") return false;
  const st = guessStatus({
    lastAt: row.lastAt || 0,
    progress: meta ? showProgress(show, meta, { now }) : null,
    ended: !!(meta && isOver(meta.status)),
    hidden: !!row.hidden,
    now,
  });
  if (!st || st === show.st) return false;
  setStatus(state, show.id, st, now);
  return true;
}

/* The numbers the export carried for this title, written against the record that was matched
   to it.
 *
 * The day it was rated travels with each one. An import happens on a Tuesday and describes
 * years of opinions, so the mtime says Tuesday and `w` says when it was really given — the
 * same split the marks draw, and the reason statistics can say anything true about a library
 * that arrived all at once.
 *
 * A rating already held is left alone when it says the same thing. Re-importing the same zip
 * should not touch a single mtime, or every device would resync a library that has not
 * changed. */
const ratingsIn = (row) => ((row && row.ratings) || []).length;

function applyRatings(show, row, now) {
  let n = 0;
  for (const r of (row && row.ratings) || []) {
    if (ratingOf(show, r.id) === r.v) continue;
    setRating(state, show.id, r.id, r.v, now, { ratedAt: r.w || 0 });
    n++;
  }
  return n;
}

// A few at a time. A library of five hundred unknown shows must not open five hundred
// connections, and a pool has the first results landing immediately rather than at the end.
async function pool(items, worker, size = 4) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}
