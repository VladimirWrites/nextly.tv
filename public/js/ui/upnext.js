// Up next — the screen the app exists for: what do I watch tonight?
//
// The answer is one show, one episode, one button. Everything else waiting is a compact row
// below it. The ranking is your own activity: whatever you're currently working through
// sits at the top, and a weekly show climbs back each time you watch it.
import { h, svg, ICON, mount, posterFallback } from "./dom.js";
import { state } from "../domain/store.js";
import { upNextList } from "../domain/progress.js";
import { epCode, passLabel } from "../domain/constants.js";
import { fmtDate, fmtDay, relTime, whenPhrase } from "../domain/dates.js";
import { episodeBlurb } from "../domain/labels.js";
import { upcomingList, groupByDate, isPremiere } from "../domain/schedule.js";
import * as cache from "../io/cache.js";
import * as view from "./viewstate.js";
import { miniBarcode } from "./barcode.js";
import { watchNext, opts } from "./actions.js";

export function renderUpNext(root, { go }) {
  const rows = upNextList(state.shows, cache.getMeta, opts());
  const soon = upcomingList(state.shows, cache.getMeta, opts());

  if (!state.shows.length) {
    return mount(root, empty(
      "Your library is empty",
      "Search for the first show you want to keep track of. Everything you mark stays encrypted on your side.",
      "Find a show", () => go("search"),
    ));
  }

  // Nothing to watch and nothing scheduled is the only true dead end.
  if (!rows.length && !soon.rows.length) {
    return mount(root, empty(
      "You're all caught up",
      "Nothing you're tracking has an unwatched episode that's aired, and nothing has a date yet.",
      "Open library", () => go("library"),
    ));
  }

  const [first, ...rest] = rows;
  const queue = rest.length
    ? h(`div.queue${view.isOn(QUEUE_OPEN) ? "" : ".is-clamped"}`, rest.map((r) => queueRow(r, go)))
    : null;
  mount(root, h("div.stack", [
    rows.length ? h("div.sect", [h("h2.t-label", { text: "Watch next" })]) : null,
    rows.length ? heroCard(first, go) : caughtUpNote(soon),
    rest.length ? h("div.sect.vt", { style: { "--vt": "waiting-head" } },
      [h("h2.t-label", { text: "Also waiting" }), h("span.sect-count", { text: `${rest.length}` })]) : null,
    queue,
    // Drawn whenever the shorter of the two limits could be biting. Which rows are actually
    // held back, and whether this is needed at all, is the stylesheet's business.
    rest.length > CLAMP ? queueMore(queue, rest.length) : null,
    comingUp(soon, go),
  ]));
}

/* How much of the queue stands between the hero and what is coming.
 *
 * Two rows on a phone, five where the rail has moved to the side; the numbers are in the
 * stylesheet, beside the breakpoint they belong to. This is the smaller of them, and all this
 * file needs to know — below it nothing can be hidden, so there is nothing to offer.
 *
 * It measured the space under the hero once, and re-measured on resize. On a phone that is an
 * event which fires whenever the address bar slides away, so rows appeared while scrolling.
 * Nothing here reads a height any more.
 *
 * Every row is still in the document. The section head goes on saying seven while two are
 * shown, and nothing is hidden from the reader except the rows themselves. */
const CLAMP = 2;

/* Open for this visit only, like every other thing a screen has unfolded. Persisting it would
   turn one tap into a permanent setting nobody asked to change, which is the opposite of what
   an expander is for. */
const QUEUE_OPEN = "queue:open";

function queueMore(queue, total) {
  const label = () => (view.isOn(QUEUE_OPEN) ? "Show fewer" : `Show all (${total})`);
  const btn = h("button.btn.btn-sm.queue-more", {
    type: "button",
    text: label(),
    onclick: () => {
      queue.classList.toggle("is-clamped", !view.toggle(QUEUE_OPEN));
      btn.textContent = label();
    },
  });
  return btn;
}

// Caught up, but with something on the way. Says so briefly rather than taking over the
// screen with an empty state — the schedule underneath is the actual answer.
function caughtUpNote(soon) {
  const next = soon.rows[0];
  return h("div.panel.vt", { style: { "--vt": "caught-up" } }, [
    h("div.t-title", { text: "You're all caught up" }),
    h("p.t-dim", { style: { marginTop: "6px", fontSize: "14px" },
      text: `${next.show.name} is next, ${whenPhrase(next.inDays)}.` }),
  ]);
}

/* ---- coming up ----
   Every unaired episode of everything you track, by date. No extra network call: catalogues
   ship announced episodes with their air dates in the same payload as the rest, so this
   works from cache and works offline. */
function comingUp(soon, go) {
  if (!soon.rows.length) return null;
  const days = groupByDate(soon.rows);

  return h("div.vt", { style: { "--vt": "coming-up" } }, [
    h("div.sect", [
      h("h2.t-label", { text: "Coming up" }),
      h("span.sect-count", { text: `${soon.rows.length} episode${soon.rows.length === 1 ? "" : "s"}` }),
    ]),
    h("div.sched", days.map((day) => h("div.sched-day", [
      h("div.sched-head", [
        h("span.sched-date.t-mono", { text: day.inDays === 1 ? "Tomorrow" : fmtDay(day.date) }),
        h("span.sched-when", { text: whenPhrase(day.inDays) }),
      ]),
      h("div.queue", day.rows.map((row) => schedRow(row, go))),
    ]))),
    // Never truncate silently: if the horizon hid something, say how much.
    soon.beyond
      ? h("p.t-dim", { style: { marginTop: "12px", fontSize: "12.5px" },
          text: `${soon.beyond} more episode${soon.beyond === 1 ? "" : "s"} scheduled further out.` })
      : null,
  ]);
}

function schedRow(row, go) {
  const { show, meta, ep } = row;
  return h("div.qrow", [
    posterImg(meta, "qrow-poster", () => go("show", show.id)),
    h("button.qrow-text", { type: "button", onclick: () => go("show", show.id) }, [
      h("div.qrow-name.t-title", { text: show.name }),
      h("div.qrow-sub", [
        h("span.t-mono", { text: epCode(ep.s, ep.e) }),
        ep.name ? " · " + ep.name : "",
      ]),
    ]),
    isPremiere(row) ? h("span.premiere-tag", { text: "Premiere" }) : null,
  ]);
}

// "in 45 days" reads better than a bare number, and "tomorrow" better than "in 1 day".
function heroCard(row, go) {
  const { show, meta, ep, progress } = row;
  // TVmaze publishes no backdrops, so the poster stands in — blurred and scaled up, which
  // gives the card its atmosphere without pretending to be artwork it isn't.
  const art = meta.backdrop || meta.poster;
  const isPoster = !meta.backdrop;
  const blurb = episodeBlurb(meta, ep);

  const facts = [
    progress.remaining > 1 ? `${progress.remaining} waiting` : null,
    ep.air ? `aired ${fmtDate(ep.air)}` : null,
    row.last ? `last watched ${relTime(row.last)}` : null,
  ].filter(Boolean);

  return h("section.hero.vt", { style: { "--vt": "up-hero" } }, [
    art ? h("div.hero-bg", { class: isPoster ? "is-poster" : null, style: { backgroundImage: `url("${art}")` } }) : null,
    h("div.hero-veil"),
    h("div.hero-body", [
      posterImg(meta, "hero-poster", () => go("show", show.id)),
      h("div.hero-text", [
        h("button.t-display.hero-show", {
          type: "button",
          text: show.name,
          onclick: () => go("show", show.id),
        }),
        progress.rewatching ? h("div", [h("span.pass-tag", { text: passLabel(progress.pass) })]) : null,
        h("div.hero-ep", [
          h("span.t-mono.hero-code", { text: epCode(ep.s, ep.e) }),
          ep.name ? "  " + ep.name : "",
        ]),
        blurb ? h("p.hero-blurb", { text: blurb }) : null,
        facts.length ? h("div.hero-meta.sep-row", facts.map((f) => h("span.sep-item", { text: f }))) : null,
        h("div.hero-actions", [
          h("button.btn.btn-primary", {
            type: "button",
            onclick: () => watchNext(show.id),
          }, [svg(ICON.check), "Mark watched"]),
          h("button.btn", { type: "button", text: "All episodes", onclick: () => go("show", show.id) }),
        ]),
      ]),
    ]),
    // The barcode closes the card: the whole show's history under the one episode it's
    // offering, so the answer arrives with its context instead of on its own.
    h("div.hero-strip", [
      miniBarcode(show, meta, ep.key, opts()),
      h("span.hero-strip-n.t-mono", { text: `${progress.watched}/${progress.aired}` }),
    ]),
  ]);
}

function queueRow(row, go) {
  const { show, meta, ep, progress } = row;
  return h("div.qrow.vt", { style: { "--vt": vt(show.id) } }, [
    posterImg(meta, "qrow-poster", () => go("show", show.id)),
    h("button.qrow-text", { type: "button", onclick: () => go("show", show.id) }, [
      h("div.qrow-name.t-title", { text: show.name }),
      h("div.qrow-sub", [
        h("span.t-mono", { text: epCode(ep.s, ep.e) }),
        ep.name ? " · " + ep.name : "",
        progress.remaining > 1 ? ` · ${progress.remaining} waiting` : "",
      ]),
    ]),
    h("button.btn.btn-sm.qrow-mark", {
      type: "button",
      "aria-label": `Mark ${show.name} ${epCode(ep.s, ep.e)} watched`,
      onclick: () => watchNext(show.id),
    }, [svg(ICON.check)]),
  ]);
}

/* A view-transition-name has to be a CSS identifier and a show id is "tvmaze:169", so the
   punctuation is folded to hyphens.

   Rows are named per show and the hero is not, which is deliberate. Sharing one namespace
   made a promoted show keep its name across the repaint, so the browser flew the card itself
   from the row up to the top — a 60px strip growing into most of the screen while crossing
   it, drawn over everything on the way. The slot is the stable thing here, not the show: the
   top card is always "the top card", so it swaps in place, and the row it came from fades out
   where it stood. */
const vt = (id) => "card-" + String(id).replace(/[^a-zA-Z0-9]+/g, "-");

// Shared poster element: catalogue art when there is any, the show's name when there isn't,
// so a missing image never leaves a hole in the layout.
function posterImg(meta, cls, onclick) {
  const src = meta.posterSm || meta.poster;
  if (src) {
    return h("img", {
      class: cls,
      src,
      alt: "",
      loading: "lazy",
      decoding: "async",
      onclick,
      style: onclick ? { cursor: "pointer" } : null,
    });
  }
  return h("div", { class: cls, onclick, style: onclick ? { cursor: "pointer" } : null },
    [posterFallback(meta.name, cls === "hero-poster" ? "lg" : "sm")]);
}

// Empty states are the one place with room to explain what the app is for, so they say what
// to do next and give you the button to do it.
export function empty(title, body, cta, onCta) {
  return h("div.empty", [
    h("div.empty-title.t-title", { text: title }),
    h("p", { text: body }),
    cta ? h("button.btn.btn-primary", { type: "button", text: cta, onclick: onCta, style: { marginTop: "18px" } }) : null,
  ]);
}
