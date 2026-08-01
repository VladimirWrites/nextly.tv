// TMDB — the optional catalogue, for better artwork and wider international coverage.
//
// A TMDB key belongs to a specific application, so there's no honest way to ship one: a
// hardcoded key is a shared quota anyone can burn, and proxying every lookup would put this
// app's server in the middle of traffic it has no reason to see. So TMDB is opt-in with the
// user's own key, which travels inside the encrypted vault and goes straight from the
// browser to TMDB. TVmaze covers everyone who doesn't want to bother.
import { showKey } from "../../domain/constants.js";
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

export async function trending(window = "week") {
  const d = await get(`/trending/tv/${window === "day" ? "day" : "week"}`);
  return (d.results || []).map(asCard);
}

export async function popular() {
  const d = await get("/tv/popular");
  return (d.results || []).map(asCard);
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

export async function topRated() {
  const d = await get("/tv/top_rated");
  return (d.results || []).map(asCard);
}

// Shows like this one. TMDB's "recommendations" are better curated than "similar", which is
// mostly genre overlap, so it is tried first.
export async function similar(ref) {
  for (const path of ["recommendations", "similar"]) {
    const d = await get(`/tv/${encodeURIComponent(ref)}/${path}`).catch(() => null);
    const rows = d && (d.results || []);
    if (rows && rows.length) return rows.map(asCard);
  }
  return [];
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

export async function person(ref) {
  const d = await get(`/person/${encodeURIComponent(ref)}`, { append_to_response: "tv_credits" });
  const seen = new Set();
  const shows = [];
  for (const c of ((d.tv_credits || {}).cast) || []) {
    if (!c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    shows.push({
      key: showKey(id, c.id),
      name: c.name || c.original_name || "",
      year: yearOf(c.first_air_date),
      poster: img(c.poster_path, "w342"),
      character: c.character || "",
    });
  }
  shows.sort((a, b) => (b.year || 0) - (a.year || 0));

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
