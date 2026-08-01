// Date helpers. Air dates arrive from TMDB as "YYYY-MM-DD" with no timezone, so they're
// treated as calendar dates in UTC — comparing them to a UTC "today" keeps an episode from
// looking unaired to a user who is merely west of the airing timezone.

export const DAY_MS = 86_400_000;

// "YYYY-MM-DD" -> epoch millis at UTC midnight, or null if absent/malformed.
export function airMs(d) {
  if (!d || typeof d !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(t) ? null : t;
}

// Has this episode aired as of `now`? An episode with no air date is treated as NOT aired:
// TMDB leaves the field empty for announced-but-unscheduled episodes, and showing those as
// "watch tonight" is worse than omitting a rare data gap.
export function hasAired(d, now = Date.now()) {
  const t = airMs(d);
  return t !== null && t <= now;
}

/* Still to come — which is not the same as "has not aired".

   An episode with no date on record has not aired by any test this app can make, and it is also
   not known to be in the future: the catalogue simply does not say. Treating the two alike meant
   an undated episode could not be ticked off in the list, while the same episode's own page
   would happily mark it — the person watching knows something the catalogue does not. */
export const isUpcoming = (d, now = Date.now()) => {
  const t = airMs(d);
  return t !== null && t > now;
};

// Whole days between two instants, positive when `d` is in the future.
export const daysUntil = (d, now = Date.now()) => {
  const t = airMs(d);
  return t === null ? null : Math.round((t - now) / DAY_MS);
};

// Compact relative phrasing for air dates and sync times. Deliberately coarse: the exact
// minute never matters here, and vagueness reads better than false precision.
export function relTime(ms, now = Date.now()) {
  if (!ms) return "";
  const diff = ms - now;
  const abs = Math.abs(diff);
  const past = diff < 0;
  if (abs < 60_000) return past ? "just now" : "in a moment";
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return past ? `${mins}m ago` : `in ${mins}m`;
  const hrs = Math.round(abs / 3_600_000);
  if (hrs < 24) return past ? `${hrs}h ago` : `in ${hrs}h`;
  const days = Math.round(abs / DAY_MS);
  if (days === 1) return past ? "yesterday" : "tomorrow";
  if (days < 7) return past ? `${days} days ago` : `in ${days} days`;
  if (days < 31) {
    const w = Math.round(days / 7);
    return past ? `${w}w ago` : `in ${w}w`;
  }
  if (days < 365) {
    const mo = Math.round(days / 30);
    return past ? `${mo}mo ago` : `in ${mo}mo`;
  }
  const y = Math.round(days / 365);
  return past ? `${y}y ago` : `in ${y}y`;
}

/* How far off something is, in the words a person would use, given a number of days. relTime
   above answers the same question from a moment; this one exists because the schedule already
   knows the gap in days and rounding a day count back into a timestamp to ask again would be
   a way of introducing an off-by-one.

   Coarser the further out it goes: eleven days is worth counting, eleven weeks is not, and
   nobody plans around "in 78 days". */
export function whenPhrase(inDays) {
  if (inDays <= 0) return "today";
  if (inDays === 1) return "tomorrow";
  if (inDays < 14) return `in ${inDays} days`;
  if (inDays < 60) return `in ${Math.round(inDays / 7)} weeks`;
  return `in ${Math.round(inDays / 30)} months`;
}

// "2024-03-11" -> "11 Mar 2024". Empty string for missing dates so callers can concatenate.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
  if (!m) return "";
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

/* The years a season aired in, from the episodes themselves — no request for a /seasons
   endpoint that would answer the same thing. "2024", "2024–2025", or null for a season
   nothing has aired in yet. */
export function seasonYears(episodes) {
  const years = [...new Set((episodes || []).map((ep) => {
    const m = /^(\d{4})-/.exec((ep && ep.air) || "");
    return m ? m[1] : null;
  }).filter(Boolean))].sort();
  if (!years.length) return null;
  return years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0];
}

// "2024-03-11" -> "Mon 11 Mar". The form a schedule wants: the weekday is the part you
// actually plan around, and the year is noise for anything within a few months. Read in UTC
// to match airMs, so the label can't disagree with the day the episode was filed under.
export function fmtDay(d) {
  const t = airMs(d);
  if (t === null) return "";
  const dt = new Date(t);
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

export const yearOf = (d) => {
  const m = /^(\d{4})/.exec(d || "");
  return m ? +m[1] : null;
};
