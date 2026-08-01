// Cast comes from the catalogue in use, not from the one a show happens to be numbered by.
// None of it is stored, so the numbering is beside the point here — what matters is which
// catalogue is being read, and so which profile the link goes to.
import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../public/js/domain/store.js";
import { credits } from "../public/js/io/meta.js";

const use = (provider, tmdbKey = "") => Object.assign(state.settings, { provider, tmdbKey });

// A TVmaze-numbered show, as anything tracked before a TMDB key was entered would be. Each test
// uses its own id, since the answers are held for the session and keyed by it.
const onTvmaze = (ref, extra = {}) => ({ key: `tvmaze:${ref}`, imdb: "tt11280740", ...extra });

function routes(map) {
  const hits = [];
  globalThis.fetch = async (url) => {
    hits.push(String(url));
    const found = Object.entries(map).find(([k]) => String(url).includes(k));
    return new Response(JSON.stringify(found ? found[1] : {}), { status: found ? 200 : 404 });
  };
  return hits;
}

const TVMAZE_CAST = [{ person: { id: 31964, name: "Adam Scott", image: { medium: "p.jpg" } },
                       character: { name: "Mark Scout" } }];
const TMDB_CAST = { cast: [{ id: 1, name: "Adam Scott", character: "Mark S.", profile_path: "/a.jpg" }] };

test("TVmaze in use, TVmaze show: asked directly, nothing to translate", async () => {
  use("tvmaze");
  const hits = routes({ "/shows/1/cast": TVMAZE_CAST });
  const cast = await credits(onTvmaze(1));
  assert.deepEqual(cast.map((c) => [c.key, c.character]), [["tvmaze:31964", "Mark Scout"]]);
  assert.equal(hits.length, 1, "its own catalogue needs no lookup first");
});

test("TMDB in use, TVmaze show: TMDB answers, once it has found its own id", async () => {
  use("tmdb", "k");
  const hits = routes({ "/find/tt11280740": { tv_results: [{ id: 1396 }] }, "/tv/1396/credits": TMDB_CAST });
  const cast = await credits(onTvmaze(2));
  assert.deepEqual(cast.map((c) => [c.key, c.character]), [["tmdb:1", "Mark S."]],
    "person keys come from TMDB, so the profile link will too");
  assert.ok(hits.some((u) => u.includes("/find/tt11280740")), "one extra request, to translate the show");
  use("tvmaze");
});

test("a catalogue that can't place the show falls back rather than showing nothing", async () => {
  use("tmdb", "k");
  routes({ "/find/tt11280740": { tv_results: [] }, "/shows/3/cast": TVMAZE_CAST });
  const cast = await credits(onTvmaze(3));
  assert.equal(cast[0].key, "tvmaze:31964", "the other catalogue's cast beats no cast");
  use("tvmaze");
});

test("with no portable id there is nothing to translate, so its own catalogue answers", async () => {
  use("tmdb", "k");
  const hits = routes({ "/shows/4/cast": TVMAZE_CAST });
  const cast = await credits({ key: "tvmaze:4" });
  assert.equal(cast.length, 1);
  assert.equal(hits.filter((u) => u.includes("/find/")).length, 0);
  use("tvmaze");
});

test("switching catalogue re-asks instead of repeating the other one's answer", async () => {
  const show = onTvmaze(5);
  use("tvmaze");
  routes({ "/shows/5/cast": TVMAZE_CAST });
  assert.equal((await credits(show))[0].key, "tvmaze:31964");

  use("tmdb", "k");
  routes({ "/find/tt11280740": { tv_results: [{ id: 1396 }] }, "/tv/1396/credits": TMDB_CAST });
  assert.equal((await credits(show))[0].key, "tmdb:1", "what's held is keyed by catalogue too");
  use("tvmaze");
});

test("a record a stand-in answered is read from whoever answered, not from its key", async () => {
  use("tvmaze");
  const hits = routes({ "/shows/6/cast": TVMAZE_CAST });
  const cast = await credits({ key: "tmdb:99999", from: "tvmaze:6", imdb: "tt11280740" });
  assert.equal(cast[0].key, "tvmaze:31964");
  assert.equal(hits.length, 1);
});

test("the same show twice costs one request", async () => {
  use("tvmaze");
  const show = onTvmaze(7);
  const hits = routes({ "/shows/7/cast": TVMAZE_CAST });
  await credits(show);
  await credits(show);
  assert.equal(hits.length, 1, "held for the session");
});

test("a show with no key at all asks nobody", async () => {
  const hits = routes({});
  assert.deepEqual(await credits({}), []);
  assert.equal(hits.length, 0);
});

/* ---- where a number came from ----
   Everything inside a record — episodes, dates, scores — came from one catalogue, and 8.4 on
   TVmaze is a different claim from 8.4 on TMDB. */
import { sourceOf } from "../public/js/io/meta.js";

test("a record names the catalogue that answered for it", () => {
  assert.equal(sourceOf({ key: "tvmaze:38052" }), "TVmaze");
  assert.equal(sourceOf({ key: "tmdb:125988" }), "TMDB");
});

test("a stand-in is credited to whoever actually answered", () => {
  assert.equal(sourceOf({ key: "tmdb:125988", from: "tvmaze:38052" }), "TVmaze",
    "the key is TMDB's numbering; the episodes and their scores are TVmaze's");
});

test("nothing to credit without a record", () => {
  assert.equal(sourceOf(null), "");
  assert.equal(sourceOf({}), "");
});

/* ---- aggregate_credits ----
   For a series, /credits answers with one season's billing; aggregate_credits collects a
   person's roles across the whole run and counts their episodes. Same single request. */

const AGGREGATE = { cast: [
  { id: 1, name: "Rebecca Ferguson", profile_path: "/r.jpg", total_episode_count: 30,
    roles: [{ character: "Juliette Nichols", episode_count: 30 }] },
  { id: 2, name: "Common", total_episode_count: 12,
    roles: [{ character: "Robert Sims", episode_count: 10 }, { character: "Sheriff", episode_count: 2 }] },
  { id: 3, name: "Extra Person", total_episode_count: 1, roles: [] },
]};

test("roles come from across the run, with the episode count", async () => {
  use("tmdb", "k");
  const hits = routes({ "/aggregate_credits": AGGREGATE });
  const cast = await credits({ key: "tmdb:2313" });
  assert.deepEqual(cast.map((c) => [c.name, c.character, c.episodes]), [
    ["Rebecca Ferguson", "Juliette Nichols", 30],
    ["Common", "Robert Sims / Sheriff", 12],
    ["Extra Person", "", 1],
  ]);
  assert.ok(hits[0].includes("/tv/2313/aggregate_credits"), "asked the aggregate endpoint");
  use("tvmaze");
});

test("more than two credited names fall back to the count", async () => {
  use("tmdb", "k");
  routes({ "/aggregate_credits": { cast: [{ id: 9, name: "Someone", total_episode_count: 40,
    roles: [{ character: "A" }, { character: "B" }, { character: "C" }] }] } });
  const cast = await credits({ key: "tmdb:9001" });
  assert.equal(cast[0].character, "A / B", "a caption holds two; the rest are in the count");
  assert.equal(cast[0].episodes, 40);
  use("tvmaze");
});

test("an older cast list beats none when aggregate is unavailable", async () => {
  use("tmdb", "k");
  const hits = routes({ "/tv/9002/credits": { cast: [{ id: 5, name: "Plain", character: "Someone" }] } });
  const cast = await credits({ key: "tmdb:9002" });
  assert.deepEqual(cast.map((c) => [c.name, c.character, c.episodes]), [["Plain", "Someone", null]]);
  assert.ok(hits.some((u) => u.includes("aggregate_credits")), "tried the better one first");
  use("tvmaze");
});
