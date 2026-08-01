// Where you were on each screen you have been to.
//
// The browser cannot restore this for us. Its own scroll restoration works on the document it
// left behind, and every screen here is the same document rebuilt from nothing: at the moment
// back lands, the page is empty and there is nowhere to scroll to. So the position is recorded
// against the history entry and put back once the screen has been rebuilt.
//
// Keyed by an id on the entry rather than by path, because the same show visited twice in one
// trail is two places you were, at two different heights.
//
// This half is the bookkeeping — which visits are still reachable, and what each was left
// looking at. It touches neither the document nor the history object, which is what lets the
// eviction rule be checked directly; the router in main.js owns the parts that do.
import * as view from "./viewstate.js";

/* The cap is only a backstop for a session that outgrows any real trail. Visits are normally
   forgotten precisely, by forgetFrom below. */
const KEEP = 400;

const scrolls = new Map();
const depths = new Map();

export const newKey = () => Math.random().toString(36).slice(2, 10);

/* Both maps are trimmed together. Dropping a scroll position while keeping its depth left a
   key in one map that the other had never heard of — harmless, but it meant the two disagreed
   about which visits existed, and the whole point of the pair is that they agree.

   Oldest first: a Map iterates in insertion order, so the front is the least recently seen. */
function trim() {
  while (scrolls.size > KEEP || depths.size > KEEP) {
    const oldest = (scrolls.size > KEEP ? scrolls : depths).keys().next().value;
    scrolls.delete(oldest);
    depths.delete(oldest);
    view.forget(oldest);
  }
}

// How deep a visit sits. Recorded on arrival, whether the entry is one we just made or one
// found already in the history on a cold load.
export function note(key, depth) {
  depths.set(key, depth);
  trim();
}

export function remember(key, y) {
  scrolls.set(key, y);
  trim();
}

export const recall = (key) => scrolls.get(key) || 0;

/* Everything the history no longer holds.

   A push throws away every entry ahead of the one being pushed from — that is what the back
   button stops offering the moment you go back three screens and then tap into something new.
   Nothing announces it, but the push itself is the proof, so at that moment every visit held
   at that depth or deeper is unreachable and its state goes with it. That includes visits from
   a branch abandoned earlier that happen to sit at the same depths.

   Not on going back: back leaves the entry ahead of you intact, and forward still reaches it.
   Depth-for-depth rather than by trail, because a push truncates the lot regardless of which
   branch each one came from. */
export function forgetFrom(depth) {
  for (const [key, d] of depths) {
    if (d < depth) continue;
    depths.delete(key);
    scrolls.delete(key);
    // What that visit had open goes with where it was scrolled to: the height a screen stands
    // at is a function of what it has unfolded, so keeping one without the other is worse
    // than keeping neither.
    view.forget(key);
  }
}

// For tests, and for anyone wondering whether this leaks.
export const held = () => ({ scrolls: scrolls.size, depths: depths.size });
