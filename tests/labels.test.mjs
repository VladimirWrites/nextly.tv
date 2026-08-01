// What a show's state says about itself, and what a strip decides to draw.
//
// These rules used to live in the view files that used them, which meant the only way to
// check one was to render a page and read it back. They are text and shape decisions, not
// element ones, and this is what checking them looks like now that they can be called.
import test from "node:test";
import assert from "node:assert/strict";
import { lifePill, cardLine, episodeBlurb } from "../public/js/domain/labels.js";
import {
  barcode, episodeCount, holdsNext, isBlock, fitsStrip, tickState, STRIP_MAX,
} from "../public/js/domain/progress.js";
import { whenPhrase } from "../public/js/domain/dates.js";
import { metaFixture, showFixture, T } from "./helpers.mjs";

/* ---- the pill ---- */

const prog = (over = {}) => ({ watched: 0, aired: 0, remaining: 0, ...over });

test("a running show wears no pill at all", () => {
  assert.equal(lifePill(metaFixture({ status: "Running" }), prog()), null);
  assert.equal(lifePill(metaFixture({ status: "In Production" }), prog()), null);
});

test("a show that has ended says so until you have finished it", () => {
  const meta = metaFixture({ status: "Ended" });
  assert.deepEqual(lifePill(meta, prog({ aired: 10, watched: 4, remaining: 6 })),
    { label: "Ended", tone: null });
  assert.deepEqual(lifePill(meta, prog({ aired: 10, watched: 10, remaining: 0 })),
    { label: "Finished", tone: "is-done" });
});

test("finished is about you, not the channel — a cancelled show you completed still reads Finished", () => {
  const meta = metaFixture({ status: "Canceled" });
  assert.deepEqual(lifePill(meta, prog({ aired: 6, watched: 6, remaining: 0 })),
    { label: "Finished", tone: "is-done" });
  assert.deepEqual(lifePill(meta, prog({ aired: 6, watched: 1, remaining: 5 })),
    { label: "Canceled", tone: null });
});

test("nothing aired yet is not something finished", () => {
  // Zero of zero is arithmetically complete and means the opposite: an ended show whose
  // episodes the catalogue hasn't listed says "Ended", not "Finished".
  assert.deepEqual(lifePill(metaFixture({ status: "Ended" }), prog({ aired: 0, watched: 0 })),
    { label: "Ended", tone: null });
});

test("no metadata, no pill", () => {
  assert.equal(lifePill(null, prog()), null);
});

/* ---- the line under the barcode ---- */

test("the card line leads with time left where there is any", () => {
  const line = cardLine(metaFixture(), prog({ watched: 3, aired: 10, minutesLeft: 350 }), null);
  assert.match(line, /^3\/10 · /);
  assert.match(line, /left$/);
});

test("with nothing left to watch it says when the show is back", () => {
  assert.equal(
    cardLine(metaFixture(), prog({ watched: 10, aired: 10, minutesLeft: 0 }), { inDays: 12 }),
    "10/10 · back in 12d");
});

test("with nothing left and nothing coming it falls back to the counts", () => {
  assert.equal(cardLine(metaFixture(), prog({ watched: 10, aired: 10, minutesLeft: 0 }), null), "10/10");
  assert.equal(
    cardLine(metaFixture(), prog({ watched: 10, aired: 10, minutesLeft: 0, completed: 3 }), null),
    "10/10 · 3× through");
});

test("a card with no metadata says so rather than showing 0/0", () => {
  assert.equal(cardLine(null, prog(), null), "—");
});

/* ---- the blurb ---- */

const withOverview = (text) => metaFixture({
  seasons: [{ n: 1, episodes: [{ e: 1, air: "2020-01-01", overview: text }] }],
});

test("a short synopsis is left exactly as written", () => {
  const meta = withOverview("A short one.");
  assert.equal(episodeBlurb(meta, { s: 1, e: 1 }), "A short one.");
});

test("a long synopsis is cut to fit and admits there is more", () => {
  const meta = withOverview("x".repeat(400));
  const out = episodeBlurb(meta, { s: 1, e: 1 });
  assert.equal(out.length, 238);          // 237 characters and the ellipsis
  assert.ok(out.endsWith("…"));
});

test("a cut that lands on a space closes up rather than printing ' …'", () => {
  // Not the same as cutting on a word boundary, which this doesn't do: a cut mid-word stays
  // mid-word. It only means the ellipsis never floats away from the text it follows.
  const meta = withOverview("ab ".repeat(100));   // 237 chars ends exactly on a space
  const out = episodeBlurb(meta, { s: 1, e: 1 });
  assert.ok(!out.includes(" …"));
  assert.ok(out.endsWith("b…"));
});

test("an episode the catalogue wrote nothing about yields an empty string, not undefined", () => {
  assert.equal(episodeBlurb(withOverview(undefined), { s: 1, e: 1 }), "");
  assert.equal(episodeBlurb(metaFixture(), { s: 9, e: 9 }), "");
  assert.equal(episodeBlurb({}, { s: 1, e: 1 }), "");
});

/* ---- how far off something is ---- */

test("the near future is named rather than counted", () => {
  assert.equal(whenPhrase(0), "today");
  assert.equal(whenPhrase(-3), "today");     // already out; the schedule shouldn't say "in -3 days"
  assert.equal(whenPhrase(1), "tomorrow");
});

test("days, then weeks, then months, as the gap grows", () => {
  assert.equal(whenPhrase(2), "in 2 days");
  assert.equal(whenPhrase(13), "in 13 days");
  assert.equal(whenPhrase(14), "in 2 weeks");
  assert.equal(whenPhrase(59), "in 8 weeks");
  assert.equal(whenPhrase(60), "in 2 months");
  assert.equal(whenPhrase(365), "in 12 months");
});

/* ---- what the strip draws ---- */

const bars = (n) => [{ n: 1, episodes: Array.from({ length: n }, (_, i) => ({ key: `1x${i + 1}` })), block: null }];

test("the episode count adds up every season, not the seasons", () => {
  assert.equal(episodeCount([]), 0);
  assert.equal(episodeCount([
    { episodes: [1, 2, 3] },
    { episodes: [] },
    { episodes: [1, 2] },
  ]), 5);
});

test("a strip is drawn up to its limit and left out past it", () => {
  assert.ok(fitsStrip(bars(STRIP_MAX.mini), STRIP_MAX.mini));
  assert.ok(!fitsStrip(bars(STRIP_MAX.mini + 1), STRIP_MAX.mini));
  // The show page has room for a great deal more than a library card.
  assert.ok(fitsStrip(bars(STRIP_MAX.mini + 1), STRIP_MAX.full));
  assert.ok(!fitsStrip(bars(STRIP_MAX.full + 1), STRIP_MAX.full));
});

test("the season holding next-up never collapses, however uniform it is", () => {
  const season = { n: 1, episodes: [{ key: "1x1" }, { key: "1x2" }], block: "u" };
  assert.ok(holdsNext(season, "1x2"));
  assert.ok(!isBlock(season, "1x2"), "the season you are working through stays as ticks");
  assert.ok(isBlock(season, "3x1"), "a uniform season elsewhere collapses");
});

test("a season with a shape of its own is drawn tick by tick regardless", () => {
  const mixed = { n: 1, episodes: [{ key: "1x1" }, { key: "1x2" }], block: null };
  assert.ok(!isBlock(mixed, null));
  assert.ok(!holdsNext(mixed, null), "no next episode means no season holds it");
});

test("next-up outranks every other state a tick could be in", () => {
  const seasons = barcode(showFixture(["1x1"]), metaFixture(), { now: T.now });
  const eps = seasons.flatMap((se) => se.episodes);
  const watched = eps.find((e) => e.key === "1x1");
  assert.equal(tickState(watched, null), "watched");
  assert.equal(tickState(watched, "1x1"), "next", "being next is what the strip is there to show");
});

test("every tick state a barcode can produce has a name", () => {
  const seasons = barcode(showFixture(["1x1"]), metaFixture({
    seasons: [
      { n: 1, episodes: [{ e: 1, air: "2020-01-01" }, { e: 2, air: "2020-01-08" }] },
      { n: 2, episodes: [{ e: 1, air: "2099-01-01" }] },
    ],
  }), { now: T.now });
  const states = seasons.flatMap((se) => se.episodes).map((ep) => tickState(ep, "1x2"));
  assert.deepEqual(states, ["watched", "next", "unaired"]);
});
