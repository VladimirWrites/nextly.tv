// Bringing a history in from another tracker, and sending one back.
//
// The rule these are mostly about: an import adds and never removes. Another service knowing
// you watched something is evidence; it not knowing is not evidence of the opposite. Almost
// every test here is a variation on refusing to treat absence as a fact.
import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, migrate } from "../public/js/domain/schema.js";
import {
  matchFeed, planMarks, applyMarks, planPush, summarize,
} from "../public/js/domain/external.js";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function libraryWith(shows) {
  const s = emptyState();
  s.shows = shows;
  return migrate(s);
}

const show = (over = {}) => ({
  id: "tvmaze:169", src: "tvmaze", ref: 169, name: "Breaking Bad", year: 2008,
  imdb: "tt0903747", tvdb: 81189, st: "active", added: NOW - DAY, m: NOW - DAY,
  entries: [], ...over,
});

const feed = (rows) => ({ shows: rows });

/* ---- matching ---- */

test("a feed row finds its show by IMDb id, not by name", () => {
  const state = libraryWith([show({ name: "Something else entirely" })]);
  const { known, unknown } = matchFeed(state, feed([
    { name: "Breaking Bad", imdb: "tt0903747", episodes: [] },
  ]));
  assert.equal(known.length, 1);
  assert.equal(unknown.length, 0);
  assert.equal(known[0].show.id, "tvmaze:169");
});

test("TheTVDB id matches too, for a row with no IMDb id", () => {
  const state = libraryWith([show()]);
  const { known } = matchFeed(state, feed([{ name: "BB", tvdb: 81189, episodes: [] }]));
  assert.equal(known.length, 1);
});

test("a TMDB id is offered as a key, so a TMDB-numbered library matches on it", () => {
  const state = libraryWith([show({ id: "tmdb:1396", src: "tmdb", ref: 1396, imdb: null, tvdb: null })]);
  const { known } = matchFeed(state, feed([{ name: "BB", tmdb: 1396, episodes: [] }]));
  assert.equal(known.length, 1);
});

test("a show the library has never heard of is reported, not silently dropped", () => {
  const state = libraryWith([show()]);
  const { known, unknown } = matchFeed(state, feed([
    { name: "Breaking Bad", imdb: "tt0903747", episodes: [] },
    { name: "The Wire", imdb: "tt0306414", episodes: [] },
  ]));
  assert.equal(known.length, 1);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].name, "The Wire");
});

/* ---- planning marks ---- */

test("episodes this library lacks are added, dated when the service says when", () => {
  const plan = planMarks(show(), [
    { s: 1, e: 1, at: NOW - 10 * DAY },
    { s: 1, e: 2 },
  ], NOW);
  assert.equal(plan.add.length, 2);
  assert.equal(plan.add[0].id, "1x1");
  assert.equal(plan.add[0].w, NOW - 10 * DAY, "the date it was seen");
  assert.equal(plan.add[0].m, NOW, "and the date this record was made — different things");
  assert.equal(plan.add[1].w, undefined, "no date offered, none invented");
});

test("an import never removes a mark this library holds and the feed does not", () => {
  const sh = show({ entries: [{ id: "1x1", m: NOW - DAY }, { id: "9x9", m: NOW - DAY }] });
  const plan = planMarks(sh, [{ s: 1, e: 1 }], NOW);
  assert.deepEqual(plan.add, [], "nothing to add");
  assert.deepEqual(plan.raise, [], "and nothing to change");
  applyMarks(sh, plan, NOW);
  assert.equal(sh.entries.length, 2, "9x9 is untouched — the feed not knowing is not evidence");
});

test("a date fills a mark that has none, and never overwrites one that has", () => {
  const sh = show({ entries: [
    { id: "1x1", m: NOW - DAY },
    { id: "1x2", m: NOW - DAY, w: NOW - 100 * DAY },
  ] });
  const plan = planMarks(sh, [
    { s: 1, e: 1, at: NOW - 10 * DAY },
    { s: 1, e: 2, at: NOW - 5 * DAY },
  ], NOW);
  assert.equal(plan.raise.length, 1);
  assert.equal(plan.raise[0].id, "1x1");
  applyMarks(sh, plan, NOW);
  assert.equal(sh.entries[0].w, NOW - 10 * DAY, "the empty one is filled");
  assert.equal(sh.entries[1].w, NOW - 100 * DAY, "the hand-corrected one is left alone");
});

test("more plays than passes raises the level; fewer never lowers it", () => {
  const sh = show({ entries: [{ id: "1x1", m: NOW, n: 3 }, { id: "1x2", m: NOW, n: 2 }] });
  const plan = planMarks(sh, [
    { s: 1, e: 1, plays: 1 },
    { s: 1, e: 2, plays: 5 },
  ], NOW);
  assert.equal(plan.raise.length, 1);
  assert.equal(plan.raise[0].id, "1x2");
  assert.equal(plan.raise[0].n, 5);
  applyMarks(sh, plan, NOW);
  assert.equal(sh.entries[0].n, 3, "three passes here, one play there — this copy knows better");
});

test("rubbish episode numbers are skipped rather than written", () => {
  const plan = planMarks(show(), [
    { s: 1, e: 1 }, { s: null, e: 2 }, { s: 1, e: "x" }, {}, { s: undefined, e: 3 },
  ], NOW);
  assert.equal(plan.add.length, 1);
});

/* The reason the check above cannot just be `+ep.s`: that turns null into 0, and season 0 is
   not a missing season here, it is where specials live. A row with no season would have been
   filed as a special without anyone noticing. */
test("season zero is a real season and survives, a missing one does not", () => {
  const kept = planMarks(show(), [{ s: 0, e: 1 }], NOW);
  assert.deepEqual(kept.add.map((m) => m.id), ["0x1"], "an explicit special is kept");
  const dropped = planMarks(show(), [{ s: null, e: 1 }], NOW);
  assert.deepEqual(dropped.add, [], "a missing season is not one");
});

test("applying a plan stamps the show so a merge carries it", () => {
  const sh = show();
  applyMarks(sh, planMarks(sh, [{ s: 1, e: 1 }], NOW), NOW);
  assert.equal(sh.m, NOW);
});

test("applying an empty plan leaves the show's mtime alone", () => {
  const sh = show({ m: NOW - DAY });
  applyMarks(sh, { add: [], raise: [] }, NOW);
  assert.equal(sh.m, NOW - DAY, "nothing changed, so nothing to tell other devices about");
});

/* ---- pushing back ---- */

test("what this library has and the service does not is what gets sent", () => {
  const state = libraryWith([show({ entries: [
    { id: "1x1", m: NOW }, { id: "1x2", m: NOW, w: NOW - DAY }, { id: "1x3", m: NOW },
  ] })]);
  const out = planPush(state, feed([
    { name: "BB", imdb: "tt0903747", episodes: [{ s: 1, e: 1 }] },
  ]));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].episodes.map((e) => `${e.s}x${e.e}`), ["1x2", "1x3"]);
  assert.equal(out[0].episodes[0].at, NOW - DAY, "with the date, where this copy knows one");
});

test("a push never proposes deleting anything from the other service", () => {
  const state = libraryWith([show({ entries: [{ id: "1x1", m: NOW }] })]);
  const out = planPush(state, feed([
    { name: "BB", imdb: "tt0903747", episodes: [{ s: 1, e: 1 }, { s: 4, e: 4 }] },
  ]));
  assert.deepEqual(out, [], "they have one this copy lacks; that is their business");
});

test("a show the feed has never heard of is not invented on the other service", () => {
  const state = libraryWith([show({ entries: [{ id: "1x1", m: NOW }] })]);
  assert.deepEqual(planPush(state, feed([])), []);
});

/* ---- saying so first ---- */

test("a summary counts what an import would do before it does it", () => {
  const state = libraryWith([show({ entries: [{ id: "1x1", m: NOW }] })]);
  const s = summarize(state, feed([
    { name: "BB", imdb: "tt0903747", episodes: [
      { s: 1, e: 1, at: NOW - DAY }, { s: 1, e: 2 }, { s: 1, e: 3 },
    ] },
    { name: "The Wire", imdb: "tt0306414", episodes: [{ s: 1, e: 1 }] },
  ]), NOW);
  assert.equal(s.shows, 1, "one already tracked");
  assert.equal(s.newShows, 1, "one that would have to be added");
  assert.equal(s.marks, 2, "two episodes not held here");
  assert.equal(s.updated, 1, "and one held mark that gains a date");
  assert.equal(s.seen, 4, "out of four the feed mentioned");
});

test("summarising an empty feed promises nothing", () => {
  const state = libraryWith([show()]);
  assert.deepEqual(summarize(state, feed([]), NOW),
    { shows: 0, newShows: 0, marks: 0, updated: 0, seen: 0 });
});

test("a feed that is missing or malformed is survived rather than thrown at", () => {
  const state = libraryWith([show()]);
  assert.deepEqual(matchFeed(state, null), { known: [], unknown: [] });
  assert.deepEqual(planPush(state, null), []);
  assert.equal(summarize(state, undefined, NOW).seen, 0);
});
