// Reading a Trakt data export.
//
// The shapes below are the ones a real export uses, checked against one: watched-history.json
// is a flat list of plays carrying the show's portable ids, and watched-shows.json is
// per-show totals with no episodes in it at all — which is why the history is the source and
// the other file is only ever a cross-check.
import test from "node:test";
import assert from "node:assert/strict";
import { feedFromHistory, shortfall, readExport, historyFiles, watchlistFiles, watchlistShows } from "../public/js/domain/trakt-export.js";

const play = (show, s, e, at, extra = {}) => ({
  id: Math.round(Math.random() * 1e6),
  watched_at: at,
  action: "watch",
  type: "episode",
  episode: { ids: { trakt: 1 }, title: "", season: s, number: e },
  show,
  ...extra,
});

const WIRE = { ids: { trakt: 1429, imdb: "tt0306414", tvdb: 79126, tmdb: 1438 }, title: "The Wire", year: 2002 };
const MORTY = { ids: { trakt: 69829, imdb: "tt2861424", tvdb: 275274, tmdb: 60625 }, title: "Rick and Morty", year: 2013 };

test("a history becomes one row per show and one entry per episode", () => {
  const feed = feedFromHistory([
    play(WIRE, 1, 1, "2018-02-03T21:30:00Z"),
    play(WIRE, 1, 2, "2018-02-04T20:00:00Z"),
    play(MORTY, 3, 4, "2020-01-01T00:00:00Z"),
  ]);
  assert.equal(feed.shows.length, 2);
  const wire = feed.shows.find((s) => s.name === "The Wire");
  assert.deepEqual(wire.episodes.map((e) => [e.s, e.e]), [[1, 1], [1, 2]]);
  assert.equal(wire.imdb, "tt0306414");
  assert.equal(wire.tvdb, 79126);
  assert.equal(wire.tmdb, 1438, "the ids matching runs on, carried through unchanged");
  assert.equal(wire.episodes[0].at, Date.parse("2018-02-03T21:30:00Z"));
});

/* Trakt records one entry per play, so a rewatch is repeated entries rather than a count in a
   field. Folding them is what makes this a history rather than a list. */
test("repeated plays of one episode are counted, and the latest date is kept", () => {
  const feed = feedFromHistory([
    play(WIRE, 1, 1, "2018-02-03T21:30:00Z"),
    play(WIRE, 1, 1, "2021-06-01T10:00:00Z"),
    play(WIRE, 1, 1, "2019-01-01T10:00:00Z"),
  ]);
  const ep = feed.shows[0].episodes[0];
  assert.equal(ep.plays, 3);
  assert.equal(ep.at, Date.parse("2021-06-01T10:00:00Z"), "the last time it was seen, not the first");
});

test("entries arrive newest first in the file, and nothing depends on that", () => {
  const newestFirst = feedFromHistory([play(WIRE, 1, 2, "2018-02-04T20:00:00Z"), play(WIRE, 1, 1, "2018-02-03T21:30:00Z")]);
  assert.deepEqual(newestFirst.shows[0].episodes.map((e) => [e.s, e.e]), [[1, 1], [1, 2]]);
});

test("specials are a season, not a special case", () => {
  const feed = feedFromHistory([play(WIRE, 0, 1, "2018-02-03T21:30:00Z")]);
  assert.deepEqual(feed.shows[0].episodes.map((e) => [e.s, e.e]), [[0, 1]]);
});

/* An export holds movies as well, and this app has none. Anything that is not an episode, or
   that names no episode this app could place, is passed over rather than half-imported. */
test("what isn't an episode is left where it is", () => {
  const feed = feedFromHistory([
    { type: "movie", action: "watch", watched_at: "2020-01-01T00:00:00Z", movie: { title: "Heat", ids: {} } },
    play(WIRE, 1, 1, "2018-02-03T21:30:00Z"),
    { type: "episode", action: "watch", show: WIRE },                       // no episode block
    play(WIRE, null, 3, "2018-02-05T20:00:00Z"),                            // no season
    play({ ids: {}, title: "Nameless" }, 1, 1, "2018-02-06T20:00:00Z"),      // no id to match on
  ]);
  assert.equal(feed.shows.length, 1);
  assert.equal(feed.shows[0].episodes.length, 1);
});

test("a play with no date is kept, with no date", () => {
  const feed = feedFromHistory([play(WIRE, 1, 1, undefined)]);
  assert.equal(feed.shows[0].episodes[0].at, 0, "zero, which is what the feed shape means by unknown");
});

/* The only thing watched-shows.json is good for. It states a total; the history is what has to
   add up to it, and when it does not the reader should hear so from us rather than work it out
   themselves three weeks later. */
test("a history that falls short of what Trakt counted is reported", () => {
  const feed = feedFromHistory([play(WIRE, 1, 1, "2018-02-03T21:30:00Z")]);
  const missing = shortfall(feed, [
    { plays: 60, show: WIRE },
    { plays: 1, show: MORTY },
  ]);
  assert.equal(missing.length, 2);
  assert.deepEqual(missing.find((m) => m.name === "The Wire"), { name: "The Wire", had: 1, claimed: 60 });
  assert.equal(missing.find((m) => m.name === "Rick and Morty").had, 0, "absent entirely, not merely short");
});

test("a history that adds up reports nothing", () => {
  const feed = feedFromHistory([play(WIRE, 1, 1, "2018-02-03T21:30:00Z"), play(WIRE, 1, 1, "2019-01-01T00:00:00Z")]);
  assert.deepEqual(shortfall(feed, [{ plays: 2, show: WIRE }]), []);
});

test("the whole read reports what it found", () => {
  const r = readExport({
    "watched-history.json": [play(WIRE, 1, 1, "2018-02-03T21:30:00Z"), play(WIRE, 1, 1, "2019-01-01T00:00:00Z"), play(MORTY, 1, 1, "2020-01-01T00:00:00Z")],
    "watched-shows.json": [{ plays: 2, show: WIRE }, { plays: 1, show: MORTY }],
  });
  assert.equal(r.events, 3);
  assert.equal(r.episodes, 2, "distinct episodes");
  assert.equal(r.plays, 3, "and the plays behind them");
  assert.deepEqual(r.missing, []);
});

/* The file is optional and the history is not. An export without the totals still imports; one
   without the history is not an export this can use, and saying so beats importing nothing and
   reporting success. */
test("the totals file is optional", () => {
  const r = readExport({ "watched-history.json": [play(WIRE, 1, 1, "2018-02-03T21:30:00Z")] });
  assert.equal(r.episodes, 1);
  assert.deepEqual(r.missing, []);
});

test("something that isn't a Trakt export is refused by name", () => {
  assert.throws(() => readExport({}), /watched history/);
  assert.throws(() => readExport({ "watched-history.json": { shows: [] } }), /watched history/,
    "present but not a list, which is a broken export rather than an empty one");
  assert.throws(() => readExport({ "watched-movies.json": [] }), /watched history/,
    "an export of somebody who only logs films has nothing here to read");
});

/* ---- how a long history is filed ----

   Found the hard way. An account with eighteen plays exports one watched-history.json; a real
   one exports watched-history-1.json through -6, at 250 entries each, and no unnumbered file
   at all. A reader that only knows the first name rejects every export worth importing. */

test("a history split across numbered files is read as one", () => {
  const page = (n, from) => Array.from({ length: n }, (_, i) => play(WIRE, 1, from + i, "2018-02-03T21:30:00Z"));
  const r = readExport({
    "watched-history-1.json": page(250, 1),
    "watched-history-2.json": page(250, 251),
    "watched-history-3.json": page(100, 501),
    "watched-shows.json": [{ plays: 600, show: WIRE }],
  });
  assert.equal(r.pages, 3);
  assert.equal(r.events, 600);
  assert.equal(r.episodes, 600);
  assert.deepEqual(r.missing, [], "and the totals line up, so nothing is reported as short");
});

test("the unnumbered file is still understood, since a small account gets one", () => {
  const r = readExport({ "watched-history.json": [play(WIRE, 1, 1, "2018-02-03T21:30:00Z")] });
  assert.equal(r.pages, 1);
  assert.equal(r.episodes, 1);
});

/* Sorted by number, not as text, or page 10 lands between 1 and 2. Nothing downstream depends
   on the order — the fold is order-independent and there is a test above saying so — but a
   list that reads wrongly invites somebody to fix the wrong thing later. */
test("pages are ordered numerically", () => {
  assert.deepEqual(
    historyFiles(["watched-history-10.json", "watched-history-2.json", "watched-history-1.json"]),
    ["watched-history-1.json", "watched-history-2.json", "watched-history-10.json"],
  );
});

test("a file that merely starts with the same words is not a history page", () => {
  assert.deepEqual(historyFiles(["watched-history-notes.json", "watched-movies.json", "watched-playback.json"]), []);
});

/* Trakt exports an unknown watch date as the Unix epoch rather than as null. Sixteen of them
   turned up in one real export. Parsing gives 0, which is exactly what the feed shape means by
   "the service does not say" — so this passes by construction, and the test is here to keep it
   passing if anyone ever reaches for a truthier date parse. */
test("a watch date at the epoch means unknown, not 1970", () => {
  const feed = feedFromHistory([play(WIRE, 1, 1, "1970-01-01T00:00:00.000Z")]);
  assert.equal(feed.shows[0].episodes[0].at, 0);
});

/* ---- the watchlist ----

   What Trakt calls the watchlist its apps label "plan to watch", and somebody who uploaded an
   export said so: the shows came in, the ones they meant to start did not. The file is empty
   until you put something in it, which is why the first export tested against had none.

   They carry no episodes, and that is what makes them work: an empty episode list means nothing
   to mark, so the show is filed under this app's default status and left there. */

const HOTD = { ids: { trakt: 154574, imdb: "tt11198330", tvdb: 371572, tmdb: 94997 },
               title: "House of the Dragon", year: 2022 };

test("a watchlisted show arrives with no episodes at all", () => {
  const rows = watchlistShows([{ type: "show", show: HOTD, listed_at: "2026-08-05T12:41:01.000Z" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "House of the Dragon");
  assert.equal(rows[0].imdb, "tt11198330");
  assert.deepEqual(rows[0].episodes, [], "which is what keeps it unstarted");
});

/* A Trakt watchlist holds films and single episodes too. This app has neither. */
test("only shows are taken off the watchlist", () => {
  const rows = watchlistShows([
    { type: "movie", movie: { title: "Heat", ids: { trakt: 1 } } },
    { type: "episode", episode: { ids: { trakt: 2 } }, show: HOTD },
    { type: "season", season: { ids: { trakt: 3 } }, show: HOTD },
    { type: "show", show: HOTD },
    { type: "show", show: { title: "Nameless", ids: {} } },
  ]);
  assert.deepEqual(rows.map((r) => r.name), ["House of the Dragon"]);
});

/* Watched beats planned. Something in both is something being watched, and the history is the
   claim carrying the marks — appending it twice would file one show as two. */
test("a show both watched and watchlisted appears once, with its history", () => {
  const r = readExport({
    "watched-history.json": [play(WIRE, 1, 1, "2018-02-03T21:30:00Z")],
    "lists-watchlist.json": [{ type: "show", show: WIRE }, { type: "show", show: HOTD }],
  });
  assert.equal(r.planned, 1, "only the one with no history counts as planned");
  assert.equal(r.feed.shows.length, 2);
  const wire = r.feed.shows.find((x) => x.name === "The Wire");
  assert.equal(wire.episodes.length, 1, "and it kept its episode");
});

test("an export with no watchlist file reads exactly as before", () => {
  const r = readExport({ "watched-history.json": [play(WIRE, 1, 1, "2018-02-03T21:30:00Z")] });
  assert.equal(r.planned, 0);
  assert.equal(r.feed.shows.length, 1);
});

test("episode and show counts do not double-count the watchlist", () => {
  const r = readExport({
    "watched-history.json": [play(WIRE, 1, 1, "2018-02-03T21:30:00Z")],
    "lists-watchlist.json": [{ type: "show", show: HOTD }],
  });
  assert.equal(r.episodes, 1, "the watchlisted show contributes no episodes");
  assert.equal(r.feed.shows.length - r.planned, 1, "and is not counted among the watched");
});

/* The watchlist splits the same way the history does, which two exports in a row failed to
   show: one had no watchlist and the other had a single entry. An account with four hundred
   gets lists-watchlist-1.json through -4, and reading only the unnumbered name dropped every
   one of them without a word — 412 shows, in the export this was found in. */

test("a watchlist split across numbered files is read as one", () => {
  const wl = (n, from) => Array.from({ length: n }, (_, i) => ({
    type: "show",
    show: { ids: { trakt: from + i, imdb: `tt${900000 + from + i}` }, title: `Show ${from + i}`, year: 2020 },
  }));
  const r = readExport({
    "watched-history.json": [play(WIRE, 1, 1, "2018-02-03T21:30:00Z")],
    "lists-watchlist-1.json": wl(250, 1),
    "lists-watchlist-2.json": wl(162, 251),
  });
  assert.equal(r.planned, 412);
  assert.equal(r.feed.shows.length, 413, "the watched one, and the rest planned");
  assert.equal(r.episodes, 1, "none of which contribute episodes");
});

test("the unnumbered watchlist is still understood", () => {
  const r = readExport({
    "watched-history.json": [play(WIRE, 1, 1, "2018-02-03T21:30:00Z")],
    "lists-watchlist.json": [{ type: "show", show: HOTD }],
  });
  assert.equal(r.planned, 1);
});

test("watchlist pages are ordered numerically, and near-misses are not pages", () => {
  assert.deepEqual(
    watchlistFiles(["lists-watchlist-10.json", "lists-watchlist-2.json", "lists-watchlist.json"]),
    ["lists-watchlist.json", "lists-watchlist-2.json", "lists-watchlist-10.json"],
  );
  assert.deepEqual(watchlistFiles(["lists-watchlist-notes.json", "lists-favorites.json", "lists-lists.json"]), []);
});

/* A user's own custom lists sit beside the watchlist and are not it. */
test("a named list is not the watchlist", () => {
  assert.deepEqual(watchlistFiles(["lists-list-33726051-watch2.json"]), []);
});
