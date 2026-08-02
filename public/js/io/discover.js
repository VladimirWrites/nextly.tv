// Fetching for the discovery screen.
//
// TVmaze has no trending, popular or similar endpoints — only the schedule. So the keyless
// feeds are built from it: a fortnight of days, ranked by each show's own popularity weight.
// A day is about 36 KB gzipped, which is why this fetches dated days rather than the 9.8 MB
// /schedule/full.
//
// Results are held for the session. Discovery is browsing, not bookkeeping: a slightly stale
// list costs nothing, and refetching a fortnight every time the tab is opened costs a lot.
import * as tvmaze from "./providers/tvmaze.js";
import * as tmdb from "./providers/tmdb.js";
import { activeProvider } from "./meta.js";
import { premieres, airing } from "../domain/discover.js";

const DAYS_AHEAD = 14;
const TTL = 6 * 60 * 60 * 1000;

const cache = new Map();   // key -> { at, value }

async function once(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const isoDay = (offset, now) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);

// A fortnight of schedule, fetched a few days at a time so the first rows can render while
// the rest arrive.
async function scheduleWindow(now = Date.now()) {
  return once("schedule", async () => {
    const days = Array.from({ length: DAYS_AHEAD }, (_, i) => isoDay(i, now));
    const out = [];
    const BATCH = 4;
    for (let i = 0; i < days.length; i += BATCH) {
      const chunk = await Promise.all(
        days.slice(i, i + BATCH).map((d) => tvmaze.scheduleOn(d).catch(() => [])),
      );
      chunk.forEach((list) => out.push(...list));
    }
    return out;
  });
}

/* ---- keyless feeds, from the schedule ----
   Gated on TVmaze being the catalogue in use, not merely on it being available. These cards
   carry tvmaze: keys, and opening one adds a show under TVmaze's episode numbering — so
   offering them while TMDB is selected quietly hands back the wrong catalogue. */

const usesTvmaze = () => activeProvider().id === "tvmaze";

export async function premiereFeed(opts = {}) {
  if (!usesTvmaze()) return [];
  return premieres(await scheduleWindow(opts.now), opts);
}

export async function airingFeed(opts = {}) {
  if (!usesTvmaze()) return [];
  const now = opts.now || Date.now();
  const today = isoDay(0, now);
  const day = await once("today", () => tvmaze.scheduleOn(today).catch(() => []));
  return airing(day, opts);
}

/* One shape for both catalogues, so a screen showing a whole feed does not have to know which
   kind it is looking at.

   TMDB pages on the server, twenty at a time, and says how many pages there are. TVmaze does
   not page at all: those rows are computed here from a schedule window this client already
   holds, so page one is everything there is and asking for page two is asking for nothing. The
   row shows the first two dozen; the whole-feed screen lifts that and gets the rest for free,
   without a single extra request. */
export async function feedPage(id, page = 1, opts = {}) {
  // opts carries the limit through untouched: the row leaves it alone and takes the domain
  // default of two dozen, the whole-feed screen passes Infinity and gets the lot.
  if (id === "premieres") return { cards: page > 1 ? [] : await premiereFeed(opts), more: false };
  if (id === "today") return { cards: page > 1 ? [] : await airingFeed(opts), more: false };
  const fn = { trending: trendingFeed, popular: popularFeed, toprated: topRatedFeed }[id];
  if (!fn) return { cards: [], more: false };
  const { cards, pages } = await fn(page);
  return { cards, more: page < pages };
}

/* ---- feeds that need the user's TMDB key ---- */

/* Whether TMDB is actually the catalogue in use — not merely whether a key is stored.
   Checking only for a key meant these rows survived switching back to TVmaze, which
   contradicted Settings telling the user in as many words that the key was not being used. */
export const hasTmdb = () => activeProvider().id === "tmdb";

const NO_MORE = { cards: [], pages: 1 };

export async function trendingFeed(page = 1) {
  if (!hasTmdb()) return NO_MORE;
  return once(`trending:${page}`, () => tmdb.trending("week", page).catch(() => NO_MORE));
}

export async function popularFeed(page = 1) {
  if (!hasTmdb()) return NO_MORE;
  return once(`popular:${page}`, () => tmdb.popular(page).catch(() => NO_MORE));
}

// Keeps the screen three rows deep on TMDB too. Not a mirror of the TVmaze schedule row —
// TMDB has no comparable listing, and the highest-rated shows are worth more here than a
// literal match would be.
export async function topRatedFeed(page = 1) {
  if (!hasTmdb()) return NO_MORE;
  return once(`toprated:${page}`, () => tmdb.topRated(page).catch(() => NO_MORE));
}

/* Shows like this one. A TVmaze-tracked show has no TMDB id, but it does carry an IMDb id,
   so one extra request maps it across — which is the whole reason those ids are stored in
   the vault rather than only a catalogue's own numbering. */
export async function similarTo(show, page = 1) {
  if (!hasTmdb()) return NO_MORE;
  return once(`similar:${show.id}:${page}`, async () => {
    let ref = show.src === "tmdb" ? show.ref : null;
    if (!ref) ref = await tmdb.tmdbIdFromExternal({ imdb: show.imdb, tvdb: show.tvdb }).catch(() => null);
    if (!ref) return NO_MORE;
    return tmdb.similar(ref, page).catch(() => NO_MORE);
  });
}

// Dropped when the library changes, so a show just tracked stops being offered — and when
// the catalogue or its key changes, since the held results came from the old one.
/* Told when the feeds are dropped, so anything drawn from them can be dropped too — the screen
   holds its own copy of what it last painted, and a stale row is worse than a placeholder. */
const onDrop = new Set();

export const onForget = (fn) => onDrop.add(fn);

export function forget() {
  cache.clear();
  for (const fn of onDrop) fn();
}
