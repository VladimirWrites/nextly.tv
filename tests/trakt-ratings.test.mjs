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

/* Which lookup a movie row is sent to.
 *
 * TMDB files films and series apart and answers about them apart: its find endpoint returns
 * movie_results and tv_results, and `lookup` reads the second. Asking it about a film with the
 * show lookup searched the television half and returned nothing — every film, every time —
 * while the keyless path worked, because Cinemeta has one lookup and only movies. */
test("a movie row goes to the movie lookup where the catalogue has one", async () => {
  const { importFeed } = await import("../public/js/io/import-feed.js");
  const asked = [];
  const tmdbLike = {
    lookup: (q) => { asked.push(["tv", q.imdb]); return Promise.resolve(null); },
    lookupMovie: (q) => { asked.push(["movie", q.imdb]); return Promise.resolve(null); },
  };
  await importFeed(
    { shows: [
      { kind: "movie", name: "Avatar", imdb: "tt1630029", episodes: [] },
      { name: "The Wire", imdb: "tt0306414", episodes: [] },
    ] },
    { addMissing: true, pick: () => tmdbLike },
  );
  assert.deepEqual(asked.sort(), [["movie", "tt1630029"], ["tv", "tt0306414"]]);
});

test("a catalogue with only one lookup still gets asked", async () => {
  const { importFeed } = await import("../public/js/io/import-feed.js");
  const asked = [];
  const cinemetaLike = { lookup: (q) => { asked.push(q.imdb); return Promise.resolve(null); } };
  await importFeed(
    { shows: [{ kind: "movie", name: "Avatar", imdb: "tt1630029", episodes: [] }] },
    { addMissing: true, pick: () => cinemetaLike },
  );
  assert.deepEqual(asked, ["tt1630029"]);
});

/* From the zip, which is the only way anybody actually imports one.
 *
 * Everything above hands readExport a files object, and so did every test written for ratings.
 * That is one layer above where the export is really opened: the zip is unpacked selectively,
 * against a list of file names, and the four ratings files were not on it. Six hundred ratings
 * were discarded before the reader saw a single one — a feature with fifty passing tests behind
 * it that had never once worked. These are the tests that go through the door the user does. */
test("the ratings files are unpacked from the zip at all", async () => {
  const { readJSONZip } = await import("../public/js/io/zip.js");
  const { wantedFile } = await import("../public/js/domain/trakt-export.js");
  const { makeZip } = await import("./helpers.mjs");

  const zip = makeZip({
    "watched-history.json": JSON.stringify([play()]),
    "watched-shows.json": JSON.stringify([{ plays: 1, show }]),
    "ratings-movies.json": JSON.stringify([{ rating: 10, rated_at: AT, movie }]),
    "ratings-shows.json": JSON.stringify([{ rating: 9, rated_at: AT, show }]),
    "ratings-seasons.json": JSON.stringify([{ rating: 8, rated_at: AT, season: { number: 4 }, show }]),
    "ratings-episodes.json": JSON.stringify([{ rating: 7, rated_at: AT, episode: { season: 4, number: 13 }, show }]),
    // The forty-odd files nobody wants, which is why the unpack is selective in the first place.
    "user-profile.json": JSON.stringify({ email: "x@example.com" }),
    "network-followers.json": JSON.stringify([{ user: "someone" }]),
  });

  const files = await readJSONZip(zip, wantedFile);
  assert.ok(files["ratings-movies.json"], "the movie ratings came out of the zip");
  assert.ok(files["ratings-shows.json"] && files["ratings-seasons.json"] && files["ratings-episodes.json"]);
  assert.equal(files["user-profile.json"], undefined, "and somebody's account did not");

  const r = readExport(files);
  assert.equal(r.ratings, 4, "all four kinds reached the reader");
  assert.equal(r.ratedTitles, 2);
});

/* The list of names and the reader have to agree, and they did not. Written against the
   patterns rather than a fixed list so a file kind added to one has to be added to the other. */
test("every file the reader can read is a file the zip is asked for", async () => {
  const { wantedFile } = await import("../public/js/domain/trakt-export.js");
  const names = [
    "watched-history.json", "watched-history-1.json", "watched-history-12.json",
    "watched-shows.json", "watched-movies.json", "watched-movies-3.json",
    "lists-watchlist.json", "lists-watchlist-4.json",
    "ratings-movies.json", "ratings-movies-3.json", "ratings-shows.json",
    "ratings-seasons.json", "ratings-episodes.json", "ratings-episodes-2.json",
  ];
  for (const n of names) assert.equal(wantedFile(n), true, `${n} must be unpacked`);
  for (const n of ["user-profile.json", "notes-ratings.json", "comments-shows.json",
    "network-followers.json", "lists-lists.json", "collection-shows.json"]) {
    assert.equal(wantedFile(n), false, `${n} is nobody's business here`);
  }
});

/* The two facts an import files a show by, both of which were sitting unread in the zip.
 *
 * Neither is a mark, which is why neither was taken: the reader's whole job was the history.
 * But a history applied without them files a library of finished shows as "Watching", so they
 * are read here and decided on in domain/status-guess.js. */
test("each row carries when it was last watched", () => {
  const r = readExport({
    "watched-history.json": [play("2019-03-04T21:00:00.000Z")],
    "watched-shows.json": [{ plays: 1, last_watched_at: AT, reset_at: null, show }],
  });
  const row = r.feed.shows.find((s) => s.name === "The Wire");
  assert.equal(row.lastAt, ms, "the totals file states it, and states it later than the play");
});

/* A history Trakt truncated still leaves the totals line whole, and a row dated only from its
   marks would look older than the show is — which is the difference between paused and dropped. */
test("the stated date wins over the marks, and the marks stand in when it is absent", () => {
  const older = "2011-01-01T00:00:00.000Z";
  const withTotals = readExport({
    "watched-history.json": [play(older)],
    "watched-shows.json": [{ plays: 1, last_watched_at: AT, show }],
  });
  assert.equal(withTotals.feed.shows[0].lastAt, ms);

  const without = readExport({ "watched-history.json": [play(older)] });
  assert.equal(without.feed.shows[0].lastAt, Date.parse(older));
});

test("a show hidden from progress says so on its row", () => {
  const r = readExport({
    "watched-history.json": [play()],
    "hidden-progress-watched.json": [{ hidden_at: AT, type: "show", show }],
  });
  assert.equal(r.feed.shows[0].hidden, true);
});

test("a history reset is the same statement in different words", () => {
  const r = readExport({
    "watched-history.json": [play()],
    "watched-shows.json": [{ plays: 1, last_watched_at: AT, reset_at: AT, show }],
  });
  assert.equal(r.feed.shows[0].hidden, true);
});

test("an export saying nothing about either leaves both off the row", () => {
  const r = readExport({ "watched-history.json": [play()] });
  assert.equal(r.feed.shows[0].hidden, undefined);
});
