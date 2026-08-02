// The pieces both show pages are built from.
//
// A show you track and a show you have only found are the same page with different powers:
// the same bar, the same hero, the same scores, the same shelves of faces underneath. What
// differs is whether anything can be marked. Keeping the shared half here is what lets the
// two renderers read as the difference between them rather than as two copies with edits.
import { h, svg, ICON, posterFallback, shelfScroller, keepMedia, poster } from "./dom.js";
import { state } from "../domain/store.js";
import { findShow } from "../domain/schema.js";
import { passOf } from "../domain/progress.js";
import { passLabel, fmtScore, fmtVotes } from "../domain/constants.js";
import * as cache from "../io/cache.js";
import * as view from "./viewstate.js";
import * as discover from "../io/discover.js";
import * as meta from "../io/meta.js";

/* ---- which render is the one being waited for ----
   Only the paint that lands on a page that was showing placeholders fades in. Every later
   one — a mark, a status change — has to be instant, or the app would feel like it lags
   behind the tap that caused it. Shared, because the page that starts waiting is sometimes
   not the page that finishes: a preview becomes a tracked show the moment you press Track. */
let waitedOn = null;

export const expectArrival = (id) => { waitedOn = id; };

export function tookArrival(id) {
  const was = waitedOn === id;
  waitedOn = null;
  return was;
}

/* ---- the bar ----
   The show page had no persistent bar of any kind — the app's topbar is skipped for this
   route — so scrolling into a long episode list left nothing saying which show you were in
   or how to get out.
   The bar is always present for the back button; the name appears only once the big title
   has scrolled past, so the same words are never on screen twice. */
let detachBar = null;

export function stickyBar(show, back) {
  const title = h("div.show-bar-title.t-title", { text: show.name });
  // The bar itself spans the whole column so its backdrop reaches both edges; the row inside
  // is capped, so the arrow and the name line up with everything below them.
  return h("header.show-bar", [
    h("div.show-bar-inner", [
      /* Whatever is behind it, which is not something this screen can name: a show can be
         reached from the library, from search, from an actor's page, or from another show's
         cast. Only where there is nothing behind it does the label's old guess apply — a
         tracked show belongs to the library, an untracked one to the search that found it. */
      h("button.show-bar-back", {
        type: "button",
        "aria-label": "Back",
        onclick: () => back(findShow(state, show.id) ? "library" : "search"),
      }, [svg(ICON.back)]),
      title,
    ]),
  ]);
}

/* Called after mount, when the heading actually exists in the document.

   The bar's weight tracks the scroll rather than being switched on at a threshold: an
   observer can only say crossed or not crossed, which made the whole bar appear between one
   frame and the next. This reports how far through the crossing the page is, and the CSS
   reads it as a number. */
const FADE = 90;   // px of scroll the bar takes to arrive

// Leaving the route takes its scroll listener with it, rather than leaving one running on a
// detached element for the rest of the session.
export function stopBarWatch() {
  if (detachBar) detachBar();
  detachBar = null;
}

export function watchTitle(bar, heading) {
  stopBarWatch();
  if (!heading) return;

  let queued = false;
  const update = () => {
    queued = false;
    // How far the heading's underside has travelled past the bar's lower edge.
    const gap = heading.getBoundingClientRect().bottom - bar.getBoundingClientRect().height;
    const t = Math.min(1, Math.max(0, 1 - gap / FADE));
    bar.style.setProperty("--t", t.toFixed(3));
  };
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  update();
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  detachBar = () => {
    removeEventListener("scroll", onScroll);
    removeEventListener("resize", onScroll);
  };
}

/* ---- the hero ----
   `hint` is the search or discovery card this page was opened from — see cache.putHint. It
   supplies the poster, the year, the network and the summary, which is most of the hero, so
   the picture the user just tapped stays on screen instead of being fetched again. Whatever
   it can't answer keeps shimmering until the catalogue does.

   The hero deliberately never fades. Most of it came from the hint and is already correct, so
   animating it would blink the one part of the page the eye is actually on. The artwork nodes
   are kept across the render for the same reason. Only what was a placeholder changes, and it
   changes in one step. */
export function header(show, m, go, hint) {
  const waiting = !m;
  const art = (m && (m.backdrop || m.poster)) || (hint && hint.poster) || null;
  const posterSrc = (m && (m.posterSm || m.poster)) || (hint && hint.poster) || null;
  const overview = (m && m.overview) || (hint && hint.overview) || "";
  const facts = m
    ? [m.year, m.status, m.network, m.genres && m.genres.slice(0, 2).join(", ")].filter(Boolean)
    : [hint && hint.year, hint && hint.network].filter(Boolean);

  return h("section.show-hero", [
    // A poster standing in for a backdrop is blurred and scaled, the same as on Up next —
    // it gives the hero its atmosphere without pretending to be artwork it isn't.
    // Kept across the render: the same artwork should not be thrown away and decoded again
    // just because the text beside it arrived.
    art ? keepMedia(`bg:${show.id}`, "div", {
            bg: art, class: m && m.backdrop ? "show-bg" : "show-bg is-poster" }) : null,
    h("div.show-veil"),
    h("div.show-body", [
      /* The poster and whatever belongs with it. A summary runs longer than a poster is tall on
         every show worth reading about, so the space beside the artwork's lower half was going
         to waste — that is where the trailer sits. */
      h("div.show-art-col", [
        posterSrc
          ? keepMedia(`poster:${show.id}`, "img", { src: posterSrc, class: "show-poster" })
          // Still coming: hold the slot. Meta with no poster: there is none, so hold nothing.
          : waiting ? h("div.show-poster.skeleton.pending") : null,
        // Empty until the trailer is found, and gone if there is none.
        h("div.row-gap.show-links"),
      ]),
      h("div", { style: { minWidth: 0 } }, [
        h("h1.t-display.show-name", { text: show.name }),
        passOf(show) > 1 ? h("div", { style: { marginTop: "10px" } }, [h("span.pass-tag", { text: passLabel(passOf(show)) })]) : null,
        facts.length || waiting
          ? h("div.show-facts.sep-row", [
              ...facts.map((f) => h("span.sep-item", { text: f })),
              // Status and genres are only in the full record, so they are still on their way.
              ...(waiting ? [pendSkel("58px", "13px"), pendSkel("74px", "13px")] : []),
            ])
          : null,
        overview ? h("p.show-overview", { class: view.isOn(`desc:${show.id}`) ? "is-open" : null, text: overview }) : null,
        // Revealed after mount, and only where there is more text than three lines can hold.
        overview ? h("button.more-link.show-more", {
          type: "button",
          hidden: true,
          text: view.isOn(`desc:${show.id}`) ? "Less" : "More",
        }) : null,
        waiting && !overview
          ? h("div.show-overview.pending", { style: { display: "grid", gap: "7px" } }, [
              skel("100%", "13px"), skel("94%", "13px"), skel("61%", "13px"),
            ])
          : null,
      ]),
    ]),
  ]);
}

/* The summary is held to three lines and opened on request.

   Catalogues write anything from a sentence to a page, so the hero used to be as tall as
   whatever turned up — and the record landing was a jolt, because the shape that waited for it
   reserved three lines and the text took nine. Three lines always, and the rest a tap away.

   Which shows are open is remembered per visit, the same as an actor's biography: coming back
   to a page that quietly closed itself would lose the place you had scrolled to. */
export function expandable(root, id) {
  const text = root.querySelector(".show-overview");
  const more = root.querySelector(".show-more");
  if (!text || !more) return;

  const flag = `desc:${id}`;
  // An open summary is exactly as tall as its contents, so the overflow test says no — it is
  // shown anyway, or there would be no way to close it again.
  if (!view.isOn(flag) && text.scrollHeight <= text.clientHeight + 2) return;

  more.hidden = false;
  more.addEventListener("click", () => {
    const open = text.classList.toggle("is-open");
    view.setOn(flag, open);
    more.textContent = open ? "Less" : "More";
  });
}

// What the trailer lookup said, per show, so a repaint does not have to ask again.
const found = new Map();

/* A link out, never an embed.

   A YouTube iframe talks to Google the moment the page paints, whether or not anyone presses
   play, and the front page of this app promises that nothing here watches you. A link contacts
   nobody until it is tapped, and on a phone it opens the YouTube app, which is the better
   player on a small screen anyway.

   Filled after the fact: for a show numbered by the catalogue in use the trailer came with the
   record, and for one numbered elsewhere it takes a request, and the page must not wait on
   either. */
export function trailerLink(root, m, n = null) {
  const row = root.querySelector(".show-links");
  if (!row || !m) return;

  const chip = (t, fresh) => h("a.chip.is-play", {
    class: fresh ? "arrive-chip" : null,
    href: t.url,
    target: "_blank",
    rel: "noreferrer noopener",
    title: t.name,
  }, [svg(ICON.play, "chip-icon"), "Trailer"]);

  /* Answered once per show for as long as the page is open. Every repaint rebuilds this row
     and asks again, and the answer is a resolved promise by then — but a promise is a tick
     late whatever it holds, so the chip would blink out and back on every mark. Once the
     answer is known it goes straight in, and only the first one animates. */
  const id = `${m.id}:${n === null ? "show" : n}`;
  if (found.has(id)) {
    const t = found.get(id);
    if (t) row.append(chip(t, false));
    return;
  }

  const find = n === null ? meta.trailer(m) : meta.seasonTrailer(m, n);
  find.then((t) => {
    found.set(id, t || null);
    if (!t || !row.isConnected) return;
    row.append(chip(t, true));
  }).catch(() => {});
}


/* Where a score comes from matters as much as the number: an 8.4 from a few hundred people
   and an 8.4 from a hundred thousand are different claims. Each is labelled with its source
   and links back to it, and the list can hold more than one. */
export function ratings(m, fill) {
  const rows = (m && m.ratings) || [];
  if (!rows.length) return null;
  return h("div", { class: fill || null }, [
    h("div.sect", [h("h2.t-label", { text: rows.length > 1 ? "Scores" : "Score" })]),
    h("div.panel", [
      h("div.score-row", rows.map((r) => {
        const body = [
          h("div.score-n", { text: fmtScore(r.score) }),
          h("div.score-src", { text: r.source }),
          r.votes ? h("div.score-votes", { text: fmtVotes(r.votes) }) : null,
        ];
        return r.url
          ? h("a.score", { href: r.url, target: "_blank", rel: "noreferrer noopener",
              title: `${fmtScore(r.score)} out of ${r.max} on ${r.source}` }, body)
          : h("div.score", body);
      })),
    ]),
  ]);
}

// A card's score is the same score the page will show, from the same source, so it goes up
// with everything else rather than after it.
export function hintRatings(hint) {
  if (!hint || !hint.rating) return null;
  return ratings({ ratings: [{ source: hint.ratingSource || "", score: hint.rating, max: 10 }] });
}

/* ---- shelves ----
   Who is in it. Fetched from whichever catalogue answered for this show, held for the session
   only, and dropped from the page entirely when there is nothing to show — an empty shelf under
   a heading is worse than neither. */
export function castSection(m, go) {
  const strip = shelfScroller(h("div.shelf"), `cast:${m.key}`);
  const section = h("div", [h("div.sect", [h("h2.t-label", { text: "Cast" })]), strip]);

  meta.credits(m).then((cast) => {
    if (!cast.length) return section.remove();
    strip.replaceChildren(...cast.slice(0, 24).map((c) => h("button.shelf-card.is-face", {
      type: "button",
      onclick: () => go("person", c.key),
      // Counted across the whole run by aggregate_credits, which is how a lead is told from
      // someone who turned up for two episodes.
      title: c.episodes ? `${c.episodes} episode${c.episodes === 1 ? "" : "s"}` : null,
      "aria-label": c.character ? `${c.name} as ${c.character}` : c.name,
    }, [
      h("div.shelf-art", [
        c.image
          ? poster("shelf-poster", c.image)
          : posterFallback(c.name, "md"),
      ]),
      h("div.shelf-name.t-title", { text: c.name }),
      c.character ? h("div.shelf-cap", { text: c.character }) : null,
    ])));
  }).catch(() => section.remove());

  return section;
}

/* Shows like this one. TMDB only — TVmaze has no similar or recommendation endpoint — so the
   section is omitted rather than shown empty when there is no key. */
export function similarSection(show, go) {
  if (!discover.hasTmdb()) return null;
  const strip = shelfScroller(h("div.shelf"), `like:${show.id}`);
  const section = h("div", [h("div.sect", [h("h2.t-label", { text: "More like this" })]), strip]);

  discover.similarTo(show).then(({ cards }) => {
    if (!cards.length) return section.remove();
    strip.replaceChildren(...cards.slice(0, 20).map((c) => {
      cache.putHint(c);
      return h("button.shelf-card", { type: "button", onclick: () => go("show", c.key) }, [
        h("div.shelf-art", [
          c.poster ? poster("shelf-poster", c.poster)
                   : posterFallback(c.name, "md"),
        ]),
        h("div.shelf-name.t-title", { text: c.name }),
        c.year ? h("div.shelf-cap", { text: String(c.year) }) : null,
      ]);
    }));
  }).catch(() => section.remove());

  return section;
}

/* ---- small shared bits ---- */

// The way to everything a row hasn't room for: the air date, the score, the summary, the
// still. Quiet, and in the same place on every row.
export function infoButton(label, onclick) {
  return h("button.ep-info", { type: "button", title: label, "aria-label": label, onclick }, [svg(ICON.info)]);
}

export function stat(n, label, highlight = false) {
  return h("div", [
    h("div.stat-n", { class: highlight ? "is-next" : null, text: String(n) }),
    h("div.stat-l", { text: label }),
  ]);
}

/* ---- waiting for the catalogue ----
   The page below is the same page, with the parts the vault already knows filled in and a
   placeholder wherever a request is still out. Replacing the whole layout with two grey
   lines threw away a title, a back button and a watch count it had all along, and made
   arriving feel like a different screen that then jumped. */

export const skel = (width, height, radius = "6px") =>
  h("div.skeleton", { style: { width, height, borderRadius: radius } });

// The same block, but held back until waiting is long enough to be worth showing.
export const pendSkel = (width, height, radius = "6px") =>
  h("div.skeleton.pending", { style: { width, height, borderRadius: radius } });

// A number that hasn't arrived, occupying exactly what the number will.
export const statSkel = (label) => h("div", [
  h("div.stat-n", [skel("34px", "21px")]),
  h("div.stat-l", { text: label }),
]);

export const seasonSkeleton = () => h("div.season", [
  h("div.season-head", [
    skel("14px", "14px", "3px"),
    h("span.season-name", [skel("94px", "15px")]),
    h("div", { style: { marginLeft: "auto" } }, [skel("92px", "30px", "999px")]),
    skel("38px", "13px"),
  ]),
]);
