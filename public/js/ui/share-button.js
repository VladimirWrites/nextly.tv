// The share button, wherever a screen has something worth sending.
//
// One builder rather than one per screen: a show, an actor, a season and an episode are all
// "a thing at an address", and the only differences are the words. Keeping it in one place is
// also what stops the icon drifting apart from the toast — three copies of this would end up
// disagreeing about what a cancelled share means.
import { h, svg, toast, shareIcon, shareLink } from "./dom.js";
import { pathFor } from "../domain/routes.js";
import { portableKey } from "../domain/constants.js";

/* `what` is what to call it in the share sheet; `route` and `arg` are where it lives.
   The URL is built from the router rather than from location, so a share sent from a screen
   reached sideways still points at the thing on it. */
/* .lib-btn, which is what every other control in a bar is: a square the height of the bar's
   control track. btn-sm is a shorter pill meant for buttons that sit in a page with words in
   them, and using it here made the one button in the bar the only thing in the app that was
   not the same size or shape as the sort and search buttons beside it. */
export function shareButton(what, route, arg, cls = "btn.lib-btn") {
  return h(`button.${cls}`, {
    type: "button",
    "aria-label": `Share ${what}`,
    title: `Share ${what}`,
    onclick: async () => {
      const url = new URL(pathFor(route, arg), location.origin).href;
      const r = await shareLink({ title: what, url });
      // Sharing announces itself; the system sheet is the feedback. Only the fallback needs a
      // word, and a cancelled share needs none at all.
      if (r === "copied") toast("Link copied");
      else if (r === "failed") toast("Couldn't share that");
    },
  }, [svg(shareIcon())]);
}
