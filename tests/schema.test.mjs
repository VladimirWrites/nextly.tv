import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, migrate, normShow, ensureDel, defSettings, findShow } from "../public/js/domain/schema.js";
import { showKey, parseShowKey, epKey, parseEpKey, epCode } from "../public/js/domain/constants.js";

test("a fresh state has every bucket the merge expects", () => {
  const s = emptyState();
  assert.deepEqual(s.shows, []);
  assert.deepEqual(Object.keys(s.del).sort(), ["ep", "show"]);
  assert.equal(s.settings.provider, "tvmaze");
});

test("show keys round-trip through parse", () => {
  assert.equal(showKey("tvmaze", 169), "tvmaze:169");
  assert.deepEqual(parseShowKey("tvmaze:169"), { src: "tvmaze", ref: "169" });
  assert.equal(parseShowKey("nonsense"), null);
  assert.equal(parseShowKey(""), null);
});

test("episode keys round-trip and render as codes", () => {
  assert.equal(epKey(3, 7), "3x7");
  assert.deepEqual(parseEpKey("3x7"), { s: 3, e: 7 });
  assert.equal(parseEpKey("S03E07"), null);
  assert.equal(epCode(3, 7), "S03E07");
  assert.equal(epCode(12, 104), "S12E104");
});

test("normShow fills in what an older or hand-edited blob may be missing", () => {
  const sh = normShow({ id: "tvmaze:5", name: "X", entries: [{ id: "1x1" }] });
  assert.equal(sh.src, "tvmaze");
  assert.equal(sh.ref, "5");
  assert.equal(sh.st, "planned", "tracking a show is not the same as starting it");
  assert.equal(sh.imdb, null);
  assert.equal(sh.entries[0].m, 0);
});

test("normShow drops records it can't key, and marks it can't parse", () => {
  assert.equal(normShow(null), null);
  assert.equal(normShow({ name: "no id" }), null);
  assert.equal(normShow({ id: "no-colon-key" }), null);
  const sh = normShow({ id: "tvmaze:5", entries: [{ id: "1x1" }, { id: "bogus" }, null, { id: 7 }] });
  assert.deepEqual(sh.entries.map((e) => e.id), ["1x1"]);
});

/* This used to assert the opposite — that a mark was rebuilt from the fields this build knows,
   so the blob could not accrete junk. That rule turned an out-of-date device into a destructive
   one: it would load a mark written by a newer build, delete the field it had never heard of,
   and push the stripped copy back for every other device. A field it cannot read is not a field
   it should be able to delete, and a few unread bytes cost less than the data they protect. */
test("normShow carries a field it does not understand rather than deleting it", () => {
  const sh = normShow({ id: "tvmaze:5", entries: [{ id: "1x1", m: 5, w: 9, somethingLater: "x" }] });
  assert.deepEqual(Object.keys(sh.entries[0]).sort(), ["id", "m", "somethingLater", "w"]);
});

test("what it does understand is still normalised, and rubbish is still refused", () => {
  const sh = normShow({ id: "tvmaze:5", entries: [
    { id: "1x1", m: "5", n: "3", w: "9" },
    { id: "nonsense", m: 1 },
    { m: 2 },
    null,
  ]});
  assert.equal(sh.entries.length, 1, "a mark needs an episode key that means something");
  assert.deepEqual(sh.entries[0], { id: "1x1", m: 5, n: 3, w: 9 }, "numbers, not strings");
});

test("migrate accepts an unknown object without throwing", () => {
  const s = migrate({ shows: "not an array" });
  assert.deepEqual(s.shows, []);
  assert.deepEqual(migrate(null).shows, []);
  assert.equal(migrate(undefined).v, emptyState().v);
});

test("migrate keeps unknown settings while restoring the defaults", () => {
  const s = migrate({ settings: { future: 1 } });
  assert.equal(s.settings.provider, defSettings().provider);
  assert.equal(s.settings.future, 1);
});

/* Theme is the one setting that is deliberately forgotten. It belongs to the device, and a
   vault that still carries one is from before that was true — io/storage.js takes the value
   over for this device first, and this drop is what stops it syncing to every other one and
   what keeps it out of the export. */
test("migrate drops a theme left in an old vault", () => {
  const s = migrate({ settings: { theme: "dark", future: 1 } });
  assert.equal(s.settings.theme, undefined);
  assert.equal(s.settings.future, 1, "and takes nothing else with it");
  assert.ok(!("theme" in JSON.parse(JSON.stringify(s.settings))), "gone from the serialised form too");
});

test("ensureDel is idempotent and keeps existing tombstones", () => {
  const s = { del: { show: { "tvmaze:1": 5 } } };
  ensureDel(s);
  ensureDel(s);
  assert.equal(s.del.show["tvmaze:1"], 5);
  assert.deepEqual(s.del.ep, {});
});

test("findShow matches on the string key", () => {
  const s = migrate({ shows: [{ id: "tvmaze:1", name: "A" }] });
  assert.equal(findShow(s, "tvmaze:1").name, "A");
  assert.equal(findShow(s, "tmdb:1"), null);
});

/* ---- one series, two catalogues ----
   Keys are provider-scoped because episode numbering belongs to the catalogue. That is
   right, and it means the same series carries a different key in each — which is how The OA
   ended up in the library twice, once from TVmaze and once from TMDB. The portable ids are
   what identify a series across catalogues, and are stored for exactly this. */

const { findSameShow } = await import("../public/js/domain/schema.js");
const { addShow } = await import("../public/js/domain/model.js");

const held = (over = {}) => ({ shows: [Object.assign(
  { id: "tvmaze:99", src: "tvmaze", ref: 99, name: "The OA", imdb: "tt4635282", tvdb: 314338 },
  over)] });

test("the same key is the same show", () => {
  assert.equal(findSameShow(held(), { key: "tvmaze:99" }).name, "The OA");
});

test("a different catalogue's key still matches on the IMDb id", () => {
  const hit = findSameShow(held(), { key: "tmdb:67744", src: "tmdb", ref: 67744, imdb: "tt4635282" });
  assert.ok(hit, "TMDB's The OA is the same show as TVmaze's");
  assert.equal(hit.id, "tvmaze:99");
});

test("TVDB matches too, for a record with no IMDb id", () => {
  const hit = findSameShow(held(), { key: "tmdb:67744", tvdb: 314338 });
  assert.equal(hit.id, "tvmaze:99");
});

test("TVDB matches across a number and its string, since catalogues disagree on the type", () => {
  assert.ok(findSameShow(held({ tvdb: "314338" }), { key: "tmdb:1", tvdb: 314338 }));
});

test("a missing id never matches, or every show without one would be the same show", () => {
  const library = held({ imdb: null, tvdb: null });
  assert.equal(findSameShow(library, { key: "tmdb:1", imdb: null, tvdb: null }), null);
});

test("a genuinely different show is not a match", () => {
  assert.equal(findSameShow(held(), { key: "tmdb:1", imdb: "tt0903747" }), null);
});

test("nothing at all is not a match", () => {
  assert.equal(findSameShow(held(), null), null);
  assert.equal(findSameShow({ shows: [] }, { key: "tmdb:1", imdb: "tt1" }), null);
});

test("addShow refuses the second copy and hands back the one already held", () => {
  const s = held();
  const same = addShow(s, { key: "tmdb:67744", src: "tmdb", ref: 67744, name: "The OA", imdb: "tt4635282" });
  assert.equal(s.shows.length, 1, "one series, one row");
  assert.equal(same.id, "tvmaze:99", "and the marks stay with the copy that has them");
});

/* ---- what a search result should say about itself ----
   TMDB's search returns no external ids, so a show tracked from TVmaze looked untracked in a
   TMDB result list: it offered to add House and then refused. The label falls back to title
   and year; the add itself never does. */

const { findLikeShow } = await import("../public/js/domain/schema.js");

// As normShow leaves it, alt included — that is what a real vault holds.
const house = () => ({ shows: [{
  id: "tvmaze:118", src: "tvmaze", ref: 118, name: "House", year: 2004,
  imdb: "tt0412142", tvdb: 73255, alt: [],
}] });

test("a TMDB result with no external ids still reads as tracked", () => {
  const hit = findLikeShow(house(), { key: "tmdb:1408", src: "tmdb", ref: 1408, name: "House", year: 2004 });
  assert.ok(hit, "same title, same year, and nothing else to go on");
  assert.equal(hit.id, "tvmaze:118");
});

test("ids still win, so a retitled show matches on them and not on its name", () => {
  const hit = findLikeShow(house(), { key: "tmdb:1408", name: "Dr House", year: 2004, imdb: "tt0412142" });
  assert.equal(hit.id, "tvmaze:118");
});

test("the title match ignores case and accents, as sorting does", () => {
  assert.ok(findLikeShow(house(), { key: "tmdb:1", name: "HOUSE", year: 2004 }));
});

test("a different year is a different show", () => {
  assert.equal(findLikeShow(house(), { key: "tmdb:1", name: "House", year: 2028 }), null);
});

test("no year is no claim — a bare title is not enough", () => {
  assert.equal(findLikeShow(house(), { key: "tmdb:1", name: "House" }), null);
  assert.equal(findLikeShow(house(), { key: "tmdb:1", name: "", year: 2004 }), null);
});

test("addShow ignores the loose match: a title must never block tracking", () => {
  const s = house();
  addShow(s, { key: "tmdb:1408", src: "tmdb", ref: 1408, name: "House", year: 2004 });
  assert.equal(s.shows.length, 2, "no shared id, so these are two different records");
});

/* ---- learning the other catalogue's name for a show ----
   The add knows exactly what it collided with, because it fetched the full record and read
   its external ids. A result list only ever sees keys. Keeping what the add worked out is
   what lets the list know too, without a request of its own. */

test("a refused add records the key it was refused under", () => {
  const s = house();
  addShow(s, { key: "tmdb:1408", src: "tmdb", ref: 1408, name: "House", year: 2004, imdb: "tt0412142" });
  assert.equal(s.shows.length, 1);
  assert.deepEqual(s.shows[0].alt, ["tmdb:1408"]);
});

test("and that key matches directly from then on, with no ids needed", () => {
  const s = house();
  addShow(s, { key: "tmdb:1408", imdb: "tt0412142" });
  // A bare search result: a key and nothing else, which is all TMDB's search returns.
  const hit = findSameShow(s, { key: "tmdb:1408" });
  assert.ok(hit, "the alias answers what the external ids answered the first time");
  assert.equal(hit.id, "tvmaze:118");
});

test("learning it again does not grow the record", () => {
  const s = house();
  addShow(s, { key: "tmdb:1408", imdb: "tt0412142" });
  addShow(s, { key: "tmdb:1408", imdb: "tt0412142" });
  assert.deepEqual(s.shows[0].alt, ["tmdb:1408"]);
});

test("a show never aliases itself", () => {
  const s = house();
  addShow(s, { key: "tvmaze:118", imdb: "tt0412142" });
  assert.deepEqual(s.shows[0].alt, []);
});

test("learning bumps the record's mtime, so the other devices get it", () => {
  const s = house();
  s.shows[0].m = 1;
  addShow(s, { key: "tmdb:1408", imdb: "tt0412142" }, 5000);
  assert.equal(s.shows[0].m, 5000);
});

test("an older blob with no alt list is filled in rather than crashing", () => {
  assert.deepEqual(normShow({ id: "tvmaze:1", name: "X" }).alt, []);
});

/* ---- folding two copies of one series into one ----
   Records added from different catalogues before anything compared the portable ids are
   already in people's vaults. Loading repairs them, and keeps repairing them when a device
   that still holds both syncs its copy over. */

const { mergeDuplicates } = await import("../public/js/domain/schema.js");

const pair = () => ({ shows: [
  { id: "tvmaze:118", src: "tvmaze", ref: 118, name: "House", year: 2004, imdb: "tt0412142",
    tvdb: null, alt: [], st: "planned", added: 100, m: 100,
    entries: [{ id: "1x1", m: 10 }, { id: "1x2", m: 20 }] },
  { id: "tmdb:1408", src: "tmdb", ref: 1408, name: "House", year: 2004, imdb: "tt0412142",
    tvdb: 73255, alt: [], st: "active", added: 200, m: 200,
    entries: [{ id: "1x2", m: 99 }, { id: "1x3", m: 30 }] },
] });

test("two copies of one series become one row", () => {
  const s = pair();
  assert.equal(mergeDuplicates(s, 500), 1);
  assert.equal(s.shows.length, 1);
});

test("the copy holding more history keeps the identity", () => {
  const s = pair();
  s.shows[1].entries.push({ id: "2x1", m: 40 });     // TMDB now holds more
  mergeDuplicates(s, 500);
  assert.equal(s.shows[0].id, "tmdb:1408", "its numbering is what most of the history was recorded against");
});

test("an even split keeps the one tracked first", () => {
  const s = pair();                                   // two marks each
  mergeDuplicates(s, 500);
  assert.equal(s.shows[0].id, "tvmaze:118");
});

test("no watch mark is lost, and the higher pass survives", () => {
  const s = pair();
  s.shows[0].entries.push({ id: "1x9", m: 5 });      // give TVmaze the larger history
  s.shows[1].entries[0].n = 2;                        // 1x2 watched twice in the other copy
  mergeDuplicates(s, 500);
  const keeper = s.shows[0];
  assert.equal(keeper.id, "tvmaze:118");
  assert.deepEqual(keeper.entries.map((e) => e.id).sort(), ["1x1", "1x2", "1x3", "1x9"]);
  assert.equal(keeper.entries.find((e) => e.id === "1x2").n, 2, "the higher pass wins");
  assert.equal(keeper.entries.find((e) => e.id === "1x2").m, 99, "and the newer mtime");
});

test("both catalogues' ids end up on the survivor", () => {
  const s = pair();
  s.shows[0].entries.push({ id: "1x9", m: 5 });
  mergeDuplicates(s, 500);
  assert.equal(s.shows[0].imdb, "tt0412142");
  assert.equal(s.shows[0].tvdb, 73255, "taken from the copy that had it");
  assert.deepEqual(s.shows[0].alt, ["tmdb:1408"], "and it answers to the other key too");
});

test("the further-along status wins over merely planned", () => {
  const s = pair();
  s.shows[0].entries.push({ id: "1x9", m: 5 });
  mergeDuplicates(s, 500);
  assert.equal(s.shows[0].st, "active");
});

test("a rewatch in either copy carries", () => {
  const s = pair();
  s.shows[0].entries.push({ id: "1x9", m: 5 });
  s.shows[1].rw = 3;
  mergeDuplicates(s, 500);
  assert.equal(s.shows[0].rw, 3);
});

test("the merged record is stamped, so other devices take this version", () => {
  const s = pair();
  s.shows[0].entries.push({ id: "1x9", m: 5 });
  mergeDuplicates(s, 500);
  assert.equal(s.shows[0].m, 500);
  assert.equal(s.shows[0].added, 100, "and it has been tracked since the earlier of the two");
});

test("shows that merely share nothing are left alone", () => {
  const s = { shows: [
    { id: "tvmaze:1", name: "A", imdb: "tt1", alt: [], entries: [] },
    { id: "tmdb:2", name: "B", imdb: "tt2", alt: [], entries: [] },
  ] };
  assert.equal(mergeDuplicates(s, 500), 0);
  assert.equal(s.shows.length, 2);
});

test("loading a vault repairs it without being asked", () => {
  const s = migrate(pair());
  assert.equal(s.shows.length, 1, "the duplicate is gone by the time anything renders");
});

/* ---- one series, one page ----
   The show page decided tracked-or-not by comparing keys while tracking resolved the portable
   ids, so the same series found in the other catalogue read as untracked and Track then said
   it was already in the library. Both now ask the same question. */
test("a series held under one catalogue's numbering is found by the other's", () => {
  const st = { shows: [], settings: {} };
  addShow(st, { key: "tvmaze:38052", src: "tvmaze", ref: 38052, name: "Silo", imdb: "tt14688458" });

  const asTmdb = { key: "tmdb:125988", src: "tmdb", ref: 125988, name: "Silo", imdb: "tt14688458" };
  const held = findSameShow(st, asTmdb);
  assert.ok(held, "the IMDb id names the same series");
  assert.equal(held.id, "tvmaze:38052", "and the record the marks are on is the one to open");
});

test("an attempt to add it again teaches the library the other key", () => {
  const st = { shows: [], settings: {} };
  addShow(st, { key: "tvmaze:38052", src: "tvmaze", ref: 38052, name: "Silo", imdb: "tt14688458" });
  const before = st.shows.length;

  addShow(st, { key: "tmdb:125988", src: "tmdb", ref: 125988, name: "Silo", imdb: "tt14688458" });
  assert.equal(st.shows.length, before, "one series, one row");
  assert.deepEqual(st.shows[0].alt, ["tmdb:125988"], "and the key it was looked up by is remembered");

  // Which means the next lookup needs no portable id at all.
  assert.equal(findSameShow(st, { key: "tmdb:125988" }).id, "tvmaze:38052");
});

/* ---- has anything actually changed? ----
   Every foreground merges the server's copy in, and almost every one of those merges is a
   no-op. Repainting anyway rebuilds the screen, and a rebuilt screen drops its horizontal rows
   back to placeholders. */
const { fingerprint } = await import("../public/js/domain/schema.js");

const lib = () => ({
  shows: [{ id: "tvmaze:1", name: "One", m: 500, entries: [{ id: "1x1", m: 400 }] }],
  settings: { provider: "tvmaze" }, updatedAt: 500,
});

test("the same library fingerprints the same", () => {
  assert.equal(fingerprint(lib()), fingerprint(lib()));
  assert.equal(fingerprint({ shows: [] }), fingerprint({ shows: [] }));
});

test("every kind of edit moves it", () => {
  const base = fingerprint(lib());

  const marked = lib(); marked.shows[0].entries.push({ id: "1x2", m: 600 });
  assert.notEqual(fingerprint(marked), base, "a new mark");

  const unmarked = lib(); unmarked.shows[0].entries = [];
  assert.notEqual(fingerprint(unmarked), base, "a mark removed");

  const rewatched = lib(); rewatched.shows[0].entries[0].m = 900;
  assert.notEqual(fingerprint(rewatched), base, "a mark touched — a level, or a watch date");

  const renamed = lib(); renamed.shows[0].m = 900;
  assert.notEqual(fingerprint(renamed), base, "the show's own record");

  const added = lib(); added.shows.push({ id: "tvmaze:2", name: "Two", m: 10, entries: [] });
  assert.notEqual(fingerprint(added), base, "a show added");

  const settings = lib(); settings.settings.provider = "tmdb";
  assert.notEqual(fingerprint(settings), base, "a setting");
});

test("a library with nothing in it is not an error", () => {
  assert.equal(typeof fingerprint({}), "string");
  assert.equal(typeof fingerprint(null), "string");
});
