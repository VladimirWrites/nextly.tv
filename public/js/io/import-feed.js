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
import { addShow } from "../domain/model.js";
import { matchFeed, planMarks, applyMarks, summarize } from "../domain/external.js";
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

   Not the same one for both: TVmaze has no films at all, so asking the television catalogue to
   find a film by its IMDb id gets a 404 and the row is written off as one nothing could place.
   That is what happened to every one of five hundred imported films — they were read out of the
   export correctly, looked up against the wrong catalogue, and counted as missing.

   Injectable so the choice can be tested without a network. */
export const lookupFor = (row) =>
  (row && row.kind === "movie" ? movieProvider() : activeProvider());

export async function importFeed(feed, { addMissing = false, onProgress = () => {}, now = Date.now(), pick = lookupFor } = {}) {
  const { known, unknown } = matchFeed(state, feed);
  let marks = 0;
  let added = 0;
  let missed = 0;

  for (const { show, row } of known) {
    marks += applyMarks(show, planMarks(show, row.episodes, now, row), now);
  }
  onProgress({ phase: "matched", done: known.length, total: known.length });

  if (addMissing && unknown.length) {
    let done = 0;
    await pool(unknown, async (row) => {
      try {
        const meta = await pick(row).lookup({ imdb: row.imdb, tvdb: row.tvdb });
        if (meta) {
          /* Kept, not just used. The lookup returns the whole record — episodes, artwork,
             scores — and dropping it meant every imported show arrived blank: no poster in the
             library, no scores, and nothing on Up next, because what Up next ranks is episodes
             this never wrote down. The request has already been paid for. */
          await cache.putMeta(meta);
          const show = addShow(state, meta, now);
          added++;
          marks += applyMarks(show, planMarks(show, row.episodes, now, row), now);
        } else missed++;
      } catch (e) {
        // One show the catalogue cannot place must not abandon the other nine hundred.
        missed++;
      }
      onProgress({ phase: "adding", done: ++done, total: unknown.length });
    });
  }

  if (marks || added) scheduleSync();
  return { shows: known.length, added, marks, missed, skipped: addMissing ? 0 : unknown.length };
}

// A few at a time. A library of five hundred unknown shows must not open five hundred
// connections, and a pool has the first results landing immediately rather than at the end.
async function pool(items, worker, size = 4) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}
