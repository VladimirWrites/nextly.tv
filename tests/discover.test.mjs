import test from "node:test";
import assert from "node:assert/strict";
import { premieres, airing, trackedKeys } from "../public/js/domain/discover.js";
import { T } from "./helpers.mjs";

const at = { now: T.now };   // 2024-06-01

// The shape TVmaze returns from /schedule/web: an episode with its show embedded.
function ep(showId, name, { season = 1, number = 1, air = "2024-06-05", weight = 50 } = {}) {
  return {
    season, number, airdate: air,
    _embedded: { show: { id: showId, name, premiered: "2020-01-01", weight,
      image: { medium: `https://img/${showId}.jpg` }, genres: ["Drama"],
      rating: { average: 8 }, webChannel: { name: "Netflix" } } },
  };
}

test("premieres keeps only first episodes of a season", () => {
  const rows = premieres([
    ep(1, "Premiere", { number: 1 }),
    ep(2, "Mid-season", { number: 4 }),
  ], at);
  assert.deepEqual(rows.map((r) => r.name), ["Premiere"]);
});

test("premieres ignores specials, which sit in season 0", () => {
  assert.equal(premieres([ep(1, "Special", { season: 0, number: 1 })], at).length, 0);
});

test("premieres ranks by popularity, then by how soon it airs", () => {
  const rows = premieres([
    ep(1, "Low",   { weight: 10, air: "2024-06-02" }),
    ep(2, "High",  { weight: 99, air: "2024-06-20" }),
    ep(3, "Also99", { weight: 99, air: "2024-06-04" }),
  ], at);
  assert.deepEqual(rows.map((r) => r.name), ["Also99", "High", "Low"]);
});

test("premieres drops shows already in the library", () => {
  const rows = premieres([ep(1, "Tracked"), ep(2, "New")],
    { ...at, tracked: new Set(["tvmaze:1"]) });
  assert.deepEqual(rows.map((r) => r.name), ["New"]);
});

test("premieres drops anything that already aired, but keeps today", () => {
  const rows = premieres([
    ep(1, "LastWeek", { air: "2024-05-20" }),
    ep(2, "Today",    { air: "2024-06-01" }),
    ep(3, "Soon",     { air: "2024-06-08" }),
  ], at);
  assert.deepEqual(rows.map((r) => r.name).sort(), ["Soon", "Today"]);
});

test("a show airing twice in the window appears once, at its earliest date", () => {
  const rows = premieres([
    ep(1, "Twice", { air: "2024-06-10", season: 2 }),
    ep(1, "Twice", { air: "2024-06-04", season: 3 }),
  ], at);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].air, "2024-06-04");
});

test("a card carries what a discovery row renders, and nothing more", () => {
  const [c] = premieres([ep(7, "Silo", { weight: 88, season: 3 })], at);
  assert.equal(c.key, "tvmaze:7");
  assert.equal(c.src, "tvmaze");
  assert.equal(c.name, "Silo");
  assert.equal(c.year, 2020);
  assert.equal(c.poster, "https://img/7.jpg");
  assert.equal(c.weight, 88);
  assert.equal(c.season, 3);
  assert.equal(c.network, "Netflix");
  assert.equal("episodes" in c, false, "a card is not a show; episode lists are fetched on demand");
});

test("premieres respects the limit", () => {
  const many = Array.from({ length: 40 }, (_, i) => ep(i + 1, `S${i}`, { weight: i }));
  assert.equal(premieres(many, { ...at, limit: 5 }).length, 5);
});

test("airing keeps every episode, not just premieres, ranked by popularity", () => {
  const rows = airing([
    ep(1, "Quiet", { number: 6, weight: 20 }),
    ep(2, "Loud",  { number: 3, weight: 90 }),
  ], {});
  assert.deepEqual(rows.map((r) => r.name), ["Loud", "Quiet"]);
});

test("airing also excludes tracked shows", () => {
  const rows = airing([ep(1, "Tracked", { number: 2 })], { tracked: new Set(["tvmaze:1"]) });
  assert.equal(rows.length, 0);
});

test("malformed schedule entries are skipped rather than throwing", () => {
  assert.deepEqual(premieres([{ number: 1, season: 1 }, null, {}], at), []);
  assert.deepEqual(airing(undefined, {}), []);
});

test("trackedKeys reads the library's show keys", () => {
  assert.deepEqual([...trackedKeys([{ id: "tvmaze:1" }, { id: "tmdb:9" }])], ["tvmaze:1", "tmdb:9"]);
  assert.equal(trackedKeys(null).size, 0);
});

/* ---- which catalogue is in use ----
   These guard a bug where the TMDB rows were gated on "is a key stored" rather than "is TMDB
   the catalogue in use", so they survived switching back to TVmaze — while Settings said in
   as many words that the key was not being used. */

const { hasTmdb, trendingFeed, popularFeed, topRatedFeed, similarTo, premiereFeed, airingFeed }
  = await import("../public/js/io/discover.js");
const { state } = await import("../public/js/domain/store.js");

const configure = (provider, tmdbKey) => Object.assign(state.settings, { provider, tmdbKey });

test("TMDB rows are off when TVmaze is the chosen catalogue, even with a valid key", () => {
  configure("tvmaze", "a-real-key");
  assert.equal(hasTmdb(), false, "a stored key is not the same as a chosen catalogue");
});

test("TMDB rows are off when TMDB is chosen but no key is set", () => {
  configure("tmdb", "");
  assert.equal(hasTmdb(), false, "without a key the catalogue falls back to TVmaze");
});

test("TMDB rows are on only when TMDB is chosen and a key is set", () => {
  configure("tmdb", "a-real-key");
  assert.equal(hasTmdb(), true);
});

test("the TMDB feeds return nothing rather than calling out when TMDB is not in use", async () => {
  configure("tvmaze", "a-real-key");
  // A page rather than a bare list now, because these feeds are paged. Empty means the same
  // thing it always did: nothing to show, and no request made.
  const empty = { cards: [], pages: 1 };
  assert.deepEqual(await trendingFeed(), empty);
  assert.deepEqual(await popularFeed(), empty);
  assert.deepEqual(await topRatedFeed(), empty);
  assert.deepEqual(await similarTo({ id: "tvmaze:1", src: "tvmaze", imdb: "tt1" }), empty);
  configure("tvmaze", "");
});

/* The whole-feed screen and the row on the search screen go through one accessor, so the shape
   it hands back has to be the same whichever catalogue answered — a screen that had to ask
   which kind of feed it was showing would be the bug this prevents. */
test("feedPage answers in one shape for both catalogues", async () => {
  const { feedPage } = await import("../public/js/io/discover.js");
  configure("tvmaze", "");
  const tv = await feedPage("premieres", 1, { tracked: new Set() });
  assert.ok(Array.isArray(tv.cards));
  assert.equal(tv.more, false, "TVmaze rows are computed here, so page one is all of it");
  assert.deepEqual(await feedPage("premieres", 2, { tracked: new Set() }), { cards: [], more: false });

  const tmdb = await feedPage("trending", 1);
  assert.ok(Array.isArray(tmdb.cards), "and the same shape when TMDB is not even in use");
  assert.equal(tmdb.more, false);

  assert.deepEqual(await feedPage("not-a-feed"), { cards: [], more: false });
});

/* The mirror image, and the one the user hit: the keyless rows kept showing under TMDB. They
   carry tvmaze: keys, so opening one would have added a show under the other catalogue's
   episode numbering — the marks would then be against numbering nothing else agrees with. */

test("the TVmaze feeds return nothing when TMDB is the chosen catalogue", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("[]", { status: 200 }); };
  configure("tmdb", "a-real-key");
  assert.deepEqual(await premiereFeed(), []);
  assert.deepEqual(await airingFeed(), []);
  assert.equal(called, false, "a gated feed should not reach the network at all");
  configure("tvmaze", "");
});

test("the TVmaze feeds stay on when TMDB is selected but unusable, since that is what runs", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("[]", { status: 200 }); };
  configure("tmdb", "");   // no key, so activeProvider falls back to TVmaze
  await airingFeed();
  assert.equal(called, true, "TVmaze is doing the work here, so its row belongs on screen");
  configure("tvmaze", "");
});

/* ---- artwork stand-in ----
   A show with no poster used to render its whole title inside the box, which at 52px wide
   produced an unreadable block for names like "KREM NASJONAL - HANNA FRA TANA". */
const { initials } = await import("../public/js/domain/constants.js");

test("initials shorten any title to something that fits a poster slot", () => {
  assert.equal(initials("KREM NASJONAL - HANNA FRA TANA"), "KN");
  assert.equal(initials("Breaking Bad"), "BB");
  assert.equal(initials("Severance"), "SE");
  assert.equal(initials("24"), "24");
});

test("initials cope with punctuation, accents and nothing at all", () => {
  assert.equal(initials("¡Que viva!"), "QV");
  assert.equal(initials("Ünter Ölberg"), "ÜÖ");
  assert.equal(initials(""), "?");
  assert.equal(initials(null), "?");
  assert.equal(initials("— —"), "?");
});

const { fmtScore, fmtVotes } = await import("../public/js/domain/constants.js");

test("scores show one decimal, because the second is noise on a 0-10 average", () => {
  assert.equal(fmtScore(9), "9.0");
  assert.equal(fmtScore(8.26), "8.3");
  assert.equal(fmtScore(null), null);
  assert.equal(fmtScore(NaN), null);
});

test("vote counts are shortened rather than spelled out", () => {
  assert.equal(fmtVotes(431), "431 votes");
  assert.equal(fmtVotes(12431), "12.4k votes");
  assert.equal(fmtVotes(2_400_000), "2.4M votes");
  assert.equal(fmtVotes(0), null);
});
