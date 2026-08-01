import test from "node:test";
import assert from "node:assert/strict";
import { addShow, removeShow, setStatus, markEpisode, markUpTo, markAllAired, markSeason, totalWatched } from "../public/js/domain/model.js";
import { findShow } from "../public/js/domain/schema.js";
import { metaFixture, showFixture, stateWith, keys, T } from "./helpers.mjs";

const at = { now: T.now };

test("addShow stores portable identity, not just a catalogue id", () => {
  const s = stateWith([]);
  const meta = metaFixture({ imdb: "tt1234567", tvdb: 9876 });
  const sh = addShow(s, meta, T.t1);
  assert.equal(sh.id, "tvmaze:1");
  assert.equal(sh.src, "tvmaze");
  assert.equal(sh.name, "Test Show");
  assert.equal(sh.year, 2020);
  assert.equal(sh.imdb, "tt1234567");
  assert.equal(sh.tvdb, 9876);
});

test("adding a show twice is a no-op that keeps existing marks", () => {
  const s = stateWith([showFixture(["1x1"])]);
  const sh = addShow(s, metaFixture(), T.t3);
  assert.equal(s.shows.length, 1);
  assert.deepEqual(keys(sh), ["1x1"]);
});

test("removeShow drops the record and its marks", () => {
  const s = stateWith([showFixture(["1x1"])]);
  assert.equal(removeShow(s, "tvmaze:1"), true);
  assert.equal(s.shows.length, 0);
  assert.equal(removeShow(s, "tvmaze:1"), false);
});

test("setStatus rejects a status the app doesn't define", () => {
  const s = stateWith([showFixture([])]);
  assert.equal(setStatus(s, "tvmaze:1", "paused").st, "paused");
  assert.equal(setStatus(s, "tvmaze:1", "nonsense").st, "planned");
});

test("markEpisode adds and removes a mark", () => {
  const s = stateWith([showFixture([])]);
  markEpisode(s, "tvmaze:1", "1x1", true, T.t1);
  assert.deepEqual(keys(s.shows[0]), ["1x1"]);
  markEpisode(s, "tvmaze:1", "1x1", false);
  assert.deepEqual(keys(s.shows[0]), []);
});

test("re-marking a watched episode keeps its original timestamp", () => {
  const s = stateWith([showFixture([{ id: "1x1", m: T.t1 }])]);
  markEpisode(s, "tvmaze:1", "1x1", true, T.t3);
  assert.equal(s.shows[0].entries[0].m, T.t1, "the mark means seen; rewriting it would churn the blob");
});

test("markUpTo fills in everything aired up to and including the target", () => {
  const s = stateWith([showFixture([])]);
  markUpTo(s, "tvmaze:1", metaFixture(), "1x2", at);
  assert.deepEqual(keys(s.shows[0]), ["1x1", "1x2"]);
});

test("markUpTo stops at the first unaired episode", () => {
  const s = stateWith([showFixture([])]);
  markUpTo(s, "tvmaze:1", metaFixture(), "2x3", at);
  assert.deepEqual(keys(s.shows[0]), ["1x1", "1x2", "2x1"], "2x2 and 2x3 haven't aired");
});

test("markUpTo doesn't duplicate marks you already have", () => {
  const s = stateWith([showFixture(["1x1"])]);
  markUpTo(s, "tvmaze:1", metaFixture(), "1x2", at);
  assert.deepEqual(keys(s.shows[0]), ["1x1", "1x2"]);
});

test("markAllAired catches a show up to everything that is out", () => {
  const s = stateWith([showFixture([])]);
  markAllAired(s, "tvmaze:1", metaFixture(), at);
  assert.deepEqual(keys(s.shows[0]), ["1x1", "1x2", "2x1"], "2x2 is in the future and 2x3 has no date");
});

test("markAllAired fills the gaps rather than only marking the newest", () => {
  // The bug this replaced: a header button that marked one episode and called it catching up.
  const s = stateWith([showFixture(["2x1"])]);
  markAllAired(s, "tvmaze:1", metaFixture(), at);
  assert.deepEqual(keys(s.shows[0]), ["1x1", "1x2", "2x1"]);
});

test("markAllAired does nothing when the show has not aired at all", () => {
  const meta = metaFixture({ seasons: [{ n: 1, episodes: [{ e: 1, air: "2030-01-01" }] }] });
  const s = stateWith([showFixture([])]);
  markAllAired(s, "tvmaze:1", meta, at);
  assert.deepEqual(keys(s.shows[0]), []);
});

/* Season two holds 2x1 (aired), 2x2 (dated later this year) and 2x3 (no date at all). Only the
   second is a claim that the episode has yet to happen; the third is the catalogue saying
   nothing, and marking a season should sweep it in with the rest. */
test("markSeason marks everything except what is still to come", () => {
  const s = stateWith([showFixture([])]);
  markSeason(s, "tvmaze:1", metaFixture().seasons[1], true, at);
  assert.deepEqual(keys(s.shows[0]), ["2x1", "2x3"], "an episode that doesn't exist yet can't be watched");
});

test("markSeason skips specials unless they're switched on", () => {
  const s = stateWith([showFixture([])]);
  markSeason(s, "tvmaze:1", metaFixture().seasons[0], true, at);
  assert.deepEqual(keys(s.shows[0]), ["1x1", "1x2"]);

  const s2 = stateWith([showFixture([])]);
  markSeason(s2, "tvmaze:1", metaFixture().seasons[0], true, { specials: true, now: T.now });
  assert.deepEqual(keys(s2.shows[0]), ["1x1", "1x2", "1x3"]);
});

test("clearing a season removes unaired marks too", () => {
  const s = stateWith([showFixture(["1x1", "1x2", "2x1"])]);
  markSeason(s, "tvmaze:1", metaFixture().seasons[0], false, at);
  assert.deepEqual(keys(s.shows[0]), ["2x1"]);
});

test("acting on a show that isn't tracked returns null instead of throwing", () => {
  const s = stateWith([]);
  assert.equal(markEpisode(s, "tvmaze:404", "1x1", true), null);
  assert.equal(markSeason(s, "tvmaze:404", metaFixture().seasons[0], true), null);
  assert.equal(findShow(s, "tvmaze:404"), null);
});

test("totalWatched sums marks across the library", () => {
  const s = stateWith([showFixture(["1x1", "1x2"]), showFixture(["1x1"], { id: "tvmaze:2" })]);
  assert.equal(totalWatched(s), 3);
});

/* ---- planned until you actually watch something ----
   Adding a show used to mean "watching", which put anything merely bookmarked into Up next
   and made that screen answer a question nobody asked. */

test("a newly tracked show is planned, not active", () => {
  const s = stateWith([]);
  addShow(s, metaFixture());
  assert.equal(s.shows[0].st, "planned");
});

test("marking an episode starts a show you had only planned", () => {
  const s = stateWith([Object.assign(showFixture(), { st: "planned" })]);
  markEpisode(s, "tvmaze:1", "1x1", true);
  assert.equal(findShow(s, "tvmaze:1").st, "active");
});

test("marking does not revive a show you paused or dropped", () => {
  for (const st of ["paused", "dropped"]) {
    const s = stateWith([Object.assign(showFixture(), { st })]);
    markEpisode(s, "tvmaze:1", "1x1", true);
    assert.equal(findShow(s, "tvmaze:1").st, st, `${st} is a decision, not a gap`);
  }
});

test("unmarking never promotes anything", () => {
  const s = stateWith([Object.assign(showFixture(["1x1"]), { st: "planned" })]);
  markEpisode(s, "tvmaze:1", "1x1", false);
  assert.equal(findShow(s, "tvmaze:1").st, "planned");
});

test("catching up in bulk starts a planned show too", () => {
  for (const run of [
    (s, m) => markUpTo(s, "tvmaze:1", m, "1x2"),
    (s, m) => markAllAired(s, "tvmaze:1", m),
    (s, m) => markSeason(s, "tvmaze:1", m.seasons[0], true),
  ]) {
    const meta = metaFixture();
    const s = stateWith([Object.assign(showFixture(), { st: "planned" })]);
    run(s, meta);
    assert.equal(findShow(s, "tvmaze:1").st, "active");
  }
});

test("clearing a season leaves a planned show planned", () => {
  const meta = metaFixture();
  const s = stateWith([Object.assign(showFixture(["1x1"]), { st: "planned" })]);
  markSeason(s, "tvmaze:1", meta.seasons[0], false);
  assert.equal(findShow(s, "tvmaze:1").st, "planned");
});

/* ---- a record that predates a field ---- */
import { isStale, SHAPE } from "../public/js/io/cache.js";

test("a record written before a field existed is refetched on sight", () => {
  const now = Date.now();
  // Fresh by every other measure: written a minute ago, for a show that ended.
  const old = { status: "Ended", shape: SHAPE - 1 };
  assert.equal(isStale(old, now - 60_000, now), true);
  assert.equal(isStale({ status: "Ended" }, now - 60_000, now), true, "no shape at all is the oldest shape");
});

test("a current record still keeps its own clock", () => {
  const now = Date.now();
  const DAY = 86_400_000;
  assert.equal(isStale({ status: "Ended", shape: SHAPE }, now - 60_000, now), false);
  assert.equal(isStale({ status: "Ended", shape: SHAPE }, now - 31 * DAY, now), true, "ended: thirty days");
  assert.equal(isStale({ status: "Running", shape: SHAPE }, now - 2 * DAY, now), true, "running: one day");
  assert.equal(isStale({ status: "Running", shape: SHAPE }, now - 60_000, now), false);
});

test("nothing cached is always stale", () => {
  assert.equal(isStale(null, Date.now()), true);
  assert.equal(isStale({ shape: SHAPE }, 0), true);
});
