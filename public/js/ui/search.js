// Search — find a show in the active catalogue and start tracking it.
import { h, svg, ICON, mount, toast, posterFallback, poster } from "./dom.js";
import { state } from "../domain/store.js";
import * as cache from "../io/cache.js";
import { findShow, findLikeShow } from "../domain/schema.js";
import { fmtScore } from "../domain/constants.js";
import * as meta from "../io/meta.js";
import { trackShow } from "./actions.js";
import { empty } from "./upnext.js";
import { renderDiscover } from "./discover.js";

let query = "";
let open = false;        // the field is a button until asked for, as in the library
let results = [];
let status = "idle";     // idle | loading | done | error
let error = "";
let timer;
let inFlight = false;

/* Set from outside when a share arrives carrying a name and nothing else: the screen opens with
   the box already filled and the request already going. */
export function presetSearch(q) {
  query = q;
  open = true;
  status = "loading";
  results = [];
  forgetRows();
}

export function renderSearch(root, { go, top }) {
  /* Whether the box has the caret right now, read before anything is replaced. Every render
     builds a new input, so focus is not inherited — it has to be put back deliberately, and
     the only way to know whether it belongs there is to look before the old one is gone. */
  const wasFocused = !!(document.activeElement && document.activeElement.classList
    && document.activeElement.classList.contains("lib-search"));

  const input = h("input.field.lib-search", {
    type: "search",
    value: query,
    placeholder: "Search for a show",
    "aria-label": "Search for a show",
    autocomplete: "off",
    oninput: (e) => {
      query = e.target.value;
      clearTimeout(timer);
      // Debounced so typing a title is one request, not one per keystroke.
      timer = setTimeout(() => run(root, go, top), 320);
    },
  });

  /* The field lives in the toolbar, behind an icon, exactly as the library's does. Tapping
     the icon costs no more than tapping into an open field would, and it buys back the screen's
     name — which is worth more on the way in than an empty box is.

     No heading below it either: a search box explains itself, and a label above it only pushes
     the discovery rows further down. */
  const openBtn = h("button.btn.lib-btn", {
    type: "button",
    "aria-label": "Search for a show",
    onclick: () => {
      open = true;
      renderSearch(root, { go, top });
      const field = document.querySelector(".topbar .lib-search");
      if (field) field.focus();
    },
  }, [svg(ICON.search, "lib-btn-icon")]);

  const closeBtn = h("button.btn.lib-btn", {
    type: "button",
    "aria-label": "Close search",
    onclick: () => {
      open = false;
      query = "";
      results = [];
      status = "idle";
      forgetRows();
      renderSearch(root, { go, top });
    },
  }, [svg(ICON.x, "lib-btn-icon")]);

  const showing = open || !!query;
  if (top) {
    top.bar.classList.add("has-actions");
    top.bar.classList.toggle("is-searching", showing);
    top.actions.replaceChildren(...(showing ? [input, closeBtn] : [openBtn]));
  }

  mount(root, top ? null : h("div.search-bar", [input]), body(root, go));

  // A query arriving from a share has had no keystroke to debounce, so it starts here.
  if (status === "loading" && !results.length && query.trim() && !inFlight) run(root, go, top);

  /* Keep focus and caret across re-renders, so a repaint mid-typing isn't felt — and equally
     when the box has just been emptied. The field's own clear button hands back an empty value,
     which used to mean the render that followed had no reason to focus anything and the
     keyboard went away mid-search. */
  if (showing && document.activeElement !== input && (wasFocused || query)) {
    input.focus();
    input.setSelectionRange(query.length, query.length);
  }
}

function body(root, go) {
  /* Typing does not empty the list. A catalogue takes a moment to answer, and clearing the
     results on every keystroke meant the screen spent most of the typing blank and then
     rebuilt itself — the rows that were about to be there anyway included.

     So a search in flight keeps whatever is on screen, and only a search with nothing behind
     it shows nothing. */
  if (status === "loading" && !results.length) return h("div");
  if (status === "error" && !results.length) return h("div.empty", [h("div.empty-title.t-title", { text: "Search failed" }), h("p", { text: error })]);
  if (status === "idle") {
    // An empty search box is a dead end. Offer something to look at instead.
    const host = h("div");
    renderDiscover(host, { go });
    return host;
  }
  if (!results.length) {
    return h("div.empty", [h("div.empty-title.t-title", { text: "No matches" }), h("p", { text: `Nothing matches “${query}”. Try the original-language title.` })]);
  }
  return resultList(results, go);
}

/* The rows themselves, kept between one answer and the next.

   Half of what a catalogue returns for "break" is still there for "breaking", and rebuilding
   those rows throws away their pictures and builds them again — which is the flicker. A row is
   kept whenever the same show comes back, moved into its new place, and only a show that was
   not on screen before is built. */
const rows = new Map();

function resultList(list, go) {
  const box = h("div");
  const next = new Map();

  for (const r of list) {
    const had = rows.get(r.key);
    // Rebuilt only when what it says would change: whether it is tracked is the one thing
    // about a row that moves under it.
    const tracked = !!findLikeShow(state, r);
    const node = had && had.tracked === tracked ? had.node : result(r, go);
    next.set(r.key, { node, tracked });
    box.append(node);
  }

  rows.clear();
  for (const [k, v] of next) rows.set(k, v);
  return box;
}

// Nothing to keep once the screen is left or the query is dropped.
const forgetRows = () => rows.clear();

function result(r, go) {
  // Matched on the portable ids, and failing those on title and year, so a show already
  // held under the other catalogue's numbering reads as tracked rather than offering to add
  // a second copy of itself and then refusing.
  const held = findLikeShow(state, r);
  const tracked = !!held;
  // Everything drawn here is worth keeping: opening this row should not have to fetch the
  // picture the user is already looking at.
  cache.putHint(r);
  const src = r.poster;
  return h("div.result", [
    src ? poster("result-poster", src)
        : h("div.result-poster", [posterFallback(r.name, "sm")]),
    h("button.result-text", {
      type: "button",
      onclick: () => go("show", r.key),
      "aria-label": `Open ${r.name}`,
    }, [
      h("div.result-name.t-title", { text: r.name + (r.year ? ` (${r.year})` : "") }),
      r.rating ? h("div.result-score", { text: `${fmtScore(r.rating)} · ${r.ratingSource || ""}`.trim() }) : null,
      r.overview ? h("p.result-overview", { text: r.overview }) : null,
    ]),
    tracked
      ? h("button.btn.btn-sm.btn-ghost", { type: "button", text: "In library", onclick: () => go("show", held.id) })
      : h("button.btn.btn-sm.btn-primary", {
          type: "button",
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              const sh = await trackShow(r.key);
              // Adding can turn out to be a show already held under the other catalogue's
              // numbering. Opening it is the thing wanted; a refusal on its own is a dead end.
              if (sh && sh.id !== r.key) go("show", sh.id);
            } catch (err) {
              toast(err.message);
              btn.disabled = false;
            }
          },
        }, [svg(ICON.plus), "Track"]),
  ]);
}

// The toolbar slots travel with every redraw, or the field it owns ends up rendered nowhere.
/* The toolbar slots travel with every redraw, or the field this owns ends up rendered nowhere.

   inFlight is what stops the render below from starting a second search while this one is
   still out — and it has to be cleared on every way out of here, including the early one. A
   request that returned by that path used to leave the flag set, and nothing could start a
   search again for the rest of the session. */
async function run(root, go, top) {
  inFlight = true;
  try {
    const q = query.trim();
    if (!q) {
      status = "idle";
      results = [];
      forgetRows();
      return;
    }
    /* Nothing is asked while the last word is a stub and there is already an answer on screen.
       The catalogue in use says whether that matters — TVmaze's matcher wants finished words,
       TMDB's does not — so this costs nothing anywhere else. */
    const p = meta.activeProvider();
    if (results.length && p.looksIncomplete && p.looksIncomplete(q)) {
      status = "done";
      return;
    }

    status = "loading";
    renderSearch(root, { go, top });
    try {
      results = await meta.search(q);
      status = "done";
    } catch (e) {
      error = e.message;
      status = "error";
      // The rows on screen are kept, so the failure has to say itself somewhere.
      if (results.length) toast(error);
    }
  } finally {
    inFlight = false;
    renderSearch(root, { go, top });
  }
}
