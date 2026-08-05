// One film.
//
// A show page is mostly its episode list — the barcode, the seasons, what to watch next. A film
// has none of that, and building this out of the show page would have meant a screen with most
// of itself switched off. So it is its own page, and a short one: the artwork, what it is, and
// the one thing there is to say about it, which is whether you have seen it.
//
// Everything it reads is the same record shape a show uses, with no seasons. What it writes is
// one mark, keyed so it can never collide with an episode.
import { h, svg, ICON, mount, keepMedia, poster, posterFallback } from "./dom.js";
import { state } from "../domain/store.js";
import { findShow } from "../domain/schema.js";
import { movieWatched, moviePlays } from "../domain/model.js";
import { fmtScore, fmtDuration } from "../domain/constants.js";
import { fmtDate } from "../domain/dates.js";
import { shareButton } from "./share-button.js";
import { anonBar, canGoBack } from "./anon.js";
import { markMovieNow, ensureMovie, untrackShow } from "./actions.js";
import { empty } from "./upnext.js";
import * as cache from "../io/cache.js";

export function renderMovie(root, key, { go, back, top, repaint }) {
  if (top) {
    top.lead.replaceChildren(...(canGoBack() ? [h("button.topbar-back", {
      type: "button", "aria-label": "Back", onclick: () => back("library"),
    }, [svg(ICON.back)])] : []));
    top.bar.classList.remove("is-searching");
    top.bar.classList.add("has-actions");
  }

  const held = findShow(state, key);
  const m = cache.getMeta(key) || cache.getHint(key);
  const name = (held && held.name) || (m && m.name) || "";

  if (top) {
    top.actions.replaceChildren(shareButton(name || "this film", "movie", key));
    top.bar.querySelector(".topbar-title").textContent = name;
  }

  // Asked for on every visit, not only when it is missing: a record written before this app
  // read runtimes is present, complete-looking, and silent about them.
  ensureMovie(key);
  if (!m) return mount(root, waiting());

  const watched = movieWatched(held);
  const plays = moviePlays(held);
  const facts = [
    m.year,
    m.runtime ? fmtDuration(m.runtime) : null,
    (m.genres || []).slice(0, 2).join(", ") || null,
    m.released && !m.year ? fmtDate(m.released) : null,
  ].filter(Boolean);

  mount(
    root,
    h("section.show-hero", [
      m.backdrop || m.poster
        ? keepMedia(`bg:${key}`, "div", {
            bg: m.backdrop || m.poster,
            class: m.backdrop ? "show-bg" : "show-bg is-poster",
          })
        : null,
      h("div.show-veil"),
      h("div.show-body", [
        h("div.show-art-col", [
          m.posterSm || m.poster
            ? keepMedia(`poster:${key}`, "img", { src: m.posterSm || m.poster, class: "show-poster" })
            : h("div.show-poster", [posterFallback(name, "md")]),
          h("div.row-gap.show-links"),
        ]),
        h("div", { style: { minWidth: 0 } }, [
          h("h1.t-display.show-name", { text: name }),
          facts.length
            ? h("div.show-facts.sep-row", facts.map((f) => h("span.sep-item", { text: String(f) })))
            : null,
          m.overview ? h("p.show-overview", { text: m.overview }) : null,
        ]),
      ]),
    ]),

    h("div.show-rest", [
      h("div.panel", { style: { marginTop: "18px" } }, [
        h("div.panel-actions", { style: { marginTop: "0" } }, [
          held
            ? h("button.btn", {
                type: "button",
                class: watched ? "btn-ghost" : "btn-primary",
                onclick: () => markMovieNow(held.id, !watched),
              }, [svg(ICON.check, "btn-icon"), watched ? "Watched — undo" : "Mark watched"])
            /* Not tracked, so there is nothing to mark yet. Marking it is also the most likely
               reason somebody opened a film they do not hold, so the one button does both. */
            : h("button.btn.btn-primary", {
                type: "button",
                onclick: () => markMovieNow(key, true),
              }, [svg(ICON.check, "btn-icon"), "Mark watched"]),
          plays > 1
            ? h("span.t-dim", { style: { fontSize: "13.5px" }, text: `Watched ${plays} times.` })
            : null,
        ]),
      ]),

      /* Whose number this is, said out loud. 7.5 on IMDb and 7.5 on TMDB are different claims by
         different crowds, and a score with no source is folklore. */
      (m.ratings || []).length
        ? h("div", [
            h("div.sect", [h("h2.t-label", { text: "Score" })]),
            h("div.panel", [
              h("div.score-row", (m.ratings || []).map((r) => h("div.score", [
                h("div.score-n", { text: fmtScore(r.score) }),
                h("div.score-src", { text: r.source }),
                r.votes ? h("div.score-votes", { text: `${r.votes.toLocaleString()} votes` }) : null,
              ]))),
            ]),
          ])
        : null,

      (m.director || []).length || (m.cast || []).length
        ? h("div", [
            h("div.sect", [h("h2.t-label", { text: "Who made it" })]),
            h("div.panel", [
              h("div.show-facts.sep-row", [
                (m.director || []).length
                  ? h("span.sep-item", { text: `Directed by ${(m.director || []).join(", ")}` })
                  : null,
                (m.cast || []).length
                  ? h("span.sep-item", { text: (m.cast || []).slice(0, 6).join(", ") })
                  : null,
              ].filter(Boolean)),
            ]),
          ])
        : null,

      held
        ? h("div.panel", { style: { marginTop: "18px" } }, [
            h("div.panel-actions", { style: { marginTop: "0" } }, [
              h("button.btn.btn-sm.btn-ghost", {
                type: "button",
                text: "Remove from library",
                onclick: () => { if (untrackShow(held.id)) go("library"); },
              }),
            ]),
          ])
        : null,

      // Only ever drawn for somebody who arrived without a vault; returns null otherwise.
      anonBar(),
    ]),
  );
}

// The record arrives in a moment; hold the shape it will take.
const waiting = () => h("div", [
  h("div.skeleton", { style: { height: "30px", width: "48%", borderRadius: "6px" } }),
  h("div.skeleton", { style: { height: "13px", width: "62%", marginTop: "14px", borderRadius: "6px" } }),
  h("div.skeleton", { style: { height: "13px", width: "88%", marginTop: "8px", borderRadius: "6px" } }),
]);

