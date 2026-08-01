// Library — everything you track, as a poster grid.
//
// Each card carries a mini barcode, so the grid shows the shape of your progress rather
// than a wall of identical artwork: where you are in each show is readable without opening
// anything.
import { h, svg, ICON, mount, posterFallback, poster } from "./dom.js";
import { state } from "../domain/store.js";
import { showProgress, nextUp } from "../domain/progress.js";
import { returnsIn } from "../domain/schedule.js";
import { ordinal, fold, sortKey, indexLetter, SHOW_STATUS } from "../domain/constants.js";
import { lifePill, cardLine } from "../domain/labels.js";
import * as cache from "../io/cache.js";
import { readView, writeView } from "../io/storage.js";
import { chooser } from "./overlay.js";
import { miniBarcode } from "./barcode.js";
import { opts, changeStatus } from "./actions.js";
import { empty } from "./upnext.js";

// Filters name states you'd actually go looking for, not the raw status field. "Waiting"
// is the one that matters day to day: tracked, aired, unwatched.
const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "waiting", label: "Waiting", test: (r) => r.st === "active" && r.progress.remaining > 0 },
  { id: "caught", label: "Caught up", test: (r) => r.st === "active" && r.progress.remaining === 0 },
  { id: "planned", label: "Planned", test: (r) => r.st === "planned" },
  { id: "paused", label: "Paused", test: (r) => r.st === "paused" },
  { id: "dropped", label: "Dropped", test: (r) => r.st === "dropped" },
];

let filter = "all";
let sort = "recent";
let query = "";
let searching = false;     // the field is a button until you ask for it
let detachAz = null;


const SORTS = [
  { id: "recent", label: "Recently watched", cmp: (a, b) => b.last - a.last || b.added - a.added },
  { id: "added", label: "Recently added", cmp: (a, b) => b.added - a.added },
  { id: "name", label: "Name", cmp: (a, b) => sortKey(a.name).localeCompare(sortKey(b.name)) },
  { id: "left", label: "Most waiting", cmp: (a, b) => b.progress.remaining - a.progress.remaining },
];

/* Restored from the device, so the library opens the way you last left it. Checked against
   the list rather than trusted: a stored id from an older build would otherwise leave the
   menu showing one order while the grid used another. */
const remembered = readView().librarySort;
if (SORTS.some((s) => s.id === remembered)) sort = remembered;

export function renderLibrary(root, { go, top }) {
  // Redrawing has to carry the topbar slots with it, or the controls it owns end up rendered
  // into nothing.
  const again = () => renderLibrary(root, { go, top });
  if (!state.shows.length) {
    return mount(root, empty(
      "Nothing tracked yet",
      "Shows you track appear here with their full episode history.",
      "Find a show", () => go("search"),
    ));
  }

  const rows = state.shows.map((show) => {
    const meta = cache.getMeta(show.id);
    const progress = meta ? showProgress(show, meta, opts()) : { remaining: 0, watched: 0, aired: 0, pct: 0 };
    return {
      show,
      meta,
      progress,
      st: show.st,
      name: show.name,
      added: show.added || 0,
      last: (show.entries || []).reduce((m, e) => Math.max(m, +e.m || 0), 0),
    };
  });

  const shown = rows.filter((FILTERS.find((f) => f.id === filter) || FILTERS[0]).test)
    .sort((SORTS.find((s) => s.id === sort) || SORTS[0]).cmp);

  const chips = h("div.row-gap", FILTERS.map((f) => {
    const n = rows.filter(f.test).length;
    return h("button.chip", {
      type: "button",
      class: f.id === filter ? "is-on" : null,
      text: `${f.label} ${n}`,
      onclick: () => { filter = f.id; again(); },
    });
  }));

  /* A button, not a <select>. The native control renders as a system picker that belongs to a
     different app — on Android a full-screen grey list with none of this app's type.

     It carries the name of the current order where there is room for it, and the icon alone on
     a phone, where "Recently added" does not fit beside everything else. Nothing marks which
     order is picked: the list below is already sorted, so the answer is on screen, and the
     sheet ticks it when opened. */
  const current = SORTS.find((s) => s.id === sort) || SORTS[0];
  const orderBtn = h("button.btn.lib-btn", {
    type: "button",
    "aria-haspopup": "dialog",
    "aria-label": `Order library: ${current.label}`,
    onclick: async () => {
      const picked = await chooser({
        title: "Order by",
        value: sort,
        options: SORTS.map((s) => ({ value: s.id, label: s.label })),
      });
      if (!picked || picked === sort) return;
      sort = picked;
      writeView({ librarySort: sort });
      again();
    },
  }, [
    svg(ICON.order, "lib-btn-icon"),
    h("span.lib-btn-label", { text: current.label }),
  ]);

  // The results live in their own container so typing can refill it without rebuilding the
  // page — rebuilding would take the focus and the caret with it on every keystroke.
  const results = h("div.lib-results");
  const count = (top && top.count) || h("span");

  /* A field sitting open costs a whole row to say nothing. It's a button until you want it,
     and it stays open while it holds a query — closing it would silently widen the results. */
  const search = searching || query
    ? h("input.field.lib-search", {
        type: "search",
        value: query,
        placeholder: "Search your library",
        "aria-label": "Search your library",
        autocomplete: "off",
        oninput: (e) => { query = e.target.value; fill(); },
        onkeydown: (e) => {
          if (e.key !== "Escape") return;
          query = "";
          searching = false;
          again();
        },
        onblur: (e) => {
          if (e.target.value.trim()) return;    // still in use
          searching = false;
          again();
        },
      })
    : h("button.btn.lib-btn", {
        type: "button",
        "aria-label": "Search your library",
        onclick: () => {
          searching = true;
          again();
          const field = document.querySelector(".lib-search");
          if (field) field.focus();
        },
      }, [svg(ICON.search, "lib-btn-icon")]);

  // A way out that doesn't rely on knowing about Escape.
  const closeSearch = h("button.btn.lib-btn", {
    type: "button",
    "aria-label": "Close search",
    onclick: () => {
      query = "";
      searching = false;
      again();
    },
  }, [svg(ICON.x, "lib-btn-icon")]);

  function fill() {
    const q = fold(query.trim());
    const list = q ? shown.filter((r) => fold(r.name).includes(q)) : shown;
    count.textContent = q || filter !== "all"
      ? `${list.length} of ${state.shows.length}`
      : `${state.shows.length} shows`;

    if (!list.length) {
      return results.replaceChildren(h("div.empty", [
        h("div.empty-title.t-title", { text: "Nothing here" }),
        h("p", { text: q ? `No show in your library matches “${query.trim()}”.` : "No shows match this filter." }),
      ]));
    }
    stopIndexWatch();
    // The anchors are collected while the grid is built, so the index and the grid can
    // never disagree about which letters exist or what order they come in.
    const anchors = [];
    const cards = grid(list, go, anchors);
    results.replaceChildren(cards, ...(showIndex() ? [azRail(anchors)] : []));
  }

  fill();

  /* The controls live in the bar at the top of the screen rather than in a row of their own:
     it is the toolbar, it is already there, and the library's name and count are in it.

     Searching takes the bar over — the name, the count and the order button all step aside,
     because while you are typing nothing else in it matters. */
  if (top) {
    top.bar.classList.add("has-actions");
    top.bar.classList.toggle("is-searching", !!(searching || query));
    top.actions.replaceChildren(
      ...(searching || query ? [search, closeSearch] : [orderBtn, search]),
    );
  }

  mount(root, chips, results);
}

/* Builds the grid and, as it goes, records the first card of each letter — that's the row a
   letter means, and the list of them is the index. Collecting both here rather than deriving
   the index separately is what keeps the two in step. */
function grid(list, go, anchors) {
  let letter = null;
  return h("div.grid", list.map((r) => {
    const l = indexLetter(r.name);
    const node = card(r, go);
    if (l !== letter) {
      letter = l;
      anchors.push({ letter: l, node });
    }
    return node;
  }));
}


/* Offered under the alphabetical sort and nowhere else, where a letter is a position — and
   never while the search is open, since the field runs the width of the screen and the index
   is pinned to the edge it ends at. Searching is a different way of finding something; the
   two don't need to be on screen together. */
const showIndex = () => sort === "name" && !searching && !query;

/* The index down the right edge, the way a phone contact list does it. Only the letters
   something actually files under: a full alphabet mostly greyed out is a list of places you
   can't go, and it can't show a Cyrillic or Korean heading anyway. Anchors arrive in grid
   order, so the strip reads in the same order as the shows. */
function azRail(anchors) {
  const jump = (node) => node.scrollIntoView({ block: "start", behavior: "smooth" });

  const keys = new Map();
  const rail = h("div.az", { "aria-hidden": "true" }, anchors.map(({ letter, node }) => {
    const key = h("button.az-key", {
      type: "button",
      tabindex: "-1",
      text: letter,
      onclick: () => jump(node),
    });
    keys.set(letter, key);
    return key;
  }));

  // Dragging down the strip scrubs through it, which is the whole point of having one.
  let scrubbing = false;
  watchIndex(rail, keys, anchors, () => scrubbing);

  const byLetter = new Map(anchors.map((a) => [a.letter, a.node]));
  const at = (y) => {
    const el = document.elementFromPoint(rail.getBoundingClientRect().left + 8, y);
    return el && el.classList.contains("az-key") ? byLetter.get(el.textContent) : null;
  };
  rail.addEventListener("pointerdown", (e) => {
    scrubbing = true;
    rail.setPointerCapture(e.pointerId);
  });
  rail.addEventListener("pointermove", (e) => {
    if (!scrubbing) return;
    const target = at(e.clientY);
    if (target) jump(target);
  });
  rail.addEventListener("pointerup", () => { scrubbing = false; });
  rail.addEventListener("pointercancel", () => { scrubbing = false; });
  return rail;
}

/* Which letter you are actually in. An index that only lists letters tells you where you
   could go; marking the current one tells you where you are, which is the half that makes a
   long list navigable. The letter is whichever run's first card has most recently passed
   under the top of the viewport. */
const INDEX_LINE = 96;   // px below the viewport top — clear of the sticky topbar

/* Keeping the letter you are in inside a strip too short to show them all.

   A phone in landscape leaves the rail about two hundred pixels, which is a dozen letters.
   Past that it scrolls — and a scrolled index whose current letter is off the end is worse
   than no index, because the one thing it is certainly meant to tell you is where you are.

   Its own scrollTop, never scrollIntoView. That would scroll the page as well as the strip,
   and the page scrolling is what decides the current letter — so it would move the list, pick
   a new letter, and move again. Nothing here may touch the page's scroll position. */
function keepLetterInView(rail, node) {
  if (!node || rail.scrollHeight <= rail.clientHeight) return;
  const pad = node.offsetHeight * 2;    // a letter or two of context either side
  const top = node.offsetTop;
  const bottom = top + node.offsetHeight;
  if (top - pad < rail.scrollTop) rail.scrollTop = Math.max(0, top - pad);
  else if (bottom + pad > rail.scrollTop + rail.clientHeight) {
    rail.scrollTop = bottom + pad - rail.clientHeight;
  }
}

function watchIndex(rail, keys, anchors, scrubbing) {
  stopIndexWatch();
  let queued = false;

  const update = () => {
    queued = false;
    let here = null;
    for (const a of anchors) {
      if (a.node.getBoundingClientRect().top - INDEX_LINE > 0) break;
      here = a.letter;
    }
    // Before the first heading scrolls past, you are still in the first letter.
    if (!here && anchors.length) here = anchors[0].letter;
    keys.forEach((node, letter) => node.classList.toggle("is-here", letter === here));
    // Not while a thumb is on the strip: moving it under the finger doing the scrubbing is
    // the one time following the current letter is wrong.
    if (!scrubbing()) keepLetterInView(rail, keys.get(here));
  };

  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  // The rail is built before it is mounted, so the first reading has to wait for the cards
  // to exist — measuring now would measure the page being replaced.
  requestAnimationFrame(update);
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  detachAz = () => {
    removeEventListener("scroll", onScroll);
    removeEventListener("resize", onScroll);
  };
}

// Released when the index goes away, so no listener is left running over a detached rail.
export function stopIndexWatch() {
  if (detachAz) detachAz();
  detachAz = null;
}

function card(row, go) {
  const { show, meta, progress } = row;
  const src = meta && (meta.posterSm || meta.poster);
  const next = meta ? nextUp(show, meta, opts()) : null;
  // A caught-up card has room to say when the show is back, which is the only thing left to
  // tell you about it.
  const back = meta && progress.remaining === 0 ? returnsIn(show, meta, opts()) : null;

  const pill = lifePill(meta, progress);

  return h("button.card", {
    type: "button",
    onclick: () => go("show", show.id),
    /* Long-press, which is what a phone sends as a context menu. Changing where a show stands
       is the one thing people come to the library to do that otherwise costs opening the show,
       reading a page built for something else and coming back. */
    oncontextmenu: (e) => { e.preventDefault(); askStatus(show); },
    "aria-label": `${show.name}, ${progress.watched} of ${progress.aired} aired episodes watched`,
  }, [
    h("div.card-art", [
      src
        ? poster("card-poster", src)
        : posterFallback(show.name, "md"),
      progress.remaining > 0 ? h("span.card-badge", { text: progress.remaining > 99 ? "99+" : String(progress.remaining) }) : null,
      progress.pass > 1 ? h("span.card-pass", { text: ordinal(progress.pass) }) : null,
      pill ? h("span.card-life", { class: pill.tone, text: pill.label }) : null,
    ]),
    h("div.card-title.t-title", { text: show.name }),
    meta ? miniBarcode(show, meta, next && next.key, opts()) : null,
    h("div.card-sub", { text: cardLine(meta, progress, back) }),
  ]);
}

const STATUS_LABEL = { active: "Watching", planned: "Planned", paused: "Paused", dropped: "Dropped" };

// The same sheet the show page raises, from the card. Nothing is changed until something is
// chosen, and choosing what it already is costs nothing.
async function askStatus(show) {
  const picked = await chooser({
    title: show.name,
    value: show.st,
    options: SHOW_STATUS.map((st) => ({ value: st, label: STATUS_LABEL[st] })),
  });
  if (picked && picked !== show.st) changeStatus(show.id, picked);
}

