// A Trakt data export, turned into the feed shape domain/external.js already speaks.
//
// Trakt lets anyone download their own data as a zip of JSON files. That matters here because
// creating an API application on Trakt is a paid feature, so the obvious route — connect an
// app, read the history — is closed to most people. A download is not.
//
// The zip holds forty-odd files and this reads two kinds of them.
//
//   watched-history.json  one entry per play: when, which episode, and the show's ids. A long
//   watched-history-N.json  history is split at 250 entries a file and numbered from 1, with
//                         no unnumbered file alongside — so a small account has the first name
//                         and a real one has the second, and both have to be understood.
//   watched-shows.json    one entry per show: total plays and a last-watched date. No seasons,
//                         no episodes — which is the whole reason the history is the source and
//                         this one is only a cross-check.
//   lists-watchlist.json  what Trakt calls the watchlist and its apps label "plan to watch":
//   lists-watchlist-N.json  shows somebody means to start and has no history for. Split and
//                         numbered past a few hundred entries, exactly as the history is, and
//                         for the same reason — so both names have to be understood here too.
//
// Everything else in the zip is ratings, comments, notes, lists, collection, social graph and
// account settings. None of it is a watch mark, and none of it is read. The profile and
// settings files in particular are left alone on purpose: there is nothing in them this app
// wants, and reading them would mean holding somebody's email address for no reason.
//
// Pure, like the rest of domain/. It is handed parsed JSON and returns a feed and a report.

/* Every history entry is a play, whatever put it there — a scrobble from a media centre, a
   check-in, or a manual mark. They differ in provenance and not in meaning. */
const isPlay = (e) => e && e.type === "episode" && e.episode && e.show;

// The other half of the same file. A movie play names the movie and nothing else — there is no
// episode to place it against, which is exactly what makes it a movie.
const isMoviePlay = (e) => e && e.type === "movie" && e.movie;

// Absent is not zero, and a season number of 0 is a real season — specials.
import { RATING_TITLE, RATING_MAX, seasonRatingKey } from "./constants.js";

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Math.trunc(+v));

const idsOf = (o) => {
  const ids = (o && o.ids) || {};
  return {
    imdb: ids.imdb || null,
    tvdb: num(ids.tvdb) || null,
    tmdb: num(ids.tmdb) || null,
    trakt: num(ids.trakt) || null,
  };
};

/* Which show an entry belongs to. Trakt's own id where there is one, because it is the only
   one guaranteed to be present and unique across the file — the others are what the show is
   matched by later, and a show can be missing any of them. */
/* Kind first, because Trakt numbers movies and series in separate spaces and every id in here
   is one or the other. Without it a movie with trakt id 154574 and a series with the same number
   are the same row, and one silently eats the other — which is exactly what happened the first
   time movies were folded in: a watchlisted series vanished behind a movie. */
const keyOf = (ids, kind) =>
  ids.trakt ? `${kind}:trakt:${ids.trakt}`
    : ids.imdb ? `${kind}:imdb:${ids.imdb}`
      : ids.tvdb ? `${kind}:tvdb:${ids.tvdb}`
        : ids.tmdb ? `${kind}:tmdb:${ids.tmdb}` : null;

const showKeyOf = (ids) => keyOf(ids, "show");
const movieKeyOf = (ids) => keyOf(ids, "movie");

/* The history, folded into one row per show and one entry per episode.

   Plays are counted rather than taken from a field, because the history is the record of them:
   three entries for the same episode is three plays, which is what a rewatch looks like here.
   The date kept is the latest, to match what `w` means in this app — when it was last seen.

   Entries arrive newest first in the file. Nothing here depends on that. */
export function feedFromHistory(history) {
  const shows = new Map();

  for (const entry of history || []) {
    if (!isPlay(entry)) continue;
    const s = num(entry.episode.season);
    const e = num(entry.episode.number);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < 0) continue;

    const ids = idsOf(entry.show);
    const key = showKeyOf(ids);
    if (!key) continue;

    if (!shows.has(key)) {
      shows.set(key, {
        name: entry.show.title || "",
        year: num(entry.show.year) || null,
        imdb: ids.imdb,
        tvdb: ids.tvdb,
        tmdb: ids.tmdb,
        trakt: ids.trakt,
        episodes: new Map(),
      });
    }

    const row = shows.get(key);
    const epKey = `${s}x${e}`;
    const at = entry.watched_at ? Date.parse(entry.watched_at) || 0 : 0;
    const held = row.episodes.get(epKey);
    if (held) {
      held.plays += 1;
      if (at > held.at) held.at = at;
    } else {
      row.episodes.set(epKey, { s, e, at, plays: 1 });
    }
  }

  return {
    shows: [...shows.values()].map((row) => ({
      ...row,
      episodes: [...row.episodes.values()].sort((a, b) => a.s - b.s || a.e - b.e),
    })),
  };
}

/* Movies, from the same history.

   Trakt files a movie play as `type: "movie"` with the movie in place of the show, and repeats
   the entry for a rewatch exactly as it does for an episode. So the fold is the same fold: one
   row per movie, plays counted, the latest date kept.

   What comes back is a row with an empty episode list and `kind: "movie"` on it, which is all
   anything downstream needs to know — matching, adding and marking are the same code.

   watched-movies-*.json holds the same movies with a play count already summed, and is used the
   way watched-shows.json is: a cross-check, never the source, because it says nothing about
   when anything was seen. */
export function moviesFromHistory(history) {
  const movies = new Map();

  for (const entry of history || []) {
    if (!isMoviePlay(entry)) continue;
    const ids = idsOf(entry.movie);
    const key = movieKeyOf(ids);
    if (!key) continue;

    const at = entry.watched_at ? Date.parse(entry.watched_at) || 0 : 0;
    const held = movies.get(key);
    if (held) {
      held.plays += 1;
      if (at > held.at) held.at = at;
    } else {
      movies.set(key, {
        name: entry.movie.title || "",
        year: num(entry.movie.year) || null,
        imdb: ids.imdb,
        tvdb: ids.tvdb,
        tmdb: ids.tmdb,
        trakt: ids.trakt,
        kind: "movie",
        plays: 1,
        at,
        episodes: [],
      });
    }
  }
  return [...movies.values()];
}

/* The watchlist: titles meant for later.

   These carry no episodes, which is the whole point of them, and that is exactly how they are
   handed on — a row with an empty episode list. Everything downstream then does the right thing
   without being told about watchlists at all: matching finds nothing to mark, adding files the
   title under this app's default status, which is "planned", and applying an empty plan promotes
   nothing, so something meant for later stays meant for later.

   Shows and movies both. It read shows only, and said so in a comment — written when this app
   had no movies in it, and left alone when it gained them. One export tested against held 412
   shows and 414 films on its watchlist, and imported half a watchlist without a word.

   Seasons and single episodes can sit in a Trakt watchlist too, and are still skipped: this
   app has no shelf for "the third season of something, later". */
export function watchlistTitles(list) {
  const out = [];
  for (const row of list || []) {
    if (!row) continue;
    const movie = row.type === "movie";
    const subject = movie ? row.movie : row.show;
    if ((!movie && row.type !== "show") || !subject) continue;
    const ids = idsOf(subject);
    if (!(movie ? movieKeyOf(ids) : showKeyOf(ids))) continue;
    out.push({
      name: subject.title || "",
      year: num(subject.year) || null,
      imdb: ids.imdb,
      tvdb: ids.tvdb,
      tmdb: ids.tmdb,
      trakt: ids.trakt,
      ...(movie ? { kind: "movie" } : {}),
      episodes: [],
    });
  }
  return out;
}

/* What the history does not account for.

   watched-shows.json is the only place the export states a total, so it is the only way to
   tell a complete history from a partial one. A show listed there with no plays in the history
   is a hole, and a reader importing a library should be told about it rather than left to
   notice later that a series they finished came in empty.

   Plays are compared and not episode counts, because that is what both files report. A show
   watched twice through has more plays than episodes, so the comparison says "fewer plays than
   Trakt counted" and never pretends to name which episode is missing. */
export function shortfall(feed, watchedShows, watchedMovies) {
  const byKey = new Map();
  for (const row of feed.shows) {
    const key = row.kind === "movie" ? movieKeyOf(row) : showKeyOf(row);
    if (key) byKey.set(key, row);
  }

  const missing = [];

  /* Movies first, and counted differently: a movie's plays live on the row, an episode's are
     spread across the episode list. Same question either way — does the history add up to what
     the totals claim. */
  for (const row of watchedMovies || []) {
    if (!row || !row.movie) continue;
    const key = movieKeyOf(idsOf(row.movie));
    if (!key) continue;
    const found = byKey.get(key);
    const plays = found ? (+found.plays || 0) : 0;
    const claimed = num(row.plays) || 0;
    if (plays < claimed) {
      missing.push({ name: row.movie.title || "", had: plays, claimed, kind: "movie" });
    }
  }

  for (const row of watchedShows || []) {
    if (!row || !row.show) continue;
    const ids = idsOf(row.show);
    const key = showKeyOf(ids);
    if (!key) continue;
    const found = byKey.get(key);
    const plays = found ? found.episodes.reduce((t, ep) => t + ep.plays, 0) : 0;
    const claimed = num(row.plays) || 0;
    if (plays < claimed) {
      missing.push({ name: row.show.title || "", had: plays, claimed, kind: "show" });
    }
  }
  return missing;
}

/* The whole job, from the files a zip holds to what an import would work from.

   The history file is required and the rest is not: an export missing watched-shows.json still
   imports, it just cannot say whether anything was left out. An export missing the history is
   not an export this can use, and says so rather than importing nothing and calling it a
   success. */
/* The history's file names, in the order their contents belong in.

   Trakt splits at 250 entries and numbers the pieces from 1. A short history is a single
   unnumbered file instead, so both shapes exist and an export has one or the other. Sorted
   numerically rather than as text, or page 10 would fall between 1 and 2 — which would not
   corrupt anything here, since nothing depends on order, but it would make every dump of this
   list confusing to read. */
export const HISTORY_FILE = /^watched-history(?:-(\d+))?\.json$/;

/* The watchlist splits the same way, which the first two exports tested against did not show:
   one had no watchlist at all and the other had a single entry. An account with four hundred
   gets lists-watchlist-1.json through -4, and a reader that knows only the unnumbered name
   drops every one of them without a word. */
export const WATCHLIST_FILE = /^lists-watchlist(?:-(\d+))?\.json$/;

/* Per-movie totals, the movie half of watched-shows.json. Split and numbered past a few hundred
   entries the way everything else in here is. */
export const WATCHED_MOVIES_FILE = /^watched-movies(?:-(\d+))?\.json$/;

/* Hidden from progress: Trakt's own words for "I am not watching this any more".
 *
 * Its apps offer it as "hide from progress", and hiding a show is the nearest thing that
 * service has to dropping one. The reset file is the same statement made another way — a
 * history reset with the show hidden afterwards. Rare in practice, one show in a library of a
 * hundred and thirteen, but it is somebody saying so outright rather than a date being read
 * into, and that is worth more than the whole rest of the guess. */
export const HIDDEN_PROGRESS_FILE = /^hidden-progress-watched(?:-reset)?\.json$/;

/* Ratings, which Trakt keeps in four files because it rates four things: the movie, the show,
   a season of it, and one episode. All on the same 1-10 integer scale, all paginated the same
   way as everything else in here — the movies file was three pages in the export this was
   written against, and a reader that knew only the unnumbered name would have taken none of
   them. */
export const RATINGS_MOVIES_FILE = /^ratings-movies(?:-(\d+))?\.json$/;
export const RATINGS_SHOWS_FILE = /^ratings-shows(?:-(\d+))?\.json$/;
export const RATINGS_SEASONS_FILE = /^ratings-seasons(?:-(\d+))?\.json$/;
export const RATINGS_EPISODES_FILE = /^ratings-episodes(?:-(\d+))?\.json$/;

/* The totals file, which is one file and never paginated — the only name in the export this
   reader takes literally. */
export const TOTALS_FILE = /^watched-shows\.json$/;

/* Every file this reader can do anything with.
 *
 * A zip holds thirty-odd files and unpacking all of them is work nobody asked for, so the
 * reader is handed only the ones it wants — and that list lived in the screen, hand-written,
 * next to the code that opens the zip. The four ratings files were never added to it. So the
 * whole ratings feature, fifty tests deep, read an export that had been stripped of every
 * rating before it arrived, reported no ratings, and wrote none. The tests could not see it:
 * every one of them hands readExport a files object and never goes near a zip.
 *
 * It lives here now, beside the names it is made of, so that adding a file kind is one edit
 * rather than two, and so the list is reachable from a test. */
export const EXPORT_FILES = [
  HISTORY_FILE, TOTALS_FILE, WATCHLIST_FILE, WATCHED_MOVIES_FILE,
  RATINGS_MOVIES_FILE, RATINGS_SHOWS_FILE, RATINGS_SEASONS_FILE, RATINGS_EPISODES_FILE,
  HIDDEN_PROGRESS_FILE,
];

export const wantedFile = (name) => EXPORT_FILES.some((re) => re.test(name));

const pagesOf = (names, re) => [...names]
  .filter((n) => re.test(n))
  .sort((a, b) => (+(a.match(re)[1] || 0)) - (+(b.match(re)[1] || 0)));

export const historyFiles = (names) => pagesOf(names, HISTORY_FILE);
export const watchlistFiles = (names) => pagesOf(names, WATCHLIST_FILE);
export const watchedMovieFiles = (names) => pagesOf(names, WATCHED_MOVIES_FILE);
export const ratingFiles = (names) => [
  ...pagesOf(names, RATINGS_MOVIES_FILE),
  ...pagesOf(names, RATINGS_SHOWS_FILE),
  ...pagesOf(names, RATINGS_SEASONS_FILE),
  ...pagesOf(names, RATINGS_EPISODES_FILE),
];

/* Every rating in the export, gathered under the title it belongs to.
 *
 * A season rating names its show and a season number; an episode rating names its show and both
 * numbers. So all four files reduce to one question — which title, and which id within it —
 * and the answer is the key space the vault already stores: "t", "4", "4x13".
 *
 * Keyed by the same show and movie keys the history uses, so a rating meets its own record
 * rather than arriving as a stranger. Trakt numbers films and series separately, which is why
 * the movie half is keyed apart and not merely by the id. */
export function ratingsFromExport(files) {
  const byTitle = new Map();
  const at = (r) => (r && r.rated_at ? Date.parse(r.rated_at) || 0 : 0);

  const put = (subject, kind, id, row) => {
    const ids = idsOf(subject);
    const key = kind === "movie" ? movieKeyOf(ids) : showKeyOf(ids);
    if (!key || !subject) return;
    if (!byTitle.has(key)) {
      byTitle.set(key, {
        kind,
        name: subject.title || "",
        year: num(subject.year) || null,
        imdb: ids.imdb, tvdb: ids.tvdb, tmdb: ids.tmdb, trakt: ids.trakt,
        ratings: [],
      });
    }
    byTitle.get(key).ratings.push({ id, v: num(row.rating), w: at(row) });
  };

  const rows = (re) => pagesOf(Object.keys(files || {}), re)
    .flatMap((name) => (Array.isArray(files[name]) ? files[name] : []));

  for (const r of rows(RATINGS_MOVIES_FILE)) {
    if (r && r.movie) put(r.movie, "movie", RATING_TITLE, r);
  }
  for (const r of rows(RATINGS_SHOWS_FILE)) {
    if (r && r.show) put(r.show, "show", RATING_TITLE, r);
  }
  for (const r of rows(RATINGS_SEASONS_FILE)) {
    const n = r && r.season ? num(r.season.number) : NaN;
    if (r && r.show && Number.isFinite(n) && n >= 0) put(r.show, "show", seasonRatingKey(n), r);
  }
  for (const r of rows(RATINGS_EPISODES_FILE)) {
    const se = r && r.episode ? num(r.episode.season) : NaN;
    const ep = r && r.episode ? num(r.episode.number) : NaN;
    if (r && r.show && Number.isFinite(se) && Number.isFinite(ep) && se >= 0 && ep >= 0) {
      put(r.show, "show", `${se}x${ep}`, r);
    }
  }

  // A rating of zero is not something Trakt writes, and it means "cleared" in the vault. A file
  // carrying one is describing nothing, and taking it would silently unrate the title.
  for (const [key, row] of byTitle) {
    row.ratings = row.ratings.filter((x) => Number.isFinite(x.v) && x.v > 0 && x.v <= RATING_MAX);
    if (!row.ratings.length) byTitle.delete(key);
  }
  return byTitle;
}

/* When each show was last watched, as the totals file states it.
 *
 * The history says the same thing and says it per episode, so this is not needed for marks. It
 * is needed for the guess at what somebody is doing with a show, and it is the better source
 * for it: a history truncated by whatever Trakt was willing to export still leaves this line
 * intact, and a show whose plays did not all come through would otherwise look older than it is.
 *
 * `reset_at` travels with it. A reset history is somebody starting again from nothing on that
 * service, which is not a thing this app can reproduce, but it does say the old dates no longer
 * describe anything. */
export function lastWatchedFromTotals(watchedShows) {
  const out = new Map();
  for (const row of watchedShows || []) {
    if (!row || !row.show) continue;
    const key = showKeyOf(idsOf(row.show));
    if (!key) continue;
    const at = row.last_watched_at ? Date.parse(row.last_watched_at) || 0 : 0;
    out.set(key, { at, reset: !!row.reset_at });
  }
  return out;
}

// The shows hidden from progress, by the same keys everything else here uses.
export function hiddenShows(files) {
  const out = new Set();
  for (const name of Object.keys(files || {})) {
    if (!HIDDEN_PROGRESS_FILE.test(name)) continue;
    for (const row of Array.isArray(files[name]) ? files[name] : []) {
      if (!row || !row.show) continue;
      const key = showKeyOf(idsOf(row.show));
      if (key) out.add(key);
    }
  }
  return out;
}

export function readExport(files) {
  const pages = historyFiles(Object.keys(files || {}));
  const history = pages.flatMap((name) => (Array.isArray(files[name]) ? files[name] : []));
  if (!pages.length || !history.length) {
    throw new Error("That doesn't look like a Trakt export — no watched history inside.");
  }
  const feed = feedFromHistory(history);

  /* Movies, always, whether or not the reader has switched them on.

     The setting decides what is shown, not what is kept — the Library hides movies when it is
     off and the vault holds them either way. Skipping them at import instead would mean
     somebody who turns movies on a month later has to find the export again and re-import it,
     to get a history that was sitting in the file they already gave us. */
  const movies = moviesFromHistory(history);
  feed.shows.push(...movies);

  /* Watchlisted shows are appended, and only where the history has not already accounted for
     them. Something both watched and planned is something being watched — the history is the
     stronger claim, and it is the one carrying the marks. */
  const rowKeyOf = (r) => (r.kind === "movie" ? movieKeyOf(r) : showKeyOf(r));
  const seen = new Set(feed.shows.map(rowKeyOf));
  const watchlist = watchlistFiles(Object.keys(files || {}))
    .flatMap((name) => (Array.isArray(files[name]) ? files[name] : []));
  /* Keyed by kind, like everything else here: a film and a series can carry the same Trakt
     number, and a watchlisted film matched against the show keys would look like a title
     already accounted for and be dropped. */
  const planned = watchlistTitles(watchlist).filter((r) => !seen.has(rowKeyOf(r)));
  feed.shows.push(...planned);

  /* Ratings, hung on the rows they belong to.
   *
   * Something rated is usually something watched, so most of these meet a row that is already
   * here and simply join it. What is left is a title rated without a single play recorded —
   * Trakt takes a rating from anybody, watched or not — and those become rows of their own,
   * carrying no episodes. Treated the same as a watchlisted show for the same reason: it is a
   * real opinion held about a real title, and dropping it would mean re-importing later to get
   * something that was in the file all along. */
  const ratings = ratingsFromExport(files);
  let ratedTitles = 0;
  let ratedRows = 0;
  const rowKey = (r) => (r.kind === "movie" ? movieKeyOf(r) : showKeyOf(r));
  for (const row of feed.shows) {
    const found = ratings.get(rowKey(row));
    if (!found) continue;
    row.ratings = found.ratings;
    ratedTitles++;
    ratedRows += found.ratings.length;
    ratings.delete(rowKey(row));
  }
  for (const [, row] of ratings) {
    feed.shows.push({ ...row, episodes: [], kind: row.kind === "movie" ? "movie" : undefined });
    ratedTitles++;
    ratedRows += row.ratings.length;
  }

  /* What each row says about how it is being watched, rather than what was watched.
   *
   * Two facts, both already in the zip and neither of them a mark: when the show was last
   * watched, and whether it has been hidden from progress. An import files a show by them
   * instead of calling a thousand years-old histories "Watching". The reading is done here, in
   * one pass, and the deciding is done in domain/status-guess.js, which also needs to know how
   * much of the show is left and can only be asked that with a catalogue in hand. */
  const totals = lastWatchedFromTotals(files["watched-shows.json"]);
  const hidden = hiddenShows(files);
  for (const row of feed.shows) {
    if (row.kind === "movie") continue;
    const key = showKeyOf(row);
    const stated = key ? totals.get(key) : null;
    // The totals file first, the history second: a history Trakt truncated still leaves the
    // stated date whole, and a row read only from marks would look older than the show is.
    const fromMarks = row.episodes.reduce((m, ep) => Math.max(m, +ep.at || 0), 0);
    const lastAt = Math.max((stated && stated.at) || 0, fromMarks);
    if (lastAt) row.lastAt = lastAt;
    if ((key && hidden.has(key)) || (stated && stated.reset)) row.hidden = true;
  }

  const episodes = feed.shows.reduce((t, s) => t + s.episodes.length, 0);
  const plays = feed.shows.reduce((t, s) => t + s.episodes.reduce((n, e) => n + e.plays, 0), 0);
  /* Counted by kind rather than worked out by subtraction. The screen used to derive its show
     count as "everything, less the films, less the watchlist", which held only while the
     watchlist was shows and the films were watched ones — and stopped holding the moment the
     watchlist gained its films back. */
  const movieRows = feed.shows.filter((s) => s.kind === "movie").length;
  const showsWithHistory = feed.shows.filter((s) => s.kind !== "movie" && s.episodes.length).length;
  return {
    feed,
    episodes,
    plays,
    events: history.length,
    pages: pages.length,
    planned: planned.length,
    plannedMovies: planned.filter((r) => r.kind === "movie").length,
    shows: showsWithHistory,
    movies: movieRows,
    watchedMovies: movies.length,
    ratings: ratedRows,
    ratedTitles,
    missing: shortfall(feed, files["watched-shows.json"], watchedMovieFiles(Object.keys(files || {}))
      .flatMap((name) => (Array.isArray(files[name]) ? files[name] : []))),
    // Who wrote it, for the sentences that have to name somebody: an export that does not add
    // up is the service's shortfall to explain, and there are two services now.
    source: "Trakt",
  };
}
