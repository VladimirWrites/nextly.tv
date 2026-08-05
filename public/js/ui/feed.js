// A whole discovery feed, rather than the two dozen of it that fit in a row.
//
// The row on the search screen is a sample: the horizontal strip stops where the hand stops,
// and both catalogues have far more behind it. This is the same feed given the page, laid out
// as a grid and loaded as it is scrolled.
//
// Its title, its lede and its captions come from the row definition rather than a second copy
// of them here. A screen that restated its own heading would eventually disagree with the row
// that led to it.
import { h, mount, svg, ICON } from "./dom.js";
import { state } from "../domain/store.js";
import { trackedKeys } from "../domain/discover.js";
import { feedById } from "./discover.js";
import * as discover from "../io/discover.js";
import * as cache from "../io/cache.js";
import { shelfCard } from "./shelf.js";

/* How far down the page a feed was, per feed, for the length of the visit. Coming back to a
   feed you scrolled a long way into and being put at the top again is the same complaint as
   losing your place anywhere else, and here it also means fetching every page over. */
const held = new Map();

export function renderFeed(root, id, { go, back, top }) {
  const row = feedById(id);

  /* Reached from a row on Search and nowhere else, and the tab bar comes off screens you go
     into rather than switch between — so the bar carries the way out, the same as a person or
     a season does. Back to Search when there is nothing behind this one, which is where the
     row that led here lives. */
  if (top) {
    top.lead.replaceChildren(h("button.topbar-back", {
      type: "button",
      "aria-label": "Back",
      onclick: () => back("search"),
    }, [svg(ICON.back)]));
  }

  if (!row) return mount(root, notAFeed(go));

  const grid = h("div.grid");
  const foot = h("div.feed-foot");
  const seen = new Set();
  let page = 0;
  let done = false;
  let busy = false;

  const add = (cards) => {
    const tracked = trackedKeys(state.shows);
    // Discovery offers what you do not have. Also deduplicated across pages: TMDB's lists move
    // while you read them, so a show can arrive on page two having already been on page one.
    const fresh = cards.filter((c) => !tracked.has(c.key) && !seen.has(c.key));
    fresh.forEach((c) => seen.add(c.key));
    grid.append(...fresh.map((c) => card(c, row.caption ? row.caption(c) : null, go)));
    return fresh.length;
  };

  async function more() {
    if (busy || done) return;
    busy = true;
    foot.replaceChildren(h("div.feed-more", { text: "Loading…" }));
    try {
      const { cards, more: hasMore } = await discover.feedPage(id, page + 1, {
        tracked: trackedKeys(state.shows),
        limit: Infinity,   // the row's two dozen is the row's business, not this screen's
      });
      page += 1;
      const added = add(cards);
      done = !hasMore;
      /* A page whose every card was already tracked or already shown adds nothing, and stopping
         there would look like the end of a feed that has more in it. Keep going while the
         catalogue says there is more. */
      if (!done && added === 0) { busy = false; return more(); }
      foot.replaceChildren(done && grid.children.length
        ? h("div.feed-end", { text: "That's everything." })
        : h("div.feed-more", { text: "Loading…" }));
      if (done && !grid.children.length) mount(root, nothingLeft(row, go));
      held.set(id, { page, done });
    } catch (e) {
      done = true;
      foot.replaceChildren(h("div.feed-end", { text: "Couldn't load any more of this." }));
    }
    busy = false;
  }

  // No heading and no lede: the bar already says which feed this is, and the row that led here
  // said what it was for. Repeating both above the grid only pushed the shows down the page.
  mount(root, h("div.feed", [grid, foot]));

  /* The sentinel is what asks for the next page: it sits under the grid, and the moment it is
     anywhere near the viewport there is more to fetch. rootMargin gets it started before the
     end is actually reached, so the scroll never stops to wait.

     Observing the foot rather than listening to scroll means no work at all happens on the
     frames in between, which is the whole reason to do it this way. */
  if (typeof IntersectionObserver === "function") {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        if (done) io.disconnect();
        else more();
      }
    }, { rootMargin: "600px 0px" });
    io.observe(foot);
  }
  more();
}

// A discovery card opens the show rather than tracking it, the same as in the row it came from.
function card(c, caption, go) {
  cache.putHint(c);
  return shelfCard(c, { caption, go });
}

const notAFeed = (go) => h("div.empty", [
  h("div.empty-title.t-title", { text: "There's no such list" }),
  h("p", { text: "It may have been renamed, or it belongs to the other catalogue." }),
  h("button.btn.btn-primary", { type: "button", text: "Back to search",
    onclick: () => go("search"), style: { marginTop: "18px" } }),
]);

const nothingLeft = (row, go) => h("div.empty", [
  h("div.empty-title.t-title", { text: "You're already tracking all of it" }),
  h("p", { text: `Every show in ${row.title.toLowerCase()} is in your library.` }),
  h("button.btn.btn-primary", { type: "button", text: "Open library",
    onclick: () => go("library"), style: { marginTop: "18px" } }),
]);
