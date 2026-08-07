// Where an imported show lands.
//
// The rule this tests is an ordering before it is a set of thresholds, and the ordering is the
// part that matters: two real Trakt exports measured while it was written had a median
// last-watched date of three years, so a rule that asked "how long ago" first would file two
// thirds of a library as Dropped — and nearly all of those are shows watched to the end. The
// first question has to be whether anything is left.
import test from "node:test";
import assert from "node:assert/strict";
import { guessStatus, STALE_DAYS, COLD_DAYS, BARELY } from "../public/js/domain/status-guess.js";

const NOW = Date.UTC(2026, 7, 7);
const DAY = 86_400_000;
const daysAgo = (n) => NOW - n * DAY;

// What progress.js reports, in the two fields the guess reads.
const prog = (everWatched, aired, remaining) => ({ everWatched, aired, remaining });

const guess = (over = {}) => guessStatus({ now: NOW, ...over });

test("a show with no history at all is not this function's business", () => {
  assert.equal(guess({ progress: prog(0, 40, 40) }), null);
  assert.equal(guess({}), null, "and neither is one with nothing known about it");
});

/* The case the ordering exists for. Both of these are years old and neither is abandoned: one
   is finished, one is between seasons, and from the dates alone they are the same show. */
test("caught up is Watching however long ago that was", () => {
  assert.equal(guess({ lastAt: daysAgo(4000), progress: prog(60, 60, 0), ended: true }), "active");
  assert.equal(guess({ lastAt: daysAgo(400), progress: prog(30, 30, 0), ended: false }), "active");
});

test("something watched recently with episodes waiting is being watched", () => {
  assert.equal(guess({ lastAt: daysAgo(10), progress: prog(20, 30, 10) }), "active");
  assert.equal(guess({ lastAt: daysAgo(STALE_DAYS - 1), progress: prog(20, 30, 10) }), "active");
});

test("six months to eighteen with episodes waiting is paused", () => {
  assert.equal(guess({ lastAt: daysAgo(STALE_DAYS + 1), progress: prog(20, 30, 10) }), "paused");
  assert.equal(guess({ lastAt: daysAgo(COLD_DAYS - 1), progress: prog(20, 30, 10) }), "paused");
});

test("past eighteen months with episodes waiting is dropped", () => {
  assert.equal(guess({ lastAt: daysAgo(COLD_DAYS + 1), progress: prog(20, 30, 10) }), "dropped");
});

/* A finished show has nothing coming to bring anybody back to it, so the middle band does not
   apply: either it was watched recently or it was given up. */
test("an ended show with episodes left skips the paused band", () => {
  const left = prog(20, 30, 10);
  assert.equal(guess({ lastAt: daysAgo(STALE_DAYS + 1), progress: left, ended: true }), "dropped");
  assert.equal(guess({ lastAt: daysAgo(30), progress: left, ended: true }), "active",
    "recent is still recent — an ended show can be mid-watch");
});

/* Two episodes of forty is not a series somebody is partway through, whatever the gap says. */
test("a show barely started is dropped rather than paused", () => {
  assert.equal(guess({ lastAt: daysAgo(STALE_DAYS + 10), progress: prog(2, 40, 38) }), "dropped");
  assert.equal(guess({ lastAt: daysAgo(STALE_DAYS + 10), progress: prog(8, 40, 32) }), "paused",
    "a fifth of it is a real attempt");
  assert.ok(BARELY > 2 / 40 && BARELY < 8 / 40, "the threshold sits between those two");
});

test("one episode of six is a beginning, not an abandonment", () => {
  assert.equal(guess({ lastAt: daysAgo(STALE_DAYS + 10), progress: prog(1, 6, 5) }), "paused");
});

/* Hidden on Trakt is somebody saying it outright, in the only words that service has for it.
   It beats every other signal, including being caught up. */
test("hidden from progress is dropped, whatever else is true", () => {
  assert.equal(guess({ lastAt: daysAgo(1), progress: prog(30, 30, 0), hidden: true }), "dropped");
});

/* An import can reach a show whose catalogue entry is not to hand. A guess from the dates alone
   is worse than one that knows what is left, and much better than filing everything as
   Watching. */
test("with no metadata the dates decide alone", () => {
  assert.equal(guess({ lastAt: daysAgo(10) }), "active");
  assert.equal(guess({ lastAt: daysAgo(300) }), "paused");
  assert.equal(guess({ lastAt: daysAgo(900) }), "dropped");
});

test("a history with no dates in it is as old as it looks", () => {
  assert.equal(guess({ lastAt: 0, progress: prog(5, 30, 25) }), "dropped",
    "nothing to date it by, and 25 episodes left");
  assert.equal(guess({ lastAt: 0, progress: prog(30, 30, 0) }), "active",
    "but caught up is caught up even undated");
});

/* Against the shape of a real library rather than one case at a time: the two exports this was
   designed against were mostly finished shows, and the rule has to reflect that or the Library
   opens on a wall of Dropped. */
test("a library of mostly finished shows does not import as mostly dropped", () => {
  const lib = [
    // 20 finished long ago
    ...Array.from({ length: 20 }, () => ({ lastAt: daysAgo(1500), progress: prog(60, 60, 0), ended: true })),
    // 6 mid-watch this month
    ...Array.from({ length: 6 }, () => ({ lastAt: daysAgo(12), progress: prog(10, 30, 20) })),
    // 3 left half-finished a year ago
    ...Array.from({ length: 3 }, () => ({ lastAt: daysAgo(365), progress: prog(15, 30, 15) })),
    // 2 given up two episodes in, years back
    ...Array.from({ length: 2 }, () => ({ lastAt: daysAgo(1200), progress: prog(2, 40, 38) })),
  ];
  const tally = {};
  for (const s of lib) tally[guess(s)] = (tally[guess(s)] || 0) + 1;
  assert.deepEqual(tally, { active: 26, paused: 3, dropped: 2 });
});
