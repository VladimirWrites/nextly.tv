// TVmaze — the default catalogue.
//
// No API key exists to leak, abuse, or ask you to register for, and the rate limit applies
// per calling IP. Since the browser calls TVmaze directly, that limit is the user's own:
// there is no shared quota for this app to run out of, and no proxy for it to pay for.
//
// One request returns the show and every episode, and the payload already carries the IMDb
// and TheTVDB ids — which is what keeps a library portable if this catalogue ever goes away.
import { showKey } from "../../domain/constants.js";

const API = "https://api.tvmaze.com";
export const id = "tvmaze";
export const label = "TVmaze";
export const needsKey = false;
// Nothing to show and no endpoint that would: the page leaves the space out rather than
// holding it open for text that never arrives.
export const hasBios = false;

async function get(path) {
  const r = await fetch(API + path, { headers: { accept: "application/json" } });
  if (r.status === 404) throw new Error("Not found on TVmaze.");
  if (r.status === 429) throw new Error("TVmaze rate limit hit. Try again in a few seconds.");
  if (!r.ok) throw new Error(`TVmaze error ${r.status}`);
  return r.json();
}

// TVmaze summaries are HTML fragments. The app renders text nodes, so the tags are stripped
// here rather than trusted anywhere downstream.
const text = (html) =>
  String(html || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

const yearOf = (d) => (/^(\d{4})/.test(d || "") ? +d.slice(0, 4) : null);

/* ---- typing, against a matcher built for finished words ----

   TVmaze matches whole words. Its own documentation puts the fuzziness at one character for a
   word over one character and two for a word over five, which is generous for a typo and fatal
   for a fragment: "breaking bad" finds the show, "breaking ba" finds nothing at all, and
   "game of thr" finds The Name of the Game. Every keystroke of a two-word title spends time in
   that state, and there is no parameter to ask for anything else — q is the only one the
   endpoint takes.

   So a query whose last word is a stub is treated as unfinished rather than as a question. The
   screen keeps what it has, and where one is asked anyway and comes back empty, it is asked
   again without the stub. */
export function looksIncomplete(query) {
  const words = String(query || "").trim().split(/\s+/).filter(Boolean);
  return words.length > 1 && words[words.length - 1].length <= 2;
}

const withoutStub = (query) =>
  String(query || "").trim().split(/\s+/).filter(Boolean).slice(0, -1).join(" ");

export async function search(query) {
  let rows = await get("/search/shows?q=" + encodeURIComponent(query));
  if (!(rows || []).length && looksIncomplete(query)) {
    // The stub is what emptied it: ask for the words that were finished.
    rows = await get("/search/shows?q=" + encodeURIComponent(withoutStub(query))).catch(() => []);
  }
  return (rows || []).map(({ show }) => ({
    key: showKey(id, show.id),
    src: id,
    ref: show.id,
    name: show.name || "",
    year: yearOf(show.premiered),
    overview: text(show.summary),
    poster: (show.image && show.image.medium) || null,
    rating: (show.rating && show.rating.average) || null,
    ratingSource: "TVmaze",
    // Carried here because search returns the whole show, externals included. It costs
    // nothing and lets a result be recognised as one already tracked under TMDB's numbering.
    imdb: (show.externals && show.externals.imdb) || null,
    tvdb: (show.externals && show.externals.thetvdb) || null,
  }));
}

/* This catalogue's own id for a show it may only know by a portable one. Cheap, and cached by
   the caller, so asking it for a cast list costs one extra request the first time only. */
export async function refFromExternal({ imdb, tvdb }) {
  const q = imdb ? "imdb=" + encodeURIComponent(imdb) : tvdb ? "thetvdb=" + encodeURIComponent(tvdb) : null;
  if (!q) return null;
  const d = await get("/lookup/shows?" + q).catch(() => null);
  return d && d.id ? d.id : null;
}

/* ---- people ----
   Cast is only ever shown, never stored, so a person needs no identity that survives anything:
   the id is the id of whichever catalogue answered, used as a cache key and nothing more.
   Switching catalogue leaves a cold cache, not a wrong record. */
export async function credits(ref) {
  const rows = await get(`/shows/${encodeURIComponent(ref)}/cast`);
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const p = row.person || {};
    if (!p.id || seen.has(p.id)) continue;      // one entry per person, however many roles
    seen.add(p.id);
    out.push({
      key: showKey(id, p.id),
      name: p.name || "",
      character: (row.character && row.character.name) || "",
      image: (p.image && p.image.medium) || null,
    });
  }
  return out;
}

export async function person(ref) {
  // Two requests here, where TMDB manages one: the details carry no credits, and the credits
  // carry no details.
  const [who, credits_] = await Promise.all([
    get(`/people/${encodeURIComponent(ref)}`),
    get(`/people/${encodeURIComponent(ref)}/castcredits?embed=show`).catch(() => []),
  ]);

  const shows = [];
  const seen = new Set();
  for (const c of credits_ || []) {
    const sh = (c._embedded || {}).show;
    if (!sh || !sh.id || seen.has(sh.id)) continue;
    seen.add(sh.id);
    shows.push({
      key: showKey(id, sh.id),
      name: sh.name || "",
      year: yearOf(sh.premiered),
      poster: (sh.image && sh.image.medium) || null,
      // TVmaze does not say which part they played on this endpoint, and asking per show would
      // cost a request each. The show is the useful half.
      character: "",
    });
  }
  shows.sort((a, b) => (b.year || 0) - (a.year || 0));

  return {
    key: showKey(id, who.id),
    src: id,
    ref: who.id,
    name: who.name || "",
    // TVmaze holds no biography for anyone — not on this endpoint and not on another one — so
    // the page shows none while this is the catalogue in use, rather than a request that would
    // come back empty.
    bio: null,
    image: (who.image && who.image.original) || (who.image && who.image.medium) || null,
    born: who.birthday || null,
    died: who.deathday || null,
    from: (who.country && who.country.name) || null,
    url: who.url || null,
    shows,
  };
}

/* The same, from the other side: TVmaze can be reached by IMDb id without a key, so a show
   tracked under TMDB can still show what TVmaze thinks of it. */
export async function ratingByImdb(imdbId) {
  if (!imdbId) return null;
  const d = await get("/lookup/shows?imdb=" + encodeURIComponent(imdbId));
  const score = d && d.rating && d.rating.average;
  if (!score) return null;
  return { source: "TVmaze", score, max: 10, url: d.url || null };
}

export async function fetchShow(ref) {
  const d = await get(`/shows/${encodeURIComponent(ref)}?embed=episodes`);
  return normalize(d);
}

/* One day of the streaming schedule, with each episode's show embedded. 36 KB gzipped, so a
   fortnight of them is cheaper than the 9.8 MB /schedule/full — and this is the only
   discovery data TVmaze offers, since it has no trending, popular or similar endpoints. */
export async function scheduleOn(date) {
  return get("/schedule/web?date=" + encodeURIComponent(date));
}

/* One request that reports every show TVmaze has touched in a window, as { id: unixSeconds }.
   This is what stops a library refresh from costing one request per show: ask once what
   changed, then refetch only the handful that did. A 500-show library normally goes from 500
   requests to 1. */
export async function updatedSince(since = "week") {
  const d = await get("/updates/shows?since=" + encodeURIComponent(since));
  const out = new Map();
  for (const [ref, secs] of Object.entries(d || {})) out.set(String(ref), (+secs || 0) * 1000);
  return out;
}

// Resolve a show from an external id — how a library rebuilds itself against this catalogue
// when the one it was recorded in is gone.
export async function lookup({ imdb, tvdb }) {
  const q = imdb ? "imdb=" + encodeURIComponent(imdb) : tvdb ? "thetvdb=" + encodeURIComponent(tvdb) : null;
  if (!q) return null;
  try {
    /* Two requests, and both are needed. /lookup/shows takes no embed parameter, so it answers
       with the show and nothing else — normalizing that gives a record with a name, a poster
       and a status, and not one episode. Which is worse than an outright failure, because it
       renders as a real show reporting 0/0 with no barcode and nothing to say why. The id it
       hands back is what the second request is for. */
    const d = await get("/lookup/shows?" + q);
    return d && d.id ? await fetchShow(d.id) : null;
  } catch (e) { return null; }
}

function normalize(d) {
  const ext = d.externals || {};
  const eps = (d._embedded && d._embedded.episodes) || [];
  const seasons = new Map();

  for (const ep of eps) {
    // TVmaze keeps specials inside their real season and flags them by type, rather than
    // collecting them into a season 0 the way TMDB does.
    const special = ep.type ? ep.type !== "regular" : false;
    const n = ep.season == null ? 1 : ep.season;
    if (!seasons.has(n)) seasons.set(n, []);
    seasons.get(n).push({
      e: ep.number == null ? 0 : ep.number,
      name: ep.name || "",
      air: ep.airdate || null,
      runtime: ep.runtime || null,
      overview: text(ep.summary),
      /* For the episode's own page rather than for the list: a score and a still beside every
         row made the show page unreadable, and both are already in this payload. */
      score: (ep.rating && ep.rating.average) || null,
      still: (ep.image && (ep.image.original || ep.image.medium)) || null,
      special,
    });
  }

  return {
    key: showKey(id, d.id),
    src: id,
    ref: d.id,
    name: d.name || `Show ${d.id}`,
    year: yearOf(d.premiered),
    status: d.status || "",
    /* The slot it goes out in, for the season pages. TVmaze often knows the days without the
       time, so the time is optional and the days are not. */
    // TVmaze indexes no video of any kind.
    trailer: null,
    airs: (d.schedule && (d.schedule.days || []).length)
      ? { days: d.schedule.days, time: d.schedule.time || "" }
      : null,
    overview: text(d.summary),
    network: (d.network && d.network.name) || (d.webChannel && d.webChannel.name) || null,
    runtime: d.averageRuntime || d.runtime || null,
    genres: d.genres || [],
    poster: (d.image && d.image.original) || null,
    posterSm: (d.image && d.image.medium) || null,
    backdrop: null,                       // TVmaze has no backdrop art; the UI falls back to the poster
    imdb: ext.imdb || null,
    tvdb: ext.thetvdb || null,
    /* A score with no source is folklore. Each one carries where it came from and a link
       to it, as a list rather than a field, so a show can carry more than one. */
    ratings: d.rating && d.rating.average
      ? [{ source: "TVmaze", score: d.rating.average, max: 10, url: d.url || null }]
      : [],
    seasons: [...seasons.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, episodes]) => ({
        n,
        name: `Season ${n}`,
        air: (episodes[0] || {}).air || null,
        episodes: episodes.sort((a, b) => a.e - b.e),
      })),
  };
}
