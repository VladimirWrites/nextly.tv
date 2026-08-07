// Reading a zip, with nothing installed.
//
// A Trakt export arrives as a zip and the app has no bundler and no dependencies, so this is
// the format's own structure walked by hand. It is less code than it sounds: a zip is a
// sequence of files followed by a directory of where they are, and the directory is what this
// reads, because it is the only part that is authoritative about names and lengths.
//
// Inflating is the browser's job. DecompressionStream has been in every engine since Safari
// 16.4, does it natively, and means no copy of an inflate implementation lives in this
// repository to be maintained and audited. Where it is missing, this says so rather than
// failing at a byte offset.
//
// Only what a Trakt export uses is supported: stored and deflated entries, no encryption, no
// zip64, no multi-disk. Anything else is refused by name.

const EOCD = 0x06054b50;        // end of central directory
const CEN = 0x02014b50;         // a central directory entry
const LOC = 0x04034b50;         // a local file header

/* The end-of-central-directory record is at the end, after a comment of unknown length, so it
   is found by searching backwards for its signature. The comment is capped at 65535 bytes by
   the format, which bounds the search. */
function findEnd(view) {
  const start = Math.max(0, view.byteLength - 65_557);
  for (let i = view.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === EOCD) return i;
  }
  return -1;
}

/* Where each entry is, and how long. Read from the central directory rather than from the
   local headers: a local header is allowed to leave the sizes at zero and put them in a
   descriptor after the data, which cannot be found without decoding the data first. The
   directory always has them. */
function entries(view) {
  const end = findEnd(view);
  if (end < 0) throw new Error("That file isn't a zip.");

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = [];

  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CEN) throw new Error("That zip's directory is damaged.");
    const method = view.getUint16(at + 10, true);
    const flags = view.getUint16(at + 8, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(
      new Uint8Array(view.buffer, view.byteOffset + at + 46, nameLen));
    out.push({ name, method, flags, compressed, size, offset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// The local header repeats the name and extra fields, and their lengths are the only way to
// know where the entry's bytes actually start.
function dataAt(view, entry) {
  if (view.getUint32(entry.offset, true) !== LOC) throw new Error("That zip's contents are damaged.");
  const nameLen = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  return new Uint8Array(view.buffer, view.byteOffset + start, entry.compressed);
}

async function inflate(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser can't unzip files. Try a newer one, or unzip it yourself.");
  }
  // deflate-raw, not deflate: a zip entry carries no zlib header around its deflate stream.
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* Every file in the zip whose name a caller wants, as text.
 *
 * Selective on purpose. A Trakt export holds forty-odd files, most of which are somebody's
 * comments, ratings, social graph and account settings — this app wants the history and the
 * totals, and decompressing the rest would mean holding the others in memory for no reason.
 *
 * `wanted` is either a list of names or a function taking one, since the history's file names
 * are only known once the zip has been opened. */
export async function readZip(buffer, wanted) {
  const view = new DataView(buffer);
  /* A list of names or a test for one. The test is not a convenience: Trakt splits a history
     into watched-history-1.json, -2 and so on once it is long enough, and how many there are
     is not known until the directory has been read. */
  const want = typeof wanted === "function" ? wanted
    : wanted ? ((name) => new Set(wanted).has(name)) : null;
  const out = {};

  for (const entry of entries(view)) {
    if (want && !want(entry.name)) continue;
    if (entry.name.endsWith("/")) continue;
    // Bit 0 is the encryption flag. Nothing here can read one, and guessing would produce
    // rubbish rather than an error.
    if (entry.flags & 1) throw new Error("That zip is password-protected.");
    if (entry.method !== 0 && entry.method !== 8) {
      throw new Error(`That zip uses a compression this can't read (method ${entry.method}).`);
    }
    const raw = dataAt(view, entry);
    const bytes = entry.method === 0 ? raw : await inflate(raw);
    out[entry.name] = new TextDecoder().decode(bytes);
  }
  return out;
}

/* What is in there, without taking anything out.
 *
 * Two services answer a data request with a zip, and which one this is has to be decided before
 * anything is unpacked: the readers want different files, and handing the wrong list to the
 * right zip yields an empty import rather than an error. Reading the directory is cheap — it is
 * a few hundred bytes at the end of the file, and no entry is decompressed to do it. */
export function zipNames(buffer) {
  return entries(new DataView(buffer)).map((e) => e.name).filter((n) => !n.endsWith("/"));
}

// The files a Trakt export is read for, parsed. A file that is present but not JSON is a
// broken export rather than an empty one, so it is not quietly treated as absent.
export async function readJSONZip(buffer, wanted) {
  const text = await readZip(buffer, wanted);
  const out = {};
  for (const [name, body] of Object.entries(text)) {
    try {
      out[name] = JSON.parse(body);
    } catch (e) {
      throw new Error(`${name} inside that zip isn't readable JSON.`);
    }
  }
  return out;
}
