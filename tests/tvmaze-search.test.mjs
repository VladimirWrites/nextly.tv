// Typing against a matcher built for finished words.
import test from "node:test";
import assert from "node:assert/strict";
import { looksIncomplete, search } from "../public/js/io/providers/tvmaze.js";

test("a query is unfinished when its last word is a stub", () => {
  assert.equal(looksIncomplete("breaking b"), true);
  assert.equal(looksIncomplete("breaking ba"), true, "two characters is still a stub — 'ba' finds nothing");
  assert.equal(looksIncomplete("game of thr"), false, "three is enough for the matcher to try");
  assert.equal(looksIncomplete("breaking bad"), false);
});

test("one word is never a stub, however short", () => {
  // A single word is matched on its own and works: "sil" finds shows, "b" finds shows.
  assert.equal(looksIncomplete("si"), false);
  assert.equal(looksIncomplete("b"), false);
  assert.equal(looksIncomplete(""), false);
  assert.equal(looksIncomplete(null), false);
  assert.equal(looksIncomplete("  the office  "), false);
});

const rows = (...names) => names.map((n) => ({ show: { id: 1, name: n, image: null, rating: {}, externals: {} } }));

test("an empty answer to an unfinished query is asked again without the stub", async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(decodeURIComponent(String(url).split("q=")[1]));
    const body = asked.length === 1 ? [] : rows("Breaking Bad");
    return new Response(JSON.stringify(body), { status: 200 });
  };

  const out = await search("breaking ba");
  assert.deepEqual(asked, ["breaking ba", "breaking"], "the stub is dropped, not the whole query");
  assert.deepEqual(out.map((r) => r.name), ["Breaking Bad"]);
});

test("an answer that came back is kept, and nothing is asked twice", async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(decodeURIComponent(String(url).split("q=")[1]));
    return new Response(JSON.stringify(rows("The Office")), { status: 200 });
  };
  const out = await search("the of");
  assert.equal(asked.length, 1, "it found something, so there is nothing to repair");
  assert.deepEqual(out.map((r) => r.name), ["The Office"]);
});

test("a finished query that finds nothing is left alone", async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(decodeURIComponent(String(url).split("q=")[1]));
    return new Response(JSON.stringify([]), { status: 200 });
  };
  assert.deepEqual(await search("qwertyuiop"), []);
  assert.equal(asked.length, 1, "no stub to drop: the answer is that there is nothing");
});
