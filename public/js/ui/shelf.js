// The card that appears in every horizontal row.
//
// There were five of these, in five files, all rendering the same three boxes: a poster, a
// title, and a caption. They agreed by coincidence, which is the kind of agreement that ends
// the first time one of them learns something the others do not — and the thing they were
// about to learn is what this file exists for.
//
// A discovery row answers "what could I watch". It could not answer the question anybody
// actually asks of it, which is "have I got this one already". The library knows; the row
// simply never asked it.
import { h, svg, ICON, poster, posterFallback } from "./dom.js";
import { state } from "../domain/store.js";
import { shelfState } from "../domain/model.js";

/* One tick, one meaning: this is already yours. Not "seen" — a watchlisted movie is in the
 * library without having been watched, and the caption below is where that distinction gets
 * drawn, at a size where it can be read. */
const badge = () => h("div.shelf-badge", { "aria-hidden": "true" }, [svg(ICON.check, "shelf-badge-icon")]);

/* The card, everywhere.
 *
 * `caption` is what the row wants said when the title is not yours — a year, a part played, an
 * air date. Holding it usually overrides that, because "Watching" is the more useful of the two
 * and both do not fit.
 *
 * Usually, not always. Where the caption is the part somebody played, overriding it puts the
 * word "Watching" in the place a role goes and it reads as the role: Monica Bellucci's page
 * offered Twin Peaks with "Watching" underneath, which says she is credited as Watching. The
 * tick in the corner already says the title is yours, so on those rows the status is the
 * repetition and the part is the news. `preferCaption` is how a row says which of the two its
 * caption is.
 *
 * The route follows the card's kind rather than the row's, since a row can hold both: a
 * career on the person page does, and so does a feed of popular movies. */
export function shelfCard(card, { caption = null, go, route, preferCaption = false } = {}) {
  const { held, label } = shelfState(state, card);
  const at = route || (card.kind === "movie" ? "movie" : "show");
  // Both, here, because nothing is competing for room in a spoken label.
  const said = [card.name, card.year ? `, ${card.year}` : "", caption ? `, ${caption}` : "",
    label ? `, ${label}` : ""].join("");

  const shown = preferCaption && caption ? caption : (label || caption);

  return h("button.shelf-card", {
    type: "button",
    onclick: () => go(at, card.key),
    "aria-label": said,
  }, [
    h("div.shelf-art", [
      card.poster ? poster("shelf-poster", card.poster) : posterFallback(card.name, "md"),
      held ? badge() : null,
    ]),
    h("div.shelf-name.t-title", { text: card.name }),
    shown
      ? h("div.shelf-cap", { class: shown === label ? "is-held" : null, text: shown })
      : null,
  ]);
}
