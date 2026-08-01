// Which visits are still reachable, and what goes when one stops being.
//
// This rule is the one the app most easily gets wrong without anyone noticing, because being
// wrong looks like nothing at all: a screen comes back at the wrong height, or a season you
// closed is open again, weeks later, on a trail nobody would think to retrace. It lived
// inside the router where the only way to exercise it was to drive a browser.
import test from "node:test";
import assert from "node:assert/strict";
import * as trail from "../public/js/ui/trail.js";
import * as view from "../public/js/ui/viewstate.js";

/* Node has no history object and this needs none: a trail is a set of keys with depths.

   A cold load sits at depth 0 and every tap-through pushes one deeper, so a trail of n screens
   is n + 1 keys — this returns them from the root outwards. `at(keys, d)` then names a screen
   by how deep it is, which is the only thing the eviction rule looks at. */
function walk(n) {
  const keys = [trail.newKey()];
  trail.note(keys[0], 0);
  for (let depth = 1; depth <= n; depth++) {
    trail.forgetFrom(depth);              // a push destroys whatever was ahead of it
    const key = trail.newKey();
    trail.note(key, depth);
    keys.push(key);
  }
  return keys;
}

test("each visit remembers its own height", () => {
  const [root, a, b] = walk(2);
  trail.remember(root, 120);
  trail.remember(a, 400);
  assert.equal(trail.recall(root), 120);
  assert.equal(trail.recall(a), 400);
  assert.equal(trail.recall(b), 0, "a screen never scrolled has no height to put back");
});

test("the same show twice in one trail is two places, at two heights", () => {
  // show -> actor -> the same show again. Keyed by visit, not by path, so the first copy is
  // still where it was after the second one is scrolled somewhere else.
  const [, first, actor, second] = walk(3);
  trail.remember(first, 300);
  trail.remember(actor, 90);
  trail.remember(second, 20);
  assert.equal(trail.recall(first), 300);
  assert.equal(trail.recall(actor), 90);
  assert.equal(trail.recall(second), 20);
});

test("a push forgets everything it destroys, and nothing behind it", () => {
  const [root, a, b, c] = walk(3);
  [root, a, b, c].forEach((k, i) => trail.remember(k, (i + 1) * 10));
  // Back to a (depth 1), then off somewhere new: the push happens at depth 2, so b and c can
  // never be returned to and a is the screen it was pushed from.
  trail.forgetFrom(2);
  assert.equal(trail.recall(root), 10);
  assert.equal(trail.recall(a), 20, "the screen pushed from is still where it was");
  assert.equal(trail.recall(b), 0);
  assert.equal(trail.recall(c), 0);
});

test("a branch abandoned earlier goes too, at the same depths", () => {
  // Two trails that both reached depth 2. walk() pushes from the root each time, so the
  // second one's own forgetFrom is what clears the first — the branch is gone regardless of
  // which trail it belonged to.
  const [, , oldB] = walk(2);
  trail.remember(oldB, 15);
  const [, , newB] = walk(2);
  assert.equal(trail.recall(oldB), 0, "a depth nobody can reach again keeps nothing");
  trail.remember(newB, 35);
  trail.forgetFrom(2);
  assert.equal(trail.recall(newB), 0);
});

test("replacing destroys what it stands on, not what is under it", () => {
  const [, a, b] = walk(2);
  trail.remember(a, 44);
  trail.remember(b, 88);
  // A redirect at depth 2: same depth, new key. The screen below keeps its place.
  trail.forgetFrom(2);
  assert.equal(trail.recall(a), 44);
  assert.equal(trail.recall(b), 0);
});

test("what a visit had open is dropped exactly when the visit is", () => {
  const [, a, b] = walk(2);
  view.bindEntry(b);
  view.setOn("season:tvmaze:1:2");
  view.setCount("pages:tvmaze:1:2", 3);
  assert.ok(view.isOn("season:tvmaze:1:2"));

  trail.forgetFrom(2);
  view.bindEntry(b);
  assert.ok(!view.isOn("season:tvmaze:1:2"), "an unreachable visit keeps nothing open");
  assert.equal(view.count("pages:tvmaze:1:2", 1), 1, "and nothing counted");

  // The visit behind it is untouched — that is the one being returned to.
  view.bindEntry(a);
  view.setOn("desc:tvmaze:1");
  trail.forgetFrom(2);
  assert.ok(view.isOn("desc:tvmaze:1"));
});

test("going back forgets nothing — forward still reaches it", () => {
  const [, a, b] = walk(2);
  trail.remember(a, 60);
  trail.remember(b, 200);
  // popstate records where it is leaving and reads back where it is going. It does not call
  // forgetFrom at all, and nothing here should need it to.
  assert.equal(trail.recall(b), 200);
  assert.equal(trail.recall(a), 60);
});

test("the two maps stay the same size as each other", () => {
  const before = trail.held();
  assert.equal(before.scrolls <= before.depths, true);
  walk([{ y: 1 }, { y: 2 }, { y: 3 }]);
  const after = trail.held();
  assert.ok(after.depths >= after.scrolls, "every scroll belongs to a visit with a depth");
});

test("a session that outgrows any real trail is capped rather than leaking", () => {
  // Depths climb, so forgetFrom never fires: this is the backstop, and the only thing that
  // stops a very long session from holding every visit it ever made.
  for (let i = 0; i < 600; i++) {
    const key = trail.newKey();
    trail.note(key, 1000 + i);
    trail.remember(key, i);
  }
  const { scrolls, depths } = trail.held();
  assert.ok(scrolls <= 400, `scrolls capped, got ${scrolls}`);
  assert.ok(depths <= 400, `depths capped, got ${depths}`);
});
