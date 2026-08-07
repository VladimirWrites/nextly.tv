// Sticky top edges in an installed desktop window.
//
// A desktop install draws its own title strip across the top of the window — fixed, opaque, and
// above everything the page puts there. Anything of this app's that sticks to the top of the
// viewport therefore has to stick below the strip instead, or it pins underneath it and stays
// there half-covered for the rest of the scroll.
//
// .topbar knew that. .show-bar, added later for the show and movie pages, did not, and on a
// desktop install its top 40px sat under the strip: half a back arrow, half a title. Nothing
// caught it because it is a rule that exists in one place and has to exist in two, and because
// the fault only appears in a window this suite cannot open.
//
// So it is read out of the stylesheet instead: find every rule that sticks to the top, and
// require each one to be offset. A new bar added tomorrow fails this until it is.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");

/* Rules, crudely: this stylesheet nests only inside media queries, and a media block's own
   header carries no declarations, so splitting on braces is enough to pair each selector with
   its body. */
function rules(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) out.push({ sel: m[1].trim().replace(/\s+/g, " "), body: m[2] });
  return out;
}

const all = rules(css);

/* Sticks to the top of the window: sticky, with a top edge of zero. A `top` of anything else is
   already an offset of some kind and is its own decision. */
const stuckToTop = all.filter((r) =>
  /position:\s*sticky/.test(r.body) && /(^|[;{\s])top:\s*0(px)?\s*;/.test(r.body));

test("every bar that sticks to the top of the window is offset under a desktop title strip", () => {
  assert.ok(stuckToTop.length >= 2, "the topbar and the detail pages' bar are both in here");

  for (const r of stuckToTop) {
    /* The selector as written may be a list; each part needs its own offset, since the strip
       covers whichever one is on screen. */
    for (const part of r.sel.split(",").map((s) => s.trim()).filter(Boolean)) {
      const name = part.replace(/^:root(\[[^\]]*\])?\s*/, "");
      const offset = all.find((o) =>
        o.sel.includes("[data-wco]") && o.sel.includes(name) && /top:\s*var\(--wco-off\)/.test(o.body));
      assert.ok(offset, `${name} sticks to the top and needs a :root[data-wco] rule offsetting it`);
    }
  }
});

/* The strip is drawn over the page, so a bar that merely sits at the same height would still
   lose to it. This is the pairing that makes the offset necessary rather than cosmetic. */
test("the title strip sits above the bars it displaces", () => {
  const z = (sel) => {
    const r = all.find((x) => x.sel === sel);
    const m = r && r.body.match(/z-index:\s*(\d+)/);
    return m ? +m[1] : null;
  };
  const strip = z(":root[data-wco] .titlebar");
  assert.ok(strip, "the strip declares a z-index");
  for (const sel of [".topbar", ".show-bar"]) {
    assert.ok(z(sel) < strip, `${sel} is drawn under the strip, which is why it must sit below it`);
  }
});
