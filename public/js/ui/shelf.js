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
 * air date. Holding it overrides that, because "Watching" is the more useful of the two and
 * both do not fit.
 *
 * The route follows the card's kind rather than the row's, since a row can hold both: a
 * career on the person page does, and so does a feed of popular movies. */
export function shelfCard(card, { caption = null, go, route } = {}) {
  const { held, label } = shelfState(state, card);
  const at = route || (card.kind === "movie" ? "movie" : "show");
  const said = [card.name, card.year ? `, ${card.year}` : "", label ? `, ${label}` : ""].join("");

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
    label
      ? h("div.shelf-cap.is-held", { text: label })
      : caption ? h("div.shelf-cap", { text: caption }) : null,
  ]);
}
