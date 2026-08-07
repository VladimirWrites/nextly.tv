// Reading a TV Time data export.
//
// Same job as the Trakt reader, for a service that files everything differently: forty-one CSV
// files, of which three describe what was watched and the rest are device identifiers, access
// tokens and notification history. What makes it work at all is that TV Time numbers shows by
// TVDB — Buffy is 70327 there and 70327 in TheTVDB — so a show read out of here meets the
// record it belongs to whichever catalogue wrote it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  readTvTimeExport, feedFromRecords, showsFromRecords, isTvTimeExport, wantedFile, shortfall,
} from "../public/js/domain/tvtime-export.js";

const HEAD = "user_id,season_number,episode_number,ep_id,series_name,created_at,key,s_id,s_no,ep_no,"
  + "is_archived,is_for_later,is_followed";

const play = ({ show = "The Wire", tvdb = 79126, s = 1, e = 1, at = "2021-06-30 22:07:07", n = 1 } = {}) =>
  `1,${s},${e},900${s}${e},${show},${at},watch-episode-${n},${tvdb},${s},${e},,,`;

const series = ({ show = "The Wire", tvdb = 79126, archived = "false", later = "false", followed = "true" } = {}) =>
  `1,,,,${show},2021-06-30 22:07:07,user-series-${tvdb},${tvdb},,,${archived},${later},${followed}`;

const records = (...lines) => ({ "tracking-prod-records-v2.csv": [HEAD, ...lines].join("\n") });

test("a zip is recognised by the one file no other service writes", () => {
  assert.equal(isTvTimeExport(["user.csv", "tracking-prod-records-v2.csv", "ip_address.csv"]), true);
  assert.equal(isTvTimeExport(["watched-history.json", "ratings-shows.json"]), false, "a Trakt export is not one");
  assert.equal(isTvTimeExport([]), false);
});

/* The four files that say something about what was watched, and only those. The rest of that
   zip is somebody's access tokens, IP addresses and device identifiers, and the strongest thing
   this app can say about them is that they are never taken out of the archive. */
test("only the files that say something about watching are unpacked", () => {
  for (const n of ["tracking-prod-records-v2.csv", "user_tv_show_data.csv", "followed_tv_show.csv",
    "tracking-prod-records.csv"]) {
    assert.equal(wantedFile(n), true, `${n} is read`);
  }
  for (const n of ["access_token.csv", "refresh_token.csv", "ip_address.csv", "user.csv",
    "device_token.csv", "user_connection.csv", "_user_creation_ip.csv", "user_session.csv",
    "notifications-prod-notifications.csv"]) {
    assert.equal(wantedFile(n), false, `${n} is nobody's business here`);
  }
});

test("plays fold into one row per show, one entry per episode", () => {
  const rows = feedFromRecords([
    { key: "watch-episode-1", s_id: "79126", series_name: "The Wire", season_number: "1", episode_number: "1", created_at: "2021-06-30 22:07:07" },
    { key: "watch-episode-2", s_id: "79126", series_name: "The Wire", season_number: "1", episode_number: "2", created_at: "2021-07-01 20:00:00" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tvdb, 79126);
  assert.deepEqual(rows[0].episodes.map((e) => `${e.s}x${e.e}`), ["1x1", "1x2"]);
});

/* Counted rather than read from a field, exactly as the Trakt reader counts them: the history
   is the record of the plays, and two rows for one episode is a rewatch. */
test("the same episode twice is two plays, keeping the later date", () => {
  const rows = feedFromRecords([
    { key: "watch-episode-1", s_id: "1", series_name: "X", season_number: "2", episode_number: "6", created_at: "2021-06-30 22:07:07" },
    { key: "rewatch-episode-2", s_id: "1", series_name: "X", season_number: "2", episode_number: "6", created_at: "2023-07-29 10:54:39" },
  ]);
  assert.equal(rows[0].episodes[0].plays, 2);
  assert.equal(rows[0].episodes[0].at, Date.parse("2023-07-29T10:54:39Z"));
});

/* The dates carry no zone and are UTC. Read as local time, every play would shift by the
   reader's own offset — far enough east, onto the day before. */
test("a date with no zone on it is read as UTC", () => {
  const rows = feedFromRecords([
    { key: "watch-episode-1", s_id: "1", series_name: "X", season_number: "1", episode_number: "1", created_at: "2026-06-30 11:40:08" },
  ]);
  assert.equal(rows[0].episodes[0].at, Date.parse("2026-06-30T11:40:08Z"));
});

/* Matching a library on names is how somebody ends up with two copies of one show, one of them
   holding half the history. */
test("a play with no show id behind it is dropped rather than matched by name", () => {
  assert.deepEqual(feedFromRecords([
    { key: "watch-episode-1", s_id: "", series_name: "The Wire", season_number: "1", episode_number: "1", created_at: "2021-06-30 22:07:07" },
  ]), []);
});

test("the year in the title is taken out of it", () => {
  const rows = feedFromRecords([
    { key: "watch-episode-1", s_id: "448147", series_name: "The Studio (2025)", season_number: "1", episode_number: "1", created_at: "2025-03-31 18:46:03" },
  ]);
  assert.equal(rows[0].name, "The Studio");
  assert.equal(rows[0].year, 2025);
});

test("brackets that are part of a name stay part of it", () => {
  const rows = feedFromRecords([
    { key: "watch-episode-1", s_id: "1", series_name: "The Office (US)", season_number: "1", episode_number: "1", created_at: "2021-01-01 00:00:00" },
  ]);
  assert.equal(rows[0].name, "The Office (US)");
  assert.equal(rows[0].year, null);
});

test("the flags a show carries are read from its own row", () => {
  const shows = showsFromRecords([
    { key: "user-series-1", s_id: "1", series_name: "A", is_archived: "true", is_for_later: "false", is_followed: "true" },
    { key: "user-series-2", s_id: "2", series_name: "B", is_archived: "false", is_for_later: "true", is_followed: "true" },
  ]);
  assert.equal(shows.get(1).archived, true);
  assert.equal(shows.get(2).forLater, true);
});

/* Archived on TV Time is the shelf a show goes on when somebody stops watching it — the same
   statement Trakt makes by hiding one from progress, and it arrives under the same name so the
   code that files imported shows needs no telling. */
test("an archived show arrives flagged the way a hidden one does", () => {
  const r = readTvTimeExport(records(play(), series({ archived: "true" })));
  assert.equal(r.feed.shows[0].hidden, true);
});

/* "For later" is a watchlist by another name: no episodes, so nothing downstream marks
   anything, and it lands as planned. */
test("a followed show with no history at all becomes a planned row", () => {
  const r = readTvTimeExport(records(
    play(),
    series(),
    series({ show: "Twin Peaks", tvdb: 70533, later: "true", followed: "false" }),
  ));
  const later = r.feed.shows.find((s) => s.name === "Twin Peaks");
  assert.ok(later);
  assert.deepEqual(later.episodes, []);
  assert.equal(r.planned, 1);
  assert.equal(r.shows, 1, "and it is not counted among the shows with history");
});

test("when a show was last watched travels with it", () => {
  const r = readTvTimeExport(records(
    play({ e: 1, at: "2021-06-30 22:07:07" }),
    play({ e: 2, at: "2024-02-02 10:00:00", n: 2 }),
  ));
  assert.equal(r.feed.shows[0].lastAt, Date.parse("2024-02-02T10:00:00Z"));
});

/* The only way to tell a complete export from a partial one, and reported in the shape the
   screen already knows how to say out loud. */
test("a history that does not add up to the count is reported", () => {
  const rows = feedFromRecords([
    { key: "watch-episode-1", s_id: "70327", series_name: "Buffy", season_number: "1", episode_number: "1", created_at: "2021-01-01 00:00:00" },
  ]);
  const missing = shortfall(rows, [
    { tv_show_id: "70327", nb_episodes_seen: "27", tv_show_name: "Buffy the Vampire Slayer" },
    { tv_show_id: "70533", nb_episodes_seen: "0", tv_show_name: "Twin Peaks" },
  ]);
  assert.deepEqual(missing, [{ name: "Buffy the Vampire Slayer", had: 1, claimed: 27, kind: "show" }]);
});

test("an export with no history in it says so rather than importing nothing", () => {
  assert.throws(() => readTvTimeExport({}), /TV Time export/);
  assert.throws(() => readTvTimeExport({ "tracking-prod-records-v2.csv": HEAD }), /TV Time export/);
});

/* Said out loud rather than quietly skipped. TV Time keeps films in a corner of the same file —
   two rows against six thousand episodes — and holds no ratings at all: the scores in that zip
   are its own measures of engagement, not anybody's opinion. */
test("it reports no movies and no ratings, because there are none to take", () => {
  const r = readTvTimeExport(records(play(), series()));
  assert.equal(r.movies, 0);
  assert.equal(r.ratings, 0);
  assert.equal(r.ratedTitles, 0);
  assert.equal(r.source, "TV Time");
});

/* Every row leaves here with the TVDB id and nothing else, which both catalogues that answer
   about television can look a show up by — see lookup() in providers/tvmaze.js and tmdb.js. */
test("rows carry the portable id both television catalogues understand", () => {
  const r = readTvTimeExport(records(play()));
  const row = r.feed.shows[0];
  assert.equal(row.tvdb, 79126);
  assert.equal(row.imdb, null);
  assert.equal(row.tmdb, null);
});

/* Films.
 *
 * TV Time tracks them — the correction that produced this: a show arrives with a TVDB id, and a
 * film arrives with a title, a release date and TV Time's own uuid. Nothing there identifies a
 * film to a catalogue, and matching one by name is how a library gains a second copy of what it
 * already holds, or a claim to have seen something nobody watched. So they are counted and left,
 * and the count is what lets the screen say so. */
test("a film is counted once, however many rows it has", async () => {
  const { moviesNamed } = await import("../public/js/domain/tvtime-export.js");
  const got = moviesNamed([
    { entity_type: "movie", type: "follow", uuid: "a", movie_name: "Mountainhead", release_date: "2025-05-31 00:00:00" },
    { entity_type: "movie", type: "watch", uuid: "a", movie_name: "Mountainhead", release_date: "2025-05-31 00:00:00" },
    { entity_type: "movie", type: "follow", uuid: "b", movie_name: "Heat", release_date: "1995-12-15 00:00:00" },
    { entity_type: "series", type: "watch", uuid: "c", series_name: "The Wire" },
  ]);
  assert.deepEqual(got, { total: 2, watched: 1 }, "two films, one of them seen");
});

test("an export with no films says so with a zero", async () => {
  const { moviesNamed } = await import("../public/js/domain/tvtime-export.js");
  assert.deepEqual(moviesNamed([]), { total: 0, watched: 0 });
  assert.deepEqual(moviesNamed(null), { total: 0, watched: 0 });
});

/* The older records file is read for the films and for nothing else. Its episode rows describe
   the same history the newer file states, and reading both would count every play twice. */
test("the legacy file contributes films and not one mark", () => {
  const r = readTvTimeExport({
    ...records(play(), series()),
    "tracking-prod-records.csv": [
      "type,entity_type,uuid,movie_name,release_date,series_name,season_number,episode_number,created_at,watch_count",
      "watch,movie,a,Mountainhead,2025-05-31 00:00:00,,,,2025-05-27 08:54:38,",
      "watch,series,b,,,The Wire,4,13,2019-01-01 00:00:00,1",
    ].join("\n"),
  });
  assert.deepEqual(r.unimported, { total: 1, watched: 1 });
  assert.equal(r.plays, 1, "the one play came from the newer file, and only once");
  assert.equal(r.shows, 1);
  assert.equal(r.movies, 0, "and nothing about a film was imported");
});
