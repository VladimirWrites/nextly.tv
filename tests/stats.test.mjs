// What the marks add up to.
import test from "node:test";
import assert from "node:assert/strict";
import { marks, watchStats, streaks, primeHour } from "../public/js/domain/stats.js";

const at = (iso) => new Date(iso).getTime();

// Two seasons of a 50-minute show, and one 22-minute comedy.
const META = {
  "tvmaze:1": { key: "tvmaze:1", runtime: 50, year: 2019, genres: ["Drama", "Crime"],
    seasons: [{ n: 1, episodes: [{ e: 1, runtime: 62, air: "2019-01-01" }, { e: 2, air: "2019-01-08" },
                                  { e: 3, air: "2019-01-15" }] }] },
  "tvmaze:2": { key: "tvmaze:2", runtime: 22, year: 1994, genres: ["Comedy"],
    seasons: [{ n: 1, episodes: [{ e: 1, air: "1994-09-22" }, { e: 2, air: "1994-09-29" }] }] },
};
const metaOf = (id) => META[id] || null;

const library = [
  { id: "tvmaze:1", name: "The Drama", entries: [
    { id: "1x1", m: at("2026-07-20T21:30:00") },
    { id: "1x2", m: at("2026-07-21T22:10:00") },
    { id: "1x3", m: at("2026-07-22T20:05:00"), n: 3 },   // seen three times
  ]},
  { id: "tvmaze:2", name: "The Comedy", entries: [
    { id: "1x1", m: at("2026-07-22T13:00:00") },
    { id: "1x2", m: at("2026-07-25T23:40:00") },
  ]},
];

test("a mark carries the episode's own runtime where there is one", () => {
  const rows = marks(library, metaOf);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].minutes, 62, "the episode's figure beats the show's average");
  assert.equal(rows[1].minutes, 50, "and the average stands in when it has none");
  assert.ok(rows.every((r) => r.known));
});

test("an episode seen three times is three viewings' worth of time", () => {
  const rows = marks(library, metaOf);
  const third = rows.find((r) => r.s === 1 && r.e === 3 && r.show === "The Drama");
  assert.equal(third.times, 3);
  assert.equal(third.minutes, 150, "50 minutes, three times");
});

test("the totals", () => {
  const s = watchStats(library, metaOf, at("2026-07-26T12:00:00"));
  assert.equal(s.episodes, 7, "five marks, one of them watched three times");
  assert.equal(s.minutes, 62 + 50 + 150 + 22 + 22);
  assert.equal(s.rewatched, 1);
  assert.equal(s.guessed, 0, "every runtime was known");
  assert.equal(s.first, at("2026-07-20T21:30:00"));
});

test("time is grouped by the show, the genre and the decade", () => {
  const s = watchStats(library, metaOf, at("2026-07-26T12:00:00"));
  assert.deepEqual(s.topShows.map((x) => [x.name, x.minutes]), [["The Drama", 262], ["The Comedy", 44]]);
  // A genre gets the whole episode: half an hour of "Drama, Crime" is half an hour of each.
  assert.deepEqual(s.genres.map((g) => [g.name, g.minutes]), [["Drama", 262], ["Crime", 262], ["Comedy", 44]]);
  assert.deepEqual(s.decades, [{ decade: 1990, minutes: 44 }, { decade: 2010, minutes: 262 }]);
});

test("days, hours and weekdays come from the moment the box was ticked", () => {
  const s = watchStats(library, metaOf, at("2026-07-26T12:00:00"));
  assert.equal(s.days.get("2026-07-22"), 2, "two marks that day");
  assert.equal(s.hours[21], 1);
  assert.equal(s.hours[23], 1);
  assert.equal(s.biggest.day, "2026-07-22");
  assert.deepEqual(s.biggest.shows.sort(), ["The Comedy", "The Drama"]);
});

test("a streak is calendar days in a row", () => {
  const days = new Map([["2026-07-20", 1], ["2026-07-21", 1], ["2026-07-22", 2], ["2026-07-25", 1]]);
  const s = streaks(days, at("2026-07-26T10:00:00"));
  assert.equal(s.best, 3);
  assert.equal(s.bestEnded, "2026-07-22");
  assert.equal(s.current, 1, "yesterday counts: today is not over");
});

test("a streak that ended before yesterday is not still running", () => {
  const days = new Map([["2026-07-20", 1], ["2026-07-21", 1]]);
  assert.equal(streaks(days, at("2026-07-26T10:00:00")).current, 0);
  assert.equal(streaks(new Map(), at("2026-07-26T10:00:00")).best, 0);
});

test("the hour someone watches at is the middle of their busiest stretch", () => {
  const hours = Array(24).fill(0);
  hours[21] = 3; hours[22] = 6; hours[23] = 4;   // an evening
  hours[9] = 5;                                   // and one odd morning
  const p = primeHour(hours);
  assert.equal(p.hour, 22, "the mode alone would have said 22 too, but the run is what decides");
  assert.ok(p.share > 0.6);
});

test("the busiest stretch may cross midnight", () => {
  const hours = Array(24).fill(0);
  hours[23] = 5; hours[0] = 6; hours[1] = 4;
  assert.equal(primeHour(hours).hour, 0);
  assert.equal(primeHour(Array(24).fill(0)), null);
});

test("a runtime nobody knows is counted as time nobody knows", () => {
  const bare = { "tvmaze:9": { key: "tvmaze:9", seasons: [{ n: 1, episodes: [{ e: 1 }] }] } };
  const s = watchStats([{ id: "tvmaze:9", name: "Unknown", entries: [{ id: "1x1", m: at("2026-07-20T20:00:00") }] }],
    (id) => bare[id] || null, at("2026-07-21T10:00:00"));
  assert.equal(s.minutes, 0, "no invented minutes");
  assert.equal(s.guessed, 1, "and the page can say so");
  assert.equal(s.episodes, 1);
});

test("an empty library has nothing to say and does not crash saying it", () => {
  const s = watchStats([], () => null, at("2026-07-26T12:00:00"));
  assert.equal(s.episodes, 0);
  assert.equal(s.first, null);
  assert.equal(s.biggest, null);
  assert.equal(s.streak.best, 0);
  assert.deepEqual(s.topShows, []);
});

/* ---- a window, and the two dimensions crossed ---- */
import { SINCE } from "../public/js/domain/stats.js";

const NOW = at("2026-07-30T12:00:00");

const spread = [
  { id: "tvmaze:1", name: "The Drama", entries: [
    { id: "1x1", m: at("2024-03-02T21:00:00") },     // two years back
    { id: "1x2", m: at("2025-12-30T22:00:00") },     // last year, inside 12 months
    { id: "1x3", m: at("2026-02-10T20:00:00") },     // this calendar year
  ]},
];

test("a window keeps only what happened inside it", () => {
  const all = watchStats(spread, metaOf, NOW, SINCE.all(NOW));
  assert.equal(all.episodes, 3);

  const rolling = watchStats(spread, metaOf, NOW, SINCE.year12(NOW));
  assert.equal(rolling.episodes, 2, "the 2024 mark is outside twelve months");

  const calendar = watchStats(spread, metaOf, NOW, SINCE.calendar(NOW));
  assert.equal(calendar.episodes, 1, "and only February is inside this calendar year");
});

test("the counts alongside it are windowed too", () => {
  const calendar = watchStats(spread, metaOf, NOW, SINCE.calendar(NOW));
  assert.equal(calendar.shows, 1, "shows this window saw something of");
  assert.equal(calendar.days.size, 1);
  assert.equal(calendar.minutes, 50, "one episode of a fifty-minute show");
});

test("the day-and-hour grid puts each mark in one cell", () => {
  const s = watchStats(library, metaOf, at("2026-07-26T12:00:00"), 0);
  // 2026-07-20 is a Monday; the first mark was made at 21:30.
  assert.equal(s.grid[1][21], 1);
  assert.equal(s.grid[3][13], 1, "and the Wednesday afternoon one");
  const total = s.grid.flat().reduce((a, b) => a + b, 0);
  assert.equal(total, 5, "every mark lands in exactly one cell");
});

test("the grid agrees with the flat counts it replaces", () => {
  const s = watchStats(library, metaOf, at("2026-07-26T12:00:00"), 0);
  for (let d = 0; d < 7; d++) {
    assert.equal(s.grid[d].reduce((a, b) => a + b, 0), s.weekdays[d], `row ${d}`);
  }
  for (let h = 0; h < 24; h++) {
    assert.equal(s.grid.reduce((t, row) => t + row[h], 0), s.hours[h], `column ${h}`);
  }
});

test("the windows themselves", () => {
  assert.equal(SINCE.all(NOW), 0);
  assert.equal(new Date(SINCE.calendar(NOW)).getMonth(), 0, "the first of January, locally");
  assert.equal(new Date(SINCE.calendar(NOW)).getDate(), 1);
  assert.ok(NOW - SINCE.year12(NOW) === 365 * 86_400_000);
});
