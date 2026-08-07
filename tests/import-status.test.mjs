// Filing shows as an import brings them in.
//
// The guess itself is tested in status-guess.test.mjs; this is the wiring around it — that the
// import asks the question at all, that it asks with the metadata it actually has, and above
// all that it never answers over the top of somebody who has already answered.
import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../public/js/domain/store.js";
import { addShow, setStatus } from "../public/js/domain/model.js";
import { importFeed } from "../public/js/io/import-feed.js";
import * as cache from "../public/js/io/cache.js";

const NOW = Date.UTC(2026, 7, 7);
const DAY = 86_400_000;
const daysAgo = (n) => NOW - n * DAY;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/* A show of `n` episodes in one season, all aired years ago unless told otherwise. */
const meta = (key, n, over = {}) => ({
  key, src: "tvmaze", ref: 1, name: "A Show", year: 2015, status: "Ended",
  imdb: "tt0306414",
  seasons: [{ n: 1, episodes: Array.from({ length: n }, (_, i) => ({
    e: i + 1, name: `E${i + 1}`, air: iso(daysAgo(2000 - i)), runtime: 45,
  })) }],
  ...over,
});

const eps = (n, at) => Array.from({ length: n }, (_, i) => ({ s: 1, e: i + 1, at, plays: 1 }));

const fresh = () => { state.shows = []; state.del = {}; state.settings = {}; };

// Catalogue stubs: the import asks for what it does not hold, and gets this.
const catalogue = (m) => ({ lookup: async () => m, lookupMovie: async () => m });

test("a show watched to the end years ago arrives as Watching, not as dropped", async () => {
  fresh();
  const m = meta("tvmaze:1", 10);
  const feed = { shows: [{ name: "A Show", imdb: "tt0306414", lastAt: daysAgo(1500),
    episodes: eps(10, daysAgo(1500)) }] };
  const r = await importFeed(feed, { addMissing: true, pick: () => catalogue(m), now: NOW });
  assert.equal(r.added, 1);
  assert.equal(state.shows[0].st, "active", "nothing left to watch is not abandonment");
});

test("a show half-watched a year ago arrives paused", async () => {
  fresh();
  const m = meta("tvmaze:2", 20, { status: "Running" });
  const feed = { shows: [{ name: "A Show", imdb: "tt0306414", lastAt: daysAgo(365),
    episodes: eps(10, daysAgo(365)) }] };
  await importFeed(feed, { addMissing: true, pick: () => catalogue(m), now: NOW });
  assert.equal(state.shows[0].st, "paused");
  assert.equal(state.shows[0].entries.length, 10, "and its marks came with it");
});

test("a show given up years ago arrives dropped", async () => {
  fresh();
  const m = meta("tvmaze:3", 40, { status: "Running" });
  const feed = { shows: [{ name: "A Show", imdb: "tt0306414", lastAt: daysAgo(1200),
    episodes: eps(2, daysAgo(1200)) }] };
  const r = await importFeed(feed, { addMissing: true, pick: () => catalogue(m), now: NOW });
  assert.equal(state.shows[0].st, "dropped");
  assert.equal(r.filed, 1, "and the import counted it as filed somewhere other than Watching");
});

test("something watched last week is still being watched", async () => {
  fresh();
  const m = meta("tvmaze:4", 20, { status: "Running" });
  await importFeed({ shows: [{ name: "A Show", imdb: "tt0306414", lastAt: daysAgo(6),
    episodes: eps(8, daysAgo(6)) }] }, { addMissing: true, pick: () => catalogue(m), now: NOW });
  assert.equal(state.shows[0].st, "active");
});

/* The guard that matters most. Somebody who paused a show themselves has said something the
   import has no business overruling — and a re-import of the same zip is exactly the case
   where it would try. */
test("a status somebody set themselves survives an import", async () => {
  fresh();
  const m = meta("tvmaze:5", 20, { status: "Running" });
  await cache.putMeta(m);
  addShow(state, m, NOW);
  setStatus(state, "tvmaze:5", "dropped", NOW);

  const feed = { shows: [{ name: "A Show", imdb: "tt0306414", tvdb: null, lastAt: daysAgo(3),
    episodes: eps(4, daysAgo(3)) }] };
  const r = await importFeed(feed, { addMissing: true, pick: () => catalogue(m), now: NOW });
  assert.equal(r.shows, 1, "it was matched, not added again");
  assert.equal(state.shows[0].st, "dropped", "recent marks do not undo a decision");
});

test("importing the same file twice changes nothing the second time", async () => {
  fresh();
  const m = meta("tvmaze:6", 20, { status: "Running" });
  const feed = () => ({ shows: [{ name: "A Show", imdb: "tt0306414", lastAt: daysAgo(400),
    episodes: eps(10, daysAgo(400)) }] });
  await importFeed(feed(), { addMissing: true, pick: () => catalogue(m), now: NOW });
  const first = state.shows[0].st;
  const again = await importFeed(feed(), { addMissing: true, pick: () => catalogue(m), now: NOW + DAY });
  assert.equal(state.shows[0].st, first);
  assert.equal(again.filed, 0);
  assert.equal(again.marks, 0);
});

/* A watchlisted show carries no history, and "planned" is already the right answer for it. */
test("a watchlisted show stays planned", async () => {
  fresh();
  const m = meta("tvmaze:7", 20, { status: "Running" });
  await importFeed({ shows: [{ name: "A Show", imdb: "tt0306414", episodes: [] }] },
    { addMissing: true, pick: () => catalogue(m), now: NOW });
  assert.equal(state.shows[0].st, "planned");
});

/* Movies have no middle. Watching, paused and dropped are all "partway through", which is not
   something a film is, and the Library filters read them that way. */
test("a movie is not filed as paused or dropped", async () => {
  fresh();
  const m = { key: "tmdb:m99", src: "tmdb", ref: "m99", kind: "movie", name: "A Film",
    year: 2001, imdb: "tt1630029", seasons: [] };
  await importFeed({ shows: [{ kind: "movie", name: "A Film", imdb: "tt1630029",
    lastAt: daysAgo(3000), plays: 1, at: daysAgo(3000), episodes: [] }] },
  { addMissing: true, pick: () => catalogue(m), now: NOW });
  assert.notEqual(state.shows[0].st, "dropped");
  assert.notEqual(state.shows[0].st, "paused");
});

/* A show already in the library whose catalogue entry has not been loaded this session. The
   dates are all there is, and they are enough to be going on with. */
test("a show with no metadata to hand is still filed by its dates", async () => {
  fresh();
  addShow(state, { key: "tvmaze:8", src: "tvmaze", ref: 8, name: "A Show", imdb: "tt0306414" }, NOW);
  await cache.dropMeta("tvmaze:8");
  await importFeed({ shows: [{ name: "A Show", imdb: "tt0306414", lastAt: daysAgo(1000),
    episodes: eps(3, daysAgo(1000)) }] }, { addMissing: false, pick: () => catalogue(null), now: NOW });
  assert.equal(state.shows[0].st, "dropped");
});
