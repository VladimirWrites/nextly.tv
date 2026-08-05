// Films.
//
// A film is the show record with one mark and no seasons. These cover the places where that
// choice could go wrong quietly — and one of them did: normShow validated every mark id against
// "<season>x<episode>", so a film's only mark was dropped every time the vault was read. It
// saved correctly, came back empty, and nothing anywhere said so.
import test from "node:test";
import assert from "node:assert/strict";
import { movieKey, isMovieKey, movieRef, isMovie, MOVIE_MARK, epKey } from "../public/js/domain/constants.js";
import { makeShow, normShow, findSameShow, findLikeShow } from "../public/js/domain/schema.js";
import { markMovie, movieWatched, moviePlays, addShow, start } from "../public/js/domain/model.js";
import { upNextList } from "../public/js/domain/progress.js";

const WIRE = { ids: { trakt: 1429, imdb: "tt0306414" }, title: "The Wire", year: 2002 };
const play = (show, s, e, at) => ({ type: "episode", action: "watch", watched_at: at,
  episode: { ids: { trakt: 1 }, season: s, number: e }, show });

const NOW = 1_700_000_000_000;
const film = (over = {}) => normShow(makeShow({
  key: "tmdb:m76600", src: "tmdb", ref: "m76600", kind: "movie",
  name: "Avatar: The Way of Water", year: 2022, imdb: "tt1630029", ...over,
}, NOW));

/* TMDB numbers films and series separately, so 76600 means two different things in the same
   catalogue. The marker is what keeps them apart in a key that has to survive being shared. */
test("a film key is not a show key, even for the same number", () => {
  assert.equal(movieKey("tmdb", 76600), "tmdb:m76600");
  assert.ok(isMovieKey("tmdb:m76600"));
  assert.ok(!isMovieKey("tmdb:76600"));
  assert.equal(movieRef("tmdb:m76600"), "76600");
  assert.equal(movieRef("tmdb:76600"), null);
});

test("Cinemeta keys by IMDb id, which survives the marker", () => {
  assert.equal(movieKey("cinemeta", "tt1630029"), "cinemeta:mtt1630029");
  assert.equal(movieRef("cinemeta:mtt1630029"), "tt1630029");
});

/* The mark that normalisation used to eat. epKey builds "<season>x<episode>" and can never
   produce "m", so the two id shapes cannot collide however they are stored. */
test("a film's mark survives being read back", () => {
  const sh = film();
  markMovie({ shows: [sh] }, sh.id, true, NOW);
  assert.equal(sh.entries.length, 1);
  assert.equal(sh.entries[0].id, MOVIE_MARK);

  const again = normShow(JSON.parse(JSON.stringify(sh)));
  assert.equal(again.entries.length, 1, "normalisation must not drop it");
  assert.ok(movieWatched(again));
});

test("nonsense in the entries is still refused", () => {
  const sh = film();
  sh.entries = [{ id: "m", m: NOW }, { id: "1x1", m: NOW }, { id: "nonsense", m: NOW }, { id: "", m: NOW }];
  assert.deepEqual(normShow(sh).entries.map((e) => e.id), ["m", "1x1"]);
});

test("a film's kind survives being read back", () => {
  assert.equal(normShow(JSON.parse(JSON.stringify(film()))).kind, "movie");
  assert.ok(isMovie(normShow(JSON.parse(JSON.stringify(film())))));
});

test("a show carries no kind at all, so old records read as shows", () => {
  const sh = normShow(makeShow({ key: "tvmaze:169", src: "tvmaze", ref: 169, name: "Breaking Bad" }, NOW));
  assert.equal("kind" in sh, false);
  assert.ok(!isMovie(sh));
});

/* Marking a film must not start it. "Watching" describes being partway through something, and
   Up next answers a question a film has no answer to. */
test("marking a film leaves it planned, and off Up next", () => {
  const sh = film();
  const state = { shows: [sh] };
  markMovie(state, sh.id, true, NOW);
  assert.equal(sh.st, "planned");
  assert.ok(movieWatched(sh));
  assert.equal(upNextList(state.shows, () => ({ seasons: [] }), { specials: true }).length, 0);
});

test("unmarking removes it again", () => {
  const sh = film();
  const state = { shows: [sh] };
  markMovie(state, sh.id, true, NOW);
  markMovie(state, sh.id, false, NOW);
  assert.equal(sh.entries.length, 0);
  assert.ok(!movieWatched(sh));
});

/* An import can say a film was seen more than once — Trakt counts plays — and the pass level
   is where that already lives for shows. */
test("plays are the pass level, so a rewatch counts", () => {
  const sh = film();
  sh.entries = [{ id: MOVIE_MARK, m: NOW, n: 3 }];
  assert.equal(moviePlays(sh), 3);
  assert.ok(movieWatched(sh));
  assert.equal(moviePlays(film()), 0, "and an unwatched film has none");
});

/* Fargo the film and Fargo the series are not the same thing, and neither are the remakes that
   share a title with the year of their source. */
test("a film never folds into a show of the same name and year", () => {
  const state = { shows: [normShow(makeShow({
    key: "tvmaze:1", src: "tvmaze", ref: 1, name: "Fargo", year: 1996, imdb: "tt0116282",
  }, NOW))] };
  const card = { key: "tmdb:m275", src: "tmdb", ref: "m275", kind: "movie", name: "Fargo", year: 1996 };
  assert.equal(findLikeShow(state, card), null);
  assert.equal(findSameShow(state, { ...card, imdb: "tt0116282" }), null,
    "not even on a shared id, which should never happen and would take the marks with it");
});

test("a film does fold into the same film from another catalogue", () => {
  const state = { shows: [film()] };
  const same = { key: "cinemeta:mtt1630029", src: "cinemeta", ref: "mtt1630029", kind: "movie",
                 name: "Avatar: The Way of Water", year: 2022, imdb: "tt1630029" };
  assert.ok(findSameShow(state, same), "matched on the portable id, as shows are");
});

test("adding a film files it as one", () => {
  const state = { shows: [] };
  const sh = addShow(state, { key: "tmdb:m76600", src: "tmdb", ref: "m76600", kind: "movie",
                              name: "Avatar: The Way of Water", year: 2022 }, NOW);
  assert.equal(sh.kind, "movie");
  assert.equal(sh.st, "planned");
  start(sh, NOW);
  assert.equal(sh.st, "planned", "and start() has nothing to say about it");
});

/* ---- films out of a Trakt export ---- */

import { filmsFromHistory, readExport } from "../public/js/domain/trakt-export.js";
import { planMarks, applyMarks } from "../public/js/domain/external.js";

const filmPlay = (at, ids = { trakt: 56580, imdb: "tt1630029", tmdb: 76600 }) => ({
  type: "movie", action: "watch", watched_at: at,
  movie: { ids, year: 2022, title: "Avatar: The Way of Water" },
});

test("a film play becomes a row with no episodes", () => {
  const rows = filmsFromHistory([filmPlay("2023-01-01T20:00:00Z")]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "movie");
  assert.deepEqual(rows[0].episodes, []);
  assert.equal(rows[0].imdb, "tt1630029");
  assert.equal(rows[0].plays, 1);
});

test("repeated film plays are counted, latest date kept", () => {
  const rows = filmsFromHistory([
    filmPlay("2023-01-01T20:00:00Z"), filmPlay("2024-06-01T20:00:00Z"), filmPlay("2023-08-01T20:00:00Z"),
  ]);
  assert.equal(rows[0].plays, 3);
  assert.equal(rows[0].at, Date.parse("2024-06-01T20:00:00Z"));
});

/* Trakt numbers films and series separately, so the same number is two different titles. The
   first version of this keyed on the number alone and a film quietly ate a watchlisted series. */
test("a film and a series sharing a Trakt id stay two rows", () => {
  const r = readExport({
    "watched-history.json": [
      play(WIRE, 1, 1, "2018-02-03T21:30:00Z"),
      filmPlay("2023-01-01T20:00:00Z", { trakt: 1429, imdb: "tt1630029" }),   // same id as WIRE
    ],
  });
  assert.equal(r.feed.shows.length, 2);
  assert.equal(r.films, 1);
});

/* The setting hides films; it does not decide what is kept. Somebody who switches films on a
   month after importing should find their history already there rather than having to fetch
   the export again. */
test("films are imported whether or not they are switched on", () => {
  const r = readExport({ "watched-history.json": [filmPlay("2023-01-01T20:00:00Z")] });
  assert.equal(r.films, 1);
  assert.equal(r.feed.shows.length, 1);
  assert.equal(r.feed.shows[0].kind, "movie");
});

/* The import writes a film's mark from its play count, which is where a rewatch elsewhere
   becomes a rewatch here. */
test("importing a film writes one mark carrying its plays and date", () => {
  const sh = film();
  const at = Date.parse("2024-06-01T20:00:00Z");
  const plan = planMarks(sh, [], NOW, { kind: "movie", plays: 3, at });
  assert.equal(plan.add.length, 1);
  assert.equal(plan.add[0].id, MOVIE_MARK);
  assert.equal(plan.add[0].n, 3);
  assert.equal(plan.add[0].w, at, "when it was seen, not when it was imported");
  assert.equal(plan.add[0].m, NOW, "and m is when this device recorded it");
  applyMarks(sh, plan, NOW);
  assert.equal(moviePlays(sh), 3);
});

test("importing a film twice adds nothing the second time", () => {
  const sh = film();
  const row = { kind: "movie", plays: 1, at: Date.parse("2024-06-01T20:00:00Z") };
  applyMarks(sh, planMarks(sh, [], NOW, row), NOW);
  const again = planMarks(sh, [], NOW, row);
  assert.deepEqual(again.add, []);
  assert.deepEqual(again.raise, []);
});

test("a higher play count raises an existing mark", () => {
  const sh = film();
  applyMarks(sh, planMarks(sh, [], NOW, { kind: "movie", plays: 1, at: 0 }), NOW);
  applyMarks(sh, planMarks(sh, [], NOW, { kind: "movie", plays: 4, at: 0 }), NOW);
  assert.equal(moviePlays(sh), 4);
});

/* TMDB carries announced projects years ahead of release. Sorting a filmography on the year
   alone opened Sam Worthington's page with Avatar 5 and Avatar 4 — neither of which exists —
   ahead of every film he has actually been in. A career is what happened, then what is coming. */
test("a filmography leads with what exists, not with what is announced", () => {
  const now = new Date().getFullYear();
  const credits = [
    { name: "Announced Sequel", year: now + 3 },
    { name: "Last Year's Film", year: now - 1 },
    { name: "Undated Project", year: null },
    { name: "The Old One", year: now - 20 },
    { name: "Next Year", year: now + 1 },
  ];
  const unreleased = (c) => !c.year || c.year > now;
  credits.sort((a, b) => (unreleased(a) !== unreleased(b) ? (unreleased(a) ? 1 : -1) : (b.year || 0) - (a.year || 0)));
  assert.deepEqual(credits.map((c) => c.name),
    ["Last Year's Film", "The Old One", "Announced Sequel", "Next Year", "Undated Project"]);
});

/* ---- which catalogue places an imported row ----

   Five hundred and ninety-three films were read out of a Trakt export correctly, looked up
   against TVmaze — which has no films — and written off as titles nothing could place. The
   library came back with the shows and none of the movies, and the count said "missed". */
test("a movie row is placed by the movie catalogue, a show row by the show one", async () => {
  const { importFeed } = await import("../public/js/io/import-feed.js");
  const { state } = await import("../public/js/domain/store.js");
  state.shows = [];
  state.settings = { provider: "tvmaze", m: 1 };

  const asked = [];
  const stub = (id) => ({
    id,
    lookup: async ({ imdb }) => {
      asked.push({ id, imdb });
      return { key: `${id}:${imdb}`, src: id, ref: imdb, name: `From ${id}`, imdb,
               kind: id === "cinemeta" ? "movie" : undefined, seasons: [] };
    },
  });

  await importFeed({ shows: [
    { name: "A Series", imdb: "tt0306414", episodes: [{ s: 1, e: 1, at: 0, plays: 1 }] },
    { name: "A Film", imdb: "tt1630029", kind: "movie", plays: 1, at: 0, episodes: [] },
  ] }, {
    addMissing: true,
    pick: (row) => (row.kind === "movie" ? stub("cinemeta") : stub("tvmaze")),
  });

  assert.deepEqual(asked.sort((a, b) => a.id.localeCompare(b.id)), [
    { id: "cinemeta", imdb: "tt1630029" },
    { id: "tvmaze", imdb: "tt0306414" },
  ], "each row went to the catalogue that can answer for it");
  assert.equal(state.shows.length, 2);
  assert.ok(state.shows.some((x) => x.kind === "movie"), "and the film was added as one");
});

/* ---- the same movie, found in the other catalogue ----

   A film added from Cinemeta is keyed by its IMDb id. Switch to TMDB and search for it again
   and the result carries TMDB's id and no IMDb id at all — that endpoint does not return one.
   With nothing in common the row offered to add a film the library already held, and pressing
   it said "already in your library", which is a fine way to make somebody distrust both. */

test("a TMDB search result matches the same movie added from Cinemeta", () => {
  const held = normShow(makeShow({
    key: "cinemeta:mtt0111161", src: "cinemeta", ref: "mtt0111161", kind: "movie",
    name: "The Shawshank Redemption", year: 1994, imdb: "tt0111161", tmdb: 278,
  }, NOW));
  assert.equal(held.tmdb, 278, "TMDB's id is kept, because for a film it is the only bridge");

  const state = { shows: [held] };
  // Exactly what tmdb.searchMovies returns: an id, and no imdb.
  const row = { key: "tmdb:m278", src: "tmdb", ref: "m278", kind: "movie",
                name: "The Shawshank Redemption", year: 1994 };
  assert.equal(findSameShow(state, row), held);
  assert.equal(findLikeShow(state, row), held);
});

test("and the other way round: a Cinemeta result matches one added from TMDB", () => {
  const held = normShow(makeShow({
    key: "tmdb:m278", src: "tmdb", ref: "m278", kind: "movie",
    name: "The Shawshank Redemption", year: 1994, imdb: "tt0111161", tmdb: 278,
  }, NOW));
  const state = { shows: [held] };
  const row = { key: "cinemeta:mtt0111161", src: "cinemeta", ref: "mtt0111161", kind: "movie",
                name: "The Shawshank Redemption", year: 1994, imdb: "tt0111161" };
  assert.equal(findSameShow(state, row), held);
});

test("a TMDB id survives being read back", () => {
  const sh = normShow(JSON.parse(JSON.stringify(normShow(makeShow({
    key: "cinemeta:mtt0111161", src: "cinemeta", ref: "mtt0111161", kind: "movie",
    name: "The Shawshank Redemption", year: 1994, imdb: "tt0111161", tmdb: 278,
  }, NOW)))));
  assert.equal(sh.tmdb, 278);
});

/* Two different films must not fold together just because both are on TMDB. */
test("different TMDB ids stay different movies", () => {
  const state = { shows: [normShow(makeShow({
    key: "cinemeta:mtt0111161", src: "cinemeta", ref: "mtt0111161", kind: "movie",
    name: "The Shawshank Redemption", year: 1994, imdb: "tt0111161", tmdb: 278,
  }, NOW))] };
  const other = { key: "tmdb:m279", src: "tmdb", ref: "m279", kind: "movie", name: "Something Else", year: 1994 };
  assert.equal(findSameShow(state, other), null);
});

/* And a film's TMDB id must never match a series carrying the same number — the two spaces are
   numbered separately, and the kind guard is what keeps them apart. */
test("a movie never matches a show on a shared TMDB number", () => {
  const state = { shows: [normShow(makeShow({
    key: "tvmaze:169", src: "tvmaze", ref: 169, name: "Breaking Bad", year: 2008, tmdb: 278,
  }, NOW))] };
  const row = { key: "tmdb:m278", src: "tmdb", ref: "m278", kind: "movie", name: "Shawshank", year: 1994 };
  assert.equal(findSameShow(state, row), null);
});

/* ---- which catalogue a movie comes from ----

   It follows the catalogue that has been chosen, which it did not: reading the TMDB key alone
   meant somebody who had entered one and then deliberately picked TVmaze still had every film
   come from TMDB and be stored under a TMDB key. */
test("choosing TVmaze means films come from Cinemeta, key or no key", async () => {
  const { movieProvider } = await import("../public/js/io/meta.js");
  const { state } = await import("../public/js/domain/store.js");

  state.settings = { provider: "tvmaze", tmdbKey: "KEY" };
  assert.equal(movieProvider().id, "cinemeta", "TVmaze has no films, and TVmaze is what was asked for");

  state.settings = { provider: "tvmaze" };
  assert.equal(movieProvider().id, "cinemeta");
});

test("choosing TMDB means films come from TMDB, when the key works", async () => {
  const { movieProvider } = await import("../public/js/io/meta.js");
  const { state } = await import("../public/js/domain/store.js");

  state.settings = { provider: "tmdb", tmdbKey: "KEY" };
  assert.equal(movieProvider().id, "tmdb");

  /* Chosen but unusable falls back to TVmaze for television, and there is only one thing left
     that can answer for a film. */
  state.settings = { provider: "tmdb" };
  assert.equal(movieProvider().id, "cinemeta");
});
