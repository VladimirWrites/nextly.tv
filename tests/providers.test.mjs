// Provider normalization. Every catalogue has to produce the same shape, because the whole
// domain layer is written against that shape and nothing below it knows which one it came
// from. fetch is stubbed, so these run offline and assert on the mapping, not on the network.
import test from "node:test";
import assert from "node:assert/strict";
import * as tvmaze from "../public/js/io/providers/tvmaze.js";
import * as tmdb from "../public/js/io/providers/tmdb.js";
import { state } from "../public/js/domain/store.js";
import { episodeList } from "../public/js/domain/progress.js";

function stubFetch(routes) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    const hit = Object.entries(routes).find(([k]) => u.includes(k));
    if (!hit) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { "content-type": "application/json" } });
  };
}

/* What /lookup/shows really answers with: the show, and no episodes, because the endpoint
   takes no embed parameter. Split out from TVMAZE_SHOW on purpose — a fixture that carried
   episodes here let a lookup that never fetched them pass, which is how 0/0 shipped. */
const lookupReply = (show) => { const { _embedded, ...rest } = show; return rest; };

const TVMAZE_SHOW = {
  id: 169,
  name: "Breaking Bad",
  premiered: "2008-01-20",
  status: "Ended",
  summary: "<p>A high school <b>chemistry</b> teacher.</p>",
  network: { name: "AMC" },
  averageRuntime: 60,
  genres: ["Drama", "Crime"],
  image: { medium: "https://static.tvmaze.com/m.jpg", original: "https://static.tvmaze.com/o.jpg" },
  externals: { imdb: "tt0903747", thetvdb: 81189, tvrage: 18164 },
  _embedded: {
    episodes: [
      { season: 1, number: 1, name: "Pilot", airdate: "2008-01-20", runtime: 60, type: "regular", summary: "<p>One.</p>" },
      { season: 1, number: 2, name: "Cat's in the Bag", airdate: "2008-01-27", runtime: 48, type: "regular", summary: null },
      { season: 1, number: 3, name: "A Special", airdate: "2008-02-03", runtime: 20, type: "insignificant_special", summary: null },
      { season: 2, number: 1, name: "Seven Thirty-Seven", airdate: "2009-03-08", runtime: 47, type: "regular", summary: null },
    ],
  },
};

const TVMAZE_LOOKUP = lookupReply(TVMAZE_SHOW);

test("tvmaze returns one show with every episode from a single request", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify(TVMAZE_SHOW), { status: 200 });
  };
  const meta = await tvmaze.fetchShow(169);
  assert.equal(calls, 1, "the whole episode list should cost one round trip");
  assert.equal(meta.key, "tvmaze:169");
  assert.equal(meta.src, "tvmaze");
  assert.equal(meta.ref, 169);
  assert.equal(meta.name, "Breaking Bad");
  assert.equal(meta.year, 2008);
  assert.equal(meta.status, "Ended");
  assert.equal(meta.network, "AMC");
  assert.deepEqual(meta.genres, ["Drama", "Crime"]);
});

test("tvmaze carries the portable ids that outlive the catalogue", async () => {
  stubFetch({ "/shows/169": TVMAZE_SHOW });
  const meta = await tvmaze.fetchShow(169);
  assert.equal(meta.imdb, "tt0903747");
  assert.equal(meta.tvdb, 81189);
});

test("tvmaze strips the HTML out of summaries", async () => {
  stubFetch({ "/shows/169": TVMAZE_SHOW });
  const meta = await tvmaze.fetchShow(169);
  assert.equal(meta.overview, "A high school chemistry teacher.");
  assert.equal(meta.seasons[0].episodes[0].overview, "One.");
});

test("tvmaze groups episodes into seasons in order", async () => {
  stubFetch({ "/shows/169": TVMAZE_SHOW });
  const meta = await tvmaze.fetchShow(169);
  assert.deepEqual(meta.seasons.map((s) => s.n), [1, 2]);
  assert.deepEqual(meta.seasons[0].episodes.map((e) => e.e), [1, 2, 3]);
});

test("tvmaze flags specials by episode type, not by season number", async () => {
  stubFetch({ "/shows/169": TVMAZE_SHOW });
  const meta = await tvmaze.fetchShow(169);
  assert.deepEqual(meta.seasons[0].episodes.map((e) => !!e.special), [false, false, true]);
  // and the domain layer then filters them the same way it does for TMDB
  assert.deepEqual(episodeList(meta).map((e) => e.key), ["1x1", "1x2", "2x1"]);
});

test("tvmaze search maps to the shape the UI renders", async () => {
  stubFetch({ "/search/shows": [{ score: 1, show: TVMAZE_SHOW }] });
  const [hit] = await tvmaze.search("breaking bad");
  assert.equal(hit.key, "tvmaze:169");
  assert.equal(hit.name, "Breaking Bad");
  assert.equal(hit.year, 2008);
  assert.equal(hit.poster, "https://static.tvmaze.com/m.jpg");
  assert.equal(hit.overview.includes("<p>"), false);
});

test("tvmaze surfaces a rate limit as a message a person can act on", async () => {
  globalThis.fetch = async () => new Response("", { status: 429 });
  await assert.rejects(() => tvmaze.fetchShow(1), /rate limit/i);
});

const TMDB_SHOW = {
  id: 1396,
  name: "Breaking Bad",
  first_air_date: "2008-01-20",
  status: "Ended",
  overview: "A chemistry teacher.",
  networks: [{ name: "AMC" }],
  episode_run_time: [49],
  genres: [{ name: "Drama" }],
  poster_path: "/p.jpg",
  backdrop_path: "/b.jpg",
  external_ids: { imdb_id: "tt0903747", tvdb_id: 81189 },
  seasons: [{ season_number: 0 }, { season_number: 1 }],
  "season/0": { name: "Specials", air_date: "2009-02-17", episodes: [{ episode_number: 1, name: "Good Cop Bad Cop", air_date: "2009-02-17" }] },
  "season/1": { name: "Season 1", air_date: "2008-01-20", episodes: [{ episode_number: 1, name: "Pilot", air_date: "2008-01-20", runtime: 58 }] },
};

test("tmdb normalizes to the same shape, with absolute image URLs", async () => {
  state.settings.tmdbKey = "testkey";
  stubFetch({ "/tv/1396": TMDB_SHOW });
  const meta = await tmdb.fetchShow(1396);
  assert.equal(meta.key, "tmdb:1396");
  assert.equal(meta.src, "tmdb");
  assert.equal(meta.imdb, "tt0903747");
  assert.equal(meta.poster, "https://image.tmdb.org/t/p/w500/p.jpg");
  assert.equal(meta.backdrop, "https://image.tmdb.org/t/p/w1280/b.jpg");
  assert.equal(meta.network, "AMC");
});

test("tmdb marks season 0 as specials, matching how tvmaze flags them", async () => {
  state.settings.tmdbKey = "testkey";
  stubFetch({ "/tv/1396": TMDB_SHOW });
  const meta = await tmdb.fetchShow(1396);
  const specials = meta.seasons.find((s) => s.n === 0);
  assert.equal(specials.episodes[0].special, true);
  assert.equal(meta.seasons.find((s) => s.n === 1).episodes[0].special, false);
  assert.deepEqual(episodeList(meta).map((e) => e.key), ["1x1"]);
});

test("tmdb refuses to call out without a key", async () => {
  state.settings.tmdbKey = "";
  await assert.rejects(() => tmdb.fetchShow(1396), /No TMDB key/);
});

test("tmdb reports a rejected key as a key problem", async () => {
  state.settings.tmdbKey = "bad";
  globalThis.fetch = async () => new Response("", { status: 401 });
  await assert.rejects(() => tmdb.fetchShow(1396), /rejected the key/i);
});

test("a v4 read token goes in the header, a v3 key in the query", async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init && init.headers && init.headers.authorization });
    return new Response(JSON.stringify(TMDB_SHOW), { status: 200 });
  };
  state.settings.tmdbKey = "aaa.bbb.ccc";
  await tmdb.fetchShow(1396);
  assert.equal(seen[0].auth, "Bearer aaa.bbb.ccc");
  assert.equal(seen[0].url.includes("api_key"), false);

  seen.length = 0;
  state.settings.tmdbKey = "plainkey";
  await tmdb.fetchShow(1396);
  assert.equal(seen[0].auth, undefined);
  assert.ok(seen[0].url.includes("api_key=plainkey"));
  state.settings.tmdbKey = "";
});

/* ---- scores ----
   A score with no source is folklore, so each one is stored with where it came from. Kept as
   a list because a show can carry more than one. */

test("tvmaze keeps its rating, attributed and linked", async () => {
  stubFetch({ "/shows/169": { ...TVMAZE_SHOW, rating: { average: 9.2 },
                              url: "https://www.tvmaze.com/shows/169/breaking-bad" } });
  const meta = await tvmaze.fetchShow(169);
  assert.deepEqual(meta.ratings, [{
    source: "TVmaze", score: 9.2, max: 10, url: "https://www.tvmaze.com/shows/169/breaking-bad",
  }]);
});

test("an unrated show carries an empty list, not a zero", async () => {
  stubFetch({ "/shows/169": { ...TVMAZE_SHOW, rating: { average: null } } });
  const meta = await tvmaze.fetchShow(169);
  assert.deepEqual(meta.ratings, [], "no rating is not the same as a rating of nothing");
});

test("tmdb carries the vote count too, since it is what makes a score mean anything", async () => {
  state.settings.tmdbKey = "testkey";
  stubFetch({ "/tv/1396": { ...TMDB_SHOW, vote_average: 8.9, vote_count: 14231 } });
  const meta = await tmdb.fetchShow(1396);
  assert.deepEqual(meta.ratings, [{
    source: "TMDB", score: 8.9, max: 10, votes: 14231,
    url: "https://www.themoviedb.org/tv/1396",
  }]);
  state.settings.tmdbKey = "";
});

test("search results name the source of their score", async () => {
  stubFetch({ "/search/shows": [{ score: 1, show: { ...TVMAZE_SHOW, rating: { average: 7.5 } } }] });
  const [hit] = await tvmaze.search("breaking bad");
  assert.equal(hit.rating, 7.5);
  assert.equal(hit.ratingSource, "TVmaze");
});

/* ---- a second opinion ----
   A show tracked from one catalogue keeps that catalogue's numbering, because that is what
   its marks were recorded against. A score is not numbering, so once the portable ids are on
   the record the other catalogue can be asked what it thinks, and both sit side by side with
   their names on them. */

const { withOtherScores } = await import("../public/js/io/meta.js");

test("a TVmaze-tracked show picks up TMDB's score", async () => {
  state.settings.tmdbKey = "testkey";
  stubFetch({
    "/find/tt0412142": { tv_results: [{ id: 1408 }] },
    "/tv/1408": { id: 1408, vote_average: 8.6, vote_count: 5000 },
  });
  const out = await withOtherScores({
    key: "tvmaze:118", src: "tvmaze", imdb: "tt0412142",
    ratings: [{ source: "TVmaze", score: 8.9, max: 10 }],
  });
  assert.deepEqual(out.ratings.map((r) => r.source), ["TVmaze", "TMDB"]);
  assert.equal(out.ratings[1].score, 8.6);
  assert.equal(out.ratings[1].votes, 5000);
  state.settings.tmdbKey = "";
});

test("and a TMDB-tracked show picks up TVmaze's, which needs no key", async () => {
  state.settings.tmdbKey = "";
  stubFetch({ "/lookup/shows": { rating: { average: 8.9 }, url: "https://www.tvmaze.com/shows/118" } });
  const out = await withOtherScores({
    key: "tmdb:1408", src: "tmdb", imdb: "tt0412142",
    ratings: [{ source: "TMDB", score: 8.6, max: 10 }],
  });
  assert.deepEqual(out.ratings.map((r) => r.source), ["TMDB", "TVmaze"]);
  assert.equal(out.ratings[1].url, "https://www.tvmaze.com/shows/118");
});

test("a score already present is not asked for twice", async () => {
  state.settings.tmdbKey = "";
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("{}", { status: 200 }); };
  const m = { key: "tvmaze:1", imdb: "tt1", ratings: [
    { source: "TVmaze", score: 8 }, { source: "TMDB", score: 7 },
  ] };
  assert.equal(await withOtherScores(m), m, "nothing to ask, so the same object comes back");
  assert.equal(calls, 0);
});

test("without a portable id there is nothing to ask about", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("{}", { status: 200 }); };
  const m = { key: "tvmaze:1", ratings: [] };
  assert.equal(await withOtherScores(m), m);
  assert.equal(calls, 0);
});

test("a second opinion that fails to arrive is not an error", async () => {
  state.settings.tmdbKey = "";
  globalThis.fetch = async () => new Response("", { status: 500 });
  const m = { key: "tmdb:1", imdb: "tt1", ratings: [{ source: "TMDB", score: 7 }] };
  const out = await withOtherScores(m);
  assert.deepEqual(out.ratings.map((r) => r.source), ["TMDB"]);
});

/* ---- when a catalogue can no longer be reached ----
   A TMDB key can be deleted, and TMDB itself can go away. A show numbered by it would then
   have no artwork, no episode list and no air dates on any device with a cold cache. The
   portable ids in the vault exist for this. */

const { fetchShow: fetchMeta, usable } = await import("../public/js/io/meta.js");

test("TVmaze is always reachable; TMDB only with a key", () => {
  state.settings.tmdbKey = "";
  assert.equal(usable("tvmaze"), true);
  assert.equal(usable("tmdb"), false);
  state.settings.tmdbKey = "k";
  assert.equal(usable("tmdb"), true);
  state.settings.tmdbKey = "";
});

test("a known alias is used directly, with no search", async () => {
  state.settings.tmdbKey = "";
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify(TVMAZE_SHOW), { status: 200 });
  };
  const m = await fetchMeta("tmdb:1408", { alt: ["tvmaze:169"], imdb: "tt0903747" });
  assert.equal(seen.length, 1, "straight to the show it already knows about");
  assert.ok(seen[0].includes("/shows/169"));
  assert.equal(m.key, "tmdb:1408", "filed under the key asked for, so the marks still line up");
  assert.equal(m.from, "tvmaze:169", "and it says where the answer came from");
  assert.equal(m.seasons.length, 2);
});

test("with no alias it is found by its IMDb id, episodes and all", async () => {
  state.settings.tmdbKey = "";
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    return new Response(JSON.stringify(u.includes("/lookup/shows") ? TVMAZE_LOOKUP : TVMAZE_SHOW),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  const m = await fetchMeta("tmdb:1408", { imdb: "tt0903747" });
  assert.equal(m.key, "tmdb:1408");
  assert.equal(m.from, "tvmaze:169");

  /* The point of the test. /lookup/shows answers with the show alone, so a record built from
     that reply has everything except the episodes — and a show with no episodes reports 0/0
     however many marks are against it. This asserts the second request happened. */
  assert.ok(seen.some((u) => u.includes("/shows/169")), "the id it found is fetched in full");
  assert.equal(m.seasons.length, 2);
  assert.equal(m.seasons.reduce((n, se) => n + se.episodes.length, 0), 4);
});

test("its own catalogue is used whenever it can be", async () => {
  state.settings.tmdbKey = "testkey";
  stubFetch({ "/tv/1396": TMDB_SHOW });
  const m = await fetchMeta("tmdb:1396", { alt: ["tvmaze:169"] });
  assert.equal(m.key, "tmdb:1396");
  assert.equal(m.from, undefined, "no stand-in was needed");
  state.settings.tmdbKey = "";
});

test("a show with no portable id says so rather than failing silently", async () => {
  state.settings.tmdbKey = "";
  globalThis.fetch = async () => new Response("{}", { status: 404 });
  await assert.rejects(() => fetchMeta("tmdb:1408", {}), /no id to find it by/i);
});
