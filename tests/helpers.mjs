// Shared fixtures. The domain modules are pure ES modules with no DOM or network, so they
// import straight into the test runner.
import { deflateRawSync, crc32 } from "node:zlib";
import { emptyState, makeShow, normShow } from "../public/js/domain/schema.js";

export const T = {
  // Fixed instants, so nothing here depends on when the suite runs.
  past: Date.UTC(2020, 0, 1),
  t1: Date.UTC(2024, 0, 1),
  t2: Date.UTC(2024, 0, 2),
  t3: Date.UTC(2024, 0, 3),
  now: Date.UTC(2024, 5, 1),
};

// A two-season show: season 1 fully aired, season 2 half aired, plus one special.
export function metaFixture(over = {}) {
  return {
    key: "tvmaze:1",
    src: "tvmaze",
    ref: 1,
    name: "Test Show",
    year: 2020,
    status: "Running",
    seasons: [
      {
        n: 1,
        episodes: [
          { e: 1, name: "One", air: "2020-01-01" },
          { e: 2, name: "Two", air: "2020-01-08" },
          { e: 3, name: "Three", air: "2020-01-15", special: true },
        ],
      },
      {
        n: 2,
        episodes: [
          { e: 1, name: "Four", air: "2024-01-01" },
          { e: 2, name: "Five", air: "2030-01-01" },   // not aired at T.now
          { e: 3, name: "Six", air: null },            // announced, unscheduled
        ],
      },
    ],
    ...over,
  };
}

// Fixtures are a show being watched, because that's what nearly every test is about. Adding
// now defaults to "planned", so the tests that care about status say so themselves.
export function showFixture(marks = [], over = {}) {
  const sh = normShow(makeShow(metaFixture(), T.t1));
  sh.st = "active";
  sh.entries = marks.map((id) => (typeof id === "string" ? { id, m: T.t1 } : id));
  return Object.assign(sh, over);
}

export function stateWith(shows) {
  const s = emptyState();
  s.shows = shows;
  return s;
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const keys = (show) => (show.entries || []).map((e) => e.id).sort();

/* A zip, by hand: a local header and payload per entry, then a central directory saying where
   each one is, then the end record. Enough of the format to be a real zip and no more, written
   with Node's own zlib so what is tested is this app's reader against somebody else's writer.

   Shared rather than kept in the zip suite because the fault it exists to catch was not in the
   reader at all: it was in the list of names handed to it, one layer up. */
export function makeZip(files, { store = false } = {}) {
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
