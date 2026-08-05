// What a discovery card knows about your library.
//
// The interesting half is not the tick — it is deciding that the card and the record are the
// same title when they were written by different catalogues. A row from TMDB names a movie
// `tmdb:m76600`; the same movie saved from Cinemeta is `cinemeta:mtt1630029`. An exact-key
// lookup says no, and the row would then offer to discover something already sitting in the
// library, which is the fault this exists to prevent.
import test from "node:test";
import assert from "node:assert/strict";
import { makeShow, normShow } from "../public/js/domain/schema.js";
import { markMovie, addShow, start, setStatus, shelfState } from "../public/js/domain/model.js";

const NOW = 1_700_000_000_000;

const stateWith = (...shows) => ({ shows: shows.map((s) => normShow(s, NOW)) });

const avatarTmdb = () => makeShow({
  key: "tmdb:m76600", src: "tmdb", ref: "m76600", kind: "movie",
  name: "Avatar: The Way of Water", year: 2022, imdb: "tt1630029", tmdb: 76600,
}, NOW);

const avatarCinemeta = () => makeShow({
  key: "cinemeta:mtt1630029", src: "cinemeta", ref: "mtt1630029", kind: "movie",
  name: "Avatar: The Way of Water", year: 2022, imdb: "tt1630029", tmdb: 76600,
}, NOW);

const wire = () => makeShow({ key: "tvmaze:169", src: "tvmaze", ref: 169, name: "The Wire", imdb: "tt0306414" }, NOW);

test("a title you do not hold gets no badge and no label", () => {
  const s = shelfState(stateWith(wire()), { key: "tmdb:m76600", kind: "movie", name: "Avatar" });
  assert.equal(s.held, null);
  assert.equal(s.label, null);
});

test("a movie you hold but have not watched reads as a watchlist entry", () => {
  const s = shelfState(stateWith(avatarTmdb()), { key: "tmdb:m76600", kind: "movie", name: "Avatar" });
  assert.ok(s.held);
  assert.equal(s.label, "Watchlist");
});

test("a movie you have watched says so", () => {
  const st = stateWith(avatarTmdb());
  markMovie(st, "tmdb:m76600", true, NOW);
  const s = shelfState(st, { key: "tmdb:m76600", kind: "movie", name: "Avatar" });
  assert.equal(s.label, "Watched");
});

/* The whole reason this is not an exact-key lookup. Both directions, because either catalogue
   can be the one that wrote the record and either can be the one drawing the row. */
test("a TMDB card finds the same movie saved from Cinemeta", () => {
  const s = shelfState(stateWith(avatarCinemeta()), {
    key: "tmdb:m76600", src: "tmdb", ref: "m76600", kind: "movie", name: "Avatar: The Way of Water",
  });
  assert.ok(s.held, "the portable ids make it the same movie");
  assert.equal(s.held.id, "cinemeta:mtt1630029");
});

test("a Cinemeta card finds the same movie saved from TMDB", () => {
  const s = shelfState(stateWith(avatarTmdb()), {
    key: "cinemeta:mtt1630029", src: "cinemeta", ref: "mtt1630029", kind: "movie",
    imdb: "tt1630029", name: "Avatar: The Way of Water",
  });
  assert.ok(s.held);
  assert.equal(s.held.id, "tmdb:m76600");
});

/* The guard that keeps a movie from wearing a series' badge. TMDB numbers the two separately,
   so the same digits mean different titles, and the `m` in the key is the only thing that
   distinguishes them. */
test("a movie and a series numbered alike are not confused for each other", () => {
  const series = normShow(makeShow({ key: "tmdb:76600", src: "tmdb", ref: 76600, name: "Something else" }, NOW), NOW);
  const s = shelfState({ shows: [series] }, { key: "tmdb:m76600", src: "tmdb", ref: "m76600", kind: "movie", name: "Avatar" });
  assert.equal(s.held, null);
});

test("a show says what you are doing with it, not whether you have finished", () => {
  const st = stateWith(wire());
  assert.equal(shelfState(st, { key: "tvmaze:169", name: "The Wire" }).label, "Planned");
  start(st.shows[0], NOW);
  assert.equal(shelfState(st, { key: "tvmaze:169", name: "The Wire" }).label, "Watching");
  setStatus(st, "tvmaze:169", "paused", NOW);
  assert.equal(shelfState(st, { key: "tvmaze:169", name: "The Wire" }).label, "Paused");
});

/* A card with no key at all — a skeleton row, or a catalogue answering with something
   unrecognisable — asks the library nothing rather than throwing inside a render. */
test("a card with no key is simply not held", () => {
  assert.deepEqual(shelfState(stateWith(wire()), { name: "Nameless" }), { held: null, label: null });
  assert.deepEqual(shelfState(stateWith(wire()), null), { held: null, label: null });
});

/* Not a badge case, but the reason addShow is in this file's imports: a row draws from
   state.shows directly, so anything that lands there has to be visible to it immediately. */
test("a title tracked from a row is held by the next card that asks", () => {
  const st = { shows: [] };
  addShow(st, { key: "tvmaze:169", src: "tvmaze", ref: 169, name: "The Wire" }, NOW);
  assert.ok(shelfState(st, { key: "tvmaze:169", name: "The Wire" }).held);
});
