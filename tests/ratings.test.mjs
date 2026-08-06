// Ratings: a number against a title, a season, or an episode.
//
// The shape is deliberately the mark's shape — same per-id merge, same m-versus-w split — and
// these cover the three places that copy could still go wrong: the key space, where zero means
// something a mark's fields never had to mean, and the merge, where two devices disagree.
import test from "node:test";
import assert from "node:assert/strict";
import { RATING_TITLE, isRatingId, ratingKind, clampRating } from "../public/js/domain/constants.js";
import { makeShow, normShow } from "../public/js/domain/schema.js";
import { setRating, ratingOf, ratingsOf, markEpisode } from "../public/js/domain/model.js";
import { mergeStates } from "../public/js/domain/merge.js";

const NOW = 1_700_000_000_000;
const wire = () => normShow(makeShow({ key: "tvmaze:169", src: "tvmaze", ref: 169, name: "The Wire" }, NOW), NOW);
const one = () => ({ shows: [wire()], del: {}, settings: {}, updatedAt: NOW });

/* Three key spaces sharing one list. "t" is the title, digits are a season, and anything with
   an x in it is an episode — so none of them can be read as another. */
test("the key space keeps titles, seasons and episodes apart", () => {
  assert.ok(isRatingId("t") && isRatingId("3") && isRatingId("3x07"));
  assert.equal(ratingKind("t"), "title");
  assert.equal(ratingKind("3"), "season");
  assert.equal(ratingKind("3x07"), "episode");
  for (const bad of ["m", "", "x", "1x", "season3", "-1"]) {
    assert.equal(isRatingId(bad), false, `${bad} is not a rating id`);
  }
});

test("a rating is one integer from 1 to 10", () => {
  assert.equal(clampRating(11), 10);
  assert.equal(clampRating(-3), 0);
  assert.equal(clampRating(7.8), 7);
  assert.equal(clampRating("9"), 9);
  assert.equal(clampRating(null), 0);
});

test("a title, a season and an episode are rated independently", () => {
  const st = one();
  setRating(st, "tvmaze:169", RATING_TITLE, 9, NOW);
  setRating(st, "tvmaze:169", "4", 10, NOW);
  setRating(st, "tvmaze:169", "4x13", 8, NOW);
  const sh = st.shows[0];
  assert.equal(ratingOf(sh), 9);
  assert.equal(ratingOf(sh, "4"), 10);
  assert.equal(ratingOf(sh, "4x13"), 8);
  assert.equal(ratingOf(sh, "5"), 0, "a season nobody rated is not rated");
});

/* The reason zero is a value rather than a deletion: a cleared rating still has to beat the
   number an unsynced device is holding. */
test("clearing leaves a zero behind rather than removing the entry", () => {
  const st = one();
  setRating(st, "tvmaze:169", RATING_TITLE, 9, NOW);
  setRating(st, "tvmaze:169", RATING_TITLE, 0, NOW + 1000);
  assert.equal(ratingOf(st.shows[0]), 0);
  assert.equal(st.shows[0].rats.length, 1, "the entry stays, carrying the newer mtime");
  assert.deepEqual(ratingsOf(st.shows[0]), [], "but it counts as nothing held");
});

/* An import knows when you actually rated something. A rating given here and now does not need
   telling apart from its own mtime. */
test("an imported rating keeps the day it was given", () => {
  const st = one();
  const then = NOW - 400 * 24 * 3600 * 1000;
  setRating(st, "tvmaze:169", RATING_TITLE, 7, NOW, { ratedAt: then });
  assert.equal(st.shows[0].rats[0].w, then);
  setRating(st, "tvmaze:169", RATING_TITLE, 8, NOW + 1);
  assert.equal(st.shows[0].rats[0].w, undefined, "re-rating now drops a date that no longer applies");
});

/* The whole point of the rating carrying its own mtime. Under the record-level merge, whichever
   device wrote last would take the entire record and the other's rating with it. */
test("rating on one device survives an unrelated edit on another", () => {
  const a = one();
  setRating(a, "tvmaze:169", RATING_TITLE, 9, NOW + 10);

  const b = one();
  b.shows[0].st = "paused";
  b.shows[0].m = NOW + 500;                       // later, and would win the whole record

  const m = mergeStates(a, b);
  assert.equal(m.shows[0].st, "paused", "the newer record still wins the record's own fields");
  assert.equal(ratingOf(m.shows[0]), 9, "and the rating is not collateral");
});

test("the newer rating wins, whichever device holds it", () => {
  const a = one(); setRating(a, "tvmaze:169", RATING_TITLE, 4, NOW);
  const b = one(); setRating(b, "tvmaze:169", RATING_TITLE, 10, NOW + 60_000);
  assert.equal(ratingOf(mergeStates(a, b).shows[0]), 10);
  assert.equal(ratingOf(mergeStates(b, a).shows[0]), 10, "and merge is order-independent");
});

test("a rating taken back stays taken back after a sync", () => {
  const a = one(); setRating(a, "tvmaze:169", RATING_TITLE, 8, NOW);
  const b = one(); setRating(b, "tvmaze:169", RATING_TITLE, 8, NOW);
  setRating(a, "tvmaze:169", RATING_TITLE, 0, NOW + 5000);
  assert.equal(ratingOf(mergeStates(a, b).shows[0]), 0);
  assert.equal(ratingOf(mergeStates(b, a).shows[0]), 0);
});

test("a tie keeps the higher number so both orders agree", () => {
  const a = one(); setRating(a, "tvmaze:169", RATING_TITLE, 6, NOW);
  const b = one(); setRating(b, "tvmaze:169", RATING_TITLE, 9, NOW);
  assert.equal(ratingOf(mergeStates(a, b).shows[0]), 9);
  assert.equal(ratingOf(mergeStates(b, a).shows[0]), 9);
});

/* Ratings and marks are separate lists for a reason: rating something is not a claim to have
   seen it, and an entry existing is exactly that claim. */
test("rating an episode does not mark it watched", () => {
  const st = one();
  setRating(st, "tvmaze:169", "1x01", 10, NOW);
  assert.deepEqual(st.shows[0].entries, [], "no mark was invented");
  markEpisode(st, "tvmaze:169", "1x01", true, NOW);
  assert.equal(st.shows[0].entries.length, 1);
  assert.equal(ratingOf(st.shows[0], "1x01"), 10, "and the rating is still there afterwards");
});

/* Everything the vault reads has to survive normShow, which is where a movie's only mark was
   once quietly eaten. */
test("ratings survive a round trip through the vault's own validator", () => {
  const st = one();
  setRating(st, "tvmaze:169", RATING_TITLE, 9, NOW);
  setRating(st, "tvmaze:169", "2x04", 7, NOW, { ratedAt: NOW - 1000 });
  const back = normShow(JSON.parse(JSON.stringify(st.shows[0])), NOW);
  assert.equal(ratingOf(back), 9);
  assert.equal(ratingOf(back, "2x04"), 7);
  assert.equal(back.rats.find((r) => r.id === "2x04").w, NOW - 1000);
});

test("nonsense in the list is dropped rather than trusted", () => {
  const sh = normShow({ ...wire(), rats: [
    { id: "t", v: 99 }, { id: "nope", v: 5 }, { id: "3x1", v: "8" }, null, { v: 4 },
  ] }, NOW);
  assert.equal(ratingOf(sh), 10, "out of range is clamped, not discarded");
  assert.equal(ratingOf(sh, "3x1"), 8, "a numeric string is a number");
  assert.equal(sh.rats.length, 2, "the unrecognisable ones are gone");
});

test("a library nobody has rated carries no rating field at all", () => {
  const sh = normShow(wire(), NOW);
  assert.equal("rats" in sh, false);
  const cleared = normShow({ ...wire(), rats: [] }, NOW);
  assert.equal("rats" in cleared, false, "an empty list is not worth syncing");
});
