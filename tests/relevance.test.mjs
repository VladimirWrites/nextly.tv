// Searching "Anora" returned ten television shows, none of them Anora, and the movie eleventh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankResults, titleTier } from "../public/js/domain/relevance.js";

// Exactly what TVmaze answers for "Anora", in its own order, scoring 0.33 down to 0.22.
const TVMAZE_ANORA = [
  "Nora Sand", "Andra Avenyn", "Ahora 360", "Por Ahora", "Nora Saon",
  "Andra åket", "Nelly & Nora", "Aquí y Ahora", "Awkwafina Is Nora from Queens",
  "Se Eu Fechar Os Olhos Agora",
].map((name) => ({ name, kind: "show" }));

const ANORA = { name: "Anora", kind: "movie", year: 2024 };

test("the title somebody typed comes first, whichever catalogue found it", () => {
  const ranked = rankResults([...TVMAZE_ANORA, ANORA], "Anora");
  assert.equal(ranked[0].name, "Anora");
  assert.equal(ranked.length, 11);
});

test("nothing is dropped, and the rest keep the order they arrived in", () => {
  const ranked = rankResults([...TVMAZE_ANORA, ANORA], "Anora");
  assert.deepEqual(ranked.slice(1).map((r) => r.name), TVMAZE_ANORA.map((r) => r.name));
});

test("a series still wins a tie with a movie of the same name", () => {
  const ranked = rankResults([
    { name: "Fargo", kind: "show" },
    { name: "Fargo", kind: "movie" },
  ], "Fargo");
  assert.equal(ranked[0].kind, "show");
});

test("an exact match outranks a longer title that opens with the same word", () => {
  const ranked = rankResults([
    { name: "Bosch: Legacy", kind: "show" },
    { name: "Bosch", kind: "show" },
  ], "Bosch");
  assert.equal(ranked[0].name, "Bosch");
});

test("a leading article is ignored on both sides", () => {
  assert.equal(titleTier("The Bear", "bear"), 4);
  assert.equal(titleTier("Bear", "The Bear"), 4);
});

test("accents and case do not matter", () => {
  assert.equal(titleTier("Amélie", "amelie"), 4);
});

test("a whole word beats a fragment inside one", () => {
  assert.ok(titleTier("Nelly & Nora", "nora") > titleTier("Senora", "nora"));
});

test("a title that matched on something we cannot see sinks", () => {
  assert.equal(titleTier("Ahora 360", "anora"), 0);
});

test("an empty or one-row list is handed straight back", () => {
  const one = [{ name: "Anora" }];
  assert.equal(rankResults(one, "Anora"), one);
  assert.deepEqual(rankResults([], "Anora"), []);
  const some = [{ name: "a" }, { name: "b" }];
  assert.equal(rankResults(some, "   "), some);
});

test("a row with no name does not throw", () => {
  const ranked = rankResults([{ name: null }, ANORA], "Anora");
  assert.equal(ranked[0].name, "Anora");
});
