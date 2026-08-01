// Multi-device merge. This is the file that decides whether the app loses data, so the
// cases here are written as the real scenarios they stand for.
import test from "node:test";
import assert from "node:assert/strict";
import { setBaseline, stampMtimes, mergeStates, epTombKey } from "../public/js/domain/merge.js";
import { emptyState, migrate } from "../public/js/domain/schema.js";
import { showFixture, stateWith, clone, keys, T } from "./helpers.mjs";

// A device: a state, plus the baseline it last synced at.
function device(shows) {
  const s = stateWith(shows.map(clone));
  setBaseline(s);
  return s;
}

// Stamp a state as if it were about to sync, using the given baseline.
function stamp(s, baseline, now) {
  setBaseline(baseline);
  return stampMtimes(now, s);
}

test("two devices marking different episodes both win", () => {
  const base = [showFixture(["1x1"])];
  const a = device(base);
  const b = device(base);

  a.shows[0].entries.push({ id: "1x2", m: 0 });
  b.shows[0].entries.push({ id: "2x1", m: 0 });
  stamp(a, stateWith(base.map(clone)), T.t2);
  stamp(b, stateWith(base.map(clone)), T.t2);

  const merged = mergeStates(a, b);
  assert.deepEqual(keys(merged.shows[0]), ["1x1", "1x2", "2x1"]);
});

test("unwatching on one device removes the mark the other still has", () => {
  const base = [showFixture(["1x1", "1x2"])];
  const a = device(base);
  const b = device(base);

  a.shows[0].entries = a.shows[0].entries.filter((e) => e.id !== "1x2");
  stamp(a, stateWith(base.map(clone)), T.t2);

  const merged = mergeStates(a, b);
  assert.deepEqual(keys(merged.shows[0]), ["1x1"]);
  assert.ok(merged.del.ep[epTombKey("tvmaze:1", "1x2")], "the deletion is recorded, not just applied");
});

test("re-watching after an unwatch beats the tombstone", () => {
  const base = [showFixture(["1x1"])];
  const a = device(base);

  a.shows[0].entries = [];
  stamp(a, stateWith(base.map(clone)), T.t2);          // unwatched at t2
  const afterUnwatch = clone(a);

  a.shows[0].entries.push({ id: "1x1", m: T.t3 });     // watched again at t3
  const merged = mergeStates(a, afterUnwatch);
  assert.deepEqual(keys(merged.shows[0]), ["1x1"]);
});

test("a tombstone wins a tie against a mark of the same age", () => {
  const a = stateWith([showFixture([{ id: "1x1", m: T.t2 }])]);
  const b = stateWith([showFixture([])]);
  b.del.ep[epTombKey("tvmaze:1", "1x1")] = T.t2;
  assert.deepEqual(keys(mergeStates(a, b).shows[0]), []);
});

test("removing a show on one device deletes it everywhere", () => {
  const base = [showFixture(["1x1"])];
  const a = device(base);
  const b = device(base);

  a.shows = [];
  stamp(a, stateWith(base.map(clone)), T.t2);

  assert.equal(mergeStates(a, b).shows.length, 0);
});

test("watching an episode after another device deleted the show keeps the show", () => {
  const base = [showFixture(["1x1"])];
  const a = device(base);
  const b = device(base);

  a.shows = [];
  stamp(a, stateWith(base.map(clone)), T.t2);          // deleted at t2
  b.shows[0].entries.push({ id: "1x2", m: T.t3 });     // watched at t3, i.e. later

  const merged = mergeStates(a, b);
  assert.equal(merged.shows.length, 1, "a later edit outranks an earlier deletion");
  assert.deepEqual(keys(merged.shows[0]), ["1x1", "1x2"]);
});

test("merging is order-independent", () => {
  const base = [showFixture(["1x1"])];
  const a = device(base);
  const b = device(base);
  a.shows[0].entries.push({ id: "1x2", m: T.t2 });
  b.shows[0].entries.push({ id: "2x1", m: T.t3 });
  b.shows.push(showFixture([], { id: "tvmaze:2", name: "Other", m: T.t2 }));

  const ab = mergeStates(a, b);
  const ba = mergeStates(b, a);
  const norm = (s) => s.shows.map((x) => [x.id, keys(x)]).sort((p, q) => p[0].localeCompare(q[0]));
  assert.deepEqual(norm(ab), norm(ba));
});

test("a show added on one device survives the merge", () => {
  const a = stateWith([showFixture([], { id: "tvmaze:1" })]);
  const b = stateWith([showFixture([], { id: "tvmaze:2", name: "Second" })]);
  assert.deepEqual(mergeStates(a, b).shows.map((s) => s.id).sort(), ["tvmaze:1", "tvmaze:2"]);
});

test("the newest settings win as a unit", () => {
  const a = emptyState();
  const b = emptyState();
  a.settings = { ...a.settings, theme: "dark", m: T.t1 };
  b.settings = { ...b.settings, theme: "light", tmdbKey: "abc", m: T.t3 };
  const merged = mergeStates(a, b);
  assert.equal(merged.settings.theme, "light");
  assert.equal(merged.settings.tmdbKey, "abc");
});

test("stampMtimes assigns mtimes only to records that actually changed", () => {
  const base = [showFixture([{ id: "1x1", m: T.t1 }])];
  const s = stateWith(base.map(clone));
  s.shows[0].entries.push({ id: "1x2", m: 0 });

  stamp(s, stateWith(base.map(clone)), T.t3);
  const marks = Object.fromEntries(s.shows[0].entries.map((e) => [e.id, e.m]));
  assert.equal(marks["1x1"], T.t1, "an untouched mark keeps its original time");
  assert.equal(marks["1x2"], T.t3);
});

test("stampMtimes bumps a show whose status changed", () => {
  const base = [showFixture(["1x1"])];
  const s = stateWith(base.map(clone));
  s.shows[0].st = "dropped";
  stamp(s, stateWith(base.map(clone)), T.t3);
  assert.equal(s.shows[0].m, T.t3);
});

test("marks stay sorted after a merge, so the blob stays diffable", () => {
  const a = stateWith([showFixture([{ id: "2x1", m: T.t1 }, { id: "1x2", m: T.t1 }])]);
  const b = stateWith([showFixture([{ id: "1x1", m: T.t1 }])]);
  assert.deepEqual(mergeStates(a, b).shows[0].entries.map((e) => e.id), ["1x1", "1x2", "2x1"]);
});

test("merging a state against itself changes nothing", () => {
  const s = stateWith([showFixture(["1x1", "1x2"])]);
  const merged = mergeStates(s, clone(s));
  assert.deepEqual(keys(merged.shows[0]), ["1x1", "1x2"]);
  assert.equal(merged.shows.length, 1);
});

/* ---- the watch date travels between devices ----
   `w` is when an episode was watched and `m` is when the record changed. They are different
   fields for a reason — sync resolves conflicts with the second — and a merge that dropped the
   first would leave two devices showing different histories for the same library. */
test("a watch date set on one device survives the merge", () => {
  const phone = { shows: [{ id: "tvmaze:1", name: "S", m: 10, entries: [{ id: "1x1", m: 10 }] }] };
  const desktop = { shows: [{ id: "tvmaze:1", name: "S", m: 20,
    entries: [{ id: "1x1", m: 20, w: 1683309600000 }] }] };

  const merged = mergeStates(phone, desktop);
  assert.equal(merged.shows[0].entries[0].w, 1683309600000, "the newer mark wins, and brings its date");

  // And the other way round, because a merge must not depend on which side it is given.
  const other = mergeStates(desktop, phone);
  assert.equal(other.shows[0].entries[0].w, 1683309600000);
});

test("an older device's copy cannot strip a watch date it has never heard of", () => {
  const dated = { shows: [{ id: "tvmaze:1", name: "S", m: 20, entries: [{ id: "1x1", m: 20, w: 999 }] }] };
  // The same mark, older mtime, no w — what a device that has not synced yet holds.
  const stale = { shows: [{ id: "tvmaze:1", name: "S", m: 5, entries: [{ id: "1x1", m: 5 }] }] };
  assert.equal(mergeStates(dated, stale).shows[0].entries[0].w, 999);
  assert.equal(mergeStates(stale, dated).shows[0].entries[0].w, 999);
});

/* ---- a tie is reconciled, not won by whoever asked first ----
   Two devices stamping the same mark in the same millisecond is not exotic: dating a library as
   it aired does it to every mark at once. Whoever came first used to win, and since each device
   merges its own copy first, each kept its own and neither ever caught up. */
const markPair = (mine, theirs) => [
  { shows: [{ id: "tvmaze:1", name: "S", m: 1, entries: [mine] }] },
  { shows: [{ id: "tvmaze:1", name: "S", m: 1, entries: [theirs] }] },
];
const markOf = (st) => st.shows[0].entries[0];

test("the same mtime on both sides gives the same answer either way round", () => {
  const [a, b] = markPair({ id: "1x1", m: 500, w: 111 }, { id: "1x1", m: 500 });
  assert.equal(markOf(mergeStates(a, b)).w, 111);
  assert.equal(markOf(mergeStates(b, a)).w, 111, "a copy that has never heard of the date cannot erase it");
});

test("a tie keeps the higher level and the earlier watch date", () => {
  const [a, b] = markPair({ id: "1x1", m: 500, n: 3, w: 900 }, { id: "1x1", m: 500, n: 2, w: 400 });
  for (const merged of [mergeStates(a, b), mergeStates(b, a)]) {
    assert.equal(markOf(merged).n, 3, "seen three times is seen three times");
    assert.equal(markOf(merged).w, 400, "the earlier date is the one nearer to the watching");
  }
});

test("a newer mtime still simply wins", () => {
  const [a, b] = markPair({ id: "1x1", m: 900, w: 111 }, { id: "1x1", m: 500, w: 222 });
  assert.equal(markOf(mergeStates(a, b)).w, 111);
  assert.equal(markOf(mergeStates(b, a)).w, 111);
});

test("a field this build has never heard of is carried, not deleted", () => {
  const st = migrate({ shows: [{ id: "tvmaze:1", src: "tvmaze", ref: 1, name: "S",
    entries: [{ id: "1x1", m: 5, w: 9, futureThing: "whatever a later build writes" }] }] });
  assert.equal(st.shows[0].entries[0].futureThing, "whatever a later build writes");
  assert.equal(st.shows[0].entries[0].w, 9);
});
