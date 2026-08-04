// Whose scores a page shows.
//
// A show keeps the numbering it was tracked under, because that is what its marks were
// recorded against. The scores are not part of that bargain: a reader who has chosen a
// catalogue and given it a key should see its numbers, the same way the cast already comes
// from the catalogue in use rather than the one the show happens to be numbered by.
import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../public/js/domain/store.js";
import { scoresFor, scoreSourceOf, ensureScores, activeProvider } from "../public/js/io/meta.js";

const onTMDB = () => { state.settings = { provider: "tmdb", tmdbKey: "KEY" }; };
const onTVmaze = () => { state.settings = { provider: "tvmaze" }; };

// Numbered by one catalogue, read by someone who chose the other.
const BORROWING = { key: "tvmaze:169", imdb: "tt0903747" };
// Numbered by the catalogue in use.
const OWN = { key: "tmdb:1396", imdb: "tt0903747" };

test("the catalogue in use is the one a key selects, not the one a show is numbered by", () => {
  onTMDB();
  assert.equal(activeProvider().id, "tmdb");
  onTVmaze();
  assert.equal(activeProvider().id, "tvmaze");
});

/* Nothing is borrowed when there is nothing to borrow: the record's own scores already came
   from the catalogue the reader chose, so there is no request and no overlay. */
test("a show numbered by the catalogue in use is left alone", async () => {
  onTMDB();
  assert.equal(scoresFor(OWN, 1), null);
  assert.equal(scoreSourceOf(OWN, 1), "TMDB");
  assert.equal(await ensureScores(OWN, 1), false, "and nothing is asked for");
});

/* Until the borrowed set arrives the page is honest about what it is showing: the record's own
   numbers, under the record's own catalogue's name. It does not label them with the chosen
   catalogue in advance of having anything from it. */
test("a borrowing show says whose numbers it is showing until the others land", () => {
  onTMDB();
  assert.equal(scoresFor(BORROWING, 1), null);
  assert.equal(scoreSourceOf(BORROWING, 1), "TVmaze");
});

/* Which catalogue answered, not which one the key names. A record that stood in for another —
   TVmaze answering for a TMDB-numbered show whose key was removed — carries `from`, and that
   is what its scores actually are. */
test("a stand-in record is judged by who answered it", () => {
  onTVmaze();
  const stoodIn = { key: "tmdb:1396", from: "tvmaze:169", imdb: "tt0903747" };
  assert.equal(scoreSourceOf(stoodIn, 1), "TVmaze", "TVmaze answered, so these are TVmaze's");
});

test("a season that is not a number is never asked about", async () => {
  onTMDB();
  for (const n of [undefined, null, NaN, "1"]) {
    assert.equal(await ensureScores(BORROWING, n), false, `season ${String(n)}`);
  }
});

test("nor is a record that isn't one", async () => {
  onTMDB();
  assert.equal(await ensureScores(null, 1), false);
  assert.equal(await ensureScores({}, 1), false, "no key, so nobody answered it");
  assert.equal(scoresFor({}, 1), null);
});

/* A key that has been removed takes the catalogue with it: activeProvider falls back rather
   than selecting something that cannot answer, so a reader without a key is never left waiting
   on a request that was never going to work. */
test("choosing a catalogue with no key selects the one that works", async () => {
  state.settings = { provider: "tmdb" };            // chosen, but no key
  assert.equal(activeProvider().id, "tvmaze");
  assert.equal(await ensureScores(BORROWING, 1), false, "which is what this show is numbered by");
});
