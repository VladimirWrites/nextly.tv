// Per visit, not per show. The same screen can be two places in one trail.
import test from "node:test";
import assert from "node:assert/strict";
import * as view from "../public/js/ui/viewstate.js";

test("two visits to the same screen keep their own idea of what is open", () => {
  view.bindEntry("a");
  view.setOn("season:tvmaze:38052:1");
  assert.equal(view.isOn("season:tvmaze:38052:1"), true);

  // Deeper in the trail, the same show again — arriving with nothing open.
  view.bindEntry("b");
  assert.equal(view.isOn("season:tvmaze:38052:1"), false, "a fresh visit is a fresh visit");
  view.setOn("season:tvmaze:38052:1");
  view.setOn("season:tvmaze:38052:1", false);       // and closed again, here

  view.bindEntry("a");
  assert.equal(view.isOn("season:tvmaze:38052:1"), true,
    "closing it on the second copy must not shorten the first — that is what loses the scroll");
});

test("toggle reports where it landed", () => {
  view.bindEntry("t");
  assert.equal(view.toggle("bio:tmdb:99"), true);
  assert.equal(view.toggle("bio:tmdb:99"), false);
  assert.equal(view.isOn("bio:tmdb:99"), false);
});

test("anything open under a prefix, on this visit alone", () => {
  view.bindEntry("p1");
  assert.equal(view.any("season:tvmaze:1:"), false);
  view.setOn("season:tvmaze:1:4");
  assert.equal(view.any("season:tvmaze:1:"), true);
  assert.equal(view.any("season:tvmaze:2:"), false, "another show's seasons are not this one's");

  view.bindEntry("p2");
  assert.equal(view.any("season:tvmaze:1:"), false, "and another visit's are not this visit's");
});

test("counts are per visit too, with a fallback for a visit that has none", () => {
  view.bindEntry("c1");
  assert.equal(view.count("pages:x:37", 1), 1);
  view.setCount("pages:x:37", 3);
  assert.equal(view.count("pages:x:37", 1), 3);

  view.bindEntry("c2");
  assert.equal(view.count("pages:x:37", 1), 1, "a fresh visit lays out one page");
});

test("old visits fall off the end rather than piling up forever", () => {
  // Nothing tells a page that a history entry was discarded, so the store is bounded.
  for (let i = 0; i < 600; i++) {
    view.bindEntry("e" + i);
    view.setOn("season:x:1");
  }
  view.bindEntry("e0");
  assert.equal(view.isOn("season:x:1"), false, "the oldest visits are gone");
  view.bindEntry("e599");
  assert.equal(view.isOn("season:x:1"), true, "the recent ones are not");
});

test("a visit can be forgotten outright, and takes its counts with it", () => {
  view.bindEntry("gone");
  view.setOn("season:x:1");
  view.setCount("pages:x:1", 4);
  view.bindEntry("stays");
  view.setOn("season:x:1");
  view.setCount("pages:x:1", 2);

  view.forget("gone");

  view.bindEntry("gone");
  assert.equal(view.isOn("season:x:1"), false);
  assert.equal(view.count("pages:x:1", 1), 1, "back to what a fresh visit would show");
  view.bindEntry("stays");
  assert.equal(view.isOn("season:x:1"), true, "and the visit still in the history is untouched");
  assert.equal(view.count("pages:x:1", 1), 2);
});

test("forgetting a visit nobody recorded is not an error", () => {
  view.forget("never-existed");
  view.bindEntry("never-existed");
  assert.equal(view.isOn("anything"), false);
});

test("a row's place is per visit, like everything else on a screen", () => {
  view.bindEntry("v1");
  view.setCount("shelf:cast:tvmaze:1", 640);
  assert.equal(view.count("shelf:cast:tvmaze:1", 0), 640);

  view.bindEntry("v2");
  assert.equal(view.count("shelf:cast:tvmaze:1", 0), 0, "the same show, visited again, starts at the beginning");

  view.bindEntry("v1");
  assert.equal(view.count("shelf:cast:tvmaze:1", 0), 640, "and the first visit is still where it was left");
});
