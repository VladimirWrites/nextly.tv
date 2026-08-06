// Ten bars, one number.
//
// The app already draws a row of ticks to mean "how much of this have you seen" — the barcode
// on the show page. This borrows that language for the other number a viewer holds: how good it
// was. Ten bars for a scale of ten, so nobody has to work out whether four stars means eight,
// and pressing the bar you mean is the whole interaction.
//
// The bars rise left to right. That is not decoration: it is what stops the control reading as
// a progress bar, which is what a flat row of ten equal ticks says in an app that already uses
// flat rows of ten equal ticks for exactly that.
import { h } from "./dom.js";
import { ratingOf } from "../domain/model.js";
import { RATING_MAX, RATING_TITLE } from "../domain/constants.js";
import { rateNow } from "./actions.js";

/* A word per number. The number is the thing stored and the word is there for the same reason a
   score says which crowd gave it — 7 alone is a fact about nothing, and everybody's private
   scale is different until it is written down. */
export const RATING_WORD = {
  1: "Terrible", 2: "Bad", 3: "Weak", 4: "Poor", 5: "Fine",
  6: "Good", 7: "Very good", 8: "Great", 9: "Superb", 10: "Perfect",
};

/* One control.
 *
 * `onset` receives the new number, or 0 when the reader presses the bar that is already set —
 * which is how a rating is taken back. There is no separate clear button: the gesture that
 * removes a rating is the one that would have set the same one again, and it is the only thing
 * that press could sensibly mean.
 *
 * `size` is "sm" for the rows inside a season, where this sits beside an episode number and
 * cannot be 46px tall. */
export function ratingBar(show, target, onset, { size = "md", label = null } = {}) {
  const now = ratingOf(show, target);
  const bars = [];

  const paint = (upto) => bars.forEach((b, i) => {
    b.classList.toggle("is-on", i < upto);
    b.classList.toggle("is-low", i < upto && upto <= 3);
  });

  const value = h("div.rate-n");
  const word = h("div.rate-word");

  for (let i = 1; i <= RATING_MAX; i++) {
    const b = h("button.rate-bar", {
      type: "button",
      "aria-label": `${i} out of ${RATING_MAX} — ${RATING_WORD[i]}`,
      "aria-pressed": String(i === now),
      onclick: () => onset(i === ratingOf(show, target) ? 0 : i),
      /* Hover previews what a press would set, so the scale can be read without committing to
         anything. Touch has no hover and does not need one: the bars are already labelled by
         their own heights. */
      onmouseenter: () => paint(i),
      onmouseleave: () => paint(ratingOf(show, target)),
    });
    // Shortest to tallest, so the row reads as a scale rather than as progress.
    b.style.height = `${52 + (i - 1) * 4.8}%`;
    bars.push(b);
  }

  // Built after the loop, not before it: h() takes its children as they are at the moment it is
  // called, so a row handed an array that is still empty is a row that stays empty.
  const row = h("div.rate-bars", bars);

  paint(now);
  value.innerHTML = "";
  if (now) {
    value.append(h("span.rate-n-v", { text: String(now) }), h("span.rate-n-max", { text: `/${RATING_MAX}` }));
    word.textContent = RATING_WORD[now];
  } else {
    value.append(h("span.rate-n-none", { text: label || "Not rated" }));
    word.textContent = "";
  }

  return h(`div.rate${size === "sm" ? ".is-sm" : ""}`, [
    h("div.rate-head", [value, word]),
    row,
  ]);
}

/* The number on its own, for the places that show a rating without offering to change it — a
   season header while its rows are collapsed, a library row. Absent when there is none, rather
   than a zero or a dash, because "not rated" is not a score. */
export function ratingChip(show, target) {
  const v = ratingOf(show, target);
  return v ? h("span.rate-chip", { title: RATING_WORD[v], text: String(v) }) : null;
}


/* The control in its own section, which is how both detail pages use it.
 *
 * `key` is passed separately from the record because a title can be rated before it is held —
 * rateNow adds it — and in that case there is no record to take an id from. */
export function ratingSection(show, key, target = RATING_TITLE, title = "Your rating") {
  return h("div", [
    h("div.sect", [h("h2.t-label", { text: title })]),
    h("div.panel", [ratingBar(show, target, (v) => rateNow((show && show.id) || key, target, v))]),
  ]);
}
