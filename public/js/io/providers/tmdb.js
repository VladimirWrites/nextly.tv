// TMDB — the optional catalogue, for better artwork and wider international coverage.
//
// A TMDB key belongs to a specific application, so there's no honest way to ship one: a
// hardcoded key is a shared quota anyone can burn, and proxying every lookup would put this
// app's server in the middle of traffic it has no reason to see. So TMDB is opt-in with the
// user's own key, which travels inside the encrypted vault and goes straight from the
// browser to TMDB. TVmaze covers everyone who doesn't want to bother.
import { showKey, movieKey } from "../../domain/constants.js";
import { state } from "../../domain/store.js";

const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/";

export const id = "tmdb";
export const label = "TMDB";
export const needsKey = true;
export const hasBios = true;
export const hasKey = () => !!(state.settings && state.settings.tmdbKey);

// TMDB accepts either a v3 key or a v4 read access token. The v4 token is a JWT — three
// dot-separated segments — and belongs in the Authorization header where the v3 key is a
// query parameter. Detecting it means pasting whichever one the account page showed works.
const isV4 = (k) => (k || "").split(".").length === 3;

async function get(path, params = {}) {
  const key = (state.settings && state.settings.tmdbKey) || "";
  if (!key) throw new Error("No TMDB key. Add one in Settings, or switch to TVmaze.");
  const url = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
  const headers = { accept: "application/json" };
  if (isV4(key)) headers.authorization = "Bearer " + key;
  else url.searchParams.set("api_key", key);

  const r = await fetch(url, { headers });
  if (r.status === 401) throw new Error("TMDB rejected the key. Check it in Settings.");
  if (r.status === 404) throw new Error("Not found on TMDB.");
  if (r.status === 429) throw new Error("TMDB rate limit hit. Try again in a moment.");
  if (!r.ok) throw new Error(`TMDB error ${r.status}`);
  return r.json();
}

const img = (path, size) => (path ? IMG + size + path : null);
const yearOf = (d) => (/^(\d{4})/.test(d || "") ? +d.slice(0, 4) : null);

export async function search(query) {
  const d = await get("/search/tv", { query, include_adult: false });
  return (d.results || []).map((r) => ({
    key: showKey(id, r.id),
    src: id,
    ref: r.id,
    name: r.name || r.original_name || "",
    year: yearOf(r.first_air_date),
    overview: r.overview || "",
    poster: img(r.poster_path, "w185"),
    rating: r.vote_average || null,
    ratingSource: "TMDB",
  }));
}

/* append_to_response takes up to 20 sub-requests and seasons count as appendable resources,
   so a twelve-season show is one follow-up request instead of twelve. Only the handful of
   shows past that ceiling need extra calls. */
const APPEND_MAX = 18;   // 18 seasons + external_ids + videos = the 20-item limit

export async function fetchShow(ref) {
  const base = await get(`/tv/${encodeURIComponent(ref)}`, { append_to_response: "external_ids,videos" });
  const numbers = (base.seasons || []).map((s) => s.season_number).sort((a, b) => a - b);
  const inline = numbers.slice(0, APPEND_MAX);
  const overflow = numbers.slice(APPEND_MAX);

  const bundle = inline.length
    ? await get(`/tv/${encodeURIComponent(ref)}`, {
        append_to_response: ["external_ids", "videos", ...inline.map((n) => `season/${n}`)].join(","),
      })
    : base;

  const seasons = [];
  for (const n of inline) {
    const se = bundle[`season/${n}`];
    if (se) seasons.push(normSeason(n, se));
  }
  // Independent requests → issued together rather than one after another.
  const extra = await Promise.all(overflow.map((n) => get(`/tv/${encodeURIComponent(ref)}/season/${n}`).catch(() => null)));
  overflow.forEach((n, i) => { if (extra[i]) seasons.push(normSeason(n, extra[i])); });

  const ext = bundle.external_ids || {};
  return {
    key: showKey(id, bundle.id),
    src: id,
    ref: bundle.id,
    name: bundle.name || bundle.original_name || `Show ${ref}`,
    year: yearOf(bundle.first_air_date),
    status: bundle.status || "",
    // TMDB records no weekly slot, so nothing here claims one.
    airs: null,
    // Appended to the request the record already costs, so a TMDB-numbered show pays nothing
    // for it. A show numbered elsewhere asks separately — see videos() below.
    trailer: bestVideo(bundle.videos),
    overview: bundle.overview || "",
    network: ((bundle.networks || [])[0] || {}).name || null,
    runtime: (bundle.episode_run_time || [])[0] || null,
    genres: (bundle.genres || []).map((g) => g.name),
    poster: img(bundle.poster_path, "w500"),
    posterSm: img(bundle.poster_path, "w185"),
    backdrop: img(bundle.backdrop_path, "w1280"),
    imdb: ext.imdb_id || null,
    tvdb: ext.tvdb_id || null,
    ratings: bundle.vote_average
      ? [{
          source: "TMDB",
          score: bundle.vote_average,
          max: 10,
          votes: bundle.vote_count || 0,
          url: `https://www.themoviedb.org/tv/${bundle.id}`,
        }]
      : [],
    seasons: seasons.sort((a, b) => a.n - b.n),
  };
}

/* Is this key actually usable? /configuration is the cheapest authenticated call TMDB has,
   so it answers the question without spending a search. A key that is merely stored tells
   the user nothing — they need to know it works before they rely on it. */
/* ---- movies ----

   The same catalogue, a different half of it. Preferred over Cinemeta wherever a key exists:
   it is the one with terms, an SLA of sorts, and artwork sized for the screen asking.

   Movies are numbered separately from series here, which is why the key carries an "m" — 76600
   is a movie and also, elsewhere in the same catalogue, something else entirely. */
export async function fetchMovie(ref) {
  const d = await get(`/movie/${encodeURIComponent(ref)}`, { append_to_response: "external_ids,videos,credits" });
  return {
    key: movieKey(id, d.id),
    src: id,
    ref: d.id,
    kind: "movie",
    name: d.title || d.original_title || "Untitled",
    year: yearOf(d.release_date),
    overview: d.overview || "",
    runtime: d.runtime || null,
    genres: (d.genres || []).map((g) => g.name),
    poster: img(d.poster_path, "w500"),
    posterSm: img(d.poster_path, "w185"),
    backdrop: img(d.backdrop_path, "w1280"),
    imdb: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || null,
    tmdb: d.id,
    tvdb: null,
    ratings: d.vote_average
      ? [{ source: "TMDB", score: d.vote_average, max: 10, votes: d.vote_count || 0,
           url: `https://www.themoviedb.org/movie/${d.id}` }]
      : [],
    seasons: [],
    released: d.release_date || null,
    cast: ((d.credits && d.credits.cast) || []).slice(0, 12).map((c) => c.name),
    director: ((d.credits && d.credits.crew) || []).filter((c) => c.job === "Director").map((c) => c.name),
    trailer: bestVideo(d.videos),
  };
}

export async function searchMovies(query) {
  const d = await get("/search/movie", { query, include_adult: false });
  return (d.results || []).map((r) => ({
    key: movieKey(id, r.id),
    src: id,
    ref: r.id,
    kind: "movie",
    name: r.title || r.original_title || "",
    year: yearOf(r.release_date),
    overview: r.overview || "",
    poster: img(r.poster_path, "w185"),
    rating: r.vote_average || null,
    ratingSource: "TMDB",
  }));
}

/* A movie this device holds under another catalogue's key. One request: TMDB's find endpoint
   takes an IMDb id directly, which is what every record and every Trakt export carries. */
export async function lookupMovie({ imdb }) {
  if (!imdb) return null;
  const d = await get(`/find/${encodeURIComponent(imdb)}`, { external_source: "imdb_id" }).catch(() => null);
  const hit = d && (d.movie_results || [])[0];
  return hit ? fetchMovie(hit.id) : null;
}

export async function verifyKey() {
  await get("/configuration");
  return true;
}

/* Discovery rows TVmaze has no equivalent for. Only reachable with the user's own key, so
   the UI hides these rather than showing an empty shelf. */
const asCard = (r) => ({
  key: showKey(id, r.id),
  src: id,
  ref: r.id,
  name: r.name || r.original_name || "",
  year: yearOf(r.first_air_date),
  poster: img(r.poster_path, "w342"),
  rating: r.vote_average || null,
  ratingSource: "TMDB",
  overview: r.overview || "",
});

/* Paged, because these lists are longer than one screen of them.

   TMDB answers twenty per page and there is no way to ask for more — no per_page — so the page
   number is the only lever. The count of pages comes back with the results and is passed on
   rather than dropped, since "is there any more" is a question the screen has to answer and
   guessing it from a short page is wrong: the last page of an exact multiple of twenty is
   full. */
const paged = (d) => ({ cards: (d.results || []).map(asCard), pages: +d.total_pages || 1 });

export async function trending(window = "week", page = 1) {
  return paged(await get(`/trending/tv/${window === "day" ? "day" : "week"}`, { page }));
}

export async function popular(page = 1) {
  return paged(await get("/tv/popular", { page }));
}

/* Just the score, for a show tracked under the other catalogue. The full record would pull
   every season with it, and none of that is wanted — the episode numbering in use is the
   one the marks were recorded against, and it stays. */
export async function ratingOf(ref) {
  const d = await get(`/tv/${encodeURIComponent(ref)}`);
  if (!d.vote_average) return null;
  return {
    source: "TMDB",
    score: d.vote_average,
    max: 10,
    votes: d.vote_count || 0,
    url: `https://www.themoviedb.org/tv/${d.id}`,
  };
}

/* Just this catalogue's episode scores for one season, for a show numbered by another one.
   Scores and episode numbers, nothing else: the record in hand already has the names, the
   dates and the stills, and they belong to the catalogue that issued the numbering. */
export async function seasonScores(ref, n) {
  const d = await get(`/tv/${encodeURIComponent(ref)}/season/${encodeURIComponent(n)}`);
  return ((d && d.episodes) || []).map((ep) => ({ e: ep.episode_number, score: ep.vote_average || null }));
}

export async function topRated(page = 1) {
  return paged(await get("/tv/top_rated", { page }));
}

// Shows like this one. TMDB's "recommendations" are better curated than "similar", which is
// mostly genre overlap, so it is tried first.
export async function similar(ref, page = 1) {
  for (const path of ["recommendations", "similar"]) {
    const d = await get(`/tv/${encodeURIComponent(ref)}/${path}`, { page }).catch(() => null);
    const rows = d && (d.results || []);
    if (rows && rows.length) return paged(d);
  }
  return { cards: [], pages: 1 };
}

// Same name as on the other provider, so the layer above can ask either without knowing which.
export const refFromExternal = (ids) => tmdbIdFromExternal(ids);

/* ---- the trailer ----

   TMDB carries several videos per show and they are not equally useful: teasers, clips, opening
   titles, and often one per language. The pick is an official trailer on YouTube, the most
   recent, since a show three seasons in has a trailer for each of them and the newest is the
   one someone opening the page now would mean. Failing that, any trailer, then any teaser.

   Only YouTube is considered. TMDB also lists Vimeo occasionally, but a link is only worth
   printing if it opens something a phone can play, and the YouTube link opens the app. */
const VIDEO_RANK = { Trailer: 0, Teaser: 1 };

function bestVideo(videos) {
  const rows = ((videos && videos.results) || [])
    .filter((v) => v.site === "YouTube" && v.key && VIDEO_RANK[v.type] !== undefined);
  if (!rows.length) return null;

  rows.sort((a, b) => {
    if (!!b.official !== !!a.official) return b.official ? 1 : -1;
    if (VIDEO_RANK[a.type] !== VIDEO_RANK[b.type]) return VIDEO_RANK[a.type] - VIDEO_RANK[b.type];
    return String(b.published_at || "").localeCompare(String(a.published_at || ""));
  });

  const pick = rows[0];
  return { key: pick.key, name: pick.name || "Trailer", url: `https://www.youtube.com/watch?v=${pick.key}` };
}

// For a show this catalogue did not answer for: its own record has no videos in it, so they
// are asked for on their own.
export async function videos(ref) {
  const d = await get(`/tv/${encodeURIComponent(ref)}/videos`).catch(() => null);
  return bestVideo(d);
}

/* A season's own, which is a different thing from the show's: a returning show's trailer is
   whichever season is next, and on the page for season two that would be a trailer for
   something that happens later. Asked for only when a season page is opened, and never
   substituted with the show's — a season either has one or does not. */
export async function seasonVideos(ref, n) {
  const d = await get(`/tv/${encodeURIComponent(ref)}/season/${encodeURIComponent(n)}/videos`).catch(() => null);
  return bestVideo(d);
}

/* ---- people ----
   Shown, never stored, so the id is a cache key and nothing more. */
/* aggregate_credits rather than credits: for a series, /credits answers with whoever was
   billed on one arbitrary season, while this collects a person's roles across the whole run
   and says how many episodes each ran for. Same single request. It falls back to /credits,
   because the shape is nearly the same and an older cast list beats none. */
export async function credits(ref) {
  const d = await get(`/tv/${encodeURIComponent(ref)}/aggregate_credits`).catch(() => null)
    || await get(`/tv/${encodeURIComponent(ref)}/credits`);
  const seen = new Set();
  const out = [];
  for (const c of d.cast || []) {
    if (!c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    // Recurring players are credited under more than one name over a long run. Two is as many
    // as a caption can carry; the rest are in the count.
    const roles = (c.roles || []).map((r) => r.character).filter(Boolean);
    out.push({
      key: showKey(id, c.id),
      name: c.name || c.original_name || "",
      character: roles.length ? roles.slice(0, 2).join(" / ") : (c.character || ""),
      episodes: c.total_episode_count || null,
      image: img(c.profile_path, "w185"),
    });
  }
  return out;
}

/* combined_credits rather than tv_credits: an actor is not two people, and a page that lists
   only their television leaves half of most careers out. Each entry says which it is, so the
   page can send a movie to the movie screen and a series to the series one.

   Movies are listed whether or not the reader has movies switched on. The setting decides what
   this app tracks, not what a person has been in — and a filmography with the movies removed is
   a strange thing to show somebody. */
export async function person(ref) {
  const d = await get(`/person/${encodeURIComponent(ref)}`, { append_to_response: "combined_credits" });
  const seen = new Set();
  const shows = [];
  for (const c of ((d.combined_credits || {}).cast) || []) {
    const movie = c.media_type === "movie";
    if (!c.id || seen.has(`${c.media_type}:${c.id}`)) continue;
    seen.add(`${c.media_type}:${c.id}`);
    shows.push({
      key: movie ? movieKey(id, c.id) : showKey(id, c.id),
      kind: movie ? "movie" : undefined,
      name: (movie ? c.title || c.original_title : c.name || c.original_name) || "",
      year: yearOf(movie ? c.release_date : c.first_air_date),
      poster: img(c.poster_path, "w342"),
      character: c.character || "",
      // How much of a career an entry represents, so a walk-on does not outrank a lead.
      weight: movie ? (c.popularity || 0) : (c.episode_count || 1) * 2,
    });
  }
  /* Newest first among things that exist, and everything unreleased after them.

     Sorting on the year alone put two unannounced Avatar sequels at the head of Sam
     Worthington's page, ahead of every movie he has actually been in. TMDB carries announced
     projects years ahead, and a filmography that opens with them describes a schedule rather
     than a career. An undated credit is the same thing with the year missing, so it sorts with
     them. */
  const thisYear = new Date().getFullYear();
  const out = (c) => !c.year || c.year > thisYear;
  shows.sort((a, b) => (out(a) !== out(b) ? (out(a) ? 1 : -1) : (b.year || 0) - (a.year || 0)));

  return {
    key: showKey(id, d.id),
    src: id,
    ref: d.id,
    name: d.name || "",
    image: img(d.profile_path, "h632"),
    born: d.birthday || null,
    died: d.deathday || null,
    from: d.place_of_birth || null,
    // Comes back with the details, so it costs nothing to carry. Blank lines are collapsed to
    // single ones, since the page renders it as one block of text.
    bio: (d.biography || "").trim().replace(/\n{2,}/g, "\n") || null,
    url: `https://www.themoviedb.org/person/${d.id}`,
    shows,
  };
}

/* What else to watch, from the catalogue's own idea of it. `recommendations` rather than
   `similar`: TMDB's similar endpoint matches on genre and keywords and returns a lot of
   loosely-related filler, while recommendations is built from what people actually went on to
   watch — which is the question being asked. Falls back to similar where a movie is obscure
   enough to have no recommendations at all. */
/* One shape for every movie this provider offers up, so a card from a search, a recommendation
   and a popular row are the same object and the screens drawing them need no special cases. */
const movieCard = (r) => ({
  key: movieKey(id, r.id),
  kind: "movie",
  src: id,
  ref: r.id,
  name: r.title || r.original_title || "",
  year: yearOf(r.release_date),
  poster: img(r.poster_path, "w342"),
  rating: r.vote_average || null,
  ratingSource: "TMDB",
});

// Most-watched movies, the movie half of what `popular` already does for series.
export async function popularMovies(page = 1) {
  const d = await get("/movie/popular", { page });
  return (d.results || []).map(movieCard);
}

export async function similarMovies(ref) {
  const d = await get(`/movie/${encodeURIComponent(ref)}/recommendations`).catch(() => null)
    || await get(`/movie/${encodeURIComponent(ref)}/similar`).catch(() => null);
  return ((d && d.results) || []).slice(0, 20).map(movieCard);
}

// The people in a movie, with ids, so each one is a page rather than a name.
export async function movieCredits(ref) {
  const d = await get(`/movie/${encodeURIComponent(ref)}/credits`).catch(() => null);
  const seen = new Set();
  const out = [];
  for (const c of ((d && d.cast) || [])) {
    if (!c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({
      key: showKey(id, c.id),
      name: c.name || "",
      character: c.character || "",
      image: img(c.profile_path, "w185"),
    });
  }
  return out.slice(0, 20);
}

// Find this show's TMDB id from an id we already store, so a TVmaze-tracked show can still
// get recommendations without being re-added.
export async function tmdbIdFromExternal({ imdb, tvdb }) {
  const q = imdb ? { id: imdb, source: "imdb_id" } : tvdb ? { id: tvdb, source: "tvdb_id" } : null;
  if (!q) return null;
  const d = await get(`/find/${encodeURIComponent(q.id)}`, { external_source: q.source }).catch(() => null);
  const hit = d && (d.tv_results || [])[0];
  return hit ? hit.id : null;
}

// Resolve from an external id, so a library recorded elsewhere can be rebuilt here.
export async function lookup({ imdb, tvdb }) {
  const q = imdb ? { id: imdb, source: "imdb_id" } : tvdb ? { id: tvdb, source: "tvdb_id" } : null;
  if (!q) return null;
  try {
    const d = await get(`/find/${encodeURIComponent(q.id)}`, { external_source: q.source });
    const hit = (d.tv_results || [])[0];
    return hit ? fetchShow(hit.id) : null;
  } catch (e) {
    return null;
  }
}

// Keep only what the app renders. TMDB season payloads carry stills, crew and guest stars
// that would multiply the cache size for nothing.
function normSeason(n, se) {
  return {
    n,
    name: se.name || `Season ${n}`,
    air: se.air_date || null,
    episodes: (se.episodes || []).map((ep) => ({
      e: ep.episode_number,
      name: ep.name || "",
      air: ep.air_date || null,
      runtime: ep.runtime || null,
      overview: ep.overview || "",
      score: ep.vote_average || null,
      still: img(ep.still_path, "w780"),
      // TMDB collects specials into season 0 rather than flagging them per episode.
      special: n === 0,
    })),
  };
}
