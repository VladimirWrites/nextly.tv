// A season's scores, added up.
import test from "node:test";
import assert from "node:assert/strict";
import { avgScore, bestScored, scoredCount } from "../public/js/domain/scores.js";
import { seasonYears } from "../public/js/domain/dates.js";

const eps = [
  { e: 1, name: "Pilot", score: 8.2 },
  { e: 2, name: "Cat's in the Bag", score: 7.9 },
  { e: 3, name: "Ozymandias", score: 9.9 },
  { e: 4, name: "Not out yet", score: null },
];

test("the average covers the episodes that have a score", () => {
  assert.equal(avgScore(eps), 8.7, "(8.2 + 7.9 + 9.9) / 3, to one place");
  assert.equal(scoredCount(eps), 3);
});

test("an unaired episode is not a nought", () => {
  assert.equal(avgScore([{ score: 8 }, { score: null }, {}]), 8);
});

test("nothing scored is not an average of zero", () => {
  assert.equal(avgScore([{ score: null }, {}]), null);
  assert.equal(avgScore([]), null);
  assert.equal(avgScore(null), null);
  assert.equal(bestScored([]), null);
});

test("the best episode is the highest, and ties go to the earlier", () => {
  assert.equal(bestScored(eps).name, "Ozymandias");
  const tied = [{ e: 1, name: "First", score: 9 }, { e: 2, name: "Second", score: 9 }];
  assert.equal(bestScored(tied).name, "First");
});

test("a season names the years it aired in", () => {
  assert.equal(seasonYears([{ air: "2023-05-05" }, { air: "2023-06-30" }]), "2023");
  assert.equal(seasonYears([{ air: "2024-11-20" }, { air: "2025-01-08" }]), "2024–2025");
  assert.equal(seasonYears([{ air: "2025-01-08" }, { air: "2024-11-20" }]), "2024–2025", "ordered whatever order they come in");
  assert.equal(seasonYears([{ air: null }, {}]), null);
  assert.equal(seasonYears(null), null);
});

/* ---- when a show goes out ---- */
import { airsLabel } from "../public/js/domain/constants.js";

test("one day a week reads as a habit", () => {
  assert.equal(airsLabel({ days: ["Friday"], time: "" }), "Fridays");
  assert.equal(airsLabel({ days: ["Sunday"], time: "21:00" }), "Sundays, 21:00");
});

test("a full week and a working week have their own words", () => {
  assert.equal(airsLabel({ days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] }), "Daily");
  assert.equal(airsLabel({ days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] }), "Weekdays");
  assert.equal(airsLabel({ days: ["Tuesday", "Thursday"] }), "Tue/Thu");
});

test("no days, nothing to say", () => {
  assert.equal(airsLabel(null), null);
  assert.equal(airsLabel({ days: [] }), null);
  assert.equal(airsLabel({ days: ["Someday"] }), null, "a day nobody recognises is not a schedule");
  assert.equal(airsLabel({ days: ["Friday", "Friday"] }), "Fridays");
});

/* ---- the series to plot ---- */
import { scoreSeries } from "../public/js/domain/scores.js";

test("the window is the season's own range, snapped to half points", () => {
  const s = scoreSeries([{ e: 1, score: 7.6 }, { e: 2, score: 8.8 }, { e: 3, score: 8.1 }]);
  assert.equal(s.points.length, 3);
  assert.equal(s.lo, 7.5, "an axis figure worth printing");
  assert.equal(s.hi, 9);
  assert.equal(s.avg, 8.2);
});

test("a season everyone agreed on is a flat line, not magnified noise", () => {
  const s = scoreSeries([{ e: 1, score: 8.1 }, { e: 2, score: 8.1 }]);
  assert.ok(s.hi - s.lo >= 1, "at least a point wide");
  assert.ok(s.lo < 8.1 && s.hi > 8.1, "and the line sits inside it");
  assert.deepEqual([s.lo, s.hi], [7.5, 9], "widened half a point at a time, both ends");
});

test("the axis stays on the scale scores are given on", () => {
  const s = scoreSeries([{ e: 1, score: 9.9 }, { e: 2, score: 9.8 }]);
  assert.equal(s.hi, 10, "nothing scores above ten");
  assert.equal(s.lo, 9);
  const low = scoreSeries([{ e: 1, score: 0.3 }, { e: 2, score: 0.4 }]);
  assert.equal(low.lo, 0);
  assert.ok(low.hi - low.lo >= 1);
});

test("one scored episode is not a history", () => {
  assert.equal(scoreSeries([{ e: 1, score: 8 }]), null);
  assert.equal(scoreSeries([{ e: 1, score: null }, { e: 2 }]), null);
  assert.equal(scoreSeries([]), null);
});

test("unscored episodes are left out of the line rather than plotted as nought", () => {
  const s = scoreSeries([{ e: 1, score: 8 }, { e: 2, score: null }, { e: 3, score: 9 }]);
  assert.deepEqual(s.points.map((p) => p.e), [1, 3]);
});
