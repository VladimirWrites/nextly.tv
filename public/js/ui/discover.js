// Discover — what the search screen shows before you've typed anything.
//
// An empty search box is a dead end, and "what should I watch" is the question this app
// exists to answer.
//
// Every row belongs to a catalogue and only appears when that catalogue is the one in use.
// A card opens a show under its catalogue's episode numbering, so a mixed screen would hand
// back TVmaze shows to someone who chose TMDB. TVmaze rows are built from its schedule
// ranked by popularity; TMDB's come from endpoints TVmaze has no equivalent for.
import { h, mount, posterFallback, shelfScroller, poster } from "./dom.js";
import { state } from "../domain/store.js";
import { trackedKeys } from "../domain/discover.js";
import { fmtDay, daysUntil } from "../domain/dates.js";
import { fmtScore } from "../domain/constants.js";
import * as discover from "../io/discover.js";
import * as cache from "../io/cache.js";

// Each row loads independently and paints as it arrives, so one slow feed never holds up
// the others.
const ROWS = [
  {
    id: "premieres",
    via: "tvmaze",
    title: "Premieres coming up",
    lede: "New seasons and new shows about to start.",
    load: (tracked) => discover.premiereFeed({ tracked }),
    caption: (c) => (c.air ? `${c.season > 1 ? `Season ${c.season}` : "New"} · ${whenLabel(c.air)}` : null),
  },
  {
    id: "today",
    via: "tvmaze",
    title: "On today",
    lede: "Airing right now, most popular first.",
    load: (tracked) => discover.airingFeed({ tracked }),
    caption: (c) => c.network,
  },
  {
    id: "trending",
    via: "tmdb",
    title: "Trending this week",
    lede: "What people are watching most.",
    load: () => discover.trendingFeed(),
    caption: (c) => scoreCaption(c),
  },
  {
    id: "popular",
    via: "tmdb",
    title: "Popular",
    load: () => discover.popularFeed(),
    caption: (c) => scoreCaption(c),
  },
  {
    id: "toprated",
    via: "tmdb",
    title: "Best rated",
    lede: "Highest scored, by people who voted enough to mean it.",
    load: () => discover.topRatedFeed(),
    caption: (c) => scoreCaption(c),
  },
];

// The source is named, not implied by a star that could mean anyone's rating.
const scoreCaption = (c) => (c.rating ? `${fmtScore(c.rating)} · ${c.ratingSource || ""}`.trim() : null);

function whenLabel(air) {
  const d = daysUntil(air);
  if (d === null) return "";
  if (d <= 0) return "today";
  if (d === 1) return "tomorrow";
  if (d < 7) return `in ${d} days`;
  return fmtDay(air);
}

/* What each row last drew. A repaint that has to happen — a sync that brought something, a show
   tracked from one of these very rows — should not take the rows down to placeholders and build
   them again from a promise that resolves in a microtask. The flash is short and it is exactly
   what makes the screen look unsteady.

   Cards only, keyed by row: cheap to hold, and dropped whenever the feeds are. */
const drawn = new Map();
discover.onForget(() => drawn.clear());

export function renderDiscover(root, { go }) {
  const tracked = trackedKeys(state.shows);
  const using = discover.hasTmdb() ? "tmdb" : "tvmaze";
  const sections = ROWS.filter((r) => r.via === using);

  const nodes = sections.map((row) => {
    /* Filtered again on the way back out: a show tracked since this row was drawn should not
       reappear for the frame before the feed resolves. */
    const held = (drawn.get(row.id) || []).filter((c) => !tracked.has(c.key));
    // Straight to the posters where this row has already been drawn once.
    const strip = shelfScroller(h("div.shelf", held.length
      ? held.map((c) => posterCard(c, row.caption(c), go))
      : [skeleton(), skeleton(), skeleton(), skeleton()]), `row:${row.id || row.title}`);
    const section = h("div", [
      h("div.shelf-head", [
        h("h2.t-label", { text: row.title }),
        row.lede ? h("div.sect-lede-sm", { text: row.lede }) : null,
      ]),
      strip,
    ]);

    row.load(tracked)
      .then((all) => {
        // Discovery offers things you don't have. TVmaze feeds drop tracked shows in the
        // domain layer; TMDB's endpoints take no such parameter, so both are filtered here.
        const cards = all.filter((c) => !tracked.has(c.key));
        if (!cards.length) { drawn.delete(row.id); return section.remove(); }
        // Nothing to do where the row is already showing exactly this.
        const same = held.length === cards.length && held.every((c, i) => c.key === cards[i].key);
        drawn.set(row.id, cards);
        if (same) return;
        strip.replaceChildren(...cards.map((c) => posterCard(c, row.caption(c), go)));
      })
      .catch(() => section.remove());

    return section;
  });

  mount(root, h("div.discover", nodes.length ? nodes : [
    h("div.empty", [
      h("div.empty-title.t-title", { text: "Search for a show" }),
      h("p", { text: "Type a title above to find something to track." }),
    ]),
  ]));
}

// A discovery card opens the show rather than tracking it: deciding whether you want
// something is the step before adding it, and adding by accident is annoying to undo.
function posterCard(card, caption, go) {
  cache.putHint(card);
  return h("button.shelf-card", {
    type: "button",
    onclick: () => go("show", card.key),
    "aria-label": `${card.name}${card.year ? `, ${card.year}` : ""}`,
  }, [
    h("div.shelf-art", [
      card.poster
        ? poster("shelf-poster", card.poster)
        : posterFallback(card.name, "md"),
    ]),
    h("div.shelf-name.t-title", { text: card.name }),
    caption ? h("div.shelf-cap", { text: caption }) : null,
  ]);
}

/* Poster, title, caption — the same three boxes a real card has, so a row does not grow by 44px
   the moment its data lands and shove everything below it down the page. */
const skeleton = () => h("div.shelf-card", [
  h("div.shelf-art.skeleton"),
  h("div.shelf-name", [h("span.skeleton.skeleton-line")]),
  h("div.shelf-cap", [h("span.skeleton.skeleton-line", { style: { width: "60%" } })]),
]);
