// State shape: defaults, a fresh state, record normalization, and the version migrator.
// Pure — operates on the plain state object passed in.
//
// The guiding rule for what lives in the vault: everything needed to understand your watch
// history WITHOUT a catalogue. Show identity is denormalized — name, year, IMDb and TheTVDB
// ids — so the blob stays meaningful and re-resolvable if the provider it came from
// disappears. Episode titles, posters and air dates are NOT stored: they're cache (see
// io/cache.js), and "Breaking Bad S03E07" is already unambiguous without them.
import { SCHEMA_VERSION, DEL_KINDS, DEFAULT_STATUS, SHOW_STATUS, showKey, parseShowKey,
         fold as foldText, levelOf, setLevel, passOf } from "./constants.js";

export function defSettings() {
  return {
    provider: "tvmaze",  // which catalogue new searches use
    tmdbKey: "",         // the user's own TMDB key; travels in the encrypted blob, never to our server
    theme: "auto",       // auto | light | dark
    specials: false,     // count specials towards progress and up-next
    m: 0,                // mtime, so two devices changing settings resolve newest-wins
  };
}

export function emptyState() {
  return {
    v: SCHEMA_VERSION,
    updatedAt: 0,
    settings: defSettings(),
    shows: [],
    del: { show: {}, ep: {} },
  };
}

// Ensure the tombstone store exists with a bucket per record kind.
export function ensureDel(s) {
  s.del = s.del || {};
  DEL_KINDS.forEach((k) => {
    if (!s.del[k]) s.del[k] = {};
  });
  return s.del;
}

// Build the vault record for a show from normalized provider metadata. Everything here is
// either identity or user state — never cacheable metadata.
export function makeShow(meta, now = Date.now()) {
  return {
    id: meta.key || showKey(meta.src, meta.ref),
    src: meta.src,            // which catalogue these episode numbers belong to
    ref: meta.ref,            // that catalogue's own id
    name: meta.name || "Untitled",
    year: meta.year || null,
    imdb: meta.imdb || null,  // the portable ids: what re-resolves this show elsewhere
    tvdb: meta.tvdb || null,
    st: DEFAULT_STATUS,
    added: now,
    m: now,
    entries: [],              // watch marks; presence means watched
  };
}

// Fill in a show record's missing fields in place. Runs on load, so a blob written by an
// older build — or hand-edited by the user, which is a supported thing to do — can't crash
// a view.
export function normShow(sh) {
  if (!sh || typeof sh !== "object" || sh.id == null) return null;
  sh.id = String(sh.id);
  const parsed = parseShowKey(sh.id);
  if (!parsed) return null;
  if (!sh.src) sh.src = parsed.src;
  if (sh.ref == null) sh.ref = parsed.ref;
  if (!sh.name) sh.name = "Untitled";
  if (sh.year != null) sh.year = +sh.year || null;
  if (sh.imdb === undefined) sh.imdb = null;
  if (sh.tvdb === undefined) sh.tvdb = null;
  if (!Array.isArray(sh.alt)) sh.alt = [];
  if (!SHOW_STATUS.includes(sh.st)) sh.st = DEFAULT_STATUS;
  if (!sh.added) sh.added = 0;
  if (!sh.m) sh.m = sh.added || 0;
  // The pass in progress. Omitted at 1, so a library nobody has rewatched costs nothing.
  const rw = Math.max(1, Math.trunc(+sh.rw) || 1);
  if (rw > 1) sh.rw = rw;
  else delete sh.rw;
  if (!Array.isArray(sh.entries)) sh.entries = [];
  /* A mark is an id, an mtime, the pass it was watched in when that is above 1, and — only
     when someone has said so — when it was actually watched.

     Those last two are different things. `m` is when the record changed and is what sync
     resolves conflicts with; `w` is when the episode was seen. They are the same for a mark
     made while watching, which is why `w` is absent then. They part company when a library is
     imported from somewhere else, where every mark was made on the day of the import and none
     of them describes an evening.

     Anything this build does not recognise is carried through untouched rather than dropped.
     It used to be dropped, and that made an out-of-date device destructive: it would load a
     mark written by a newer one, quietly delete the field it had never heard of, and push the
     stripped copy back for everyone. A field it cannot read is not a field it should be able to
     delete. */
  sh.entries = sh.entries
    .filter((e) => e && typeof e.id === "string" && /^\d+x\d+$/.test(e.id))
    .map((e) => {
      const { id, m, n, w, ...rest } = e;
      const out = { ...rest, id, m: +m || 0 };
      const level = Math.max(1, Math.trunc(+n) || 1);
      if (level > 1) out.n = level;
      const watched = +w || 0;
      if (watched > 0) out.w = watched;
      return out;
    });
  return sh;
}

// Bring any loaded state up to the current shape. Returns the same object, mutated.
export function migrate(s) {
  if (!s || typeof s !== "object") return emptyState();
  if (!s.v) s.v = SCHEMA_VERSION;
  s.settings = Object.assign(defSettings(), s.settings || {});
  s.updatedAt = +s.updatedAt || 0;
  s.shows = Array.isArray(s.shows) ? s.shows.map(normShow).filter(Boolean) : [];
  mergeDuplicates(s);
  ensureDel(s);
  // Future schema bumps append their step here, each guarded by `if (s.v < N)`.
  s.v = SCHEMA_VERSION;
  return s;
}

// Find a show by its provider-scoped key.
export const findShow = (s, id) => (s.shows || []).find((x) => x.id === String(id)) || null;

/* The same show, however it was found. Keys are provider-scoped on purpose — TVmaze and
   TMDB number some shows differently, and a mark recorded against one numbering can't be
   trusted against the other — but that means the same series carries two different keys, and
   The OA added from each catalogue landed in the library twice.

   The portable ids are what identify a series across catalogues, which is the reason they
   are stored in the vault at all. Matched in order: the key first, then IMDb, then TVDB.
   Nulls never match, or every show missing an IMDb id would be the same show. */
/* The same show as far as a person is concerned, for deciding what a search result should
   say about itself. Ids first; failing that, the same title in the same year.

   The looser test exists because TMDB's search returns no external ids — one request per
   result would be needed to get them — so a show tracked from TVmaze looked untracked in a
   TMDB result list. It offered to add House, and then refused, which is the worst of both.

   Deliberately not used for the add itself. A title is a weak claim: two different shows can
   share one, and a name should never be enough to stop something being tracked. Here the
   cost of being wrong is a label, and a tap that opens a show you do have. */
export function findLikeShow(state, card) {
  const byId = findSameShow(state, card);
  if (byId || !card) return byId;
  const name = foldText(card.name);
  if (!name || !card.year) return null;
  return (state.shows || []).find((x) => foldText(x.name) === name && x.year === card.year) || null;
}

export function findSameShow(state, meta) {
  if (!meta) return null;
  const shows = state.shows || [];
  const key = meta.key || (meta.src && meta.ref != null ? `${meta.src}:${meta.ref}` : null);
  return (key && shows.find((x) => x.id === String(key)))
    // Learned last time: the other catalogue's key for this same series.
    || (key && shows.find((x) => (x.alt || []).includes(String(key))))
    || (meta.imdb && shows.find((x) => x.imdb && x.imdb === meta.imdb))
    || (meta.tvdb && shows.find((x) => x.tvdb && String(x.tvdb) === String(meta.tvdb)))
    || null;
}

/* A short string that changes when anything worth repainting has.

   Coming back to a foregrounded tab merges the server's copy into this one, and that merge is
   almost always a no-op — nobody else has touched the vault. Repainting anyway rebuilt every
   screen: the horizontal rows dropped back to placeholders and refilled, which reads as a
   flinch every time the app is opened.

   Cheaper than comparing the states themselves, which for a large library means megabytes of
   JSON on every return. Counts and the newest mtime cover every edit there is: a mark added or
   removed moves the count, a level or a date moves an mtime, a status or a rename moves the
   show's own, and a deletion moves the count of shows. */
export function fingerprint(state) {
  let marks = 0;
  let newest = +(state && state.updatedAt) || 0;
  for (const sh of (state && state.shows) || []) {
    const entries = sh.entries || [];
    marks += entries.length;
    if (+sh.m > newest) newest = +sh.m;
    for (const e of entries) if (+e.m > newest) newest = +e.m;
  }
  const shows = ((state && state.shows) || []).length;
  return `${shows}:${marks}:${newest}:${JSON.stringify((state && state.settings) || {})}`;
}

/* ---- one series, one row ----
   Two records for the same series can already exist: they were added from different
   catalogues before anything compared the portable ids. Folding them together on load
   repairs those, and keeps repairing them when a device that still has both syncs its copy
   over.

   Nothing is thrown away. The ids of both are kept, so the record is findable by either
   catalogue's numbering afterwards, and the marks are unioned rather than replaced — an
   episode watched in either copy stays watched, at the higher of the two passes.

   The record with more marks wins the identity, since its numbering is the one most of the
   history was recorded against. Both use SxE keys, so where the catalogues agree on
   numbering — which is nearly always — the union is exact; where they disagree the marks
   from the smaller copy land on that episode number, which is the same assumption tracking
   the show under one catalogue makes anyway. */
export function mergeDuplicates(state, now = Date.now()) {
  const kept = [];
  let merged = 0;
  for (const sh of state.shows || []) {
    const twin = findSameShow({ shows: kept }, sh);
    if (!twin) { kept.push(sh); continue; }
    const keeper = weight(twin) >= weight(sh) ? twin : sh;
    const other = keeper === twin ? sh : twin;
    fold(keeper, other, now);
    kept[kept.indexOf(twin)] = keeper;
    merged++;
  }
  state.shows = kept;
  return merged;
}

// How much history a copy holds. Ties go to the one tracked first.
const weight = (sh) => (sh.entries || []).length;

const ST_RANK = { dropped: 0, planned: 1, paused: 2, active: 3 };

function fold(keeper, other, now) {
  keeper.imdb = keeper.imdb || other.imdb || null;
  keeper.tvdb = keeper.tvdb || other.tvdb || null;

  // Both keys, so the merged record answers to either catalogue from now on.
  const alt = keeper.alt || (keeper.alt = []);
  for (const key of [other.id, ...(other.alt || [])]) {
    if (key !== keeper.id && !alt.includes(key)) alt.push(key);
  }

  const byId = new Map((keeper.entries || []).map((e) => [e.id, e]));
  for (const e of other.entries || []) {
    const cur = byId.get(e.id);
    if (!cur) {
      const copy = { id: e.id, m: +e.m || 0 };
      setLevel(copy, levelOf(e));
      keeper.entries.push(copy);
      continue;
    }
    setLevel(cur, Math.max(levelOf(cur), levelOf(e)));
    cur.m = Math.max(+cur.m || 0, +e.m || 0);
  }

  // The further-along state wins: a show being watched in one copy is not merely planned.
  if ((ST_RANK[other.st] || 0) > (ST_RANK[keeper.st] || 0)) keeper.st = other.st;

  const rw = Math.max(passOf(keeper), passOf(other));
  if (rw > 1) keeper.rw = rw;
  else delete keeper.rw;

  keeper.added = Math.min(keeper.added || now, other.added || now);
  keeper.m = now;      // the record changed, so the other devices should take this version
}

/* Remember that another catalogue calls this same series by a different key.

   Worked out once, from the full record's external ids, and then kept — otherwise every
   search would rediscover it, and a result list, which only ever sees keys, would have no
   way of knowing. It is the cheapest possible index: a string, learned from a request that
   had to happen anyway. */
export function rememberAlias(show, key) {
  if (!show || !key || String(key) === show.id) return false;
  const alt = show.alt || (show.alt = []);
  if (alt.includes(String(key))) return false;
  alt.push(String(key));
  return true;
}
