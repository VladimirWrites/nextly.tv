// What a search result offers for a film.
//
// A series row says Track, which is a sentence about a series: follow this, and tell me when the
// next episode lands. A film has no next episode. There are two things anybody does with one —
// say they have seen it, or set it aside — and one button labelled Track answered neither, then
// filed the film as planned and hoped that was the one meant.
//
// The row is built in ui/search.js, which imports the DOM and cannot be loaded outside a
// browser, so what can be checked here is the source and the stylesheet. Both hold the parts
// that were actually wrong: which words the buttons use, and whether an icon on its own is
// still reachable by something that cannot see it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync(new URL("../public/js/ui/search.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const rules = (text) => {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) out.push({ sel: m[1].trim().replace(/\s+/g, " "), body: m[2].trim() });
  return out;
};

const inside = (cond) => {
  const head = `@media (${cond})`;
  let out = "";
  for (let at = css.indexOf(head); at >= 0; at = css.indexOf(head, at + 1)) {
    let depth = 0, i = css.indexOf("{", at);
    const start = i;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) break;
    }
    out += css.slice(start + 1, i) + "\n";
  }
  return out;
};

test("a film offers the two things anybody does with one", () => {
  assert.match(js, /act\("Watch later", ICON\.plus/);
  assert.match(js, /act\("Mark watched", ICON\.check/);
});

/* The same words and the same icons the film's own page uses. A row and the page it opens
   naming one action two ways is how somebody learns the app twice. */
test("the row and the film's page name these the same", () => {
  const movie = readFileSync(new URL("../public/js/ui/movie.js", import.meta.url), "utf8");
  for (const word of ["Mark watched", "Watch later"]) {
    assert.ok(movie.includes(word), `the film page says "${word}"`);
    assert.ok(js.includes(word), `and so does the row`);
  }
  assert.match(movie, /ICON\.check[\s\S]*?Mark watched/, "watched is a tick on both");
});

/* Track stays, for the thing it is true of. */
test("a series still says Track, and a film never does", () => {
  assert.match(js, /svg\(ICON\.plus\), "Track"/);
  const acts = js.slice(js.indexOf("function movieActions"));
  assert.ok(!acts.includes('"Track"'), "the film's buttons do not use the word");
});

/* Below the desktop width these are icons alone, and an icon alone says nothing to a screen
   reader. The label is carried whether or not it is drawn. */
test("an icon-only button still says what it does", () => {
  const acts = js.slice(js.indexOf("function movieActions"));
  assert.match(acts, /"aria-label": label/);
  assert.match(acts, /title: label/);
});

test("the words appear where there is room, and not before", () => {
  const hidden = rules(css).find((r) => r.sel === ".result-acts .act-label");
  assert.ok(hidden, "the label is hidden by default");
  assert.match(hidden.body, /display:\s*none/);

  const shown = rules(inside("min-width: 900px")).find((r) => r.sel === ".result-acts .act-label");
  assert.ok(shown, "and shown where the rail has moved to the side");
  assert.match(shown.body, /display:\s*inline/);
});

/* .btn-sm trims the height for buttons carrying words to lean on. An icon on its own has
   nothing to be read from and keeps the full target — 42px was what it measured before this. */
test("a button with no words on it is still a fingertip wide", () => {
  const act = rules(css).find((r) => r.sel === ".result-acts .act");
  assert.match(act.body, /min-width:\s*44px/);
  assert.match(act.body, /min-height:\s*44px/);
});

/* The word that follows the button. "Tracking Heat" is what a series does. */
test("setting a film aside is not called tracking", () => {
  const actions = readFileSync(new URL("../public/js/ui/actions.js", import.meta.url), "utf8");
  const track = actions.slice(actions.indexOf("export async function trackMovie"));
  const body = track.slice(0, track.indexOf("export async function trackShow"));
  assert.ok(!/toast\(`Tracking/.test(body), "the film path does not say tracking");
  assert.match(body, /watch later/);
});
