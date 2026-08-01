// What the marks add up to.
//
// Every watch mark carries the moment it was made, so a library is not only a list of shows —
// it is a record of when someone sat down to watch television. This turns that into the few
// numbers worth knowing: how much time, on which days, at what hour, and which shows took it.
//
// One honest caveat runs through all of it, and the page says so out loud: a mark records when
// you ticked the box, not when you watched. Someone who marks a whole season on Sunday night
// looks like they watched thirteen episodes on Sunday night. There is no way to know better,
// and pretending otherwise would be inventing data.
//
// Pure: it takes the library, a way to look up metadata, and the time. It reads no clock and
// no cache of its own.
import { parseEpKey, levelOf } from "./constants.js";

const DAY = 86_400_000;

// Best guess at how long an episode ran. The episode's own figure where the catalogue has one,
// the show's average where it doesn't, and nothing at all rather than a number made up.
function runtimeOf(meta, s, e) {
  const se = (meta.seasons || []).find((x) => x.n === s);
  const ep = se && (se.episodes || []).find((x) => x.e === e);
  return (ep && ep.runtime) || meta.runtime || null;
}

/* Every mark, flattened, with what is known about the episode behind it. A mark at pass 3 is
   three viewings: the level is how many times that episode has been seen, and time watched
   should say so. */
export function marks(shows, metaOf) {
  const out = [];
  for (const sh of shows || []) {
    const meta = metaOf(sh.id);
    for (const e of sh.entries || []) {
      const at = parseEpKey(e.id);
      if (!at || !e.m) continue;
      const runtime = meta ? runtimeOf(meta, at.s, at.e) : null;
      const times = Math.max(1, levelOf(e));
      out.push({
        // When it was watched if anyone has said so, and otherwise when the box was ticked.
        when: e.w || e.m,
        showId: sh.id,
        show: sh.name,
        s: at.s,
        e: at.e,
        times,
        minutes: runtime ? runtime * times : 0,
        known: !!runtime,
        genres: (meta && meta.genres) || [],
        year: (meta && meta.year) || sh.year || null,
      });
    }
  }
  return out.sort((a, b) => a.when - b.when);
}

/* Which day a moment belongs to. Local, deliberately: the question is what someone's own
   evenings look like, and an evening is a local thing.

   Exported because the heatmap has to agree with it exactly — it walks a strip of days and
   asks this map what each one holds, and a second copy of the rule is a chance for the two to
   drift. Takes a Date or a timestamp, since the page has one and the counting has the other. */
export const dayKey = (t) => {
  const d = t instanceof Date ? t : new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* The longest run of days with at least one mark, and whether it is still going. A run is
   counted in calendar days rather than in 24-hour blocks: two episodes either side of midnight
   are two evenings, and anyone would call that two days.

   "Still going" allows for today being young — a streak that ran to yesterday has not been
   broken until yesterday is over. */
export function streaks(days, now) {
  const keys = [...days.keys()].sort();
  if (!keys.length) return { best: 0, current: 0, bestEnded: null };

  let best = 0, run = 0, bestEnd = null, prev = null;
  for (const k of keys) {
    const t = new Date(k + "T00:00:00").getTime();
    run = prev !== null && t - prev === DAY ? run + 1 : 1;
    if (run > best) { best = run; bestEnd = k; }
    prev = t;
  }

  const today = dayKey(now);
  const yesterday = dayKey(now - DAY);
  const last = keys[keys.length - 1];
  const current = last === today || last === yesterday ? run : 0;
  return { best, current, bestEnded: bestEnd };
}

/* The window a page is asking about. A rolling twelve months by default, because that is the
   question people mean by "this year" more often than the calendar one — but the calendar one
   is there too, and so is the whole history. */
export const SINCE = {
  year12: (now) => now - 365 * DAY,
  calendar: (now) => new Date(new Date(now).getFullYear(), 0, 1).getTime(),
  all: () => 0,
};

// Everything the page shows, worked out in one pass so a repaint costs nothing.
export function watchStats(shows, metaOf, now = Date.now(), since = 0) {
  const rows = marks(shows, metaOf).filter((m) => m.when >= since);
  const days = new Map();          // "2026-07-30" -> episodes marked
  const hours = Array(24).fill(0); // when in the day
  const weekdays = Array(7).fill(0);
  /* Day of the week against hour of the day. The two apart say "evenings" and "Sundays"; the
     two crossed say which evenings — a Sunday afternoon and a Tuesday midnight are different
     habits, and neither of the flat counts can tell them apart. */
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  const byShow = new Map();
  const byGenre = new Map();
  const byDecade = new Map();

  let minutes = 0;
  let episodes = 0;
  let rewatched = 0;
  let guessed = 0;

  for (const m of rows) {
    const d = new Date(m.when);
    const k = dayKey(m.when);
    days.set(k, (days.get(k) || 0) + 1);
    hours[d.getHours()]++;
    weekdays[d.getDay()]++;
    grid[d.getDay()][d.getHours()]++;

    minutes += m.minutes;
    episodes += m.times;
    if (m.times > 1) rewatched++;
    if (!m.known) guessed++;

    const show = byShow.get(m.showId) || { id: m.showId, name: m.show, episodes: 0, minutes: 0 };
    show.episodes += m.times;
    show.minutes += m.minutes;
    byShow.set(m.showId, show);

    // A genre gets the whole episode, not a share of it: half an hour of "Drama, Crime" is
    // half an hour of drama and half an hour of crime, and splitting it would make every
    // number smaller than the thing it describes.
    for (const g of m.genres) byGenre.set(g, (byGenre.get(g) || 0) + m.minutes);
    if (m.year) {
      const decade = Math.floor(m.year / 10) * 10;
      byDecade.set(decade, (byDecade.get(decade) || 0) + m.minutes);
    }
  }

  const ranked = (map, key = "minutes") =>
    [...map.values()].sort((a, b) => b[key] - a[key]);

  // The heaviest single day, and what was on. Named as "marked" rather than "watched" — the
  // page is careful about this and so is the wording.
  let biggest = null;
  for (const [k, n] of days) if (!biggest || n > biggest.count) biggest = { day: k, count: n };
  if (biggest) {
    const names = new Set(rows.filter((m) => dayKey(m.when) === biggest.day).map((m) => m.show));
    biggest.shows = [...names];
  }

  /* Finished within the window: a show finished years ago is not something this year did. With
     no window it is every show whose aired episodes are all marked. */
  const finished = (shows || []).filter((sh) => {
    const meta = metaOf(sh.id);
    if (!meta || !(sh.entries || []).length) return false;
    const aired = (meta.seasons || []).flatMap((se) => se.episodes || [])
      .filter((ep) => ep.air && new Date(ep.air).getTime() <= now && !ep.special).length;
    const within = (sh.entries || []).filter((e) => (e.w || e.m) >= since).length;
    return aired > 0 && (sh.entries || []).length >= aired && within > 0;
  }).length;

  return {
    since,
    grid,
    episodes,
    minutes,
    // How much of the time figure rests on the show's average rather than the episode's own.
    guessed,
    // Shows this window saw something of, rather than everything in the library.
    shows: new Set(rows.map((m) => m.showId)).size,
    finished,
    rewatched,
    first: rows.length ? rows[0].when : null,
    days,
    hours,
    weekdays,
    topShows: ranked(byShow).slice(0, 8),
    genres: [...byGenre.entries()].map(([name, mins]) => ({ name, minutes: mins }))
      .sort((a, b) => b.minutes - a.minutes).slice(0, 8),
    decades: [...byDecade.entries()].map(([decade, mins]) => ({ decade, minutes: mins }))
      .sort((a, b) => a.decade - b.decade),
    streak: streaks(days, now),
    biggest,
  };
}

/* The hour someone actually watches at. Not the mode, which on a small library is whichever
   hour happened twice — the middle of the busiest stretch of three consecutive hours, which is
   what "you watch in the evening" really means. Wraps midnight, because that is when a lot of
   television gets watched. */
export function primeHour(hours) {
  const total = hours.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let best = 0, at = 0;
  for (let i = 0; i < 24; i++) {
    const run = hours[i] + hours[(i + 1) % 24] + hours[(i + 2) % 24];
    if (run > best) { best = run; at = i; }
  }
  return { hour: (at + 1) % 24, share: best / total };
}
