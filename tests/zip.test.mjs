// Reading a zip without a library.
//
// The archives here are built by Node's own zlib and assembled to the format's spec, so what
// is being tested is this reader against somebody else's writer rather than against itself.
import test from "node:test";
import assert from "node:assert/strict";
import { readZip, readJSONZip } from "../public/js/io/zip.js";
import { makeZip } from "./helpers.mjs";

test("a deflated entry comes back as what went in", async () => {
  const body = JSON.stringify([{ hello: "world".repeat(50) }]);
  const out = await readZip(makeZip({ "a.json": body }));
  assert.equal(out["a.json"], body);
});

// Small files are often stored rather than deflated, because deflating them makes them bigger.
test("a stored entry does too", async () => {
  const out = await readZip(makeZip({ "b.json": "[]" }, { store: true }));
  assert.equal(out["b.json"], "[]");
});

/* A Trakt export holds forty-three files and this app wants two. Decompressing the rest would
   mean holding somebody's comments, ratings and social graph in memory for no reason. */
test("only the named files are read", async () => {
  const out = await readZip(
    makeZip({ "watched-history.json": "[1]", "user-profile.json": '{"email":"x"}', "notes-people.json": "[]" }),
    ["watched-history.json"],
  );
  assert.deepEqual(Object.keys(out), ["watched-history.json"]);
});

test("entries are found by the directory, whatever order they sit in", async () => {
  const out = await readZip(makeZip({ "one.json": "1", "two.json": "22", "three.json": "333" }));
  assert.deepEqual(out, { "one.json": "1", "two.json": "22", "three.json": "333" });
});

test("something that isn't a zip is said to be, rather than read as one", async () => {
  // Its own buffer, not Buffer's shared pool — a pooled slice hands the reader eight kilobytes
  // of whatever was there before, which is not the thing under test.
  const text = Buffer.from("this is not a zip, it is a sentence");
  const junk = new Uint8Array(text).buffer;
  await assert.rejects(() => readZip(junk), /isn't a zip/);
});

test("JSON is parsed, and a file that isn't JSON is named", async () => {
  const good = await readJSONZip(makeZip({ "x.json": '[{"a":1}]' }));
  assert.deepEqual(good["x.json"], [{ a: 1 }]);
  await assert.rejects(() => readJSONZip(makeZip({ "y.json": "{not json" })), /y\.json/);
});
