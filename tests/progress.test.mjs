import test from "node:test";
import assert from "node:assert/strict";
import {
  episodeList, watchedSet, showProgress, nextUp,
  upNextList, barcode, seasonProgress, lastWatchedAt, TICK,
} from "../public/js/domain/progress.js";
import { metaFixture, showFixture, T } from "./helpers.mjs";

const at = { now: T.now };

test("episodeList excludes specials by default and includes them on request", () => {
  const meta = metaFixture();
  assert.deepEqual(episodeList(meta).map((e) => e.key), ["1x1", "1x2", "2x1", "2x2", "2x3"]);
  assert.ok(episodeList(meta, true).map((e) => e.key).includes("1x3"));
});

test("episodeList sorts by season then episode regardless of input order", () => {
  const meta = metaFixture({
    seasons: [
      { n: 2, episodes: [{ e: 2, air: "2020-01-01" }, { e: 1, air: "2020-01-01" }] },
      { n: 1, episodes: [{ e: 1, air: "2020-01-01" }] },
    ],
  });
  assert.deepEqual(episodeList(meta).map((e) => e.key), ["1x1", "2x1", "2x2"]);
});

test("watchedSet reads presence, not a flag", () => {
  assert.deepEqual([...watchedSet(showFixture(["1x1", "2x1"]))].sort(), ["1x1", "2x1"]);
  assert.equal(watchedSet(showFixture()).size, 0);
});

/* What counts as out is everything the catalogue does not place in the future. An episode it
   has no date for is a gap in its records, not a claim that the episode has yet to happen — and
   one you have watched and marked should not be missing from the count of what there is. */
test("showProgress counts what is out separately from the total", () => {
  // Out at T.now: 1x1, 1x2, 2x1, and 2x3 which has no date at all. Still to come: 2x2.
  const p = showProgress(showFixture(["1x1"]), metaFixture(), at);
  assert.equal(p.aired, 4);
  assert.equal(p.total, 5);
  assert.equal(p.watched, 1);
  assert.equal(p.remaining, 3);
  assert.equal(p.unaired, 1, "only the one with a date in the future");
  assert.equal(p.pct, 25);
});

test("showProgress reports caughtUp without claiming the show is done", () => {
  // 2x3 has no date, so it is one of the things there is to watch and has to be marked before
  // this reads as caught up. Only 2x2, dated in the future, is genuinely still to come.
  const p = showProgress(showFixture(["1x1", "1x2", "2x1", "2x3"]), metaFixture(), at);
  assert.equal(p.remaining, 0);
  assert.equal(p.caughtUp, true);
  assert.equal(p.done, false, "a Running show with an episode still to come is not finished");
});

test("showProgress marks a fully watched ended show as done", () => {
  const meta = metaFixture({ status: "Ended" });
  const p = showProgress(showFixture(["1x1", "1x2", "2x1", "2x2", "2x3"]), meta, at);
  assert.equal(p.done, true);
});

test("showProgress ignores marks for episodes the catalogue no longer lists", () => {
  // A renumbering upstream must not produce 4/3.
  const p = showProgress(showFixture(["1x1", "1x2", "2x1", "9x9"]), metaFixture(), at);
  assert.equal(p.watched, 3);
  assert.ok(p.watched <= p.aired);
});

test("nextUp returns the lowest aired unwatched episode", () => {
  assert.equal(nextUp(showFixture([]), metaFixture(), at).key, "1x1");
  assert.equal(nextUp(showFixture(["1x1"]), metaFixture(), at).key, "1x2");
});

test("nextUp respects gaps rather than hiding a skipped episode", () => {
  const next = nextUp(showFixture(["1x1", "2x1"]), metaFixture(), at);
  assert.equal(next.key, "1x2", "skipping ahead must not bury the episode you never saw");
});

test("nextUp returns null once everything aired is watched", () => {
  assert.equal(nextUp(showFixture(["1x1", "1x2", "2x1"]), metaFixture(), at), null);
});

/* This used to assert the opposite, that an episode with no date was never offered. It reads
   reasonably until you have a library typed in by hand from a catalogue with gaps: those
   episodes could not be ticked, did not count towards finishing a season, and were never up
   next — invisible in every way except that they were listed. An episode nobody says is coming
   is one you can watch. */
test("nextUp offers an episode with no date, and never one that is still to come", () => {
  const undated = metaFixture({ seasons: [{ n: 1, episodes: [{ e: 1, air: null }] }] });
  assert.equal(nextUp(showFixture([]), undated, at).key, "1x1");

  const future = metaFixture({ seasons: [{ n: 1, episodes: [{ e: 1, air: "2032-01-01" }] }] });
  assert.equal(nextUp(showFixture([]), future, at), null);
});

test("lastWatchedAt is the newest mark", () => {
  const show = showFixture([{ id: "1x1", m: T.t1 }, { id: "1x2", m: T.t3 }]);
  assert.equal(lastWatchedAt(show), T.t3);
  assert.equal(lastWatchedAt(showFixture()), 0);
});

test("upNextList ranks by most recent activity, then by newest added", () => {
  const a = showFixture([{ id: "1x1", m: T.t1 }], { id: "tvmaze:a", name: "A", added: T.t1 });
  const b = showFixture([{ id: "1x1", m: T.t3 }], { id: "tvmaze:b", name: "B", added: T.t1 });
  const c = showFixture([], { id: "tvmaze:c", name: "C", added: T.t3 });
  const rows = upNextList([a, b, c], () => metaFixture(), at);
  assert.deepEqual(rows.map((r) => r.show.name), ["B", "A", "C"]);
});

test("upNextList omits shows that aren't active, and shows with nothing to watch", () => {
  const paused = showFixture([], { id: "tvmaze:p", st: "paused" });
  const dropped = showFixture([], { id: "tvmaze:d", st: "dropped" });
  const caught = showFixture(["1x1", "1x2", "2x1"], { id: "tvmaze:c" });
  assert.equal(upNextList([paused, dropped, caught], () => metaFixture(), at).length, 0);
});

test("upNextList skips shows whose metadata hasn't been fetched yet", () => {
  assert.equal(upNextList([showFixture()], () => null, at).length, 0);
});

test("barcode groups by season and marks exactly the states the UI paints", () => {
  const strip = barcode(showFixture(["1x1"]), metaFixture(), at);
  assert.deepEqual(strip.map((s) => s.n), [1, 2]);
  assert.deepEqual(strip[0].episodes.map((e) => e.t), [TICK.WATCHED, TICK.UNWATCHED]);
  // 2x2 is dated in the future; 2x3 has no date and so is drawn as something you could watch.
  assert.deepEqual(strip[1].episodes.map((e) => e.t), [TICK.UNWATCHED, TICK.UNAIRED, TICK.UNWATCHED]);
});

test("seasonProgress counts one season, excluding specials by default", () => {
  const show = showFixture(["1x1"]);
  const s1 = metaFixture().seasons[0];
  assert.deepEqual(seasonProgress(show, s1, at), { watched: 1, aired: 2, total: 2 });
  assert.equal(seasonProgress(show, s1, { specials: true, now: T.now }).total, 3);
});

/* ---- how much is left ----
   The count answers "how many"; this answers "have I got the evening". Only aired, unwatched
   episodes count — time you can't spend yet isn't time left. */

test("minutesLeft adds up the aired episodes still unwatched", () => {
  const meta = metaFixture();
  // metaFixture's episodes carry no runtime, so the show average stands in for each.
  meta.runtime = 45;
  const show = showFixture(["1x1"]);
  const p = showProgress(show, meta, at);
  assert.equal(p.minutesLeft, p.remaining * 45);
});

test("an episode's own runtime beats the show's average", () => {
  const meta = metaFixture();
  meta.runtime = 45;
  meta.seasons[0].episodes[0].runtime = 90;
  const p = showProgress(showFixture(), meta, at);
  const p2 = showProgress(showFixture(["1x1"]), meta, at);
  assert.equal(p.minutesLeft - p2.minutesLeft, 90, "dropping the 90-minute episode drops 90 minutes");
});

test("unaired episodes are not time you have left", () => {
  const meta = metaFixture();
  meta.runtime = 30;
  const p = showProgress(showFixture(), meta, at);
  assert.equal(p.minutesLeft, p.remaining * 30);
  assert.ok(p.unaired > 0, "the fixture has something unaired, or this proves nothing");
});

test("nothing left is no time left, not a fallback times zero", () => {
  const meta = metaFixture();
  meta.runtime = 60;
  const all = showProgress(markedThrough(meta), meta, at);
  assert.equal(all.minutesLeft, 0);
});

function markedThrough(meta) {
  const eps = [];
  for (const se of meta.seasons) for (const ep of se.episodes || []) eps.push(`${se.n}x${ep.e}`);
  return showFixture(eps);
}

/* ---- collapsing whole seasons ----
   A season is only worth drawing episode by episode when its episodes differ. */

test("a season watched end to end reports one block, not a run of identical ticks", () => {
  const meta = metaFixture();
  const s1 = meta.seasons[0].episodes.map((ep) => `1x${ep.e}`);
  const rows = barcode(showFixture(s1), meta, at);
  assert.equal(rows[0].block, "w");
  assert.ok(rows[0].episodes.length > 1, "the episodes are still there for when it expands");
});

test("a season nobody has touched collapses too", () => {
  const rows = barcode(showFixture(), metaFixture(), at);
  const untouched = rows.find((r) => r.episodes.every((e) => e.t === "u"));
  if (untouched) assert.equal(untouched.block, "u");
});

test("a season part-watched has a shape worth drawing, so it stays expanded", () => {
  const rows = barcode(showFixture(["1x1"]), metaFixture(), at);
  assert.equal(rows[0].block, null);
});

test("a season you're midway through with episodes still to air stays expanded", () => {
  const meta = metaFixture();
  const season = meta.seasons.find((se) => se.episodes.some((ep) => !ep.air || ep.air > "2024-06-01"));
  if (!season) return;                       // fixture has none; nothing to assert
  const watched = season.episodes.filter((ep) => ep.air && ep.air < "2024-06-01")
    .map((ep) => `${season.n}x${ep.e}`);
  const rows = barcode(showFixture(watched), meta, at);
  const row = rows.find((r) => r.n === season.n);
  assert.equal(row.block, null, "watched and unaired are two states, so it is not uniform");
});

test("an entirely unaired season is uniform and collapses", () => {
  const meta = metaFixture();
  meta.seasons.push({ n: 9, episodes: [
    { e: 1, name: "A", air: "2099-01-01" }, { e: 2, name: "B", air: "2099-01-08" },
  ] });
  const rows = barcode(showFixture(), meta, at);
  assert.equal(rows.find((r) => r.n === 9).block, "x");
});

test("an empty season is not a block", () => {
  const meta = metaFixture();
  meta.seasons.push({ n: 8, episodes: [] });
  const rows = barcode(showFixture(), meta, at);
  const row = rows.find((r) => r.n === 8);
  assert.ok(!row || row.block === null);
});

/* ---- what just got finished ----
   "Watched" says nothing about whether this particular mark closed a season, so the state is
   compared either side of it. These pin the difference between being complete and having just
   become complete. */

const { completion, newlyFinished } = await import("../public/js/domain/progress.js");

const airedMeta = () => ({
  seasons: [
    { n: 1, episodes: [{ e: 1, air: "2020-01-01" }, { e: 2, air: "2020-01-08" }] },
    { n: 2, episodes: [{ e: 1, air: "2021-01-01" }, { e: 2, air: "2021-01-08" }] },
  ],
  status: "Ended",
});

const withMarks = (ids) => showFixture(ids);

test("closing a season is reported once, and only for that season", () => {
  const meta = airedMeta();
  const before = completion(withMarks(["1x1"]), meta, at);
  const after = completion(withMarks(["1x1", "1x2"]), meta, at);
  assert.deepEqual(newlyFinished(before, after), { seasons: [1], series: false });
});

test("a season already finished is not news again", () => {
  const meta = airedMeta();
  const done = completion(withMarks(["1x1", "1x2"]), meta, at);
  assert.deepEqual(newlyFinished(done, done), { seasons: [], series: false });
});

test("the last episode of an ended show finishes the series as well as the season", () => {
  const meta = airedMeta();
  const before = completion(withMarks(["1x1", "1x2", "2x1"]), meta, at);
  const after = completion(withMarks(["1x1", "1x2", "2x1", "2x2"]), meta, at);
  assert.deepEqual(newlyFinished(before, after), { seasons: [2], series: true });
});

test("a running show never finishes, however far through it is", () => {
  const meta = airedMeta();
  meta.status = "Running";
  const before = completion(withMarks(["1x1", "1x2", "2x1"]), meta, at);
  const after = completion(withMarks(["1x1", "1x2", "2x1", "2x2"]), meta, at);
  assert.deepEqual(newlyFinished(before, after), { seasons: [2], series: false });
});

test("catching up on everything at once reports every season it closed", () => {
  const meta = airedMeta();
  const before = completion(withMarks([]), meta, at);
  const after = completion(withMarks(["1x1", "1x2", "2x1", "2x2"]), meta, at);
  assert.deepEqual(newlyFinished(before, after), { seasons: [1, 2], series: true });
});

test("unmarking finishes nothing", () => {
  const meta = airedMeta();
  const before = completion(withMarks(["1x1", "1x2"]), meta, at);
  const after = completion(withMarks(["1x1"]), meta, at);
  assert.deepEqual(newlyFinished(before, after), { seasons: [], series: false });
});

test("starting a rewatch is not a finish, even though every season resets at once", () => {
  const meta = airedMeta();
  const done = withMarks(["1x1", "1x2", "2x1", "2x2"]);
  const before = completion(done, meta, at);
  const rewatching = Object.assign(showFixture(["1x1", "1x2", "2x1", "2x2"]), { rw: 2 });
  const after = completion(rewatching, meta, at);
  assert.deepEqual(newlyFinished(before, after), { seasons: [], series: false });
});

test("a season with nothing aired yet is not finished by having no marks", () => {
  const meta = { status: "Ended", seasons: [{ n: 9, episodes: [{ e: 1, air: "2099-01-01" }] }] };
  const snap = completion(showFixture([]), meta, at);
  assert.equal(snap.seasons.get(9), false);
});
