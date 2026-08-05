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
