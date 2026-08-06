// Mutations on the state document. Every user action that changes the vault goes through
// here, so there's exactly one place that knows how a watch mark is written.
//
// Deletions just remove the record; merge.js turns that into a tombstone at sync time by
// diffing against the last-synced baseline. Nothing here needs to know about tombstones.
import { makeShow, findShow, findSameShow, rememberAlias, normShow } from "./schema.js";
import { SHOW_STATUS, DEFAULT_STATUS, passOf, levelOf, setLevel, parseEpKey, isMovie, MOVIE_MARK,
  RATING_TITLE, clampRating, isRatingId } from "./constants.js";
import { episodeList } from "./progress.js";
import { isUpcoming } from "./dates.js";

// Every mark written by this file carries the pass it belongs to. Assigning `n = rw` rather
// than incrementing is what makes marking idempotent: two devices marking the same episode
// of the same pass land on the same number instead of racing each other to 3.
const putMark = (entries, key, pass, now) => {
  const e = { id: key, m: now };
  setLevel(e, pass);
  entries.push(e);
  return e;
};

// Add a show from normalized provider metadata. Adding one that's already tracked is a
// no-op that returns the existing record, so a double-tap on "Track" can't duplicate it or
// reset the marks on it.
export function addShow(state, meta, now = Date.now()) {
  // Matched across catalogues, not only by key: the same series added from TVmaze and from
  // TMDB has two different keys and is still one show. What the match was is worth keeping:
  // it is how a result list, which sees nothing but keys, can tell next time.
  const existing = findSameShow(state, meta);
  if (existing) {
    if (rememberAlias(existing, meta.key)) existing.m = now;
    return existing;
  }
  const sh = normShow(makeShow(meta, now));
  state.shows.push(sh);
  return sh;
}

/* ---- when it was actually watched ----

   A library imported from somewhere else arrives with every mark stamped on the day of the
   import. That is true — it is when the record was made — and it is useless: a history that
   says you watched nine hundred episodes over one weekend describes the import, not the
   watching.

   So a mark can carry a second date. `m` stays what it was, because sync resolves conflicts
   with it and a backdated mtime would make this device's copy look older than everyone else's.
   `w` is when it was seen, and it is what the statistics read.

   Evening, not midnight: an episode watched "on the 4th" was watched during the 4th, and a
   timestamp at midnight puts half a library in the small hours of the following day.
*/
const EVENING = 20;

const dayAt = (iso, hour = EVENING) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], hour, 0, 0, 0).getTime();
};

/* Rewrite the watch dates of one show.

   - "aired": each episode on the evening it first went out, which is what someone who followed
     a show week by week actually did. Episodes with no air date are left alone rather than
     invented.
   - "spread": the marks laid out in episode order between two dates, evenly. A season watched
     over a fortnight two years ago becomes a fortnight two years ago.
   - "single": everything on one day, for a show that genuinely was one sitting.
   - "clear": forget all of it and go back to when the boxes were ticked.

   Returns a breakdown rather than a count, because "nothing changed" has several meanings and
   they are not interchangeable: dates already correct, no air dates on record to go on, and no
   episode list loaded yet are three different things to tell someone. */
const nothing = () => ({ changed: 0, dated: 0, missing: 0, known: false });

export function setWatchDates(state, id, plan, now = Date.now(), metaOf = () => null) {
  const sh = findShow(state, id);
  if (!sh) return nothing();

  const meta = metaOf(id);
  const rows = [...(sh.entries || [])].sort((a, b) => {
    const A = parseEpKey(a.id) || { s: 0, e: 0 };
    const B = parseEpKey(b.id) || { s: 0, e: 0 };
    return A.s - B.s || A.e - B.e;
  });
  if (!rows.length) return nothing();

  const from = dayAt(plan && plan.from);
  const to = dayAt(plan && plan.to);
  let changed = 0;
  let dated = 0;      // marks this plan gave a date to, whether or not it differed
  let missing = 0;    // marks it could not date, for want of an air date

  rows.forEach((e, i) => {
    let w = null;
    if (plan.mode === "aired") {
      const at = parseEpKey(e.id);
      const se = meta && (meta.seasons || []).find((x) => x.n === at.s);
      const ep = se && (se.episodes || []).find((x) => x.e === at.e);
      w = ep && ep.air ? dayAt(ep.air) : null;
      if (!w) { missing++; return; }        // nothing known: leave the mark as it stands
    } else if (plan.mode === "single") {
      if (!from) return;
      w = from;
    } else if (plan.mode === "spread") {
      if (!from || !to) return;
      // Evenly, in episode order. One mark sits at the start rather than dividing by zero.
      const span = to - from;
      w = rows.length === 1 ? from : Math.round(from + (span * i) / (rows.length - 1));
    } else if (plan.mode === "clear") {
      if (!e.w) return;
      delete e.w;
      e.m = now;
      changed++;
      return;
    } else {
      return;
    }

    dated++;
    if (e.w === w) return;
    e.w = w;
    // The edit itself is a change, and sync decides with this.
    e.m = now;
    changed++;
  });

  if (changed) sh.m = now;
  return { changed, dated, missing, known: !!meta };
}

export function removeShow(state, id) {
  const i = state.shows.findIndex((x) => x.id === String(id));
  if (i < 0) return false;
  state.shows.splice(i, 1);
  return true;
}

export function setStatus(state, id, st, now = Date.now()) {
  const sh = findShow(state, id);
  if (!sh) return null;
  sh.st = SHOW_STATUS.includes(st) ? st : DEFAULT_STATUS;
  sh.m = now;
  return sh;
}

// Mark or unmark one episode for the pass in progress. `on` defaults to true.
//
// Unmarking steps the level down by one rather than deleting outright, so clearing an
// episode during a rewatch leaves the earlier viewing intact — you saw it, and undoing
// tonight's tick shouldn't claim otherwise. It only becomes a deletion at level 0.
export function markEpisode(state, id, key, on = true, now = Date.now()) {
  const sh = findShow(state, id);
  if (!sh) return null;
  const pass = passOf(sh);
  const i = sh.entries.findIndex((e) => e.id === key);

  if (on) {
    if (i < 0) putMark(sh.entries, key, pass, now);
    else if (levelOf(sh.entries[i]) < pass) {
      setLevel(sh.entries[i], pass);
      sh.entries[i].m = now;
    }
    // Already watched at this pass: left alone. The mark means "seen", and rewriting it
    // would churn the blob and reshuffle the up-next order for nothing.
  } else if (i >= 0) {
    const next = Math.min(levelOf(sh.entries[i]), pass) - 1;
    if (next < 1) sh.entries.splice(i, 1);
    else {
      setLevel(sh.entries[i], next);
      sh.entries[i].m = now;
    }
  }
  if (on) start(sh, now);
  return sh;
}

/* Watching an episode of something you had merely planned means you have started it. Every
   way of marking goes through here — one episode, a catch-up, a whole season, and an import.

   Only from planned: pausing or dropping a show and then correcting one mark should not
   quietly put it back in Up next. Clearing a mark never promotes anything either.

   Exported because an import writes marks through domain/external.js rather than through the
   functions above, and skipping this left every imported show sitting at "planned" — which
   Up next passes over, so a library that had just gained a thousand marks showed nothing at
   all on the screen it opens on. */
export function start(sh, now) {
  /* A movie is watched or it is not; there is no middle where it is being watched. Leaving it
     "planned" keeps it off Up next, which answers "what next in something you have started" and
     has nothing to say about a movie. */
  if (isMovie(sh)) return;
  if (sh.st !== "planned") return;
  sh.st = "active";
  sh.m = now;
}

/* ---- rewatches ---- */

// Start another pass. Deliberately an explicit action rather than something that happens
// when you tap an episode you've already seen: that tap means "I mis-marked this", and
// silently promoting it to a rewatch would reset a finished show's progress by accident.
/* Marking a movie. One mark, keyed so it can never be mistaken for an episode: epKey builds
   "<season>x<episode>" and cannot produce "m". Everything else — the pass level that counts
   rewatches, the mtime, the tombstone on removal — is the machinery episodes already use. */
export function markMovie(state, id, on = true, now = Date.now()) {
  return markEpisode(state, id, MOVIE_MARK, on, now);
}

// Seen, at the pass currently being watched.
export const movieWatched = (sh) =>
  !!sh && (sh.entries || []).some((e) => e.id === MOVIE_MARK && levelOf(e) >= passOf(sh));

// How many times, which an import can set from another service's play count.
export const moviePlays = (sh) => {
  const e = (sh && (sh.entries || []).find((x) => x.id === MOVIE_MARK)) || null;
  return e ? levelOf(e) : 0;
};

export function startRewatch(state, id, now = Date.now()) {
  const sh = findShow(state, id);
  if (!sh) return null;
  const highest = (sh.entries || []).reduce((n, e) => Math.max(n, levelOf(e)), 0);
  sh.rw = Math.max(passOf(sh), highest) + 1;
  sh.m = now;
  return sh;
}

// Back out of a pass that was started by mistake. Marks already made in it stay — they're
// the record of what you watched — but they now read as belonging to the pass below.
export function cancelRewatch(state, id, now = Date.now()) {
  const sh = findShow(state, id);
  if (!sh) return null;
  const back = passOf(sh) - 1;
  if (back < 1) return sh;
  if (back > 1) sh.rw = back;
  else delete sh.rw;
  sh.m = now;
  return sh;
}

// Mark every aired episode up to and including `key`. This is how you record a show you
// started before you started tracking it — one tap instead of eighty.
export function markUpTo(state, id, meta, key, { specials = false, now = Date.now() } = {}) {
  const sh = findShow(state, id);
  if (!sh) return null;
  const pass = passOf(sh);
  const byId = new Map(sh.entries.map((e) => [e.id, e]));
  for (const ep of episodeList(meta, specials)) {
    // Stops at the first episode that is genuinely still to come. One the catalogue has no
    // date for is not that, and catching up should sweep it in with the rest.
    if (isUpcoming(ep.air, now)) break;
    const existing = byId.get(ep.key);
    if (!existing) putMark(sh.entries, ep.key, pass, now);
    else if (levelOf(existing) < pass) {
      setLevel(existing, pass);
      existing.m = now;
    }
    if (ep.key === key) break;
  }
  start(sh, now);
  return sh;
}

// Mark everything that is out. The bulk action for "I am completely up to date", which is the
// only catch-up that makes sense without naming an episode.
export function markAllAired(state, id, meta, { specials = false, now = Date.now() } = {}) {
  const aired = episodeList(meta, specials).filter((ep) => !isUpcoming(ep.air, now));
  const last = aired[aired.length - 1];
  if (!last) return findShow(state, id);
  return markUpTo(state, id, meta, last.key, { specials, now });
}

// Mark or unmark a whole season. Episodes still to come are never marked — you can't have
// watched something that doesn't exist yet, and marking them would corrupt the up-next queue.
// One with no date on record is not in that group: the catalogue is silent, not predicting.
export function markSeason(state, id, season, on = true, { specials = false, now = Date.now() } = {}) {
  const sh = findShow(state, id);
  if (!sh) return null;
  const pass = passOf(sh);
  const keys = (season.episodes || [])
    .filter((ep) => specials || !ep.special)
    .filter((ep) => (on ? !isUpcoming(ep.air, now) : true))
    .map((ep) => `${season.n}x${ep.e}`);

  if (on) {
    const byId = new Map(sh.entries.map((e) => [e.id, e]));
    keys.forEach((k) => {
      const existing = byId.get(k);
      if (!existing) putMark(sh.entries, k, pass, now);
      else if (levelOf(existing) < pass) {
        setLevel(existing, pass);
        existing.m = now;
      }
    });
    start(sh, now);
  } else {
    // Clearing steps each mark down a pass, matching what unmarking one episode does.
    const drop = new Set(keys);
    sh.entries = sh.entries.filter((e) => {
      if (!drop.has(e.id)) return true;
      const next = Math.min(levelOf(e), pass) - 1;
      if (next < 1) return false;
      setLevel(e, next);
      e.m = now;
      return true;
    });
  }
  return sh;
}

// Total episodes seen across the library, counting every pass — so a show watched three
// times through contributes three times. This is the number that should go up when you
// rewatch something, which is the whole point of tracking passes.
export const totalWatched = (state) =>
  (state.shows || []).reduce((n, sh) => n + (sh.entries || []).reduce((m, e) => m + levelOf(e), 0), 0);

// Distinct episodes seen at least once, ignoring rewatches.
export const totalEpisodes = (state) =>
  (state.shows || []).reduce((n, sh) => n + (sh.entries || []).length, 0);

/* What a discovery card should say about itself.
 *
 * A row of posters answers "what could I watch" and could not answer the question anybody
 * actually asks of it — whether they have the thing already. The library knows; the row simply
 * never asked. This is that question, asked once, for every row in the app.
 *
 * Not an exact-key lookup, because a card and a record name the same title in different
 * catalogues: a TMDB row gives `tmdb:m76600` for a movie saved from Cinemeta as
 * `cinemeta:mtt1630029`. findSameShow reconciles those on the portable ids — IMDb, TVDB, and
 * TMDB's own number, which Cinemeta carries — so this needs no special case per row.
 *
 * A movie is binary, so it says which half it is in. A show is not, and what it can honestly
 * say is its status, a plain field on the record.
 *
 * Deliberately not "caught up", which is the more useful sentence and the one this cannot
 * write: showProgress needs the episode list, and the metadata cache is read synchronously
 * from whatever happens to be in memory. Half a row would say "Caught up" and half "Watching",
 * decided by what an earlier screen had fetched, and it would change on repaint. A badge that
 * means different things on neighbouring cards is worse than a badge that means less. */
export const SHELF_STATUS = {
  active: "Watching", planned: "Planned", paused: "Paused", dropped: "Dropped",
};

export function shelfState(state, card) {
  if (!card || !card.key) return { held: null, label: null };
  const held = findShow(state, card.key) || findSameShow(state, { ...card, key: card.key });
  if (!held) return { held: null, label: null };
  const label = isMovie(held)
    ? (movieWatched(held) ? "Watched" : "Watchlist")
    : (SHELF_STATUS[held.st] || "In library");
  return { held, label };
}


/* ---- ratings ---- */

/* One number, 1 to 10, against a title, a season or an episode.
 *
 * `at` is when the rating was written and settles merges. `ratedAt` is when it was actually
 * given, and is only recorded when it says something the mtime does not — an import carries
 * real dates from years ago, while a rating made here and now is described perfectly well by
 * its own mtime. The same distinction the marks draw between m and w, for the same reason.
 *
 * Zero clears it. The entry stays behind carrying zero and a newer mtime, which is what beats
 * the old number on a device that has not heard yet, and is why taking a rating back needs no
 * tombstone of its own. */
export function setRating(state, id, target, value, at = Date.now(), { ratedAt = 0 } = {}) {
  const sh = findShow(state, id);
  if (!sh || !isRatingId(target)) return null;
  const v = clampRating(value);
  if (!Array.isArray(sh.rats)) sh.rats = [];
  const ex = sh.rats.find((r) => r.id === target);
  const rec = ex || { id: target };
  rec.v = v;
  rec.m = at;
  if (ratedAt > 0) rec.w = ratedAt;
  else delete rec.w;
  if (!ex) sh.rats.push(rec);
  /* The record's own mtime is deliberately left alone. A rating carries its own, so rating a
     show on one device and moving it to Paused on another keeps both — where bumping the
     record would have let whichever happened second overwrite the other outright. */
  return rec;
}

// The number, or 0 for "not rated" — which is what a cleared rating and an absent one both are.
export function ratingOf(sh, target = RATING_TITLE) {
  const r = ((sh && sh.rats) || []).find((x) => x.id === target);
  return r ? clampRating(r.v) : 0;
}

// Every rating actually held, cleared ones dropped. For statistics and for export.
export const ratingsOf = (sh) => ((sh && sh.rats) || []).filter((r) => clampRating(r.v) > 0);
