// Looking at the app without a vault, because somebody shared a link.
//
// Two things and nothing more: a way to tell, and a way out. Both live here rather than in
// main.js so the screens can use them without importing the router, which would be a circle.
import { h, svg, ICON } from "./dom.js";
import { rememberedToken } from "../io/storage.js";

// Read rather than stored, so it cannot go stale after somebody signs in.
export const signedOut = () => !rememberedToken();

/* Off to make one. A full navigation rather than an in-page render: the gate is what boot
   draws when there is no token, and reaching it by reloading means one path to it instead of
   two that can disagree. */
export const startAccount = () => { location.href = "/"; };

/* Whether the arrow in the bar has anywhere to point.

   It is not a system back button: at the top of the stack it does not leave, it falls back to a
   screen of the app. That fallback assumes an account. Somebody who followed a link and has no
   vault was being sent to their library, which is not theirs and says "Nothing tracked yet" —
   a stranger dropped into an empty copy of somebody else's app with no way to read it.

   So the arrow is drawn only where it leads somewhere: back through screens they opened
   themselves, or anywhere at all once there is a vault behind it. With neither, the way onward
   is the strip below, and the browser's own back is the way out. */
export const canGoBack = () => ((history.state && history.state.depth) || 0) > 0 || !signedOut();

/* The strip along the bottom of a shared page.
 *
 * Not a modal and not a banner over the content: somebody who followed a link came to look at
 * the thing, and covering it to ask for a signup is how that visit ends. It sits under the
 * page, out of the way, and says what an account would be for rather than demanding one. */
export function anonBar() {
  if (!signedOut()) return null;
  return h("div.anon-bar", [
    h("div.anon-bar-inner", [
      h("div.anon-text", [
        h("div.anon-title", { text: "You're browsing without an account" }),
        h("div.anon-sub", { text: "Keeping track of this takes one tap and no email." }),
      ]),
      h("button.btn.btn-sm.btn-primary", {
        type: "button", text: "Start tracking", onclick: startAccount,
      }),
    ]),
  ]);
}
