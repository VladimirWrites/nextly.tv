// Reading the four ratings files out of a Trakt export.
//
// Trakt rates four things and files them separately, so the reader's job is to collapse four
// shapes into the one key space the vault stores: "t" for the title, "4" for a season, "4x13"
// for an episode. The account this was written against had ratings in two of the four files and
// empty arrays in the others, which is exactly the shape that lets a reader look correct while
// silently ignoring half of what it was given.
import test from "node:test";
import assert from "node:assert/strict";
import { ratingsFromExport, ratingFiles, readExport } from "../public/js/domain/trakt-export.js";

const ids = (n) => ({ trakt: n, imdb: `tt000${n}`, tmdb: n * 10 });
const show = { title: "The Wire", year: 2002, ids: ids(1) };
const movie = { title: "Avatar", year: 2009, ids: ids(2) };
const AT = "2026-07-21T17:52:00.000Z";
const ms = Date.parse(AT);

const play = (at = AT) => ({ type: "episode", action: "watch", watched_at: at,
  episode: { ids: { trakt: 9 }, season: 1, number: 1 }, show });

test("all four kinds land in one key space", () => {
  const got = ratingsFromExport({
    "ratings-movies.json": [{ rating: 10, rated_at: AT, type: "movie", movie }],
    "ratings-shows.json": [{ rating: 9, rated_at: AT, type: "show", show }],
    "ratings-seasons.json": [{ rating: 8, rated_at: AT, type: "season", season: { number: 4 }, show }],
    "ratings-episodes.json": [{ rating: 7, rated_at: AT, type: "episode",
      episode: { season: 4, number: 13 }, show }],
  });
  const series = [...got.values()].find((r) => r.kind === "show");
  const film = [...got.values()].find((r) => r.kind === "movie");
  assert.deepEqual(series.ratings.map((r) => r.id).sort(), ["4", "4x13", "t"]);
  assert.deepEqual(film.ratings, [{ id: "t", v: 10, w: ms }]);
});

/* The fault the history reader already had once, waiting in a second place. The account tested
   against had three pages of rated movies; a reader knowing only the unnumbered name takes none
   of them and says nothing about it. */
test("the movie ratings file paginates like everything else", () => {
  const files = {
    "ratings-movies-1.json": [{ rating: 8, rated_at: AT, movie }],
    "ratings-movies-2.json": [{ rating: 6, rated_at: AT, movie: { title: "Up", year: 2009, ids: ids(3) } }],
    "ratings-movies-3.json": [{ rating: 4, rated_at: AT, movie: { title: "Coco", year: 2017, ids: ids(4) } }],
  };
  assert.equal(ratingFiles(Object.keys(files)).length, 3);
  assert.equal(ratingsFromExport(files).size, 3);
});

test("pages are read in numeric order, not alphabetical", () => {
  const names = ["ratings-movies-10.json", "ratings-movies-2.json", "ratings-movies-1.json"];
  assert.deepEqual(ratingFiles(names),
    ["ratings-movies-1.json", "ratings-movies-2.json", "ratings-movies-10.json"]);
});

/* Empty files are what this account actually had for seasons and episodes, and a reader that
   treats "[]" as a reason to throw would refuse the whole import. */
test("the empty files most accounts have are simply nothing", () => {
  const got = ratingsFromExport({
    "ratings-shows.json": [{ rating: 5, rated_at: AT, show }],
    "ratings-seasons.json": [],
    "ratings-episodes.json": [],
    "notes-ratings.json": [],
  });
  assert.equal(got.size, 1);
  assert.equal(got.values().next().value.ratings.length, 1);
});

test("the day it was rated travels with the number", () => {
  const got = ratingsFromExport({ "ratings-shows.json": [{ rating: 9, rated_at: AT, show }] });
  assert.equal(got.values().next().value.ratings[0].w, ms);
});

/* Zero means "cleared" in the vault, so a file carrying one would silently unrate a title. It
   is not a number Trakt writes, which is the point: anything outside 1-10 is corrupt. */
test("only 1 to 10 is a rating", () => {
  const got = ratingsFromExport({ "ratings-shows.json": [
    { rating: 0, rated_at: AT, show },
    { rating: 11, rated_at: AT, show: { title: "X", year: 2000, ids: ids(5) } },
    { rating: null, rated_at: AT, show: { title: "Y", year: 2000, ids: ids(6) } },
  ] });
  assert.equal(got.size, 0, "nothing here describes a rating");
});

test("a rating with no title behind it is dropped rather than guessed at", () => {
  const got = ratingsFromExport({ "ratings-shows.json": [
    { rating: 8, rated_at: AT },
    { rating: 8, rated_at: AT, show: { title: "No ids", year: 2000, ids: {} } },
  ] });
  assert.equal(got.size, 0);
});

/* Trakt numbers films and series separately, so the same number means different titles. This
   is the fold that once let a movie eat a watchlisted series. */
test("a movie and a show sharing a Trakt number stay apart", () => {
  const got = ratingsFromExport({
    "ratings-shows.json": [{ rating: 9, rated_at: AT, show: { title: "Fargo", year: 2014, ids: { trakt: 77 } } }],
    "ratings-movies.json": [{ rating: 6, rated_at: AT, movie: { title: "Fargo", year: 1996, ids: { trakt: 77 } } }],
  });
  assert.equal(got.size, 2);
});

/* The join. A rated title that was also watched belongs to the row that already carries its
   marks, not to a second row of its own. */
test("a rating joins the row the history already made", () => {
  const r = readExport({
    "watched-history.json": [play()],
    "ratings-shows.json": [{ rating: 9, rated_at: AT, show }],
  });
  const rows = r.feed.shows.filter((s) => s.name === "The Wire");
  assert.equal(rows.length, 1, "one row, not two");
  assert.deepEqual(rows[0].ratings, [{ id: "t", v: 9, w: ms }]);
  assert.equal(rows[0].episodes.length, 1, "and it still has its marks");
  assert.equal(r.ratings, 1);
  assert.equal(r.ratedTitles, 1);
});

/* Trakt takes a rating for something you have never watched, so an opinion can arrive with no
   history at all. Kept for the same reason a watchlisted show is: it was in the file. */
test("a title rated but never watched arrives as its own row", () => {
  const r = readExport({
    "watched-history.json": [play()],
    "ratings-movies.json": [{ rating: 10, rated_at: AT, movie }],
  });
  const row = r.feed.shows.find((s) => s.name === "Avatar");
  assert.ok(row, "the movie is in the feed");
  assert.equal(row.kind, "movie");
  assert.deepEqual(row.episodes, [], "carrying no claim to have seen it");
  assert.deepEqual(row.ratings, [{ id: "t", v: 10, w: ms }]);
});

test("an export with no ratings at all still reads", () => {
  const r = readExport({ "watched-history.json": [play()] });
  assert.equal(r.ratings, 0);
  assert.equal(r.ratedTitles, 0);
  assert.equal(r.feed.shows[0].ratings, undefined);
});
