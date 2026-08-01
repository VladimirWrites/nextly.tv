// Dates on an episode: what the catalogue knows, and what it merely hasn't said.
import test from "node:test";
import assert from "node:assert/strict";

/* ---- "no date" is not "not yet" ----
   The list would not let an undated episode be ticked while its own page would, because both
   asked whether it had aired and neither asked whether it was still to come. */
import { isUpcoming, hasAired } from "../public/js/domain/dates.js";

test("only a date in the future counts as still to come", () => {
  const now = new Date("2026-07-31T12:00:00Z").getTime();
  assert.equal(isUpcoming("2026-08-15", now), true);
  assert.equal(isUpcoming("2026-01-01", now), false);
  assert.equal(isUpcoming(null, now), false, "no date on record says nothing about the future");
  assert.equal(isUpcoming("", now), false);
  assert.equal(isUpcoming("not a date", now), false);
});

test("which is the distinction hasAired cannot make on its own", () => {
  const now = new Date("2026-07-31T12:00:00Z").getTime();
  // Both of these have "not aired" as far as hasAired is concerned...
  assert.equal(hasAired("2026-08-15", now), false);
  assert.equal(hasAired(null, now), false);
  // ...and only one of them is a claim about the future.
  assert.notEqual(isUpcoming("2026-08-15", now), isUpcoming(null, now));
});
