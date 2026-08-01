// Metadata cache: episode lists, titles, air dates, poster paths.
//
// This is deliberately NOT in the vault. It's rebuildable from TMDB at any time, it dwarfs
// the watch marks in size, and keeping it out means the encrypted blob stays small enough to
// push on every tap. It lives in IndexedDB rather than localStorage because a few hundred
// shows of episode data is megabytes, well past the 5 MB localStorage ceiling.
//
// It's also what makes the app usable offline: the library renders from here, and the
// catalogue is only consulted to refresh it.
//
// Every provider normalizes to this shape, keyed by the provider-scoped show key:
//   { key: "tvmaze:169", src, ref, name, year, status, overview, network, runtime, genres,
//     poster, posterSm, backdrop, imdb, tvdb,
//     seasons: [ { n, name, air, episodes: [ { e, name, air, runtime, overview, special } ] } ] }

const DB_NAME = "nextly";
const DB_VERSION = 1;
const STORE = "meta";

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexeddb"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.onerror = () => reject(t.error);
    if (req) { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }
    else t.oncomplete = () => resolve();
  }));
}

/* ---- in-memory mirror ----
   Every render asks for the metadata of every visible show, and rendering can't await. So the
   whole cache is read into memory once at boot and kept in sync on write; IndexedDB is the
   durable copy, this Map is the one the UI reads. */
const mem = new Map();
// When each entry was fetched, mirrored alongside `mem` so staleness can be judged without
// an IndexedDB round trip per show — that check runs once per show on every library load.
const ats = new Map();

/* ---- hints ----
   A search result already carries the poster, the name, the year and a summary. Opening it
   used to discard all of that and start from an empty page, so the same picture the user had
   just tapped was fetched again before it could be shown. A hint is that card, kept until the
   full record replaces it: enough to draw the page, never enough to be mistaken for it —
   there are no episodes in a hint, so nothing that counts progress can read one by accident.

   Memory only. It exists for the seconds between a tap and a response. */
const hints = new Map();

export function putHint(card) {
  if (card && card.key) hints.set(String(card.key), card);
}

export const getHint = (id) => hints.get(String(id)) || null;

export const getMeta = (id) => mem.get(String(id)) || null;
export const metaOf = (id) => getMeta(id);   // the shape progress.js expects
export const fetchedAt = (id) => ats.get(String(id)) || 0;
export const has = (id) => mem.has(String(id));

export async function loadAll() {
  try {
    const rows = await tx("readonly", (s) => s.getAll());
    for (const row of rows || []) {
      mem.set(String(row.id), row.meta);
      ats.set(String(row.id), row.at || 0);
    }
    return mem.size;
  } catch (e) {
    return 0;                                 // private-mode or blocked IndexedDB: run memory-only
  }
}

export async function putMeta(meta, at = Date.now()) {
  // Stamped on the way in, so a record can say which set of fields it was written with.
  meta = { ...meta, shape: SHAPE };
  mem.set(String(meta.key), meta);
  ats.set(String(meta.key), at);
  try { await tx("readwrite", (s) => s.put({ id: String(meta.key), meta, at })); } catch (e) {}
  return meta;
}

export async function dropMeta(id) {
  mem.delete(String(id));
  ats.delete(String(id));
  try { await tx("readwrite", (s) => s.delete(String(id))); } catch (e) {}
}

export async function clearAll() {
  mem.clear();
  ats.clear();
  try { await tx("readwrite", (s) => s.clear()); } catch (e) {}
}

/* What a stored record is expected to contain. Raised whenever a field is added to the
   normalizers, because a record written before that field existed is not wrong — it is
   incomplete, and no amount of waiting will fill it in.

   Without this, adding per-episode scores meant nobody saw one for up to thirty days: the
   record was fresh by every measure the cache had, and the field it lacked was simply
   missing. Anything below the current number is refetched on next sight.

   3: per-episode score and still, and the show's air days. */
export const SHAPE = 3;

// How stale a cached show may be before it's worth refetching. A finished show never gains
// episodes, so it's checked rarely; a running one can gain an episode any week.
const DAY = 86_400_000;
export function isStale(meta, at, now = Date.now()) {
  if (!meta || !at) return true;
  if ((meta.shape || 0) < SHAPE) return true;      // written before a field it should carry
  const ended = /ended|canceled|cancelled/i.test(meta.status || "");
  return now - at > (ended ? 30 * DAY : DAY);
}
