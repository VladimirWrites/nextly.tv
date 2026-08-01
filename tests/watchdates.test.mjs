// Correcting the dates on an imported library.
import test from "node:test";
import assert from "node:assert/strict";
import { setWatchDates } from "../public/js/domain/model.js";
import { watchStats } from "../public/js/domain/stats.js";

const IMPORT_DAY = new Date(2026, 6, 1, 12, 0, 0).getTime();   // everything arrived at once
const NOW = new Date(2026, 6, 30, 9, 0, 0).getTime();

const meta = {
  key: "tvmaze:1", runtime: 50, genres: [], year: 2024,
  seasons: [{ n: 1, episodes: [
    { e: 1, air: "2024-03-01" }, { e: 2, air: "2024-03-08" }, { e: 3, air: "2024-03-15" },
    { e: 4 },                                                  // no air date on record
  ]}],
};
const metaOf = () => meta;

const fresh = () => ({ shows: [{ id: "tvmaze:1", name: "Imported", entries: [
  { id: "1x3", m: IMPORT_DAY }, { id: "1x1", m: IMPORT_DAY }, { id: "1x2", m: IMPORT_DAY },
  { id: "1x4", m: IMPORT_DAY },
]}]});

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

test("as it aired: each episode on the evening it went out", () => {
  const st = fresh();
  const r = setWatchDates(st, "tvmaze:1", { mode: "aired" }, NOW, metaOf);
  assert.equal(r.changed, 3, "the fourth has no air date and is left alone");
  const by = Object.fromEntries(st.shows[0].entries.map((e) => [e.id, e.w]));
  assert.equal(new Date(by["1x1"]).getFullYear(), 2024);
  assert.equal(new Date(by["1x1"]).getHours(), 20, "an evening, not midnight");
  assert.ok(by["1x1"] < by["1x2"] && by["1x2"] < by["1x3"]);
  assert.equal(by["1x4"], undefined);
});

test("the mtime moves even though the watch date goes backwards", () => {
  const st = fresh();
  setWatchDates(st, "tvmaze:1", { mode: "aired" }, NOW, metaOf);
  const e = st.shows[0].entries.find((x) => x.id === "1x1");
  assert.equal(e.m, NOW, "sync resolves with m, and this edit is the newest thing about it");
  assert.ok(e.w < e.m, "while the watch date is two years earlier");
  assert.equal(st.shows[0].m, NOW);
});

test("spread: laid out in episode order between two dates", () => {
  const st = fresh();
  const r = setWatchDates(st, "tvmaze:1", { mode: "spread", from: "2025-01-01", to: "2025-01-31" }, NOW, metaOf);
  assert.equal(r.changed, 4, "every mark, including the one with no air date");
  const by = Object.fromEntries(st.shows[0].entries.map((e) => [e.id, e.w]));
  assert.deepEqual([dayOf(by["1x1"]), dayOf(by["1x4"])], ["2025-01-01", "2025-01-31"]);
  assert.ok(by["1x1"] < by["1x2"] && by["1x2"] < by["1x3"] && by["1x3"] < by["1x4"],
    "order follows the episodes, not the order the marks happen to sit in");
});

test("single: one evening for the lot", () => {
  const st = fresh();
  setWatchDates(st, "tvmaze:1", { mode: "single", from: "2025-05-04" }, NOW, metaOf);
  const days = new Set(st.shows[0].entries.map((e) => dayOf(e.w)));
  assert.deepEqual([...days], ["2025-05-04"]);
});

test("clear: back to when the boxes were ticked", () => {
  const st = fresh();
  setWatchDates(st, "tvmaze:1", { mode: "aired" }, NOW, metaOf);
  const r = setWatchDates(st, "tvmaze:1", { mode: "clear" }, NOW + 1000, metaOf);
  assert.equal(r.changed, 3);
  assert.ok(st.shows[0].entries.every((e) => e.w === undefined));
});

/* "Nothing changed" has several meanings and they are not interchangeable. Reporting the wrong
   one sends someone looking for a fault that isn't there: running this twice used to say the
   catalogue had no air dates, when it had already used them. */
test("nothing to do says which kind of nothing", () => {
  const st = fresh();
  setWatchDates(st, "tvmaze:1", { mode: "aired" }, NOW, metaOf);

  const again = setWatchDates(st, "tvmaze:1", { mode: "aired" }, NOW, metaOf);
  assert.deepEqual([again.changed, again.dated, again.missing], [0, 3, 1],
    "nothing changed, three are dated, one has no air date to use");

  const noEnd = setWatchDates(st, "tvmaze:1", { mode: "spread", from: "2025-01-01" }, NOW, metaOf);
  assert.equal(noEnd.changed, 0, "a range needs both ends");

  const noShow = setWatchDates(st, "tvmaze:9", { mode: "aired" }, NOW, metaOf);
  assert.deepEqual([noShow.changed, noShow.known], [0, false]);

  assert.equal(setWatchDates(st, "tvmaze:1", { mode: "nonsense" }, NOW, metaOf).changed, 0);
});

test("a show whose episode list has not loaded is not a show without air dates", () => {
  const st = fresh();
  const r = setWatchDates(st, "tvmaze:1", { mode: "aired" }, NOW, () => null);
  assert.deepEqual([r.changed, r.known, r.missing], [0, false, 4],
    "so the message can say to wait rather than blaming the catalogue");
});

test("the statistics read the corrected dates", () => {
  const st = fresh();
  const before = watchStats(st.shows, metaOf, NOW);
  assert.equal(before.days.size, 1, "an import is one very long day");

  setWatchDates(st, "tvmaze:1", { mode: "aired" }, NOW, metaOf);
  const after = watchStats(st.shows, metaOf, NOW);
  assert.equal(after.days.size, 4, "three aired evenings, and the untouched mark on its own day");
  assert.equal(after.hours[20], 3, "an evening apiece");
});
