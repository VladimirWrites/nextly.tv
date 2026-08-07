// A TV Time data export, turned into the feed shape domain/external.js already speaks.
//
// The same job domain/trakt-export.js does, for a service that files everything differently.
// TV Time answers a data request with a zip of forty-one CSV files, most of which are somebody's
// device identifiers, access tokens, IP addresses and notification history. Three of them
// describe what was watched, and those three are the only ones this reads. The rest are not
// merely ignored: they are never taken out of the zip, so nothing here is ever holding an
// access token that could be logged, synced or gone looking for.
//
//   tracking-prod-records-v2.csv  every play, one row each, and one row per followed show. The
//                                 `key` column says which: watch-episode, rewatch-episode, or
//                                 user-series.
//   user_tv_show_data.csv         one row per show with a count of episodes seen. No episodes,
//                                 which is why it is only ever a cross-check.
//   followed_tv_show.csv          names and follow dates. Read for the shows that appear in
//                                 neither of the others.
//
// What makes this work at all is that TV Time numbers shows by TVDB. Buffy is 70327 there and
// 70327 in TheTVDB, and this app's matcher already reconciles on portable ids — so a show found
// here meets the record it belongs to whichever catalogue wrote it.
//
// What it does not carry: ratings, of any kind. The scores in that zip are TV Time's own —
// an "addiction score" and a gamification total — and neither is an opinion anybody gave.
// Movies are technically present and practically absent: the export tested against had two
// movie rows against six thousand episodes, in a file whose shape says the feature was an
// afterthought. Neither is read, and both are said out loud rather than quietly skipped.
//
// Pure, like the rest of domain/: handed text, returns a feed and a report.
import { csvObjects } from "./csv.js";

export const RECORDS_FILE = /^tracking-prod-records-v2\.csv$/;
export const TOTALS_FILE = /^user_tv_show_data\.csv$/;
export const FOLLOWED_FILE = /^followed_tv_show\.csv$/;

export const TVTIME_FILES = [RECORDS_FILE, TOTALS_FILE, FOLLOWED_FILE];

export const wantedFile = (name) => TVTIME_FILES.some((re) => re.test(name));

/* Which export a zip is, from its file list alone.
 *
 * Asked before anything is unpacked, because the two readers want different files and reading
 * the wrong one out of the right zip produces an empty import rather than an error. The records
 * file is the test: it is the only name here that no other service uses, and an export without
 * it has nothing to import anyway. */
export const isTvTimeExport = (names) => (names || []).some((n) => RECORDS_FILE.test(n));

const num = (v) => {
  const n = Math.trunc(+v);
  return Number.isFinite(n) ? n : NaN;
};

/* "2026-06-30 11:40:08", which is UTC and does not say so. Left to the browser's own parsing it
   would be read as local time and every date would shift by the reader's offset — enough, for
   somebody far enough east, to move a play to the day before. */
const at = (s) => (s ? Date.parse(`${String(s).replace(" ", "T")}Z`) || 0 : 0);

/* "The Studio (2025)" is a title and a year, and the year is worth having: it is what tells two
   shows of the same name apart when a catalogue is asked about them. Only a four-digit year in
   trailing brackets, so a title that ends in brackets for its own reasons keeps them. */
const titleYear = (raw) => {
  const name = String(raw || "").trim();
  const m = /^(.*?)\s*\((\d{4})\)$/.exec(name);
  return m ? { name: m[1].trim(), year: num(m[2]) } : { name, year: null };
};

const kindOf = (row) => String(row.key || "").split("-")[0];   // watch | rewatch | user | ...
const isPlay = (row) => /^(?:re)?watch-episode/.test(String(row.key || ""));
const isSeries = (row) => String(row.key || "").startsWith("user-series");

/* Every play, folded into one row per show and one entry per episode.
 *
 * Plays are counted rather than read from a field, exactly as the Trakt reader counts them:
 * two rows for the same episode is two plays, which is what a rewatch looks like here. The
 * date kept is the latest.
 *
 * A row with no show id is dropped. TV Time writes the show's name beside every play, and
 * matching a library on names is how somebody ends up with two copies of one show — one of
 * them holding half the history. */
export function feedFromRecords(records) {
  const shows = new Map();

  for (const r of records || []) {
    if (!isPlay(r)) continue;
    const tvdb = num(r.s_id || r.series_id);
    const s = num(r.season_number !== "" ? r.season_number : r.s_no);
    const e = num(r.episode_number !== "" ? r.episode_number : r.ep_no);
    if (!tvdb || !Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < 0) continue;

    if (!shows.has(tvdb)) {
      const { name, year } = titleYear(r.series_name);
      shows.set(tvdb, { name, year, imdb: null, tvdb, tmdb: null, episodes: new Map() });
    }
    const row = shows.get(tvdb);
    const key = `${s}x${e}`;
    const when = at(r.created_at);
    const held = row.episodes.get(key);
    if (held) {
      held.plays += 1;
      if (when > held.at) held.at = when;
    } else {
      row.episodes.set(key, { s, e, at: when, plays: 1 });
    }
  }

  return [...shows.values()].map((row) => ({
    ...row,
    episodes: [...row.episodes.values()].sort((a, b) => a.s - b.s || a.e - b.e),
  }));
}

/* The shows themselves, as TV Time files them.
 *
 * One row per followed show, carrying three flags. "For later" is a watchlist by another name.
 * "Archived" is the shelf TV Time gives a show somebody has stopped watching, which is the
 * nearest thing it has to dropping one — the same statement Trakt makes by hiding a show from
 * progress, and it arrives on the row under the same name, so what reads it is the same code. */
export function showsFromRecords(records) {
  const out = new Map();
  for (const r of records || []) {
    if (!isSeries(r)) continue;
    const tvdb = num(r.s_id || r.series_id);
    if (!tvdb) continue;
    const yes = (v) => v === "true" || v === "1";
    out.set(tvdb, {
      tvdb,
      ...titleYear(r.series_name),
      archived: yes(r.is_archived),
      forLater: yes(r.is_for_later),
      followed: yes(r.is_followed),
    });
  }
  return out;
}

/* What the history does not account for.
 *
 * user_tv_show_data.csv states a count per show and nothing else, which makes it the only way
 * to tell a complete export from a partial one — the same job watched-shows.json does in a
 * Trakt export, and reported in the same shape so the screen showing it needs no new code. */
export function shortfall(rows, totals) {
  const had = new Map(rows.map((r) => [r.tvdb, r.episodes.reduce((n, ep) => n + ep.plays, 0)]));
  const missing = [];
  for (const t of totals || []) {
    const tvdb = num(t.tv_show_id);
    const claimed = num(t.nb_episodes_seen) || 0;
    if (!tvdb || claimed <= 0) continue;
    const plays = had.get(tvdb) || 0;
    if (plays < claimed) {
      missing.push({ name: titleYear(t.tv_show_name).name, had: plays, claimed, kind: "show" });
    }
  }
  return missing;
}

/* The whole job, from the files a zip holds to what an import would work from.
 *
 * The records file is required and the other two are not: without it there is nothing to import
 * and saying so beats importing nothing and calling it a success. */
export function readTvTimeExport(files) {
  const records = csvObjects(String((files || {})["tracking-prod-records-v2.csv"] || ""));
  if (!records.length) {
    throw new Error("That doesn't look like a TV Time export — no watch history inside.");
  }

  const rows = feedFromRecords(records);
  const held = new Map(rows.map((r) => [r.tvdb, r]));
  const shows = showsFromRecords(records);

  /* The flags, onto the rows the history already made, and a row of its own for anything
     followed that was never watched. A show meant for later is exactly a watchlisted show:
     no episodes, so nothing downstream marks anything, and it lands as planned. */
  const planned = [];
  for (const [tvdb, show] of shows) {
    const row = held.get(tvdb);
    if (row) {
      if (show.archived) row.hidden = true;
      continue;
    }
    if (!show.followed && !show.forLater) continue;
    planned.push({ name: show.name, year: show.year, imdb: null, tvdb, tmdb: null, episodes: [] });
  }

  /* Names for anything the records file did not describe. followed_tv_show.csv is the older of
     the two lists and occasionally holds a show the newer one has forgotten; taken only where
     it adds something, never to overrule what the records say. */
  for (const f of csvObjects(String((files || {})[/* named for the service, not for us */ "followed_tv_show.csv"] || ""))) {
    const tvdb = num(f.tv_show_id);
    if (!tvdb || held.has(tvdb) || shows.has(tvdb)) continue;
    if (f.active === "0" || f.archived === "1") continue;
    planned.push({ ...titleYear(f.tv_show_name), imdb: null, tvdb, tmdb: null, episodes: [] });
    shows.set(tvdb, { tvdb });
  }

  /* When each show was last watched, which is what files it as watching, paused or dropped.
     Taken from the marks, since TV Time states a last-watched date only inside a printed Go map
     — a string carrying microseconds in scientific notation, which is a fragile thing to read
     for an answer the marks already hold. */
  for (const row of rows) {
    const last = row.episodes.reduce((m, ep) => Math.max(m, ep.at || 0), 0);
    if (last) row.lastAt = last;
  }

  const feed = { shows: [...rows, ...planned] };
  const episodes = rows.reduce((n, r) => n + r.episodes.length, 0);
  const plays = rows.reduce((n, r) => n + r.episodes.reduce((t, ep) => t + ep.plays, 0), 0);
  const totals = csvObjects(String((files || {})["user_tv_show_data.csv"] || ""));

  return {
    feed,
    episodes,
    plays,
    events: records.filter(isPlay).length,
    pages: 1,
    planned: planned.length,
    plannedMovies: 0,
    shows: rows.length,
    // TV Time keeps films in a corner of the same file — two rows against six thousand — and
    // this reads none of them. Nothing is dropped silently that anybody would look for.
    movies: 0,
    watchedMovies: 0,
    // Nor ratings: the only scores in that export are TV Time's own measures of engagement.
    ratings: 0,
    ratedTitles: 0,
    missing: shortfall(rows, totals),
    source: "TV Time",
  };
}

export { kindOf };
