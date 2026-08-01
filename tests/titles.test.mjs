// How titles are filed: matching, ordering, and the heading each one sits under.
import test from "node:test";
import assert from "node:assert/strict";
import { fold, sortKey, indexLetter, fmtDuration, runState, isOver } from "../public/js/domain/constants.js";

test("folding ignores case and accents so search and sorting agree", () => {
  assert.equal(fold("Ünter Ölberg"), "unter olberg");
  assert.equal(fold("BoJack"), "bojack");
  assert.ok(fold("Amélie").includes("amelie"));
});

test("a leading article doesn't decide where a show files", () => {
  assert.equal(sortKey("The Bear"), "bear");
  assert.equal(sortKey("A Discovery of Witches"), "discovery of witches");
  assert.equal(sortKey("An Idiot Abroad"), "idiot abroad");
  assert.equal(sortKey("Theodore"), "theodore", "only the whole word, not any word starting with it");
});

/* ---- headings ----
   A fixed A-Z would file every non-Latin title under one bucket. Each script gets its own
   heading instead, and the alphabetical sort puts them after the Latin ones on its own. */

test("Latin titles file under their letter, article and accents aside", () => {
  assert.equal(indexLetter("Breaking Bad"), "B");
  assert.equal(indexLetter("The Bear"), "B");
  assert.equal(indexLetter("Ünter"), "U");
});

test("other scripts keep their own letter rather than collapsing into one bucket", () => {
  assert.equal(indexLetter("Корона"), "К");          // Cyrillic
  assert.equal(indexLetter("Δύο"), "Δ");             // Greek
  assert.equal(indexLetter("שטיסel"), "ש");          // Hebrew, which has no case
});

test("a Hangul title indexes under a syllable, not a jamo a font may not draw", () => {
  const l = indexLetter("오징어 게임");
  assert.equal(l, "오");
  assert.equal(l.normalize("NFC"), l, "must be composed, or it renders as a conjoining jamo");
});

test("anything that isn't a letter files under #", () => {
  assert.equal(indexLetter("24"), "#");
  assert.equal(indexLetter("3%"), "#");
  assert.equal(indexLetter("¡Rompan todo!"), "#");
  assert.equal(indexLetter(""), "#");
  assert.equal(indexLetter(null), "#");
});

test("sorting by key puts other scripts after the Latin ones, which is why they sit below", () => {
  const names = ["Корона", "Breaking Bad", "오징어 게임", "Andor"];
  const order = names.slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  assert.deepEqual(order.slice(0, 2), ["Andor", "Breaking Bad"]);
  assert.ok(order.indexOf("Корона") > order.indexOf("Breaking Bad"));
});

/* ---- durations ---- */

test("time left reads in the units a person would use", () => {
  assert.equal(fmtDuration(45), "45m");
  assert.equal(fmtDuration(60), "1h");
  assert.equal(fmtDuration(200), "3h 20m");
  assert.equal(fmtDuration(60 * 40 + 7), "40h", "nobody plans around the last seven minutes");
  assert.equal(fmtDuration(0), null);
  assert.equal(fmtDuration(null), null);
});

/* ---- one vocabulary for two catalogues ---- */

test("both catalogues' status words reduce to the same few states", () => {
  assert.equal(runState("Running"), "running");
  assert.equal(runState("Returning Series"), "running");
  assert.equal(runState("Ended"), "ended");
  assert.equal(runState("Canceled"), "canceled");
  assert.equal(runState("Cancelled"), "canceled");
  assert.equal(runState("To Be Determined"), "upcoming");
  assert.equal(runState("In Development"), "upcoming");
  assert.equal(runState(""), "unknown");
});

test("isOver is the question the pill actually asks", () => {
  assert.ok(isOver("Ended"));
  assert.ok(isOver("Canceled"));
  assert.equal(isOver("Running"), false);
  assert.equal(isOver("In Development"), false);
});
