// Reading a Trakt data export.
//
// The shapes below are the ones a real export uses, checked against one: watched-history.json
// is a flat list of plays carrying the show's portable ids, and watched-shows.json is
// per-show totals with no episodes in it at all — which is why the history is the source and
// the other file is only ever a cross-check.
import test from "node:test";
import assert from "node:assert/strict";
import { feedFromHistory, shortfall, readExport } from "../public/js/domain/trakt-export.js";

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
  assert.throws(() => readExport({}), /watched-history\.json/);
  assert.throws(() => readExport({ "watched-history.json": { shows: [] } }), /watched-history\.json/);
});
