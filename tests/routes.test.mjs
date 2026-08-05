// What an address means, and what address a screen has.
//
// The point of most of these is one property: no address this app understands carries its
// subject anywhere a browser would transmit it. Not merely none that it writes — none that it
// reads either, so there is no shape of URL anyone could construct that would name a show to
// the server. The rest is making sure that cost neither the odd characters nor the round trip.
import test from "node:test";
import assert from "node:assert/strict";
import { parseRoute, pathFor, DETAIL, HOME } from "../public/js/domain/routes.js";

/* ---- the property this exists for ---- */

test("no address for a detail screen names its subject in the path", () => {
  const cases = [
    ["show", "tmdb:67070"],
    ["person", "tvmaze:12345"],
    ["season", "tvmaze:38052/3"],
    ["episode", "tvmaze:38052/3/1"],
  ];
  for (const [name, arg] of cases) {
    const url = pathFor(name, arg);
    const [path, frag] = url.split("#");
    assert.equal(path, `/${name}`, `${name} should have a bare path`);
    assert.ok(frag, `${name} should carry its subject in the fragment`);
    // The part before the # is everything a server ever receives.
    assert.ok(!path.includes(arg.split("/")[0]), "the path must not contain the show key");
  }
});

test("the tab routes stay ordinary paths — they name no content", () => {
  assert.equal(pathFor("next", null), "/");
  assert.equal(pathFor("library", null), "/library");
  assert.equal(pathFor("search", null), "/search");
  assert.equal(pathFor("you", null), "/you");
  assert.equal(pathFor("stats", null), "/stats");
  for (const p of ["/", "/library", "/search", "/you", "/stats"]) {
    assert.ok(!p.includes("#"));
  }
});

/* ---- round trip ---- */

test("every detail route survives being written and read back", () => {
  const cases = [
    ["show", "tmdb:67070"],
    ["show", "tvmaze:169"],
    ["person", "42"],
    ["season", "tvmaze:38052/3"],
    ["episode", "tvmaze:38052/3/1"],
  ];
  for (const [name, arg] of cases) {
    const [path, frag] = pathFor(name, arg).split("#");
    assert.deepEqual(parseRoute(path, "#" + frag), { name, arg });
  }
});

test("a colon is left readable, and still parses", () => {
  assert.equal(pathFor("show", "tmdb:67070"), "/show#tmdb:67070");
  // Both forms open the same page, so a link written either way works.
  assert.deepEqual(parseRoute("/show", "#tmdb:67070"), { name: "show", arg: "tmdb:67070" });
  assert.deepEqual(parseRoute("/show", "#tmdb%3A67070"), { name: "show", arg: "tmdb:67070" });
});

test("the slashes between an episode's parts stay slashes", () => {
  assert.equal(pathFor("episode", "tvmaze:38052/3/1"), "/episode#tvmaze:38052/3/1");
  assert.deepEqual(parseRoute("/episode", "#tvmaze:38052/3/1"),
    { name: "episode", arg: "tvmaze:38052/3/1" });
});

test("a name with characters of its own comes back intact", () => {
  // Not a real key, but a space and a hash are exactly what would break this: the hash would
  // end the fragment early and take the rest of the name with it. encodeURIComponent escapes
  // both, so the address holds one # and the whole name survives the round trip.
  const arg = "tmdb:a b/c#d";
  const url = pathFor("season", arg);
  assert.equal(url, "/season#tmdb:a%20b/c%23d");
  assert.equal(url.split("#").length, 2, "the escaped hash must not end the fragment");
  const [path, frag] = url.split("#");
  assert.deepEqual(parseRoute(path, "#" + frag), { name: "season", arg });
});

/* ---- reading an address ---- */

test("a subject in the path is ignored — only the fragment names anything", () => {
  /* There is no reading of the path at all. An address that carries a subject where it used
     to go is not half-understood, it is not understood: it opens the home screen, and the
     Worker gives it a 404 before it ever gets that far. Nothing anywhere can turn a path into
     a show, which is what makes "this server is never told" a property of the shapes rather
     than of the code being careful. */
  assert.deepEqual(parseRoute("/show/tvmaze:169", ""), { name: "next", arg: null });
  assert.deepEqual(parseRoute("/person/42", ""), { name: "next", arg: null });
  assert.deepEqual(parseRoute("/season/tvmaze:38052/3", ""), { name: "next", arg: null });
  assert.deepEqual(parseRoute("/episode/tvmaze:38052/3/1", ""), { name: "next", arg: null });
});

test("a fragment is read even when the path also carries something", () => {
  assert.deepEqual(parseRoute("/show/tvmaze:1", "#tmdb:2"), { name: "show", arg: "tmdb:2" });
});

test("a detail route with nothing to name is not a detail route", () => {
  // The bare path is what the server sees; without a fragment there is no page to open, so it
  // falls to the home screen rather than rendering a show page for undefined.
  for (const p of ["/show", "/person", "/season", "/episode"]) {
    assert.deepEqual(parseRoute(p, ""), { name: "next", arg: null });
  }
});

test("a route given fewer parts than it needs falls home rather than half-opening", () => {
  assert.deepEqual(parseRoute("/season", "#tvmaze:1"), { name: "next", arg: null });
  assert.deepEqual(parseRoute("/episode", "#tvmaze:1/2"), { name: "next", arg: null });
  // And extra parts are ignored rather than concatenated into a key nothing matches.
  assert.deepEqual(parseRoute("/season", "#tvmaze:1/2/3/4"), { name: "season", arg: "tvmaze:1/2" });
});

test("the tabs, the share target, and anything unrecognised", () => {
  assert.deepEqual(parseRoute("/library", ""), { name: "library", arg: null });
  assert.deepEqual(parseRoute("/share", ""), { name: "share", arg: null });
  assert.deepEqual(parseRoute("/", ""), { name: "next", arg: null });
  assert.deepEqual(parseRoute("", ""), { name: "next", arg: null });
  assert.deepEqual(parseRoute("/librarry", ""), { name: "next", arg: null });
});

test("a broken escape in the address bar does not throw", () => {
  // decodeURIComponent rejects a lone % or a truncated escape, and an address bar is
  // somewhere people type. Losing the page is a worse answer than showing what was typed.
  assert.doesNotThrow(() => parseRoute("/show", "#100%"));
  assert.deepEqual(parseRoute("/show", "#100%"), { name: "show", arg: "100%" });
  assert.doesNotThrow(() => parseRoute("/show/%E0%A4%A", ""));
});

/* ---- the table itself ---- */

test("DETAIL names exactly the screens that have a subject", () => {
  assert.deepEqual(Object.keys(DETAIL).sort(), ["episode", "feed", "movie", "person", "season", "show"]);
});

/* A film names a film, so it goes in the fragment with the rest. Its key carries an "m" after
   the colon because TMDB numbers films and series separately and the same number means two
   different things — which is a thing the address has to survive being copied. */
test("a film is named in the fragment, keeping the marker in its key", () => {
  assert.deepEqual(parseRoute("/movie", "#tmdb:m76600"), { name: "movie", arg: "tmdb:m76600" });
  assert.equal(pathFor("movie", "tmdb:m76600"), "/movie#tmdb:m76600");
  assert.deepEqual(parseRoute("/movie", ""), HOME, "a film with no name is not a place");
  assert.deepEqual(parseRoute("/movie/tmdb:m76600", ""), HOME, "and the path form is not a route");
});

test("a Cinemeta film keeps its IMDb id through an address", () => {
  assert.deepEqual(parseRoute("/movie", "#cinemeta:mtt1630029"),
    { name: "movie", arg: "cinemeta:mtt1630029" });
  assert.equal(pathFor("movie", "cinemeta:mtt1630029"), "/movie#cinemeta:mtt1630029");
});

/* A whole discovery feed. Same rule as every other route that names something: the name goes in
   the fragment, so the server sees only that a feed was opened. */
test("a feed is named in the fragment like anything else", () => {
  assert.deepEqual(parseRoute("/feed", "#trending"), { name: "feed", arg: "trending" });
  assert.equal(pathFor("feed", "trending"), "/feed#trending");
  assert.deepEqual(parseRoute("/feed", ""), HOME, "a feed with no name is not a place");
  assert.deepEqual(parseRoute("/feed/trending", ""), HOME, "and the path form is not a route at all");
});

/* A shared address has to survive arriving somewhere that cannot read it. A catalogue key is a
   number only that catalogue understands; the ids in every vault record are not. */
test("a portable key is a key, and is not a catalogue", async () => {
  const { isPortableKey, parseShowKey, PORTABLE_SRC } =
    await import("../public/js/domain/constants.js");
  assert.equal(isPortableKey("imdb:tt0903747"), true);
  assert.equal(isPortableKey("tvdb:81189"), true);
  assert.equal(isPortableKey("tmdb:1396"), false, "a catalogue key is not portable");
  assert.equal(isPortableKey("tvmaze:169"), false);
  assert.equal(isPortableKey("nonsense"), false, "and something with no colon is not a key");
  assert.equal(isPortableKey(""), false);
  assert.deepEqual(parseShowKey("imdb:tt0903747"), { src: "imdb", ref: "tt0903747" });
  assert.ok(!PORTABLE_SRC.has("tmdb"), "no catalogue is ever treated as portable");
});

test("a portable address routes like any other show", () => {
  assert.deepEqual(parseRoute("/show", "#imdb:tt0903747"), { name: "show", arg: "imdb:tt0903747" });
  assert.equal(pathFor("show", "imdb:tt0903747"), "/show#imdb:tt0903747",
    "and the colon stays readable");
});

test("the share button prefers a portable id and falls back to the key it has", async () => {
  const { portableKey } = await import("../public/js/domain/constants.js");
  assert.equal(portableKey("tmdb:1396", { imdb: "tt0903747", tvdb: 81189 }), "imdb:tt0903747");
  assert.equal(portableKey("tmdb:1396", { imdb: null, tvdb: 81189 }), "tvdb:81189");
  assert.equal(portableKey("tmdb:1396", { imdb: null, tvdb: null }), "tmdb:1396");
  assert.equal(portableKey("tvmaze:169", null), "tvmaze:169");
});
