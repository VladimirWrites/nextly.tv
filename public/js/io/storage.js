// Persistence and multi-device sync. Talks to localStorage and /api/vault, and reports
// status to the UI through the injected listeners.
//
// Writes are optimistically concurrent. Every push carries the `updated_at` this client last
// saw; if the server has moved on since, it answers 409 with the current blob, and this
// module merges and retries instead of overwriting whatever the other device wrote. Without
// that check, two devices open at once would quietly clobber each other — the exact failure
// per-record merging exists to prevent.
import { state, setState } from "../domain/store.js";
import { stampMtimes, setBaseline, mergeStates } from "../domain/merge.js";
import { migrate, emptyState, fingerprint } from "../domain/schema.js";
import { encS, decS, keysReady, getAccountId } from "./crypto.js";
import { MAX_BLOB } from "../../lib/limits.js";
import { APP_ID } from "../brand.js";

const LS_STATE = "nx_state";
const LS_STATE_BAK = "nx_state_bak";
const LS_TOKEN = "nx_token";
const LS_SYNCED = "nx_synced_at";
const LS_SEEN = "nx_seen_at";     // server updated_at this client last reconciled with
const LS_VIEW = "nx_view";        // how this device likes to look at the library
const LS_THEME = "nx_theme";      // light | dark; absent means follow the system

const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  rem(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

export const syncedAt = () => +LS.get(LS_SYNCED) || 0;

/* ---- keeping what is here ----
   Everything this app knows offline — the vault's local copy and the whole metadata cache —
   lives in storage a browser is allowed to throw away when a device runs short. For an app
   whose one promise is not losing your watch history, that is worth asking about.

   Asked once, after there is something worth keeping. Chrome decides on its own from whether
   the app is installed and used; Firefox asks the user. A refusal changes nothing that was
   already working, so nothing waits on the answer. */
export async function askToPersist() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) {
    return false;
  }
}

// What the offline copy costs, for the one place it is worth saying: Settings.
export async function storageUse() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return { usage: usage || 0, quota: quota || 0, persisted };
  } catch (e) {
    return null;
  }
}

/* ---- view preferences ----
   Kept on the device rather than in the vault. Which order you like the library in is a
   property of the screen you're looking at, not of your watch history — a phone and a
   desktop can reasonably disagree, and it isn't worth a sync round trip or a byte of
   ciphertext. Never contains anything about what you watch. */
/* Theme, for the same reason as the view preferences below and with one extra: app.html reads
   this key in an inline script before the first paint, so a reload never flashes the wrong
   colours. Absent means auto, which is why choosing auto removes it rather than storing it. */
export const readTheme = () => LS.get(LS_THEME) || "auto";

export function writeTheme(pref) {
  if (pref === "light" || pref === "dark") LS.set(LS_THEME, pref);
  else LS.rem(LS_THEME);
}

/* A vault written before the theme moved to the device still carries one. It is taken over
   here, once, and only when this device has no preference of its own — a device that has
   already been set has the better answer, and an incoming sync must not overwrite it.
   migrate() drops the field immediately after, so it stops travelling and stops appearing in
   the export. */
function adoptLegacyTheme(parsed) {
  const set = parsed && parsed.settings;
  if (!set || !set.theme) return parsed;
  // Shared on purpose: the vault is the authority and every device follows it.
  if (set.themeSync) writeTheme(set.theme);
  // Otherwise it is a leftover from when theme always synced. Taken over once, and only where
  // this device has no answer of its own — one already set knows better than an old vault.
  else if (set.theme !== "auto" && !LS.get(LS_THEME)) writeTheme(set.theme);
  return parsed;
}

const hydrate = (parsed) => migrate(adoptLegacyTheme(parsed));

export function readView() {
  try { return JSON.parse(LS.get(LS_VIEW)) || {}; } catch (e) { return {}; }
}

export function writeView(patch) {
  LS.set(LS_VIEW, JSON.stringify({ ...readView(), ...patch }));
}
const seenAt = () => +LS.get(LS_SEEN) || 0;

// The UI injects how to show sync state and how to re-render after remote data lands.
let setSync = () => {};
let onDataChanged = () => {};
export function setSyncReporter(fn) { setSync = fn; }
export function setDataListener(fn) { onDataChanged = fn; }

/* ---- the account number ----
   Remembered on this device so the app opens straight into the library. It's the only
   credential, so "sign out" means forgetting it here — the vault itself is untouched. */
export const rememberedToken = () => LS.get(LS_TOKEN);
export const rememberToken = (t) => LS.set(LS_TOKEN, t);
export function forgetToken() {
  LS.rem(LS_TOKEN);
  LS.rem(LS_STATE);
  LS.rem(LS_STATE_BAK);
  LS.rem(LS_SYNCED);
  LS.rem(LS_VIEW);
  LS.rem(LS_SEEN);
}

/* ---- local storage ---- */

// Keep a one-deep backup of the previous local state, so a bad write stays recoverable.
function saveLocal() {
  try {
    const prev = LS.get(LS_STATE);
    if (prev) LS.set(LS_STATE_BAK, prev);
  } catch (e) {}
  LS.set(LS_STATE, JSON.stringify(state));
}

function loadLocal() {
  const r = LS.get(LS_STATE);
  try { return r ? hydrate(JSON.parse(r)) : null; } catch (e) { return null; }
}

/* ---- server sync ---- */

let syncTimer;
let warned = false;

// Called after every mutation. Saves locally at once and debounces the push, so marking a
// run of episodes is one request rather than eight.
export function scheduleSync() {
  state.updatedAt = Date.now();
  stampMtimes();
  saveLocal();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushServer(), 1200);
}

export function flushSync() {
  clearTimeout(syncTimer);
  return pushServer(false, true);
}

async function putBlob(blob, keepalive) {
  const body = JSON.stringify({ id: getAccountId(), blob, prev: seenAt() || null });
  const opts = { method: "PUT", headers: { "content-type": "application/json" }, body };
  // keepalive is ONLY for the tab-close flush: it shares a small browser-wide quota, and
  // spending it on routine saves can make ordinary fetches start throwing.
  if (keepalive && body.length < 60000) opts.keepalive = true;
  return fetch("/api/vault", opts);
}

export async function pushServer(manual = false, keepalive = false, retry = 0) {
  if (!keysReady()) return false;
  try {
    stampMtimes();
    const blob = await encS();
    if (blob.length > MAX_BLOB) {
      setSync("off", "Too big to sync");
      return false;
    }
    setSync("sync", "Saving");
    const r = await putBlob(blob, keepalive);

    if (r.status === 409 && retry < 2) {
      // Another device wrote since we last looked. Merge its version in, then try again.
      const { blob: theirs, updated_at } = await r.json();
      await mergeRemote(theirs, updated_at);
      onDataChanged();
      return pushServer(manual, keepalive, retry + 1);
    }

    if (r.ok) {
      const { updated_at } = await r.json();
      setBaseline(state);
      LS.set(LS_SEEN, String(updated_at));
      LS.set(LS_SYNCED, String(Date.now()));
      setSync("ok", "Saved");
      warned = false;
      return true;
    }

    if (r.status === 429) {
      setSync("off", "Rate limited");
      if (manual || !warned) { warned = true; setSync("off", "Too many new accounts from this network — saved on this device"); }
      return false;
    }

    setSync("off", "Sync error");
    return false;
  } catch (e) {
    setSync("off", "Offline — saved here");
    return false;
  }
}

// Pull the server's copy and merge it into the live state.
async function mergeRemote(blob, updatedAt) {
  const remote = hydrate(await decS(blob));
  const before = fingerprint(state);
  const merged = migrate(mergeStates(state, remote));
  const changed = fingerprint(merged) !== before;
  setState(merged);
  setBaseline(merged);
  saveLocal();
  if (updatedAt) LS.set(LS_SEEN, String(updatedAt));
  LS.set(LS_SYNCED, String(Date.now()));
  // Null when the merge brought nothing new, so a caller can tell "synced" from "changed".
  return changed ? merged : null;
}

/* Fetch the vault and merge it with whatever is already loaded locally. Used at sign-in and
   whenever the tab regains focus, so a device that was asleep catches up on its own.

   Returns the merged state only when the merge actually changed something, and null otherwise —
   which is the usual case on a foreground, and is what lets the app leave the screen alone. */
/* A phone whose radio is asleep, or on a connection that accepts the socket and then says
   nothing, leaves fetch waiting for minutes — the browser's own limit is far past the point
   where a person has decided the app is broken. Sync is the one thing here that can be given
   up on safely: the local copy is complete, the next foreground tries again, and nothing is
   lost by deciding this attempt is not coming. */
const VAULT_TIMEOUT = 12000;

/* Feature-checked rather than called outright. AbortSignal.timeout is not in Safari before 16,
   and calling it there throws — inside the try below, which would have been caught and reported
   as "Offline", quietly turning a missing convenience into a device that never syncs again. */
const giveUpAfter = (ms) =>
  (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(ms) : undefined;

export async function loadServer() {
  if (!keysReady()) return null;
  try {
    const r = await fetch("/api/vault", {
      headers: { "X-Vault-Id": getAccountId() },
      signal: giveUpAfter(VAULT_TIMEOUT),
    });
    if (r.status === 404) {
      setSync("ok", "New vault");
      setBaseline(state);
      return null;                       // nothing stored yet; first push creates the row
    }
    if (!r.ok) { setSync("off", "Local only"); return null; }
    const { blob, updated_at } = await r.json();
    const merged = await mergeRemote(blob, updated_at);
    setSync("ok", "Synced");
    return merged;
  } catch (e) {
    setSync("off", "Offline");
    return null;
  }
}

/* ---- bringing a session up, in two halves ----

   Split because they cost completely different things. The local half is a localStorage read
   and is done before the next frame; the server half is a round trip on a radio that may have
   been asleep. Joined together they were one await, and the app drew nothing until the slow
   half finished — a documented "paints immediately" that never did. */

/* Everything that needs no network. Returns false when this device has no copy yet, which is
   the one case where painting straight away would be a lie: a new device signing in to an
   existing account would show an empty library and then fill it, which reads as data loss to
   the person it happens to. */
export function openLocal() {
  const local = loadLocal();
  setState(local || emptyState());
  setBaseline(state);
  return !!local;
}

// The server half. Resolves truthy when the merge changed something and the screen is stale.
export async function syncVault() {
  const merged = await loadServer();
  // A merge that changed anything needs pushing back, so the other device converges too.
  if (merged) await pushServer();
  return merged;
}

// Both halves in order, for a caller that has nothing to draw until the vault is whole.
export async function bootVault() {
  openLocal();
  await syncVault();
  return state;
}

export async function deleteVault() {
  if (!keysReady()) return false;
  try {
    const r = await fetch("/api/vault", { method: "DELETE", headers: { "X-Vault-Id": getAccountId() } });
    return r.ok;
  } catch (e) {
    return false;
  }
}

/* ---- export / import ----
   The escape hatch that makes the rest of this optional: a plain JSON file the user holds,
   readable in any text editor, with show names spelled out. If this app disappears, that
   file is still a complete record of what you watched. */

/* The export is a file people are told to keep, and told they can hand to something else. It
   is also the only copy of a library that survives this app disappearing, so what goes in it
   is a real choice rather than an obvious one.

   Credentials are the part worth deciding about. The TMDB key is yours, it belongs with a
   backup, and leaving it out means re-entering it after a restore. It is also a live
   credential sitting in a plaintext file that gets mailed around, posted for debugging and
   handed to converter scripts. Both are true at once, so the caller says which it wants.

   `keys: false` takes out anything credential-shaped. Nothing else in settings is a secret. */
export function exportJSON({ keys = true } = {}) {
  const settings = { ...(state.settings || {}) };
  if (!keys) {
    delete settings.tmdbKey;
    // Whatever else ends up here. A field that does not exist yet costs nothing to remove,
    // and a credential that outlives someone remembering to add it here costs plenty.
    delete settings.sync;
  }
  return JSON.stringify(
    { app: APP_ID, exported: new Date().toISOString(), ...state, settings },
    null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.shows)) throw new Error("Not a nextly export — no shows in this file.");
  const incoming = hydrate(parsed);
  const merged = migrate(mergeStates(state, incoming));
  setState(merged);
  scheduleSync();
  return merged.shows.length;
}
