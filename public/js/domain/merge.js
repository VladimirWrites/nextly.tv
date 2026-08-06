// Multi-device merge: per-record modified-times (m) + tombstones for deletions.
//
// Edits aren't stamped by every handler. Instead stampMtimes() diffs the live state against
// the last-synced "baseline" to assign an m to each changed record and a tombstone to each
// removed one. mergeStates() then merges local+remote per record — newest m wins, deletions
// honoured — rather than letting one whole document overwrite the other.
//
// The record granularity is the point: a show is a parent, and each watch mark is its own
// child record. Two devices marking different episodes of the same show both win, because
// they touched different records. Only the same episode on both devices is a real conflict,
// and that one resolves newest-first.
//
// A watch mark carries a level: the pass it was watched in (absent means the first). Losing
// a mark entirely — unwatching on a first pass — is a deletion, which is what the tombstones
// are for: without them, a device that still holds the old mark would silently re-add it on
// the next merge.
import { DEL_KINDS, levelOf, setLevel } from "./constants.js";
import { ensureDel, defSettings } from "./schema.js";
import { state } from "./store.js";

const clone = (s) => JSON.parse(JSON.stringify(s));

// Snapshot of the last-synced state, used as the diff baseline by stampMtimes().
let baseline = null;
export function setBaseline(s) {
  try { baseline = clone(s || state); } catch (e) { baseline = null; }
}
// Tombstone key for one episode of one show.
export const epTombKey = (showId, epId) => `${showId}|${epId}`;

// Stamp the whole live state against the baseline. Mutates state in place.
export function stampMtimes(now = Date.now(), s = state) {
  const b = baseline || {};
  const del = ensureDel(s);

  if (JSON.stringify(omitM(s.settings)) !== JSON.stringify(omitM(b.settings || defSettings()))) {
    s.settings.m = now;
  }

  const bShows = new Map((b.shows || []).map((p) => [p.id, p]));
  const seenShows = new Set();

  (s.shows || []).forEach((sh) => {
    seenShows.add(sh.id);
    const old = bShows.get(sh.id);
    if (!old) sh.m = sh.m || now;
    else if (!showMetaEq(sh, old)) sh.m = now;
    else sh.m = sh.m || old.m || 0;

    const bEntries = new Map(((old && old.entries) || []).map((e) => [e.id, e]));
    const seenEps = new Set();
    (sh.entries || []).forEach((e) => {
      seenEps.add(e.id);
      const oe = bEntries.get(e.id);
      if (!oe) e.m = e.m || now;
      // A mark can change without appearing or disappearing: rewatching an episode raises its
      // level, and correcting an imported date sets when it was watched. Both are content
      // changes, so they need a fresh mtime or the merge would keep handing the win to
      // whichever device happens to hold the older copy.
      else if (levelOf(e) !== levelOf(oe) || (+e.w || 0) !== (+oe.w || 0)) e.m = now;
      else e.m = e.m || oe.m || 0;
    });
    // Marks present at last sync but gone now = the user unwatched them.
    bEntries.forEach((_oe, id) => {
      if (!seenEps.has(id)) del.ep[epTombKey(sh.id, id)] = now;
    });
  });

  // Shows present at last sync but gone now = removed from the library.
  bShows.forEach((_old, id) => {
    if (!seenShows.has(id)) del.show[id] = now;
  });

  return s;
}

const omitM = (o) => {
  const c = { ...(o || {}) };
  delete c.m;
  return c;
};

// A show's own fields, ignoring its watch marks and mtime — these are what a metadata edit
// or a status change touches.
const showMetaEq = (a, b) =>
  JSON.stringify(omitM({ ...a, entries: undefined })) === JSON.stringify(omitM({ ...b, entries: undefined }));

// Merge two tombstone stores, keeping the latest time per id in each bucket.
//
// Tombstones are never pruned. They're only created by unwatching an episode or removing a
// show — both rare — and dropping one early would let a long-offline device resurrect the
// record it deletes. ~30 bytes each is a cheap price for that guarantee.
function mergeDel(a, b) {
  const out = {};
  DEL_KINDS.forEach((k) => {
    const o = {};
    Object.entries((a && a[k]) || {}).forEach(([i, t]) => (o[i] = Math.max(o[i] || 0, +t || 0)));
    Object.entries((b && b[k]) || {}).forEach(([i, t]) => (o[i] = Math.max(o[i] || 0, +t || 0)));
    out[k] = o;
  });
  return out;
}

// A show's effective mtime: the newest of the show record and all its marks. A
// show-deletion tombstone then only wins over edits that are genuinely older than it,
// so "device A deletes the show, device B watches an episode" keeps the show.
const showM = (sh) => (sh.entries || []).reduce((m, e) => Math.max(m, +e.m || 0), +sh.m || 0);

// Merge two whole states per record. Order-independent: merge(a, b) and merge(b, a) agree.
export function mergeStates(a, b) {
  const del = mergeDel(a.del, b.del);
  const A = new Map((a.shows || []).map((p) => [p.id, p]));
  const B = new Map((b.shows || []).map((p) => [p.id, p]));
  const shows = [];

  new Set([...A.keys(), ...B.keys()]).forEach((id) => {
    const pa = A.get(id);
    const pb = B.get(id);
    const tomb = del.show[id] || 0;
    // A tombstone wins ties: deleting then re-adding at the same millisecond is not a case
    // worth preserving, and letting deletions lose ties would make them unreliable.
    if (tomb > 0 && tomb >= Math.max(pa ? showM(pa) : 0, pb ? showM(pb) : 0)) return;

    const meta = (pa ? +pa.m || 0 : -1) >= (pb ? +pb.m || 0 : -1) ? pa || pb : pb || pa;

    const marks = new Map();
    const addMark = (e) => {
      const t = del.ep[epTombKey(id, e.id)] || 0;
      const m = +e.m || 0;
      if (t > 0 && t >= m) return;                       // unwatched later than this mark
      const ex = marks.get(e.id);
      if (!ex) { marks.set(e.id, e); return; }
      const em = +ex.m || 0;
      if (em < m) marks.set(e.id, e);
      else if (em === m) marks.set(e.id, reconcile(ex, e));
    };
    ((pa && pa.entries) || []).forEach(addMark);
    ((pb && pb.entries) || []).forEach(addMark);

    /* Ratings merge per id, like marks, so the newer number wins wherever it was given and the
       rest of the record is not dragged along with it. No tombstones: a rating taken back is
       stored as zero, so clearing is an ordinary edit that competes on its mtime like any
       other. A tie keeps the higher number rather than picking arbitrarily — the same rule the
       marks use for a tied pass level, and it makes merge(a, b) and merge(b, a) agree. */
    const rats = new Map();
    const addRating = (r) => {
      const ex = rats.get(r.id);
      if (!ex) { rats.set(r.id, r); return; }
      const em = +ex.m || 0;
      const m = +r.m || 0;
      if (em < m) rats.set(r.id, r);
      else if (em === m && (+r.v || 0) > (+ex.v || 0)) rats.set(r.id, r);
    };
    ((pa && pa.rats) || []).forEach(addRating);
    ((pb && pb.rats) || []).forEach(addRating);

    const merged = { ...meta, entries: [...marks.values()].sort(byEpKey) };
    if (rats.size) merged.rats = [...rats.values()].sort((x, y) => (x.id < y.id ? -1 : 1));
    else delete merged.rats;
    shows.push(merged);
  });

  const sa = a.settings || defSettings();
  const sb = b.settings || defSettings();
  const out = clone((+a.updatedAt || 0) >= (+b.updatedAt || 0) ? a : b);
  out.settings = clone((+sa.m || 0) >= (+sb.m || 0) ? sa : sb);
  out.shows = clone(shows);
  out.del = del;
  out.updatedAt = Math.max(+a.updatedAt || 0, +b.updatedAt || 0);
  return out;
}

/* Two copies of one mark, stamped at the same millisecond and disagreeing about their contents.

   Taking whichever arrived first made the answer depend on which side of the merge a device
   happened to be on — and since every device merges its own copy first, each kept its own and
   the two never converged. Pressing Sync on both did nothing at all, which is what it looked
   like from the outside.

   So a tie is reconciled rather than won: the higher level, because an episode seen twice was
   seen twice whatever the other copy says; the earlier watch date, because it is the one nearer
   to when the episode was actually watched; and for anything neither of those covers, the
   smaller of the two written out — arbitrary, but the same arbitrary answer on both machines. */
function reconcile(a, b) {
  const out = { ...b, ...a };
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === "id" || k === "m" || k === "n" || k === "w") continue;
    const x = a[k];
    const y = b[k];
    if (x !== undefined && y !== undefined && x !== y) {
      out[k] = JSON.stringify(x) <= JSON.stringify(y) ? x : y;
    }
  }
  out.m = +a.m || 0;
  setLevel(out, Math.max(levelOf(a), levelOf(b)));

  const dates = [+a.w || 0, +b.w || 0].filter(Boolean);
  if (dates.length) out.w = Math.min(...dates);
  else delete out.w;

  return out;
}

// Sort marks by season then episode, so the blob is stable and diffable.
function byEpKey(x, y) {
  const [xs, xe] = x.id.split("x").map(Number);
  const [ys, ye] = y.id.split("x").map(Number);
  return xs - ys || xe - ye;
}
