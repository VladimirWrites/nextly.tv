// Mutations on the state document. Every user action that changes the vault goes through
// here, so there's exactly one place that knows how a watch mark is written.
//
// Deletions just remove the record; merge.js turns that into a tombstone at sync time by
// diffing against the last-synced baseline. Nothing here needs to know about tombstones.
import { makeShow, findShow, findSameShow, rememberAlias, normShow } from "./schema.js";
import { SHOW_STATUS, DEFAULT_STATUS, passOf, levelOf, setLevel, parseEpKey } from "./constants.js";
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
  if (sh.st !== "planned") return;
  sh.st = "active";
  sh.m = now;
}

/* ---- rewatches ---- */

// Start another pass. Deliberately an explicit action rather than something that happens
// when you tap an episode you've already seen: that tap means "I mis-marked this", and
// silently promoting it to a rewatch would reset a finished show's progress by accident.
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
