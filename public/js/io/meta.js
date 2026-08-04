// The catalogue layer: one interface, several providers.
//
// This indirection is the answer to the question the whole app is built around — what
// happens when the service you depend on shuts down. A provider is one file implementing
// four functions, every show record stores which provider its ids and episode numbering
// came from, and every record also carries IMDb and TheTVDB ids so it can be re-resolved
// against a different catalogue later. Losing a provider costs a file, not a library.
//
// A provider exports: id, label, needsKey, search(query), fetchShow(ref), lookup({imdb,tvdb}),
// and returns metadata in the shape documented in io/cache.js.
import * as tvmaze from "./providers/tvmaze.js";
import * as tmdb from "./providers/tmdb.js";
import { parseShowKey, PORTABLE_SRC} from "../domain/constants.js";
import { state } from "../domain/store.js";

const PROVIDERS = { tvmaze, tmdb };
const DEFAULT_PROVIDER = "tvmaze";

export const provider = (srcId) => PROVIDERS[srcId] || PROVIDERS[DEFAULT_PROVIDER];

// The provider new searches go to. TVmaze unless TMDB is both chosen and usable, so a
// missing key degrades to something that works instead of to an error.
export function activeProvider() {
  const want = (state.settings && state.settings.provider) || DEFAULT_PROVIDER;
  const p = PROVIDERS[want];
  if (!p) return PROVIDERS[DEFAULT_PROVIDER];
  if (p.needsKey && !p.hasKey()) return PROVIDERS[DEFAULT_PROVIDER];
  return p;
}

export const search = (query) => activeProvider().search(query);

// Fetch by the app's own provider-scoped key ("tvmaze:169"), so callers never have to know
// which catalogue a given show came from.
/* Can this catalogue be reached at all? TVmaze always can. TMDB only with a key, and the
   key can be removed — or the whole service can go away, which is the thing this app exists
   to survive. */
export const usable = (srcId) => {
  const p = provider(srcId);
  return !p.needsKey || p.hasKey();
};

/* Turn a portable link into this device's own key.
 *
 * Asked of every catalogue that can be reached, starting with the one in use, so a reader on
 * TVmaze gets a TVmaze key and a reader with a TMDB key gets a TMDB one. What comes back is a
 * real catalogue record with a real catalogue key, which is the only kind the vault stores.
 *
 * Null when nothing can place it. That is a real outcome — a show one catalogue has never
 * heard of — and it is the caller's job to say so rather than to show an empty page. */
export async function resolvePortable(key) {
  const parsed = parseShowKey(key);
  if (!parsed || !PORTABLE_SRC.has(parsed.src)) return null;
  const ids = parsed.src === "imdb" ? { imdb: parsed.ref } : { tvdb: parsed.ref };
  const first = activeProvider().id;
  const order = [first, ...Object.keys(PROVIDERS).filter((id) => id !== first)];
  for (const id of order) {
    if (!usable(id)) continue;
    const found = await PROVIDERS[id].lookup(ids).catch(() => null);
    if (found) return found;
  }
  return null;
}

/* Metadata for one show, from its own catalogue where possible and from another where not.

   A show added under TMDB is numbered by TMDB and stays that way — its marks were recorded
   against that numbering. But if the key is deleted, that catalogue can no longer answer
   anything, and without a fallback the show would go blank: no artwork, no episode list, no
   air dates, on every device with a cold cache. The portable ids in the vault are stored for
   exactly this, and the alias learned from a previous match makes the common case a direct
   request rather than a search.

   What comes back is filed under the key that was asked for, so the marks still line up with
   it. Where two catalogues disagree on numbering some marks will sit on the wrong episode —
   which is worth saying plainly, and is still better than a show that shows nothing. */
export async function fetchShow(key, { alt = [], imdb = null, tvdb = null } = {}) {
  const parsed = parseShowKey(key);
  if (!parsed) throw new Error("Bad show key: " + key);
  if (usable(parsed.src)) return provider(parsed.src).fetchShow(parsed.ref);

  // Already known to be the same show under a catalogue that does answer.
  for (const other of alt) {
    const a = parseShowKey(other);
    if (a && usable(a.src)) return standIn(await provider(a.src).fetchShow(a.ref), key);
  }

  for (const id of Object.keys(PROVIDERS)) {
    if (id === parsed.src || !usable(id)) continue;
    const found = await PROVIDERS[id].lookup({ imdb, tvdb }).catch(() => null);
    if (found) return standIn(found, key);
  }

  throw new Error(`${provider(parsed.src).label} can't be reached, and this show has no id to find it by elsewhere.`);
}

// Filed under the key that was asked for, with a note of where the answer actually came from.
const standIn = (m, key) => ({ ...m, key, from: m.key });

/* Ask a provider what changed recently. Optional: a provider without a bulk endpoint returns
   null, and callers fall back to per-show staleness. TMDB has no equivalent, which is another
   reason TVmaze is the default. */
/* The trailer, from whichever catalogue in use has one — which today means TMDB, since TVmaze
   indexes no video at all.

   A record TMDB answered for carries it already, appended to the request it cost anyway. One
   numbered elsewhere is translated the same way its cast is, and then asked. Held for the
   session either way: a trailer does not change while you are reading the page. */
export function trailer(m) {
  if (m && m.trailer) return Promise.resolve(m.trailer);
  const own = answeredFor(m);
  if (!own) return Promise.resolve(null);

  return once(`trailer:${activeProvider().id}:${own.src}:${own.ref}`, async () => {
    const at = await castFrom(m);
    if (!at || !at.p.videos || !usable(at.p.id)) return null;
    return at.p.videos(at.ref).catch(() => null);
  });
}

/* A season's own trailer, when that season has one. Never the show's as a stand-in: on the page
   for season two, the show's current trailer is an advertisement for season four. */
export function seasonTrailer(m, n) {
  const own = answeredFor(m);
  if (!own || n == null) return Promise.resolve(null);

  return once(`trailer:${activeProvider().id}:${own.src}:${own.ref}:s${n}`, async () => {
    const at = await castFrom(m);
    if (!at || !at.p.seasonVideos || !usable(at.p.id)) return null;
    return at.p.seasonVideos(at.ref, n).catch(() => null);
  });
}

/* ---- people ----
   Held for the session and no longer. Cast is not yours — it is the catalogue's, it never
   enters the vault, and it costs one request to fetch again — so it has no business in the
   durable cache alongside the episode lists.

   Which catalogue to ask is settled by the record in hand: whichever one actually answered for
   the show, which is not always the one its key names once a catalogue has stood in for
   another. */
const people = new Map();

const once = (key, fn) => {
  if (!people.has(key)) people.set(key, fn().catch((e) => { people.delete(key); throw e; }));
  return people.get(key);
};

const answeredFor = (m) => parseShowKey((m && (m.from || m.key)) || "");

/* Which catalogue the record in hand came from, by name. Everything inside a record — its
   episodes, their dates, their scores — came from one catalogue, and a number with no source
   is folklore: 8.4 on TVmaze and 8.4 on TMDB are different claims by different crowds. The
   show page has said where its scores come from since the beginning; this is how the season
   and episode pages say the same about theirs.

   It is whoever answered, which is not always the catalogue in use: a show tracked from TVmaze
   keeps TVmaze's numbering, and its episode scores are TVmaze's. */
export function sourceOf(m) {
  const at = answeredFor(m);
  return at ? provider(at.src).label : "";
}

/* ---- episode scores, from the catalogue in use ----

   The same rule the cast follows, for the same reason. A show tracked from TVmaze keeps its
   TVmaze key forever, because that is what its marks are recorded against — but the numbering
   is the only part of that which has to stay. Reading the scores out of the record meant a
   reader who had chosen TMDB, and given it a key, was shown TVmaze's numbers on every episode
   page and every season average, however plainly TMDB was selected.

   Held for the session and never written to the durable cache, exactly as the cast is: these
   are not the record, they are what one catalogue currently thinks, and a cache that outlived
   a change of catalogue would serve the wrong crowd's numbers after the setting had changed.

   Matched by episode number within the season, which is the part worth being plain about: the
   two catalogues do not always split a season the same way, and an episode the chosen
   catalogue does not list gets no score rather than keeping the other one's. A number labelled
   TMDB has to be TMDB's. */
const overlays = new Map();

const overlayKey = (m, n) => {
  const own = answeredFor(m);
  return own ? `scores:${activeProvider().id}:${own.src}:${own.ref}:s${n}` : null;
};

/* Whether the catalogue in use is already the one that answered. When it is, the record's own
   scores are that catalogue's and there is nothing to fetch or to overlay. */
const ownScores = (m) => {
  const own = answeredFor(m);
  return !!own && activeProvider().id === own.src;
};

/* What has already arrived, as a Map of episode number to score, or null. Synchronous, so a
   render can consult it without becoming asynchronous itself. */
export function scoresFor(m, n) {
  if (!m || ownScores(m)) return null;
  const key = overlayKey(m, n);
  const got = key && overlays.get(key);
  return got instanceof Map ? got : null;
}

// Which crowd the scores on screen belong to, which is the catalogue in use once one has been
// borrowed from and the record's own until then.
export function scoreSourceOf(m, n) {
  return scoresFor(m, n) ? activeProvider().label : sourceOf(m);
}

/* Fetch them if they are wanted and not already here. Resolves true when something arrived
   that was not on screen, which is a caller's cue to repaint and nothing more. */
export function ensureScores(m, n) {
  if (!m || ownScores(m) || !Number.isFinite(n)) return Promise.resolve(false);
  const key = overlayKey(m, n);
  if (!key || overlays.has(key)) return Promise.resolve(false);

  overlays.set(key, "asking");          // so a repaint mid-flight does not ask again
  return once(key, async () => {
    const at = await castFrom(m);       // the catalogue in use, by its own id for this show
    if (!at || at.p.id !== activeProvider().id || !at.p.seasonScores || !usable(at.p.id)) return null;
    return at.p.seasonScores(at.ref, n);
  }).then((rows) => {
    if (!rows || !rows.length) { overlays.set(key, null); return false; }
    overlays.set(key, new Map(rows.map((r) => [r.e, r.score])));
    return true;
  }).catch(() => {
    // A catalogue that will not answer is not an error worth showing; the record's own stand.
    overlays.set(key, null);
    return false;
  });
}

/* Cast comes from the catalogue in use, not from the one the show happens to be numbered by.

   A show tracked from TVmaze keeps its TVmaze key forever — that is what its marks are recorded
   against — so keying the cast to it meant TMDB was never asked, however plainly it was
   selected. Since none of this is stored, the numbering is irrelevant here: only which
   catalogue the person is being read from, and which profile the link should point at.

   Where the two differ, the chosen catalogue is asked for its own id for the show first, using
   the portable ids on the record. That costs one extra request, once, and if it comes back with
   nothing the show's own catalogue answers instead — a cast list from the other one beats no
   cast list at all. */
async function castFrom(m) {
  const own = answeredFor(m);
  const want = activeProvider();

  if (own && want.id === own.src) return { p: want, ref: own.ref };

  if (want.credits && want.refFromExternal && (m.imdb || m.tvdb)) {
    const ref = await want.refFromExternal({ imdb: m.imdb, tvdb: m.tvdb }).catch(() => null);
    if (ref) return { p: want, ref };
  }

  return own && usable(own.src) ? { p: provider(own.src), ref: own.ref } : null;
}

export function credits(m) {
  const own = answeredFor(m);
  if (!own) return Promise.resolve([]);
  // Keyed by the catalogue in use as well as the show, so switching catalogue re-asks rather
  // than handing back the other one's answer.
  return once(`credits:${activeProvider().id}:${own.src}:${own.ref}`, async () => {
    const at = await castFrom(m);
    if (!at || !at.p.credits || !usable(at.p.id)) return [];
    return at.p.credits(at.ref);
  });
}

export function person(personKey) {
  const at = parseShowKey(personKey);
  if (!at) return Promise.reject(new Error("Bad person key: " + personKey));
  const p = provider(at.src);
  if (!p.person) return Promise.reject(new Error(`${p.label} doesn't publish people.`));
  if (!usable(at.src)) return Promise.reject(new Error(`${p.label} can't be reached.`));
  return once(`person:${personKey}`, () => p.person(at.ref));
}

/* ---- scores from wherever they can be had ----
   A show tracked from TVmaze keeps TVmaze's numbering, because that is what its marks were
   recorded against — merging two records never changes that. But a score is not numbering.
   Once the record carries the portable ids, the other catalogue can be asked what it thinks
   of the same show, and both answers can sit side by side with their names on them.

   One request, and only for a page that shows scores; the answer is cached with the rest of
   the record. A failure is silent, since a missing second opinion is not an error. */
export async function withOtherScores(m) {
  if (!m || !m.imdb) return m;
  const have = new Set((m.ratings || []).map((r) => r.source));
  const asks = [];

  if (!have.has("TMDB") && tmdb.hasKey()) {
    asks.push(
      tmdb.tmdbIdFromExternal({ imdb: m.imdb, tvdb: m.tvdb })
        .then((ref) => (ref ? tmdb.ratingOf(ref) : null)),
    );
  }
  if (!have.has("TVmaze")) asks.push(tvmaze.ratingByImdb(m.imdb));
  if (!asks.length) return m;

  const found = await Promise.all(asks.map((p2) => p2.catch(() => null)));
  const extra = found.filter(Boolean).filter((r) => !have.has(r.source));
  if (!extra.length) return m;
  return { ...m, ratings: [...(m.ratings || []), ...extra] };
}

export async function updatedSince(srcId, since = "week") {
  const p = PROVIDERS[srcId];
  if (!p || !p.updatedSince) return null;
  try { return await p.updatedSince(since); } catch (e) { return null; }
}

// Check a provider's credentials, where it has any. Returns null when there is nothing to
// check, an error message when the check fails, and "" when the key is good.
export async function verifyKey(srcId) {
  const p = PROVIDERS[srcId];
  if (!p || !p.verifyKey) return null;
  try { await p.verifyKey(); return ""; }
  catch (e) { return e.message || "Could not reach the catalogue."; }
}

// Find the same show in another catalogue, using the portable ids stored in the vault.
// This is the migration path: point it at whichever provider is still standing.
export async function reresolve(show, targetId = DEFAULT_PROVIDER) {
  const p = PROVIDERS[targetId];
  if (!p || !p.lookup) return null;
  if (!show.imdb && !show.tvdb) return null;
  return p.lookup({ imdb: show.imdb, tvdb: show.tvdb });
}
