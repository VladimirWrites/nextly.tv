// The "coming up" query. Everything here reads metadata the cache already holds, so the
// tests are pure — no network, no stubs.
import test from "node:test";
import assert from "node:assert/strict";
import { upcomingList, groupByDate, returnsIn, isPremiere, DEFAULT_HORIZON_DAYS } from "../public/js/domain/schedule.js";
import { showFixture, metaFixture, T } from "./helpers.mjs";

// The fixture's unaired episodes at T.now (2024-06-01): 2x2 airs 2030-01-01, 2x3 has no date.
const at = { now: T.now };

// A show with episodes at known distances from "now", for horizon and ordering tests.
function scheduleMeta(offsetsInDays, { name = "Sched" } = {}) {
  const day = 86_400_000;
  return {
    key: "tvmaze:9",
    src: "tvmaze",
    ref: 9,
    name,
    status: "Running",
    seasons: [{
      n: 1,
      episodes: offsetsInDays.map((d, i) => ({
        e: i + 1,
        name: `Ep ${i + 1}`,
        air: new Date(T.now + d * day).toISOString().slice(0, 10),
      })),
    }],
  };
}

test("upcomingList returns only episodes that haven't aired", () => {
  const show = showFixture([]);
  // A wide window, so this tests airing status rather than the horizon.
  const { rows } = upcomingList([show], () => metaFixture(), { now: T.now, days: 9999 });
  assert.deepEqual(rows.map((r) => r.ep.key), ["2x2"], "2x3 has no air date, and the rest are out");
});

test("an episode with no air date is never scheduled", () => {
  const meta = metaFixture({ seasons: [{ n: 1, episodes: [{ e: 1, name: "TBA", air: null }] }] });
  const { rows } = upcomingList([showFixture([])], () => meta, at);
  assert.equal(rows.length, 0, "there is no date to file it under");
});

test("episodes are ordered soonest first, across shows", () => {
  const a = showFixture([], { id: "tvmaze:a", name: "A" });
  const b = showFixture([], { id: "tvmaze:b", name: "B" });
  const metaOf = (id) => (id === "tvmaze:a" ? scheduleMeta([10, 3], { name: "A" }) : scheduleMeta([5], { name: "B" }));
  const { rows } = upcomingList([a, b], metaOf, at);
  assert.deepEqual(rows.map((r) => r.inDays), [3, 5, 10]);
});

test("each row carries how many days away it is", () => {
  const { rows } = upcomingList([showFixture([])], () => scheduleMeta([45]), at);
  assert.equal(rows[0].inDays, 45);
  assert.equal(rows[0].air, new Date(T.now + 45 * 86_400_000).toISOString().slice(0, 10));
});

test("an episode airing today counts as out, not coming up", () => {
  const { rows } = upcomingList([showFixture([])], () => scheduleMeta([0]), at);
  assert.equal(rows.length, 0);
});

test("dropped shows are left off the schedule; paused and planned stay on it", () => {
  const metaOf = () => scheduleMeta([7]);
  const of = (st) => upcomingList([showFixture([], { st })], metaOf, at).rows.length;
  assert.equal(of("active"), 1);
  assert.equal(of("paused"), 1, "knowing a shelved show is back is exactly when you'd unpause it");
  assert.equal(of("planned"), 1);
  assert.equal(of("dropped"), 0);
});

test("shows whose metadata hasn't loaded yet are skipped rather than crashing", () => {
  assert.deepEqual(upcomingList([showFixture([])], () => null, at).rows, []);
});

test("episodes past the horizon are counted, not silently dropped", () => {
  const { rows, beyond } = upcomingList([showFixture([])], () => scheduleMeta([10, 400]), at);
  assert.deepEqual(rows.map((r) => r.inDays), [10]);
  assert.equal(beyond, 1, "a truncated list has to be able to say so");
});

test("the horizon is adjustable", () => {
  const metaOf = () => scheduleMeta([10, 400]);
  const wide = upcomingList([showFixture([])], metaOf, { now: T.now, days: 500 });
  assert.equal(wide.rows.length, 2);
  assert.equal(wide.beyond, 0);
  assert.equal(DEFAULT_HORIZON_DAYS, 120);
});

test("specials stay off the schedule unless they're switched on", () => {
  const meta = {
    key: "tvmaze:9", src: "tvmaze", ref: 9, name: "S", status: "Running",
    seasons: [{ n: 1, episodes: [{ e: 1, air: "2030-01-01", special: true }] }],
  };
  assert.equal(upcomingList([showFixture([])], () => meta, { now: T.now, days: 9999 }).rows.length, 0);
  assert.equal(upcomingList([showFixture([])], () => meta, { now: T.now, days: 9999, specials: true }).rows.length, 1);
});

test("groupByDate collects everything landing on one day under one heading", () => {
  const a = showFixture([], { id: "tvmaze:a", name: "A" });
  const b = showFixture([], { id: "tvmaze:b", name: "B" });
  const metaOf = (id) => (id === "tvmaze:a" ? scheduleMeta([7], { name: "A" }) : scheduleMeta([7, 14], { name: "B" }));
  const days = groupByDate(upcomingList([a, b], metaOf, at).rows);

  assert.equal(days.length, 2);
  assert.equal(days[0].rows.length, 2, "two shows air the same day");
  assert.deepEqual(days[0].rows.map((r) => r.show.name), ["A", "B"], "same day sorts by name");
  assert.equal(days[0].inDays, 7);
  assert.equal(days[1].inDays, 14);
});

test("returnsIn reports the next episode and its distance", () => {
  const r = returnsIn(showFixture([]), scheduleMeta([45]), at);
  assert.equal(r.inDays, 45);
  assert.equal(r.ep.e, 1);
});

test("returnsIn is null when nothing is scheduled", () => {
  const meta = metaFixture({ seasons: [{ n: 1, episodes: [{ e: 1, air: "2020-01-01" }] }] });
  assert.equal(returnsIn(showFixture([]), meta, at), null);
});

test("returnsIn skips an undated episode to find a dated one", () => {
  const meta = {
    key: "tvmaze:9", src: "tvmaze", ref: 9, name: "S", status: "Running",
    seasons: [{ n: 2, episodes: [{ e: 1, air: null }, { e: 2, air: "2030-01-01" }] }],
  };
  assert.equal(returnsIn(showFixture([]), meta, at).ep.e, 2);
});

test("a first episode reads as a premiere", () => {
  const { rows } = upcomingList([showFixture([])], () => scheduleMeta([7, 14]), at);
  assert.equal(isPremiere(rows[0]), true);
  assert.equal(isPremiere(rows[1]), false);
});
