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
//                         shows somebody means to start and has no history for. Empty until you
//                         put something in it, which is why the first export tested against had
//                         no such file and this was missed.
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

// Absent is not zero, and a season number of 0 is a real season — specials.
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
const showKeyOf = (ids) =>
  ids.trakt ? `trakt:${ids.trakt}`
    : ids.imdb ? `imdb:${ids.imdb}`
      : ids.tvdb ? `tvdb:${ids.tvdb}`
        : ids.tmdb ? `tmdb:${ids.tmdb}` : null;

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

/* The watchlist: shows meant for later.

   These carry no episodes, which is the whole point of them, and that is exactly how they are
   handed on — a row with an empty episode list. Everything downstream then does the right thing
   without being told about watchlists at all: matching finds nothing to mark, adding files the
   show under this app's default status, which is "planned", and applying an empty plan promotes
   nothing, so a show meant for later stays meant for later.

   Movies, seasons and single episodes can sit in a Trakt watchlist too. Only shows are taken. */
export function watchlistShows(list) {
  const out = [];
  for (const row of list || []) {
    if (!row || row.type !== "show" || !row.show) continue;
    const ids = idsOf(row.show);
    if (!showKeyOf(ids)) continue;
    out.push({
      name: row.show.title || "",
      year: num(row.show.year) || null,
      imdb: ids.imdb,
      tvdb: ids.tvdb,
      tmdb: ids.tmdb,
      trakt: ids.trakt,
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
export function shortfall(feed, watchedShows) {
  const byKey = new Map();
  for (const row of feed.shows) {
    const key = showKeyOf({ trakt: row.trakt, imdb: row.imdb, tvdb: row.tvdb, tmdb: row.tmdb });
    if (key) byKey.set(key, row);
  }

  const missing = [];
  for (const row of watchedShows || []) {
    if (!row || !row.show) continue;
    const ids = idsOf(row.show);
    const key = showKeyOf(ids);
    if (!key) continue;
    const found = byKey.get(key);
    const plays = found ? found.episodes.reduce((t, ep) => t + ep.plays, 0) : 0;
    const claimed = num(row.plays) || 0;
    if (plays < claimed) {
      missing.push({ name: row.show.title || "", had: plays, claimed });
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

export function historyFiles(names) {
  return [...names]
    .filter((n) => HISTORY_FILE.test(n))
    .sort((a, b) => (+(a.match(HISTORY_FILE)[1] || 0)) - (+(b.match(HISTORY_FILE)[1] || 0)));
}

export function readExport(files) {
  const pages = historyFiles(Object.keys(files || {}));
  const history = pages.flatMap((name) => (Array.isArray(files[name]) ? files[name] : []));
  if (!pages.length || !history.length) {
    throw new Error("That doesn't look like a Trakt export — no watched history inside.");
  }
  const feed = feedFromHistory(history);

  /* Watchlisted shows are appended, and only where the history has not already accounted for
     them. Something both watched and planned is something being watched — the history is the
     stronger claim, and it is the one carrying the marks. */
  const seen = new Set(feed.shows.map((r) => showKeyOf(r)));
  const planned = watchlistShows(files["lists-watchlist.json"])
    .filter((r) => !seen.has(showKeyOf(r)));
  feed.shows.push(...planned);

  const episodes = feed.shows.reduce((t, s) => t + s.episodes.length, 0);
  const plays = feed.shows.reduce((t, s) => t + s.episodes.reduce((n, e) => n + e.plays, 0), 0);
  return {
    feed,
    episodes,
    plays,
    events: history.length,
    pages: pages.length,
    planned: planned.length,
    missing: shortfall(feed, files["watched-shows.json"]),
  };
}
