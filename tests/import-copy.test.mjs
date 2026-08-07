// The sentences the import screen prints.
//
// These were written inside ui/trakt-import.js, which imports the DOM and therefore cannot be
// loaded by a test at all. So none of them were covered, and one of them — the line about a
// history that does not add up — was a call to a function that had never been written. It threw
// `shortfallLine is not defined` the first time anybody imported a file with a shortfall in it,
// months after the commit that introduced it.
//
// Which is the argument for this file existing: a sentence is logic, it has plurals and branches
// and numbers in it, and it belongs where it can be read back.
import test from "node:test";
import assert from "node:assert/strict";
import { shortfallLine, what, newThings, fmtInt } from "../public/js/domain/import-copy.js";

const miss = (name, kind = "show") => ({ name, kind, had: 1, claimed: 9 });

test("a shortfall names how many, of what kind, and a few of them", () => {
  const line = shortfallLine([miss("Buffy"), miss("Twin Peaks"), miss("Futurama")], "Trakt");
  assert.match(line, /^3 shows have fewer plays in the file than Trakt counted/);
  assert.match(line, /\(Buffy, Twin Peaks, Futurama\)/);
  assert.match(line, /Trakt's export may not go all the way back\.$/);
});

test("one of them is singular", () => {
  assert.match(shortfallLine([miss("Buffy")], "Trakt"), /^1 show has fewer plays/);
});

/* The sentence this replaced said "shows" whatever it was counting, which is the fault that
   split the counts by kind everywhere else in the import. */
test("films are not called shows", () => {
  const line = shortfallLine([miss("Heat", "movie"), miss("Buffy")], "Trakt");
  assert.match(line, /^1 show and 1 movie have fewer plays/);
  assert.match(shortfallLine([miss("Heat", "movie")], "Trakt"), /^1 movie has fewer plays/);
});

test("more than three is three and an ellipsis", () => {
  const line = shortfallLine([miss("A"), miss("B"), miss("C"), miss("D")], "Trakt");
  assert.match(line, /\(A, B, C, …\)/);
});

/* Two services now, and a shortfall is the service's to explain. */
test("whoever wrote the export is who the sentence names", () => {
  assert.match(shortfallLine([miss("Buffy")], "TV Time"), /than TV Time counted/);
  assert.match(shortfallLine([miss("Buffy")], "TV Time"), /TV Time's export may not go/);
});

test("nothing missing is nothing said", () => {
  assert.equal(shortfallLine([]), "");
  assert.equal(shortfallLine(null), "");
});

test("a row with no name is counted without being named", () => {
  const line = shortfallLine([miss(""), miss("")], "Trakt");
  assert.match(line, /^2 shows have fewer plays/);
  assert.ok(!line.includes("()"), "and no empty brackets are left behind");
});

/* What importing would do, which is a different question from what the file holds. */
test("marks landing on tracked shows is what it leads with", () => {
  assert.equal(
    what({ marks: 1412, shows: 12, updated: 0, newShows: 0, newMovies: 0 }, 12),
    "1,412 new to 12 shows you track.",
  );
});

test("new shows and new movies are counted apart", () => {
  const line = what({ marks: 5, shows: 2, updated: 0, newShows: 596, newMovies: 593 }, 30);
  assert.match(line, /596 shows and 593 movies you don't\.$/);
});

/* The count that was once "596 shows" while 593 of them were films. */
test("a file of nothing but films says so", () => {
  assert.equal(newThings({ newShows: 0, newMovies: 4 }), "4 movies");
  assert.equal(newThings({ newShows: 1, newMovies: 0 }), "1 show");
  assert.equal(newThings({ newShows: 0, newMovies: 0 }), "");
});

test("an empty library is not told it has nothing new", () => {
  assert.equal(
    what({ marks: 0, shows: 0, updated: 0, newShows: 40, newMovies: 0 }, 0),
    "None of them are in your library yet.",
  );
  assert.match(what({ marks: 0, shows: 0, updated: 0, newShows: 40, newMovies: 0 }, 12),
    /^Nothing new for the shows you track/);
});

test("a file holding nothing this library lacks says exactly that", () => {
  assert.equal(
    what({ marks: 0, shows: 0, updated: 0, newShows: 0, newMovies: 0 }, 12),
    "Nothing in there that isn't already here.",
  );
});

/* A file of only new films used to fall through to "nothing in there that isn't already here",
   which is the opposite of true. */
test("new films alone are still something new", () => {
  assert.match(what({ marks: 0, shows: 0, updated: 0, newShows: 0, newMovies: 7 }, 12),
    /7 movies you don't\.$/);
});

test("numbers are grouped, because five figures of marks is unreadable otherwise", () => {
  assert.equal(fmtInt(6278), (6278).toLocaleString());
});
