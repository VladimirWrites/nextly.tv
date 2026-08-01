import test from "node:test";
import assert from "node:assert/strict";
import { airMs, hasAired, daysUntil, relTime, fmtDate, yearOf, DAY_MS } from "../public/js/domain/dates.js";

const NOW = Date.UTC(2024, 5, 15);

test("airMs parses a calendar date as UTC midnight", () => {
  assert.equal(airMs("2024-01-02"), Date.UTC(2024, 0, 2));
  assert.equal(airMs(""), null);
  assert.equal(airMs(null), null);
  assert.equal(airMs("2024-1-2"), null, "TMDB and TVmaze both zero-pad; anything else is malformed");
  assert.equal(airMs(20240102), null);
});

test("hasAired treats a missing air date as not aired", () => {
  assert.equal(hasAired("2024-01-01", NOW), true);
  assert.equal(hasAired("2030-01-01", NOW), false);
  assert.equal(hasAired(null, NOW), false, "an unscheduled episode must never show up as watchable");
});

test("an episode airing today counts as aired", () => {
  assert.equal(hasAired("2024-06-15", NOW), true);
});

test("daysUntil is positive for the future and negative for the past", () => {
  assert.equal(daysUntil("2024-06-18", NOW), 3);
  assert.equal(daysUntil("2024-06-12", NOW), -3);
  assert.equal(daysUntil(null, NOW), null);
});

test("relTime phrases both directions coarsely", () => {
  assert.equal(relTime(NOW - 30_000, NOW), "just now");
  assert.equal(relTime(NOW - 5 * 60_000, NOW), "5m ago");
  assert.equal(relTime(NOW - 3 * 3_600_000, NOW), "3h ago");
  assert.equal(relTime(NOW - DAY_MS, NOW), "yesterday");
  assert.equal(relTime(NOW + DAY_MS, NOW), "tomorrow");
  assert.equal(relTime(NOW - 3 * DAY_MS, NOW), "3 days ago");
  assert.equal(relTime(NOW - 14 * DAY_MS, NOW), "2w ago");
  assert.equal(relTime(NOW - 400 * DAY_MS, NOW), "1y ago");
  assert.equal(relTime(0, NOW), "", "never synced renders as nothing, not as 1970");
});

test("fmtDate renders a readable date and tolerates junk", () => {
  assert.equal(fmtDate("2024-03-11"), "11 Mar 2024");
  assert.equal(fmtDate("2024-12-01"), "1 Dec 2024");
  assert.equal(fmtDate(""), "");
  assert.equal(fmtDate("nope"), "");
});

test("yearOf pulls the year out of an air date", () => {
  assert.equal(yearOf("2008-01-20"), 2008);
  assert.equal(yearOf(null), null);
});
