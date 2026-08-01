// Shared fixtures. The domain modules are pure ES modules with no DOM or network, so they
// import straight into the test runner.
import { emptyState, makeShow, normShow } from "../public/js/domain/schema.js";

export const T = {
  // Fixed instants, so nothing here depends on when the suite runs.
  past: Date.UTC(2020, 0, 1),
  t1: Date.UTC(2024, 0, 1),
  t2: Date.UTC(2024, 0, 2),
  t3: Date.UTC(2024, 0, 3),
  now: Date.UTC(2024, 5, 1),
};

// A two-season show: season 1 fully aired, season 2 half aired, plus one special.
export function metaFixture(over = {}) {
  return {
    key: "tvmaze:1",
    src: "tvmaze",
    ref: 1,
    name: "Test Show",
    year: 2020,
    status: "Running",
    seasons: [
      {
        n: 1,
        episodes: [
          { e: 1, name: "One", air: "2020-01-01" },
          { e: 2, name: "Two", air: "2020-01-08" },
          { e: 3, name: "Three", air: "2020-01-15", special: true },
        ],
      },
      {
        n: 2,
        episodes: [
          { e: 1, name: "Four", air: "2024-01-01" },
          { e: 2, name: "Five", air: "2030-01-01" },   // not aired at T.now
          { e: 3, name: "Six", air: null },            // announced, unscheduled
        ],
      },
    ],
    ...over,
  };
}

// Fixtures are a show being watched, because that's what nearly every test is about. Adding
// now defaults to "planned", so the tests that care about status say so themselves.
export function showFixture(marks = [], over = {}) {
  const sh = normShow(makeShow(metaFixture(), T.t1));
  sh.st = "active";
  sh.entries = marks.map((id) => (typeof id === "string" ? { id, m: T.t1 } : id));
  return Object.assign(sh, over);
}

export function stateWith(shows) {
  const s = emptyState();
  s.shows = shows;
  return s;
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const keys = (show) => (show.entries || []).map((e) => e.id).sort();
