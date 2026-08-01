// Rewatches. A watch mark carries the pass it was made in (`entry.n`), and a show carries
// the pass in progress (`show.rw`). Both are omitted at 1, so a library nobody has
// rewatched is byte-identical to one written before the feature existed — the first test
// here is that promise.
import test from "node:test";
import assert from "node:assert/strict";
import { showProgress, nextUp, barcode, seasonProgress, levelMap, passOf, TICK } from "../public/js/domain/progress.js";
import { markEpisode, markUpTo, markSeason, startRewatch, cancelRewatch, totalWatched, totalEpisodes } from "../public/js/domain/model.js";
import { normShow, migrate } from "../public/js/domain/schema.js";
import { ordinal, passLabel, levelOf } from "../public/js/domain/constants.js";
import { setBaseline, stampMtimes, mergeStates } from "../public/js/domain/merge.js";
import { metaFixture, showFixture, stateWith, clone, keys, T } from "./helpers.mjs";

const at = { now: T.now };
const levels = (show) => Object.fromEntries((show.entries || []).map((e) => [e.id, levelOf(e)]));

/* ---- storage shape ---- */

test("a first-watch library stores no rewatch fields at all", () => {
  const sh = normShow(showFixture(["1x1", "1x2"]));
  assert.equal("rw" in sh, false, "a show on its first pass carries no rw");
  assert.deepEqual(sh.entries.map((e) => Object.keys(e).sort()), [["id", "m"], ["id", "m"]]);
});

test("levels above one are stored, and survive a round trip", () => {
  const sh = normShow(showFixture([{ id: "1x1", m: T.t1, n: 3 }], { rw: 3 }));
  assert.equal(sh.rw, 3);
  assert.equal(sh.entries[0].n, 3);
  assert.deepEqual(normShow(clone(sh)).entries[0], { id: "1x1", m: T.t1, n: 3 });
});

test("a mark written before rewatches existed reads as watched once", () => {
  const sh = migrate({ shows: [{ id: "tvmaze:1", name: "X", entries: [{ id: "1x1", m: T.t1 }] }] }).shows[0];
  assert.equal(passOf(sh), 1);
  assert.equal(levelMap(sh).get("1x1"), 1);
});

test("nonsense levels are clamped rather than trusted", () => {
  const sh = normShow(showFixture([{ id: "1x1", m: T.t1, n: 0 }, { id: "1x2", m: T.t1, n: -4 }, { id: "2x1", m: T.t1, n: "x" }], { rw: -2 }));
  assert.equal(passOf(sh), 1);
  assert.deepEqual(levels(sh), { "1x1": 1, "1x2": 1, "2x1": 1 });
});

/* ---- ordinals ---- */

test("ordinals read the way people write them", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
  assert.equal(passLabel(2), "2nd watch");
});

/* ---- starting a pass ---- */

test("starting a rewatch puts everything that is out back in the queue", () => {
  const s = stateWith([showFixture(["1x1", "1x2", "2x1", "2x3"])]);
  const before = showProgress(s.shows[0], metaFixture(), at);
  assert.equal(before.remaining, 0);
  assert.equal(before.caughtUp, true);

  startRewatch(s, "tvmaze:1", T.t2);
  const after = showProgress(s.shows[0], metaFixture(), at);
  assert.equal(after.pass, 2);
  assert.equal(after.rewatching, true);
  assert.equal(after.watched, 0, "nothing is watched yet on the second pass");
  assert.equal(after.everWatched, 4, "but the first pass is still on record");
  assert.equal(after.remaining, 4, "three aired, and the one the catalogue gave no date for");
  assert.equal(after.completed, 1, "one full time through");
});

test("starting a rewatch does not touch a single watch mark", () => {
  const s = stateWith([showFixture(["1x1", "1x2"])]);
  const before = clone(s.shows[0].entries);
  startRewatch(s, "tvmaze:1", T.t2);
  assert.deepEqual(s.shows[0].entries, before);
});

test("next up on a rewatch starts again from the first episode", () => {
  const s = stateWith([showFixture(["1x1", "1x2", "2x1", "2x3"])]);
  assert.equal(nextUp(s.shows[0], metaFixture(), at), null);
  startRewatch(s, "tvmaze:1", T.t2);
  assert.equal(nextUp(s.shows[0], metaFixture(), at).key, "1x1");
});

test("a rewatch progresses independently of the first pass", () => {
  const s = stateWith([showFixture(["1x1", "1x2", "2x1", "2x3"])]);
  startRewatch(s, "tvmaze:1", T.t2);
  markEpisode(s, "tvmaze:1", "1x1", true, T.t3);
  assert.equal(nextUp(s.shows[0], metaFixture(), at).key, "1x2");
  const p = showProgress(s.shows[0], metaFixture(), at);
  assert.equal(p.watched, 1);
  assert.equal(p.remaining, 3);
});

test("a third pass follows a second", () => {
  const s = stateWith([showFixture(["1x1", "1x2", "2x1", "2x3"])]);
  startRewatch(s, "tvmaze:1", T.t2);
  markSeason(s, "tvmaze:1", metaFixture().seasons[0], true, at);
  markSeason(s, "tvmaze:1", metaFixture().seasons[1], true, at);
  assert.equal(showProgress(s.shows[0], metaFixture(), at).completed, 2);

  startRewatch(s, "tvmaze:1", T.t3);
  assert.equal(passOf(s.shows[0]), 3);
  assert.equal(showProgress(s.shows[0], metaFixture(), at).watched, 0);
  assert.equal(nextUp(s.shows[0], metaFixture(), at).key, "1x1");
});

test("cancelling a rewatch steps the show back a pass and keeps the marks", () => {
  const s = stateWith([showFixture(["1x1", "1x2", "2x1", "2x3"])]);
  startRewatch(s, "tvmaze:1", T.t2);
  markEpisode(s, "tvmaze:1", "1x1", true, T.t3);
  cancelRewatch(s, "tvmaze:1", T.t3);

  assert.equal(passOf(s.shows[0]), 1);
  assert.equal("rw" in s.shows[0], false, "back on the first pass, the field goes away again");
  assert.equal(levels(s.shows[0])["1x1"], 2, "what you watched stays watched");
  assert.equal(showProgress(s.shows[0], metaFixture(), at).remaining, 0);
});

test("cancelling on the first pass is a no-op", () => {
  const s = stateWith([showFixture(["1x1"])]);
  cancelRewatch(s, "tvmaze:1", T.t2);
  assert.equal(passOf(s.shows[0]), 1);
});

/* ---- marking within a pass ---- */

test("marking sets the level to the current pass rather than incrementing", () => {
  const s = stateWith([showFixture([])]);
  startRewatch(s, "tvmaze:1", T.t1);              // pass 2, nothing watched yet
  markEpisode(s, "tvmaze:1", "1x1", true, T.t2);
  assert.equal(levels(s.shows[0])["1x1"], 2);
});

test("marking the same episode twice in a pass is idempotent", () => {
  const s = stateWith([showFixture(["1x1"])]);
  startRewatch(s, "tvmaze:1", T.t2);
  markEpisode(s, "tvmaze:1", "1x1", true, T.t3);
  markEpisode(s, "tvmaze:1", "1x1", true, T.t3);
  markEpisode(s, "tvmaze:1", "1x1", true, T.t3);
  assert.equal(levels(s.shows[0])["1x1"], 2, "two devices doing this must not race to 4");
});

test("unmarking during a rewatch steps down instead of erasing the first viewing", () => {
  const s = stateWith([showFixture(["1x1"])]);
  startRewatch(s, "tvmaze:1", T.t2);
  markEpisode(s, "tvmaze:1", "1x1", true, T.t3);
  assert.equal(levels(s.shows[0])["1x1"], 2);

  markEpisode(s, "tvmaze:1", "1x1", false, T.t3);
  assert.equal(levels(s.shows[0])["1x1"], 1, "you did still watch it the first time");
  assert.equal(s.shows[0].entries.length, 1);
});

test("unmarking on a first pass still deletes the mark", () => {
  const s = stateWith([showFixture(["1x1"])]);
  markEpisode(s, "tvmaze:1", "1x1", false, T.t2);
  assert.deepEqual(keys(s.shows[0]), []);
});

test("markUpTo and markSeason raise levels to the current pass", () => {
  const s = stateWith([showFixture(["1x1", "1x2", "2x1", "2x3"])]);
  startRewatch(s, "tvmaze:1", T.t2);

  markUpTo(s, "tvmaze:1", metaFixture(), "1x2", at);
  assert.deepEqual(levels(s.shows[0]), { "1x1": 2, "1x2": 2, "2x1": 1, "2x3": 1 });

  markSeason(s, "tvmaze:1", metaFixture().seasons[1], true, at);
  assert.deepEqual(levels(s.shows[0]), { "1x1": 2, "1x2": 2, "2x1": 2, "2x3": 2 });
});

test("clearing a season during a rewatch steps its marks down one pass", () => {
  const s = stateWith([showFixture(["1x1", "1x2", "2x1", "2x3"])]);
  startRewatch(s, "tvmaze:1", T.t2);
  markSeason(s, "tvmaze:1", metaFixture().seasons[0], true, at);
  markSeason(s, "tvmaze:1", metaFixture().seasons[0], false, at);
  assert.deepEqual(levels(s.shows[0]), { "1x1": 1, "1x2": 1, "2x1": 1, "2x3": 1 });
});

/* ---- what the screens read ---- */

test("the barcode shows the previous pass underneath the current one", () => {
  const s = stateWith([showFixture(["1x1", "1x2", "2x1", "2x3"])]);
  startRewatch(s, "tvmaze:1", T.t2);
  markEpisode(s, "tvmaze:1", "1x1", true, T.t3);

  const strip = barcode(s.shows[0], metaFixture(), at);
  assert.deepEqual(strip[0].episodes.map((e) => e.t), [TICK.WATCHED, TICK.SEEN]);
  assert.deepEqual(strip[1].episodes.map((e) => e.t), [TICK.SEEN, TICK.UNAIRED, TICK.SEEN]);
});

test("season counts follow the current pass too", () => {
  const s = stateWith([showFixture(["1x1", "1x2"])]);
  startRewatch(s, "tvmaze:1", T.t2);
  assert.deepEqual(seasonProgress(s.shows[0], metaFixture().seasons[0], at), { watched: 0, aired: 2, total: 2 });
  markEpisode(s, "tvmaze:1", "1x1", true, T.t3);
  assert.equal(seasonProgress(s.shows[0], metaFixture().seasons[0], at).watched, 1);
});

test("the library total counts every pass, and the distinct count doesn't", () => {
  const s = stateWith([showFixture(["1x1", "1x2"])]);
  assert.equal(totalWatched(s), 2);
  assert.equal(totalEpisodes(s), 2);

  startRewatch(s, "tvmaze:1", T.t2);
  markEpisode(s, "tvmaze:1", "1x1", true, T.t3);
  assert.equal(totalWatched(s), 3, "watching an episode a second time is a second episode watched");
  assert.equal(totalEpisodes(s), 2);
});

/* ---- merging passes across devices ---- */

function stamp(s, baseline, now) {
  setBaseline(baseline);
  return stampMtimes(now, s);
}

test("two devices rewatching different episodes both win", () => {
  const base = [showFixture(["1x1", "1x2", "2x1", "2x3"], { rw: 2 })];
  const a = stateWith(base.map(clone));
  const b = stateWith(base.map(clone));

  markEpisode(a, "tvmaze:1", "1x1", true, T.t2);
  markEpisode(b, "tvmaze:1", "1x2", true, T.t2);
  stamp(a, stateWith(base.map(clone)), T.t2);
  stamp(b, stateWith(base.map(clone)), T.t2);

  const merged = mergeStates(a, b);
  assert.deepEqual(levels(merged.shows[0]), { "1x1": 2, "1x2": 2, "2x1": 1, "2x3": 1 });
});

test("a level change is stamped as an edit, so the newer one wins", () => {
  const base = [showFixture([{ id: "1x1", m: T.t1 }], { rw: 2 })];
  const s = stateWith(base.map(clone));
  markEpisode(s, "tvmaze:1", "1x1", true, T.t2);
  stamp(s, stateWith(base.map(clone)), T.t3);
  assert.equal(s.shows[0].entries[0].m, T.t3, "raising a level must refresh the mtime or the merge can't see it");
});

test("the newest level wins when two devices disagree about the same episode", () => {
  const a = stateWith([showFixture([{ id: "1x1", m: T.t3, n: 1 }], { rw: 2 })]);
  const b = stateWith([showFixture([{ id: "1x1", m: T.t2, n: 2 }], { rw: 2 })]);
  assert.equal(levels(mergeStates(a, b).shows[0])["1x1"], 1, "the later edit is the one that reflects reality");
  assert.equal(levels(mergeStates(b, a).shows[0])["1x1"], 1, "and it doesn't depend on merge order");
});

test("a device that starts a rewatch propagates the pass, not just the marks", () => {
  const base = [showFixture(["1x1", "1x2", "2x1", "2x3"])];
  const a = stateWith(base.map(clone));
  const b = stateWith(base.map(clone));

  startRewatch(a, "tvmaze:1", T.t2);
  stamp(a, stateWith(base.map(clone)), T.t2);

  const merged = mergeStates(a, b);
  assert.equal(passOf(merged.shows[0]), 2);
  assert.equal(showProgress(merged.shows[0], metaFixture(), at).remaining, 4);
});

test("an unwatch during a rewatch survives the merge without erasing the first viewing", () => {
  const base = [showFixture([{ id: "1x1", m: T.t1, n: 2 }], { rw: 2 })];
  const a = stateWith(base.map(clone));
  const b = stateWith(base.map(clone));

  markEpisode(a, "tvmaze:1", "1x1", false, T.t2);   // steps 2 -> 1
  stamp(a, stateWith(base.map(clone)), T.t2);

  const merged = mergeStates(a, b);
  assert.equal(levels(merged.shows[0])["1x1"], 1);
  assert.equal(merged.shows[0].entries.length, 1, "stepping down is an edit, not a deletion");
});
