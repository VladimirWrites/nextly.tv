// Cinemeta: movies, without a key.
//
// TVmaze has no movies — it is a television database and says so in its name — so the catalogue
// that costs nothing to use cannot answer for them. TMDB can, and needs a key. That would have
// made movies a feature most readers could not turn on, which is a poor kind of feature.
//
// Cinemeta is Stremio's metadata add-on: open, keyless, and answering CORS preflights with
// `access-control-allow-origin: *`, so the browser can talk to it directly the way it talks to
// TVmaze. Stremio publish a tutorial teaching third parties to call it and describe it as an
// alternative to OMDb and TMDB, and their add-on protocol exists so that clients other than
// theirs can use it. It has been running since about 2015.
//
// What they do not publish is a rate limit, a term of service, or any promise that it will keep
// answering. So it is the fallback and never the first choice: a reader with a TMDB key never
// touches it, and if it goes away, movies degrade for the readers who had no key rather than
// breaking for everyone. That is the same bargain the whole provider layer exists to make.
//
// Keyed by IMDb id, which is the happy part: the portable id is the primary key, so nothing
// here needs translating into what the vault already stores.
import { movieKey } from "../../domain/constants.js";

const API = "https://v3-cinemeta.strem.io";

export const id = "cinemeta";
export const label = "Cinemeta";
export const needsKey = false;
export const hasKey = () => true;

const RETRIES = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The same shape of politeness the TVmaze client learned the hard way: a refusal pauses every
   request rather than only the one that failed, or the rest of the burst causes the next one.
   Nothing is paced while it is answering. */
let pausedUntil = 0;
let strikes = 0;

const gate = async () => {
  while (Date.now() < pausedUntil) await sleep(pausedUntil - Date.now() + 10);
};

function refused() {
  strikes = Math.min(strikes + 1, 5);
  pausedUntil = Math.max(pausedUntil, Date.now() + Math.min(8000, 500 * (2 ** strikes)));
}

const allowed = () => { if (strikes) strikes--; };

async function get(path, attempt = 0) {
  await gate();
  let r;
  try {
    r = await fetch(API + path, { headers: { accept: "application/json" } });
  } catch (e) {
    refused();
    if (attempt < RETRIES) return get(path, attempt + 1);
    throw new Error("Couldn't reach Cinemeta.");
  }
  if (r.status === 429 || r.status >= 500) {
    refused();
    if (attempt < RETRIES) return get(path, attempt + 1);
    throw new Error("Cinemeta is busy. Try again in a moment.");
  }
  allowed();
  if (r.status === 404) throw new Error("Not found on Cinemeta.");
  if (!r.ok) throw new Error(`Cinemeta error ${r.status}`);
  return r.json();
}

// "192 min" — a string, and the app counts minutes.
const minutes = (s) => {
  const m = /(\d+)/.exec(String(s || ""));
  return m ? +m[1] : null;
};

const yearOf = (v) => {
  const m = /^(\d{4})/.exec(String(v || ""));
  return m ? +m[1] : null;
};

/* A movie, in the shape io/cache.js documents for a show, with no seasons.
   Nothing downstream has to know which catalogue answered. */
function normalize(meta) {
  const ref = meta.imdb_id || meta.id;
  return {
    key: movieKey(id, ref),
    src: id,
    ref,
    kind: "movie",
    name: meta.name || "Untitled",
    year: yearOf(meta.year) || yearOf(meta.released) || null,
    overview: meta.description || "",
    runtime: minutes(meta.runtime),
    genres: meta.genres || meta.genre || [],
    poster: meta.poster || null,
    posterSm: meta.poster || null,
    backdrop: meta.background || null,
    imdb: meta.imdb_id || (String(meta.id || "").startsWith("tt") ? meta.id : null),
    // Cinemeta carries TMDB's id as well, so a record made here can still be recognised as the
    // same movie if the reader later adds a TMDB key.
    tmdb: meta.moviedb_id ? +meta.moviedb_id : null,
    tvdb: null,
    // Its own opinion, named — a number with no source is folklore.
    ratings: meta.imdbRating ? [{ source: "IMDb", score: +meta.imdbRating, max: 10 }] : [],
    seasons: [],
    released: meta.released || null,
    cast: meta.cast || [],
    director: meta.director || [],
  };
}

/* An id it has never heard of comes back 200 with an empty meta object rather than a 404, so
   the absence has to be recognised by what is missing from it. A movie with no name is not a
   movie, and taking it at face value would have filed "Untitled" in somebody's library. */
export async function fetchMovie(ref) {
  const d = await get(`/meta/movie/${encodeURIComponent(ref)}.json`);
  const meta = d && d.meta;
  if (!meta || !meta.name) throw new Error("Not found on Cinemeta.");
  return normalize(meta);
}

export async function search(query) {
  const d = await get(`/catalog/movie/top/search=${encodeURIComponent(query)}.json`).catch(() => null);
  return ((d && d.metas) || []).map((m) => ({
    key: movieKey(id, m.imdb_id || m.id),
    src: id,
    ref: m.imdb_id || m.id,
    kind: "movie",
    name: m.name || "",
    year: yearOf(m.year) || yearOf(m.releaseInfo) || null,
    overview: m.description || "",
    poster: m.poster || null,
    rating: m.imdbRating ? +m.imdbRating : null,
    ratingSource: "IMDb",
  }));
}

/* Its "top" catalogue, which the manifest labels Popular. Paged by an offset rather than a page
   number, and it answers a redirect before it answers with JSON — fetch follows that on its own,
   which curl does not, and is why this looked broken the first time it was asked for. */
export async function popularMovies(skip = 0) {
  const at = skip ? `/catalog/movie/top/skip=${skip}.json` : "/catalog/movie/top.json";
  const d = await get(at).catch(() => null);
  return ((d && d.metas) || []).map((m) => ({
    key: movieKey(id, m.imdb_id || m.id),
    kind: "movie",
    src: id,
    ref: m.imdb_id || m.id,
    name: m.name || "",
    year: yearOf(m.year) || yearOf(m.releaseInfo) || null,
    poster: m.poster || null,
    rating: m.imdbRating ? +m.imdbRating : null,
    ratingSource: "IMDb",
  }));
}

// The portable id is the key here, so placing a movie from elsewhere costs one request and no
// searching. tvdb is ignored: Cinemeta does not index it.
export async function lookup({ imdb }) {
  if (!imdb) return null;
  return fetchMovie(imdb).catch(() => null);
}
