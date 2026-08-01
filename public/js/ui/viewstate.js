// What a screen had open, per visit rather than per show.
//
// A trail can hold the same screen more than once — show → an actor in it → the same show
// again → the same actor — and those are different places, not one place seen twice. Each has
// its own scroll position, and so each must have its own idea of which seasons are open, how
// many pages of episodes were asked for, and whether a biography was expanded. Keyed by show
// alone, collapsing a season on the second copy left the first one short, and coming back to it
// landed at the wrong height: the height a screen stands at is a function of what it has open.
//
// So every flag is namespaced by the history entry it belongs to. A new visit starts with
// nothing open, which is also what makes a fresh visit behave like one — the show page opens
// the season you are up to, exactly as it does the first time.
//
// Everything here is memory for this tab, and none of it is worth persisting: what you had
// unfolded an hour ago is not something to restore, and it is certainly not something to put
// in the vault.

// The entry being looked at. main.js moves this as the history entry changes; until it does,
// everything shares one namespace, which is right for a page that has not navigated yet.
let entry = "0";

export function bindEntry(key) {
  entry = String(key || "0");
}

const flags = new Set();
const counts = new Map();
const at = (name) => `${entry}|${name}`;

/* A backstop, not the mechanism. Visits are forgotten precisely — see forget(), which the
   router calls the moment a push destroys the entries ahead of it — and this only catches a
   session that somehow climbs past any real trail.

   Oldest first: a Set and a Map both iterate in insertion order, so the front of each is the
   least recently opened. */
const MAX = 400;

function trim(store) {
  while (store.size > MAX) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

export const isOn = (name) => flags.has(at(name));

export function setOn(name, on = true) {
  if (on) { flags.add(at(name)); trim(flags); }
  else flags.delete(at(name));
  return on;
}

// Toggles and returns the new state, so callers can read the result without asking again.
export const toggle = (name) => setOn(name, !isOn(name));

// Is anything under this prefix open, on this visit? The show page asks before deciding
// whether to open the season you are up to: it should do that on arrival, and not again once
// you have closed it yourself.
export function any(prefix) {
  const p = at(prefix);
  for (const k of flags) if (k.startsWith(p)) return true;
  return false;
}

/* Everything one visit had open, dropped. Pushing a new entry throws away whatever was ahead
   of it in the history, and those visits can never be returned to — no event says so, but the
   push itself is the proof. */
export function forget(key) {
  const p = `${String(key)}|`;
  for (const k of flags) if (k.startsWith(p)) flags.delete(k);
  for (const k of counts.keys()) if (k.startsWith(p)) counts.delete(k);
}

// For things counted rather than switched — how many pages of a long season are laid out.
export const count = (name, fallback = 0) => (counts.has(at(name)) ? counts.get(at(name)) : fallback);
export const setCount = (name, n) => { counts.set(at(name), n); trim(counts); };
