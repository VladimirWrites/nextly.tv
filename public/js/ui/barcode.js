// The barcode strip — the app's signature element.
//
// One tick per episode, grouped by season. A percentage tells you how much is left; this
// tells you the shape of it: which season you stalled in, the gap where you skipped one,
// how much hasn't aired yet, and exactly which episode you'd play next. It costs the same
// vertical space as a progress bar.
//
// Colour carries all of the meaning, so it stays scarce: amber for watched, one cyan tick
// for next-up, neutral for aired-and-unwatched, faint and short for unaired.
//
// During a rewatch a fifth state appears: an episode you saw on an earlier pass but not yet
// on this one draws as a half-height amber bar. The previous run stays visible underneath
// the current one, which is what stops a rewatch from looking like starting from nothing.
import { h, svg, ICON, dragScroll } from "./dom.js";
import { barcode, TICK, passOf, isBlock, fitsStrip, tickState, STRIP_MAX } from "../domain/progress.js";
import { epCode } from "../domain/constants.js";
import { fmtDate } from "../domain/dates.js";

/* Which class draws which state. The decisions — what collapses to a block, what counts as
   next, how long is too long to draw at all — are in domain/progress.js, where they can be
   checked; this file is what those decisions look like. */
const CLASS = {
  next: "is-next",
  watched: "is-w",
  seen: "is-s",
  unaired: "is-x",
  unwatched: "",
};

const tickClass = (ep, nextKey) => CLASS[tickState(ep, nextKey)];

// Compact strip for library cards and rows. Not interactive — a card is one tap target.
// Returns null for a show too long to draw, and callers simply leave it out.
export function miniBarcode(show, meta, nextKey, opts = {}) {
  const seasons = barcode(show, meta, opts);
  if (!fitsStrip(seasons, STRIP_MAX.mini)) return null;

  return h("div.bc", { "aria-hidden": "true" }, seasons.map((se) =>
    isBlock(se, nextKey)
      ? h("div.bc-season", [h("i.bc-lump", { class: "is-" + se.block })])
      : h("div.bc-season", se.episodes.map((ep) =>
          h("i.bc-tick", { class: tickClass(ep, nextKey) })
        ))
  ));
}

// Full strip for the show page: taller, labelled by season, and every tick is a button that
// toggles that episode.
/* The show page draws every episode, always — that is the screen you came to in order to see
   exactly where you are, and a summary is the opposite of it.

   Up to a point. A tick per episode stops being a picture of anything once there are more
   ticks than pixels, so past that length the strip is left out rather than replaced with
   something more elaborate. The season list below is the answer at that size. */

export function fullBarcode(show, meta, nextKey, onToggle, opts = {}) {
  const seasons = barcode(show, meta, opts);
  if (!fitsStrip(seasons, STRIP_MAX.full)) return null;
  const strip = h("div.bc.bc-full.scroll-x", seasons.map((se) =>
    h("div.bc-season", [
      h("div.bc-ticks", se.episodes.map((ep) => {
        const unaired = ep.t === TICK.UNAIRED;
        const label = [
          epCode(ep.s, ep.e),
          ep.name || null,
          ep.n > 1 ? `watched ${ep.n}×` : null,
          unaired && ep.air ? "airs " + fmtDate(ep.air) : null,
        ].filter(Boolean).join(" · ");
        return h("button.bc-tick", {
          class: tickClass(ep, nextKey),
          type: "button",
          title: label,
          "aria-label": label,
          disabled: unaired,
          onclick: unaired ? null : () => onToggle(ep),
        });
      })),
      h("div.bc-num", { text: se.n === 0 ? "SP" : "S" + String(se.n).padStart(2, "0") }),
    ])
  ));

  // A long show's strip runs past the edge, and a mouse with no horizontal wheel could not
  // reach the end of it.
  dragScroll(strip);
  return h("div", [strip, legend(passOf(show) > 1)]);
}

function legend(rewatching) {
  const key = (cls, label) => h("span.bc-key", [h("i.bc-swatch", { class: cls }), label]);
  const keys = [key("is-w", "Watched"), key("is-next", "Next up")];
  // The rewatch key only appears when there's something to explain.
  if (rewatching) keys.push(key("is-s", "Seen before"));
  keys.push(key("", "Not watched"), key("is-x", "Not aired"));
  return h("div.bc-legend", keys);
}

export { svg, ICON };
