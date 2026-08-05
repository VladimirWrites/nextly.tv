// One movie.
//
// A show page is mostly its episode list — the barcode, the seasons, what to watch next. A movie
// has none of that, and building this out of the show page would have meant a screen with most
// of itself switched off. So it is its own page, and a short one: the artwork, what it is, and
// the one thing there is to say about it, which is whether you have seen it.
//
// Everything it reads is the same record shape a show uses, with no seasons. What it writes is
// one mark, keyed so it can never collide with an episode.
import { h, svg, ICON, mount, keepMedia, poster, posterFallback } from "./dom.js";
import { state } from "../domain/store.js";
import { findShow, findSameShow } from "../domain/schema.js";
import { movieWatched, moviePlays } from "../domain/model.js";
import { fmtScore, fmtDuration, movieKey } from "../domain/constants.js";
import { fmtDate } from "../domain/dates.js";
import { anonBar } from "./anon.js";
import { markMovieNow, trackMovie, ensureMovie, untrackShow } from "./actions.js";
import { empty } from "./upnext.js";
import * as cache from "../io/cache.js";
import { movieCredits, similarMovies } from "../io/meta.js";
import { castSection, stickyBar, watchTitle } from "./show-parts.js";
import { shelfScroller } from "./dom.js";

export function renderMovie(root, key, { go, back, top, repaint }) {
  const held = findShow(state, key)
    /* The same movie under either catalogue's key. A record added from Cinemeta is keyed by its
       IMDb id and a TMDB link names a number, so an exact-key lookup finds nothing and the page
       offers to add a movie the library already holds. */
    || findSameShow(state, { ...(cache.getMeta(key) || {}), key, kind: "movie" });
  const m = cache.getMeta(key) || cache.getHint(key);
  const name = (held && held.name) || (m && m.name) || "";

  /* Asked once. Repainting on the failure is what draws the message below, and asking again on
     that repaint would fetch, fail, repaint and fetch for as long as the page is open. */
  if (!failed.has(key)) {
    ensureMovie(key).then((got) => {
      if (got || cache.has(key)) return;
      failed.add(key);
      repaint();
    });
  }

  /* The show page's own bar, over the cover, rather than the app's topbar — which is why this
     route takes none. A bar above the artwork puts it in a box; the cover has to start at the
     top of the screen and the bar has to float on it.

     Shared with the show page rather than rebuilt: what differs is where Back falls back to and
     what Share addresses. A movie is shared by an id every device can open, which is Cinemeta's
     form of the IMDb id — a tmdb:m key is a number only TMDB can read. */
  const imdb = (held && held.imdb) || (m && m.imdb) || null;
  const bar = stickyBar({ id: key, name }, back, {
    route: "movie",
    shareKey: imdb ? movieKey("cinemeta", imdb) : key,
  });

  if (!m) return mount(root, bar, failed.has(key) ? unplaceable(go) : waiting());

  const watched = movieWatched(held);
  const plays = moviePlays(held);
  const facts = [
    m.year,
    m.runtime ? fmtDuration(m.runtime) : null,
    (m.genres || []).slice(0, 2).join(", ") || null,
    m.released && !m.year ? fmtDate(m.released) : null,
  ].filter(Boolean);

  const castBox = h("div");
  const likeBox = h("div");

  mount(
    root,
    bar,
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
            /* Not tracked, so there is nothing to mark yet, and marking is the most likely reason
               somebody opened a movie they do not hold — so that button does both at once. */
            : h("button.btn.btn-primary", {
                type: "button",
                onclick: () => markMovieNow(key, true),
              }, [svg(ICON.check, "btn-icon"), "Mark watched"]),

          /* The other reason to open a movie you do not hold: you want to see it later. That was
             only expressible by marking it watched, which is a lie about the past.

             A movie in the library with no mark against it is already exactly what "watch later"
             means — the Library files it under Planned — so this writes no new state and needs
             no new status. It is the same record, minus the mark. */
          !held
            ? h("button.btn.btn-ghost", {
                type: "button",
                onclick: () => trackMovie(key),
              }, [svg(ICON.plus, "btn-icon"), "Watch later"])
            : !watched
              /* Held and unmarked, which is to say already on the watchlist. Said rather than
                 offered again, so the button does not sit there doing nothing when pressed. */
              ? h("span.t-dim", { style: { fontSize: "13.5px" }, text: "On your watchlist." })
              : null,
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

      /* Filled after mount, and only where a TMDB key exists. Cinemeta lists a cast as names
         with no ids behind them — there is nobody to open — so a movie from there keeps the
         plain line below and gains no shelf. */
      castBox,
      likeBox,

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

  watchTitle(bar, root.querySelector(".show-name"));
  castBox.replaceChildren(castSection(m, go, movieCredits));
  fillSimilar(likeBox, m, go);
}

async function fillSimilar(box, m, go) {
  const like = await similarMovies(m).catch(() => []);
  if (!like.length || !box.isConnected) return;
  box.replaceChildren(
    h("div.sect", [h("h2.t-label", { text: "If you liked this" })]),
    shelfScroller(h("div.shelf", like.map((f) => h("button.shelf-card", {
      type: "button",
      onclick: () => go("movie", f.key),
      "aria-label": `${f.name}${f.year ? `, ${f.year}` : ""}`,
    }, [
      h("div.shelf-art", [f.poster ? poster("shelf-poster", f.poster) : posterFallback(f.name, "md")]),
      h("div.shelf-name.t-title", { text: f.name }),
      h("div.shelf-cap", { text: f.year ? String(f.year) : "" }),
    ]))), `like:${m.key}`),
  );
}

/* Either it is on its way or it is not coming. The two look the same for a moment, which is
   why the skeleton is what is drawn first and the honest sentence replaces it — a page that
   says "couldn't find this" while the answer is still in flight is worse than a blank one. */
const failed = new Set();

function unplaceable(go) {
  return empty(
    "Couldn't find that movie",
    "The catalogue that link names can't be reached from this device. Searching for it by name may still find it.",
    "Search", () => go("search"),
  );
}

// The record arrives in a moment; hold the shape it will take.
const waiting = () => h("div", [
  h("div.skeleton", { style: { height: "30px", width: "48%", borderRadius: "6px" } }),
  h("div.skeleton", { style: { height: "13px", width: "62%", marginTop: "14px", borderRadius: "6px" } }),
  h("div.skeleton", { style: { height: "13px", width: "88%", marginTop: "8px", borderRadius: "6px" } }),
]);

