// Turning a share into something the app can look up. Where the link lands — title, text or
// url — depends on which app did the sharing, so all three are searched.
import test from "node:test";
import assert from "node:assert/strict";
import { parseShared } from "../public/js/domain/share.js";

test("a TVmaze link names one show in one numbering", () => {
  assert.deepEqual(parseShared({ url: "https://www.tvmaze.com/shows/169/breaking-bad" }),
    { src: "tvmaze", ref: "169" });
});

test("a TMDB link does the same", () => {
  assert.deepEqual(parseShared({ url: "https://www.themoviedb.org/tv/1396-breaking-bad" }),
    { src: "tmdb", ref: "1396" });
});

test("an IMDb id is taken from anywhere in the share, not only from an imdb.com link", () => {
  assert.deepEqual(parseShared({ url: "https://m.imdb.com/title/tt0903747/" }), { imdb: "tt0903747" });
  assert.deepEqual(parseShared({ text: "have you seen this tt4574334 yet" }), { imdb: "tt4574334" });
});

test("a catalogue id wins over an IMDb id in the same share, being the more settled of the two", () => {
  assert.deepEqual(
    parseShared({ text: "tt0903747", url: "https://www.tvmaze.com/shows/169/breaking-bad" }),
    { src: "tvmaze", ref: "169" });
});

test("the link is found wherever the sharing app happened to put it", () => {
  const want = { src: "tvmaze", ref: "44933" };
  assert.deepEqual(parseShared({ url: "https://www.tvmaze.com/shows/44933/severance" }), want);
  assert.deepEqual(parseShared({ text: "https://www.tvmaze.com/shows/44933/severance" }), want);
  assert.deepEqual(parseShared({ title: "https://www.tvmaze.com/shows/44933/severance" }), want);
});

/* ---- nothing but words ---- */

test("a shared title becomes a search", () => {
  assert.deepEqual(parseShared({ title: "Only Fools and Horses" }), { query: "Only Fools and Horses" });
});

test("a page title is cut at the site's name", () => {
  assert.deepEqual(parseShared({ title: "Severance | Apple TV+" }), { query: "Severance" });
  assert.deepEqual(parseShared({ title: "Silo - Wikipedia" }), { query: "Silo" });
});

test("a URL left in the text is stripped rather than searched for", () => {
  assert.deepEqual(parseShared({ text: "Watch Andor https://example.com/andor" }), { query: "Watch Andor" });
});

test("a bare link with no id and no words is nothing to go on", () => {
  assert.equal(parseShared({ url: "https://example.com/" }), null);
  assert.equal(parseShared({ text: "https://example.com/" }), null);
});

test("an empty share is nothing at all", () => {
  assert.equal(parseShared({}), null);
  assert.equal(parseShared(), null);
  assert.equal(parseShared({ title: "   ", text: "", url: "" }), null);
});

test("a very long title is trimmed rather than sent whole to a catalogue", () => {
  const got = parseShared({ title: "x".repeat(300) });
  assert.ok(got.query.length <= 80);
});
