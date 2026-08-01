// Which of TMDB's videos is "the trailer".
//
// A show carries teasers, clips, opening titles and featurettes, often one per language and one
// per season, all in the same list. Picking the wrong one is worse than picking none.
import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../public/js/domain/store.js";
import { trailer, seasonTrailer } from "../public/js/io/meta.js";

const use = (provider, tmdbKey = "") => Object.assign(state.settings, { provider, tmdbKey });

function routes(map) {
  const hits = [];
  globalThis.fetch = async (url) => {
    hits.push(String(url));
    const found = Object.entries(map).find(([k]) => String(url).includes(k));
    return new Response(JSON.stringify(found ? found[1] : {}), { status: found ? 200 : 404 });
  };
  return hits;
}

const VIDEOS = { results: [
  { site: "YouTube", key: "clip1", type: "Clip", official: true, published_at: "2025-01-01" },
  { site: "YouTube", key: "teaser", type: "Teaser", official: true, published_at: "2024-01-01" },
  { site: "YouTube", key: "old", type: "Trailer", official: true, name: "Season 1 Trailer", published_at: "2023-04-01" },
  { site: "YouTube", key: "new", type: "Trailer", official: true, name: "Season 3 Trailer", published_at: "2026-05-01" },
  { site: "Vimeo", key: "vimeo", type: "Trailer", official: true, published_at: "2027-01-01" },
]};

test("the newest official trailer, and only from a site that plays on a phone", async () => {
  use("tmdb", "k");
  routes({ "/tv/900/videos": VIDEOS });
  const t = await trailer({ key: "tmdb:900" });
  assert.equal(t.key, "new", "newest wins — a returning show has one trailer per season");
  assert.equal(t.url, "https://www.youtube.com/watch?v=new");
  assert.equal(t.name, "Season 3 Trailer");
  use("tvmaze");
});

test("a teaser will do when there is no trailer; a clip will not", async () => {
  use("tmdb", "k");
  routes({ "/tv/901/videos": { results: [
    { site: "YouTube", key: "c", type: "Clip", official: true },
    { site: "YouTube", key: "t", type: "Teaser", official: true },
  ]}});
  assert.equal((await trailer({ key: "tmdb:901" })).key, "t");

  routes({ "/tv/902/videos": { results: [{ site: "YouTube", key: "c", type: "Featurette" }] } });
  assert.equal(await trailer({ key: "tmdb:902" }), null, "a featurette is not a trailer");
  use("tvmaze");
});

test("an unofficial upload loses to an official one", async () => {
  use("tmdb", "k");
  routes({ "/tv/903/videos": { results: [
    { site: "YouTube", key: "fan", type: "Trailer", official: false, published_at: "2027-01-01" },
    { site: "YouTube", key: "real", type: "Trailer", official: true, published_at: "2020-01-01" },
  ]}});
  assert.equal((await trailer({ key: "tmdb:903" })).key, "real");
  use("tvmaze");
});

test("a record that already carries one is not asked for again", async () => {
  use("tmdb", "k");
  const hits = routes({});
  const held = { key: "tmdb:904", trailer: { key: "abc", url: "https://www.youtube.com/watch?v=abc", name: "Trailer" } };
  assert.equal((await trailer(held)).key, "abc");
  assert.equal(hits.length, 0, "it came appended to the record's own request");
  use("tvmaze");
});

test("a show numbered by the other catalogue is translated first", async () => {
  use("tmdb", "k");
  const hits = routes({ "/find/tt99": { tv_results: [{ id: 555 }] }, "/tv/555/videos": VIDEOS });
  const t = await trailer({ key: "tvmaze:44", imdb: "tt99" });
  assert.equal(t.key, "new");
  assert.ok(hits.some((u) => u.includes("/find/tt99")), "one request to place it, then one to ask");
  use("tvmaze");
});

test("a season asks for its own, and gets nothing rather than the show's", async () => {
  use("tmdb", "k");
  routes({ "/tv/905/season/2/videos": { results: [
    { site: "YouTube", key: "s2", type: "Trailer", official: true, name: "Season 2 Trailer" },
  ]}});
  assert.equal((await seasonTrailer({ key: "tmdb:905" }, 2)).key, "s2");

  routes({ "/tv/906/videos": VIDEOS });     // the show has one; season 1 does not
  assert.equal(await seasonTrailer({ key: "tmdb:906" }, 1), null,
    "the show's trailer on a season page advertises a later season");
  use("tvmaze");
});

test("TVmaze has no video of any kind, and asks nobody", async () => {
  use("tvmaze");
  const hits = routes({});
  assert.equal(await trailer({ key: "tvmaze:38052" }), null);
  assert.equal(await seasonTrailer({ key: "tvmaze:38052" }, 1), null);
  assert.equal(hits.length, 0);
});
