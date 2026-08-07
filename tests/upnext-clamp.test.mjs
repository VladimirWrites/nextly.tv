// How much of the queue Up next shows before "Coming up".
//
// Up next listed everything waiting, and a queue of seven put the schedule a full screen below
// the fold on a phone: the part of the screen that says what is on the way could only be found
// by somebody who already knew it was there.
//
// Two rows where the rail is along the bottom, five where it has moved to the side, on the same
// 900px line the rail turns on. Fixed counts on purpose. The version between this and the
// original measured the space left under the hero and re-measured on resize — and on a phone
// resize is what happens every time the address bar slides away, so rows appeared as the page
// was scrolled. A number that cannot change while you read cannot do that.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Comments first: this stylesheet explains itself at length, and one sitting between two rules
// is otherwise read as part of the second one's selector.
const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const js = readFileSync(new URL("../public/js/ui/upnext.js", import.meta.url), "utf8");

const rules = (text) => {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) out.push({ sel: m[1].trim().replace(/\s+/g, " "), body: m[2].trim() });
  return out;
};

/* Everything written under a condition, gathered. Every one of them, not the first: this
   stylesheet opens `@media (min-width: 900px)` several times, beside whatever it is widening. */
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
  assert.ok(out, `a @media (${cond}) block exists`);
  return out;
};

test("two rows with the rail along the bottom, five with it at the side", () => {
  const narrow = rules(css).find((r) => r.sel === ".queue.is-clamped .qrow:nth-child(n + 3)"
    && /display:\s*none/.test(r.body));
  assert.ok(narrow, "the third row and beyond are hidden by default");

  const wide = rules(inside("min-width: 900px")).filter((r) => r.sel.startsWith(".queue.is-clamped"));
  assert.deepEqual(wide.map((r) => r.body.replace(/\s+/g, " ")),
    ["display: flex;", "display: none;"],
    "the wide window puts rows three to five back and hides from the sixth");
  assert.match(wide[0].sel, /nth-child\(n \+ 3\)/);
  assert.match(wide[1].sel, /nth-child\(n \+ 6\)/);
});

/* Hiding is not something a later rule undoes by hiding less — nth-child(n+6) does not bring
   back the third row that nth-child(n+3) took away, so the wide block has to say so itself. */
test("the wide window restores the rows the narrow one hid", () => {
  const wide = rules(inside("min-width: 900px"))
    .find((r) => r.sel === ".queue.is-clamped .qrow:nth-child(n + 3)");
  assert.ok(wide, "there is a rule putting them back");
  assert.match(wide.body, /display:\s*flex/, "and it restores the layout they had, not inline");
});

/* The queue's own breakpoint is the rail's. A window wide enough to move the rail to the side
   is a window tall enough for the extra rows, and two numbers that have to agree should be one. */
test("the queue turns on the same line the rail does", () => {
  const rail = rules(inside("min-width: 900px")).find((r) => r.sel === ".nav");
  assert.ok(rail, "the rail moves at 900px");
  assert.match(rail.body, /position:\s*fixed/);
  const block = css.slice(css.indexOf(".queue.is-clamped"), css.lastIndexOf(".queue-more"));
  assert.ok(!/@media \(min-width: (?!900px)/.test(block), "and the queue names no other width");
});

/* The button toggles the class that clamps, so a rule offering it only while clamped would take
   it away the instant it worked, leaving no way back. It counts rows instead. */
test("the expander is offered by how many rows there are, not by whether they are hidden", () => {
  const offers = rules(css).filter((r) => r.sel.includes(".queue-more") && /display:\s*inline-flex/.test(r.body));
  assert.ok(offers.length >= 1);
  for (const r of offers) {
    assert.ok(!r.sel.includes("is-clamped"), `"${r.sel}" must not depend on the class it removes`);
    assert.match(r.sel, /:has\(\.qrow:nth-child\(\d\)\)/, "it asks how long the queue is");
  }
});

/* :has() is not everywhere, and this app already avoids it where old tablets are the audience.
   Here it only decides whether a control appears, so the fallback has to fail the harmless way:
   a button that expands what is already expanded, never rows nothing can reach. */
test("without :has the rows are still reachable", () => {
  assert.match(rules(css).find((r) => r.sel === ".queue-more").body, /display:\s*none/);
  assert.match(js, /rest\.length > CLAMP \? queueMore\(/);
  assert.match(js, /const CLAMP = 2;/, "and the render uses the smaller of the two limits");
});

/* Nothing reads a height. That is the whole of the fix for rows appearing mid-scroll: a phone
   fires resize as its address bar slides away, and anything measuring answers differently each
   time it is asked. */
test("no measurement decides this", () => {
  for (const bad of ["getBoundingClientRect", "innerHeight", '"resize"']) {
    assert.ok(!js.includes(bad), `${bad} has no business in this decision`);
  }
});

/* Everything waiting is drawn, always. The count in the section head is the number of rows, so
   a render that sliced the list would have the head and the list disagreeing — and expanding
   would have to re-render rather than take a class off. */
test("every waiting row is rendered, clamped or not", () => {
  assert.match(js, /rest\.map\(\(r\) => queueRow\(r, go\)\)/);
  assert.ok(!/rest\.slice\(/.test(js), "nothing is left out of the document");
  assert.match(js, /text: `\$\{rest\.length\}`/, "and the head counts all of them");
});

/* Unfolded for this visit, like every other thing a screen has open. */
test("the expander is per visit rather than a setting", () => {
  assert.match(js, /view\.toggle\(QUEUE_OPEN\)/);
  assert.ok(!/localStorage|state\.settings/.test(js.slice(js.indexOf("QUEUE_OPEN"))),
    "nothing about it is stored");
});
