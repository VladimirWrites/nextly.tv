// Shared constants. Pure data — no DOM, no network.

export const SCHEMA_VERSION = 1;

// Tombstone buckets, one per record kind that can be deleted. merge.js walks this list,
// so adding a deletable record kind means adding it here too.
export const DEL_KINDS = ["show", "ep"];

// How a show is being tracked. "completed" is deliberately absent: it's derived from the
// watch marks, so it can never disagree with them.
export const SHOW_STATUS = ["active", "planned", "paused", "dropped"];

/* Tracking a show is not the same as starting it. Adding used to mean "watching", which put
   things you had only bookmarked straight into Up next and made that screen answer the wrong
   question. Marking the first episode promotes a planned show to active, so the common case
   still needs no thought. */
export const DEFAULT_STATUS = "planned";

/* ---- provider-scoped show keys ----
   A show is identified by which catalogue it came from plus that catalogue's id, because
   episode numbering is a property of the catalogue: TVmaze and TMDB disagree about some
   shows, and a mark recorded against one numbering can't be trusted against the other.
   Baking the source into the key means the two can coexist, and a stored key always says
   which numbering its marks belong to. */
export const showKey = (src, ref) => `${src}:${ref}`;

/* A portable show key: "imdb:tt0903747".
 *
 * Only ever an address, never a stored one. A show in the vault is keyed by the catalogue whose
 * episode numbering its marks were recorded against, and that cannot be a portable id — two
 * catalogues number the same series differently, so a mark filed under an IMDb id would not
 * know which numbering it meant.
 *
 * What this is for is links. A key like "tmdb:1396" is a number only TMDB can read, and a
 * stranger given one without a TMDB key has nothing to look it up with. An IMDb id is readable
 * by every catalogue, which is the same reason the export carries one. A link that arrives
 * portable is resolved to whichever catalogue this device uses and the address is rewritten. */
export const PORTABLE_SRC = new Set(["imdb", "tvdb"]);

export const isPortableKey = (key) => {
  const p = parseShowKey(key);
  return !!p && PORTABLE_SRC.has(p.src);
};

/* The most portable address this show has.
 *
 * A catalogue key is a number only that catalogue can read: a stranger sent "tmdb:1396"
 * without a TMDB key has nothing to look it up with, and the page they open never resolves.
 * An IMDb id is readable by every catalogue, which is the same reason the export carries one.
 *
 * Falls back to the catalogue key when there is no portable id, which is rare and is still
 * better than not offering to share at all — it works for anyone using the same catalogue. */
export function portableKey(id, ids) {
  if (ids && ids.imdb) return `imdb:${ids.imdb}`;
  if (ids && ids.tvdb) return `tvdb:${ids.tvdb}`;
  return id;
}

export function parseShowKey(key) {
  const i = String(key || "").indexOf(":");
  if (i < 1) return null;
  return { src: key.slice(0, i), ref: key.slice(i + 1) };
}

// Episode key: "<season>x<episode>". Human-readable on purpose — a raw export stays legible
// without any catalogue, and it survives the provider going away.
export const epKey = (s, e) => `${s}x${e}`;

export function parseEpKey(key) {
  const m = /^(\d+)x(\d+)$/.exec(key || "");
  return m ? { s: +m[1], e: +m[2] } : null;
}

// Display form for an episode, zero-padded the way everyone writes it: S03E07.
export const epCode = (s, e) => `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`;

/* ---- rewatches ----
   A watch mark is a level, not a flag: `entry.n` is the highest pass an episode was watched
   in, and `show.rw` is the pass currently in progress. Both are omitted when they're 1, so a
   library nobody has rewatched stores exactly what it stored before rewatches existed.

   Marking sets n = rw rather than incrementing, which makes it idempotent — two devices
   marking the same episode of the same pass agree instead of racing to 3. */

const DEFAULT_PASS = 1;

// The pass a show is currently being watched in.
export const passOf = (show) => Math.max(1, Math.trunc(+(show && show.rw)) || DEFAULT_PASS);

// The pass an episode was last watched in. A mark with no level predates rewatches, so it
// means "seen once".
export const levelOf = (entry) => Math.max(1, Math.trunc(+(entry && entry.n)) || DEFAULT_PASS);

// Write a level back, dropping the field at 1 so the blob stays as small as it ever was.
export function setLevel(entry, n) {
  if (n > 1) entry.n = Math.trunc(n);
  else delete entry.n;
  return entry;
}

export function ordinal(n) {
  const v = Math.abs(Math.trunc(n));
  if (v % 100 >= 11 && v % 100 <= 13) return `${n}th`;
  return n + (["th", "st", "nd", "rd"][v % 10] || "th");
}

/* Artwork stand-in. A title has no size at which it fits a 52px poster slot, so a show with
   no image shows initials instead — the full name is always on the row beside it. */
export function initials(name) {
  const words = String(name || "").match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/* Scores are shown to one decimal, because the second one is noise on a 0-10 average, and a
   whole number still reads as a rating rather than a count. */
export const fmtScore = (n) => (typeof n === "number" && isFinite(n) ? n.toFixed(1) : null);

// Vote counts, shortened. "12k votes" says as much as "12,431" and takes half the room.
export function fmtVotes(n) {
  if (!n || n < 1) return null;
  if (n < 1000) return `${n} votes`;
  if (n < 1_000_000) return `${Math.round(n / 100) / 10}k votes`;
  return `${Math.round(n / 100_000) / 10}M votes`;
}

// "1st watch", "2nd watch", … — the label for a pass.
export const passLabel = (n) => `${ordinal(n)} watch`;

/* How much is left, in the units a person would use. Minutes below an hour, hours and
   minutes below half a day, whole hours past that — nobody plans around the 7 minutes at the
   end of a 90-hour show. */
export function fmtDuration(min) {
  const m = Math.max(0, Math.round(+min || 0));
  if (!m) return null;
  if (m < 60) return `${m}m`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (hours < 12) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  return `${Math.round(m / 60)}h`;
}

/* ---- what the catalogue says about a show's life ----
   TVmaze says Running / Ended / To Be Determined / In Development. TMDB says Returning
   Series / Ended / Canceled / In Production / Planned. Same three facts under different
   names, so they're reduced to one vocabulary here and nothing above this line has to know
   which catalogue answered. */
/* When a show goes out, in as few words as it takes: "Fridays", "Weekdays", "Daily",
   "Tue/Thu". Shown on a season page, since a season is the thing that has a slot.

   TVmaze knows the days more often than the time, so the time is optional. */
const DAY_SHORT = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
                    friday: "Fri", saturday: "Sat", sunday: "Sun" };
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];

export function airsLabel(airs) {
  const days = ((airs && airs.days) || []).map((d) => String(d).toLowerCase()).filter((d) => DAY_SHORT[d]);
  if (!days.length) return null;
  const set = new Set(days);
  const time = String((airs && airs.time) || "").trim();

  let when;
  if (set.size === 7) when = "Daily";
  else if (set.size === 5 && WEEKDAYS.every((d) => set.has(d))) when = "Weekdays";
  // One day a week is the common case, and it reads as a habit rather than a date: "Fridays".
  else if (set.size === 1) when = `${days[0][0].toUpperCase()}${days[0].slice(1)}s`;
  else when = [...set].map((d) => DAY_SHORT[d]).join("/");

  return time ? `${when}, ${time}` : when;
}

export function runState(status) {
  const t = String(status || "").toLowerCase();
  if (/cancel/.test(t)) return "canceled";
  if (/ended|concluded/.test(t)) return "ended";
  if (/running|returning|continuing|in production/.test(t)) return "running";
  if (t) return "upcoming";     // to be determined, in development, planned
  return "unknown";
}

export const isOver = (status) => ["ended", "canceled"].includes(runState(status));

/* ---- filing titles ----
   Matching and ordering ignore case, accents and a leading article, because "The Bear" is
   filed under B in everyone's head and nobody types the diacritics. */
export const fold = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const sortKey = (name) => fold(name).replace(/^(the|a|an)\s+/, "");

/* The heading a title files under: its own first letter, whatever script that is in.
   A fixed A-Z can't index a library holding Корона or 오징어 게임 — every one of those titles
   would fall into the same meaningless bucket. Taking the character itself gives Cyrillic Б,
   Greek Δ and Korean 오 their own headings, and an alphabetical sort already places them
   after the Latin ones, so they line up underneath without being told to.

   Composed back to NFC because folding decomposes: a Hangul syllable would otherwise index
   under a conjoining jamo, which several fonts refuse to draw on its own. Anything that
   isn't a letter — a digit, punctuation, an emoji — files under #. */
export function indexLetter(name) {
  const first = [...sortKey(name).normalize("NFC")][0] || "";
  const up = first.toLocaleUpperCase();
  return /\p{L}/u.test(up) ? up : "#";
}
