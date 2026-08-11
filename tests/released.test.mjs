// Whether a movie has actually come out.
//
// The question the Mark watched button depends on: nothing that has not been released can have
// been watched, and offering to say otherwise is how a library ends up claiming somebody saw a
// film that does not exist yet.
import test from "node:test";
import assert from "node:assert/strict";
import { releasedYet } from "../public/js/domain/constants.js";

const TODAY = new Date("2026-08-09T12:00:00Z");

test("a dated release in the past is out", () => {
  assert.equal(releasedYet({ released: "2022-12-16", year: 2022 }, TODAY), true);
});

test("a dated release in the future is not", () => {
  assert.equal(releasedYet({ released: "2027-12-17", year: 2027 }, TODAY), false);
});

/* The day itself counts as released. A release date is the day it opens somewhere, and where
   that somewhere is depends on who is reading — calling somebody a liar about a film they saw
   this morning is the worse of the two mistakes. */
test("the day of release counts as out", () => {
  assert.equal(releasedYet({ released: "2026-08-09" }, TODAY), true);
});

/* A catalogue that has heard of a film years out often carries nothing but the year. */
test("a year alone is enough to decide", () => {
  assert.equal(releasedYet({ year: 2029 }, TODAY), false);
  assert.equal(releasedYet({ year: 2026 }, TODAY), true);
  assert.equal(releasedYet({ year: 1999 }, TODAY), true);
});

/* Knowing nothing is not the same as knowing it is unreleased. Most of the catalogue is old
   films with patchy data, and hiding the button on all of them would be worse than the bug. */
test("a movie with no dates at all is treated as out", () => {
  assert.equal(releasedYet({}, TODAY), true);
  assert.equal(releasedYet(null, TODAY), true);
});

test("a malformed date falls back to the year", () => {
  assert.equal(releasedYet({ released: "soon", year: 2030 }, TODAY), false);
  assert.equal(releasedYet({ released: "", year: 2001 }, TODAY), true);
});
