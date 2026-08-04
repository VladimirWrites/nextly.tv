// Reading a zip without a library.
//
// The archives here are built by Node's own zlib and assembled to the format's spec, so what
// is being tested is this reader against somebody else's writer rather than against itself.
import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, crc32 } from "node:zlib";
import { readZip, readJSONZip } from "../public/js/io/zip.js";

/* A zip, by hand: a local header and payload per entry, then a central directory saying where
   each one is, then the end record. Enough of the format to be a real zip and no more. */
function makeZip(files, { store = false } = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8");
    const body = store ? raw : deflateRawSync(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);                       // version needed
    local.writeUInt16LE(store ? 0 : 8, 8);            // method
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(store ? 0 : 8, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);

  const buf = Buffer.concat([...chunks, dir, end]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

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
