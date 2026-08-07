// The verbs. Every view calls these rather than touching the store or the network itself,
// so "mark watched" means exactly one thing no matter which screen you tapped it from.
import { state } from "../domain/store.js";
import { findShow } from "../domain/schema.js";
import { markEpisode, markUpTo, markAllAired, markSeason, addShow, setWatchDates, removeShow, setStatus, startRewatch, cancelRewatch, markMovie, setRating } from "../domain/model.js";
import { nextUp, passOf, completion, newlyFinished, showProgress } from "../domain/progress.js";
import { epCode, parseEpKey, ordinal, parseShowKey, fmtDuration, isMovie } from "../domain/constants.js";
import { scheduleSync } from "../io/storage.js";
import * as cache from "../io/cache.js";
import * as meta from "../io/meta.js";
import * as discover from "../io/discover.js";
import { toast, setProgress } from "./dom.js";
import { celebrate } from "./celebrate.js";

/* A record already cached may predate the second opinion — it was fetched before a TMDB key
   was added, or before the two copies of the show were folded together. Filled in behind the
   paint, once, and only when there is something missing to fill. */
const topping = new Set();

function topUpScores(id, m) {
  if (topping.has(id) || !m.imdb) return;
  const sources = new Set((m.ratings || []).map((r) => r.source));
  if (sources.has("TMDB") && sources.has("TVmaze")) return;
  topping.add(id);
  meta.withOtherScores(m)
    .then(async (next) => {
      if (next === m || (next.ratings || []).length === (m.ratings || []).length) return;
      await cache.putMeta(next);
      repaint();
    })
    .catch(() => {})
    .finally(() => topping.delete(id));
}

// The UI registers how to repaint after state changes.
let repaint = () => {};
export function setRepaint(fn) { repaint = fn; }

export const opts = () => ({ specials: !!(state.settings && state.settings.specials) });

/* ---- metadata ----
   The cache is the source the UI reads; the catalogue only refreshes it. Views therefore
   never wait on the network to paint — a stale episode list renders immediately and updates
   in place when the fetch lands. */

const inflight = new Map();

/* `scores` asks the other catalogue what it thinks of the same show, once the record is in
   hand. Only the show page passes it: the library fetches metadata for everything it holds,
   and a second request per show to fill in a number nothing on that screen displays would be
   a lot of traffic for nothing. */
export async function ensureMeta(id, { force = false, scores = false } = {}) {
  id = String(id);
  const have = cache.getMeta(id);
  if (have && !force && !cache.isStale(have, cache.fetchedAt(id))) {
    if (scores) topUpScores(id, have);
    return have;
  }
  if (inflight.has(id)) return inflight.get(id);

  // The portable ids travel with the request, so a catalogue that can no longer be reached
  // can be stood in for by one that can.
  const sh = findShow(state, id);
  const p = meta.fetchShow(id, sh ? { alt: sh.alt, imdb: sh.imdb, tvdb: sh.tvdb } : {})
    .then((m) => (scores ? meta.withOtherScores(m).catch(() => m) : m))
    // Writing to the cache is the whole point of the fetch: every view reads metadata from
    // the cache, never from here. Without this the request succeeds, the repaint runs, and
    // the views still find nothing — which looks exactly like a load that never finishes.
    .then(async (m) => { await cache.putMeta(m); repaint(); return m; })
    .catch((e) => {
      if (!have) toast(e.message);       // a background refresh fails quietly; a first load doesn't
      return have;
    })
    .finally(() => inflight.delete(id));

  inflight.set(id, p);
  return have || p;                       // stale data now beats correct data later
}

// Run tasks a few at a time. A library of 500 shows must not open 500 connections, and a
// pool keeps the first results arriving immediately instead of after the whole set.
async function pool(items, worker, size = 4) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
}

/* Bring the library's metadata up to date at boot.
 *
 * The naive version — check every show for staleness and refetch — costs one request per
 * show on every single load. Instead:
 *
 *   1. Shows with nothing cached are fetched individually, because there is no way around
 *      needing their episode lists. Active shows go first: they are what Up next ranks, so
 *      the screen the user is looking at fills in before the rest of the library.
 *   2. Everything already cached is checked with ONE request per catalogue — TVmaze reports
 *      every show it has touched in a window — and only the handful that actually changed
 *      upstream are refetched. A 500-show library costs 1 request instead of 500.
 *
 * Views repaint as each result lands, so this never blocks the UI.
 */
let lastSweep = 0;
const SWEEP_EVERY = 30 * 60 * 1000;

/* Whichever kind the record is.
 *
 * ensureMeta asks a catalogue for a series, and a movie key handed to it resolves to
 * `/tv/m76600` — a 404, and on a first load a toast about it. So a movie added on one device
 * arrived on the next one as a name with no poster, no year and no synopsis, and stayed that
 * way until somebody opened its page, which is the one screen that asked the right question.
 *
 * The vault syncs records, not metadata: every device fetches its own artwork. That is the
 * design, and it means the hydrate is the only thing standing between a synced record and a
 * blank card. */
const ensureRecord = (sh, opts) => (isMovie(sh) ? ensureMovie(sh.id, opts) : ensureMeta(sh.id, opts));

export async function hydrateLibrary() {
  const shows = state.shows || [];
  if (!shows.length) return;

  const missing = shows.filter((sh) => !cache.has(sh.id));
  const cached = shows.filter((sh) => cache.has(sh.id));

  // Active first — those are the rows Up next needs to rank.
  const byNeed = [...missing].sort((a, b) => (a.st === "active" ? 0 : 1) - (b.st === "active" ? 0 : 1));

  // Filling in what is missing has to happen every time this runs, because shows arrive
  // after boot too — from a sync, or a merge with another device. Asking the catalogue what
  // changed upstream is a different question, costs a request per catalogue, and only needs
  // answering occasionally.
  const due = Date.now() - lastSweep > SWEEP_EVERY;
  const changed = due ? await staleFromCatalogue(cached) : [];
  if (due) lastSweep = Date.now();

  const total = byNeed.length + changed.length;
  let done = 0;
  const step = () => setProgress(++done, total);
  if (total) setProgress(0, total);

  await pool(byNeed, (sh) => ensureRecord(sh).finally(step));
  await pool(changed, (sh) => ensureRecord(sh, { force: true }).finally(step));

  setProgress(total, total);
  repaint();
}

// Which cached shows actually changed upstream. One bulk request per catalogue that offers
// one; anything else falls back to the per-show age check.
async function staleFromCatalogue(cached) {
  /* A series question: what has aired, what got renamed, which episode moved. No movie
     catalogue answers it — TMDB's changes feed is per-kind and Cinemeta has none — and asking
     it about a movie would put a movie's ref up against a list of series ids, where a match is
     a coincidence rather than a fact. Movies fall through to the age check below. */
  const series = cached.filter((sh) => !isMovie(sh));
  const sources = [...new Set(series.map((sh) => sh.src))];
  const updates = new Map();
  await Promise.all(sources.map(async (src) => updates.set(src, await meta.updatedSince(src, "week"))));

  return cached.filter((sh) => {
    if (isMovie(sh)) return cache.isStale(cache.getMeta(sh.id), cache.fetchedAt(sh.id));
    const changed = updates.get(sh.src);
    if (!changed) return cache.isStale(cache.getMeta(sh.id), cache.fetchedAt(sh.id));
    const upstream = changed.get(String(sh.ref));
    return upstream ? upstream > cache.fetchedAt(sh.id) : false;
  });
}

// Force a refetch of everything. Only for the explicit "Refresh now" button, where the user
// has asked for exactly that and is willing to wait.
export async function refreshLibrary({ force = false } = {}) {
  await pool(state.shows || [], (sh) => ensureRecord(sh, { force }));
  repaint();
}

/* ---- watch marks ---- */

/* The repaint after marking, with the cards moving to wherever the mark just put them.

   The class is what turns the naming on — see .is-advancing .vt in app.css. Names that were
   always present would also pair up on arriving at this screen and on leaving it, and the
   cards would slide for a navigation that has nothing to do with marking anything.

   It goes on before the transition starts, because the old snapshot is taken then, and comes
   off when the animations have finished rather than when the callback returns.

   A view transition also blocks input while it runs, so this is deliberately short. */
function advance(paint) {
  const ok = document.startViewTransition
    && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!ok) return paint();
  const root = document.documentElement;
  root.classList.add("is-advancing");
  document.startViewTransition(() => paint()).finished
    .finally(() => root.classList.remove("is-advancing"));
}

/* Marking an episode of a planned show starts it — see model.markEpisode. That has to be
   said out loud: the show moves out of Planned and into Up next, and a status changing on
   its own is exactly the kind of thing that is alarming when you find it later rather than
   when it happens. */
function said(showId, run, message, { undo = null, animate = false } = {}) {
  const show = findShow(state, showId);
  const meta = cache.getMeta(showId);
  const before = { st: show && show.st, done: meta && show ? completion(show, meta, opts()) : null };

  run();

  const after = findShow(state, showId);
  scheduleSync();
  if (animate) advance(repaint);
  else repaint();

  const started = before.st === "planned" && after && after.st === "active";
  const name = (after && after.name) || "";
  if (started) toast(`${message ? message + " · " : ""}${name} moved to Watching`, { undo });
  else if (message) toast(message, { undo });

  // A finish speaks for itself and would only be talked over by a toast repeating the count.
  if (meta && after) applause(after, meta, before.done);
  return started;
}

/* The two moments worth more than a number: the mark that closes a season, and the one that
   finishes a show for good. Only ever one of them at a time — a last episode closes its
   season and the series at once, and the series is the bigger news. */
function applause(show, meta, before) {
  const got = newlyFinished(before, completion(show, meta, opts()));
  if (got.series) {
    const p = showProgress(show, meta, opts());
    const spent = fmtDuration(p.aired * (meta.runtime || 0));
    return celebrate({
      big: true,
      title: `That's all of ${show.name}.`,
      line: [`${p.aired} episodes`, spent, p.pass > 1 ? `${ordinal(p.pass)} time through` : null]
        .filter(Boolean).join(" · "),
    });
  }
  if (!got.seasons.length) return null;

  // Several at once happens on a catch-up; the last one closed is the one you just reached.
  const n = got.seasons[got.seasons.length - 1];
  const rest = nextUp(show, meta, opts());
  return celebrate({
    title: n === 0 ? "Specials done." : `Season ${n} done.`,
    line: rest
      ? `Next: ${epCode(rest.s, rest.e)}${rest.name ? " · " + rest.name : ""}`
      : "You're all caught up.",
  });
}

export function toggleEpisode(showId, key, on) {
  said(showId, () => markEpisode(state, showId, key, on));
}

// The main action on the up-next card: mark the episode you were offered, and move on.
export function watchNext(showId) {
  const show = findShow(state, showId);
  const m = cache.getMeta(showId);
  if (!show || !m) return null;
  const ep = nextUp(show, m, opts());
  if (!ep) return null;
  /* The one action in the app that is a single tap on the screen you land on, which makes it
     the one most easily done by accident — so it is the one that offers a way back. Unmarking
     is the exact inverse: during a rewatch markEpisode steps the level down rather than
     deleting, so the earlier run is not lost by undoing this one. */
  said(showId, () => markEpisode(state, showId, ep.key), `Marked ${epCode(ep.s, ep.e)}`, {
    animate: true,
    undo: () => said(showId, () => markEpisode(state, showId, ep.key, false), "Put back",
      { animate: true }),
  });
  return ep;
}

export function catchUpTo(showId, key) {
  const m = cache.getMeta(showId);
  if (!m) return;
  const p = parseEpKey(key);
  said(showId, () => markUpTo(state, showId, m, key, opts()),
       "Marked everything up to " + (p ? epCode(p.s, p.e) : key));
}

// Mark everything that has aired. The bulk action that actually makes sense on the show
// header, where there is no particular episode to catch up *to*.
export function catchUpToLatest(showId) {
  const m = cache.getMeta(showId);
  if (!m) return;
  said(showId, () => markAllAired(state, showId, m, opts()), "Marked everything that has aired");
}

export function toggleSeason(showId, season, on) {
  said(showId, () => markSeason(state, showId, season, on, opts()),
       on ? `Marked season ${season.n}` : `Cleared season ${season.n}`);
}

// Start another pass through a show. The show reappears at the top of Up next with every
// episode waiting again, and the previous run stays visible in the barcode underneath.
export function beginRewatch(showId) {
  const sh = startRewatch(state, showId);
  if (!sh) return null;
  scheduleSync();
  repaint();
  toast(`Starting your ${ordinal(passOf(sh))} watch of ${sh.name}`);
  return sh;
}

export function undoRewatch(showId) {
  const sh = cancelRewatch(state, showId);
  if (!sh) return null;
  scheduleSync();
  repaint();
  toast("Rewatch cancelled");
  return sh;
}

/* ---- library ---- */

/* Tracking a movie. The same shape as trackShow and for the same reasons — fetch first so the
   vault record carries a real name and year rather than a number, cache the record that request
   already paid for, and let addShow decide whether this is new. */
/* The record for one movie, fetched once and cached. Same contract as ensureMeta: a no-op when
   there is nothing to fetch, and silent when the catalogue will not answer — a movie page that
   cannot load its record says so by staying on its skeleton, not by shouting. */
export function ensureMovie(key, { force = false } = {}) {
  if (!force && cache.has(key)) return Promise.resolve(cache.getMeta(key));
  // The vault's own portable id, so a movie survives its catalogue's key being taken away.
  const held = findShow(state, key);
  return meta.fetchMovie(key, { imdb: (held && held.imdb) || null })
    .then(async (m) => { await cache.putMeta(m); repaint(); return m; })
    .catch(() => null);
}

/* Marking a movie, including the case where it is not tracked yet. Somebody who opens a movie
   they do not hold and presses "Mark watched" means both things — add it, and mark it — and
   making them press twice would be pedantry. */
export async function markMovieNow(key, on = true) {
  let sh = findShow(state, key);
  if (!sh) {
    if (!on) return null;
    sh = await trackMovie(key).catch(() => null);
    if (!sh) return null;
  }
  markMovie(state, sh.id, on);
  scheduleSync();
  repaint();
  return sh;
}

export async function trackMovie(key) {
  const existing = findShow(state, key);
  if (existing) { toast("Already in your library"); return existing; }

  const m = await meta.fetchMovie(key);
  await cache.putMeta(m);
  const before = state.shows.length;
  const sh = addShow(state, m);
  scheduleSync();
  repaint();
  if (state.shows.length === before) {
    toast(`Already in your library as ${sh.name}`);
    return sh;
  }
  // Not "tracking": a film is not followed, it is set aside. The word has to match the button
  // that was pressed, which says Watch later.
  toast(`${sh.name} — watch later`);
  return sh;
}

export async function trackShow(key) {
  const existing = findShow(state, key);
  if (existing) { toast("Already in your library"); return existing; }
  // Fetching first means the vault record is written with real identity — name, year, IMDb
  // id — rather than a bare number that means nothing without the catalogue.
  let m = await meta.fetchShow(key);

  /* Discovery rows come from TVmaze's schedule whatever the chosen catalogue, because TMDB
     publishes nothing equivalent for premieres. Tracking one would otherwise write a
     TVmaze-numbered show for someone who chose TMDB, quietly ignoring the setting. The IMDb
     id in the payload maps it across; if that fails the original stands, since a show in the
     wrong numbering beats no show at all. */
  const chosen = meta.activeProvider().id;
  if (m.src !== chosen) {
    const moved = await meta.reresolve(m, chosen).catch(() => null);
    if (moved) m = moved;
  }

  await cache.putMeta(m);
  /* Whether this is a new show is the data layer's decision, not one the UI makes again on
     its own: addShow matches on the portable ids as well as the key, so the same series
     found in each catalogue is one row rather than two. Reading the answer off the library
     keeps the rule in one place. */
  const before = state.shows.length;
  const sh = addShow(state, m);
  if (state.shows.length === before) {
    /* Nothing was added, but something was learned: addShow files this catalogue's key on the
       record it matched. That has to be written down and painted, or the next visit asks the
       same question and gets the same surprise. */
    scheduleSync();
    repaint();
    toast(`Already in your library as ${sh.name}`);
    return sh;
  }
  scheduleSync();
  repaint();
  discover.forget();     // it should stop being offered as something to discover
  toast(`Tracking ${sh.name}`);
  return sh;
}

/* Correcting the dates on a show whose marks all landed on the day it was imported. Writes the
   watched-at date only; the mtime moves forward, because the edit is the newest thing about
   the record even when the date it sets is two years old. */
export function retimeShow(id, plan) {
  const r = setWatchDates(state, id, plan, Date.now(), cache.getMeta);

  if (!r.changed) {
    /* Three different silences, and saying the wrong one sends someone looking for a fault that
       isn't there — running "as they aired" twice used to report that the catalogue had no air
       dates, when in truth it had already used them. */
    toast(
      r.dated ? "Already dated as they aired"
        : !r.known ? "Episode list hasn't loaded yet — try again in a moment"
        : r.missing ? "No air dates on record for this show"
        : "Nothing to change",
    );
    return 0;
  }

  scheduleSync();
  repaint();
  const left = r.missing ? `, ${r.missing} without an air date` : "";
  toast(plan.mode === "clear"
    ? `Cleared ${r.changed} watch date${r.changed === 1 ? "" : "s"}`
    : `Dated ${r.changed} episode${r.changed === 1 ? "" : "s"}${left}`);
  return r.changed;
}

/* The same correction across the whole library, which is what an import actually needs: nobody
   is going to open nine hundred shows one at a time. Only shows with air dates to go on change,
   and it says how many did. */
export function retimeLibrary() {
  const now = Date.now();
  let episodes = 0;
  let shows = 0;
  let already = 0;
  for (const sh of state.shows) {
    const r = setWatchDates(state, sh.id, { mode: "aired" }, now, cache.getMeta);
    if (r.changed) { episodes += r.changed; shows++; }
    else if (r.dated) already++;
  }
  if (!episodes) {
    toast(already ? "Everything is already dated as it aired" : "Nothing to date — no air dates on record yet");
    return 0;
  }
  scheduleSync();
  repaint();
  toast(`Dated ${episodes} episodes across ${shows} show${shows === 1 ? "" : "s"}`);
  return episodes;
}

export function untrackShow(id) {
  const sh = findShow(state, id);
  if (!sh) return false;
  removeShow(state, id);
  cache.dropMeta(id);
  scheduleSync();
  repaint();
  toast(`Removed ${sh.name}`);
  return true;
}

export function changeStatus(id, st) {
  setStatus(state, id, st);
  scheduleSync();
  repaint();
}


/* Rating something, including the case where it is not tracked yet.
 *
 * Same reasoning as marking a movie watched: somebody who opens a title they do not hold and
 * gives it a number means both things, and making them press "add" first would be pedantry.
 * The rating is worth as much as the record it hangs on, and there is no record without this. */
export async function rateNow(key, target, value) {
  let sh = findShow(state, key);
  if (!sh) {
    if (!value) return null;                       // nothing to clear on a title nobody holds
    sh = await (isMovie({ id: key }) ? trackMovie(key) : trackShow(key)).catch(() => null);
    if (!sh) return null;
  }
  setRating(state, sh.id, target, value);
  scheduleSync();
  repaint();
  return sh;
}
