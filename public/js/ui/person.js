// One person, and what else they are in.
//
// Nothing here is yours: no marks, no status, nothing that touches the vault. It is a view onto
// the catalogue, so it is read-only by construction and its only job is to get you to another
// show. Tapping one goes to that show's page, which already knows how to handle a show you
// track and one you don't.
import { h, svg, ICON, mount, posterFallback, shelfScroller, keepMedia, poster } from "./dom.js";
import * as meta from "../io/meta.js";
import { fmtDate } from "../domain/dates.js";
import { empty } from "./upnext.js";
import * as view from "./viewstate.js";

// Held so going back to a person just visited paints at once rather than fetching again.
const seen = new Map();



export function renderPerson(root, key, { go, back, top }) {
  if (top) {
    top.bar.classList.remove("has-actions", "is-searching");
    top.actions.replaceChildren();
    /* This screen is only ever arrived at from a show, so it is the one place in the app that
       needs a way out that isn't the nav: the show you were reading is not on the nav, and
       finding your way back to it through the library is absurd. */
    top.lead.replaceChildren(h("button.topbar-back", {
      type: "button",
      "aria-label": "Back",
      // Wrapped, not passed: back() takes where to go when there is nothing behind this
      // screen, and handing it a click event would send it there.
      onclick: () => back("library"),
    }, [svg(ICON.back)]));
  }

  const have = seen.get(key);
  if (have) return paint(root, have, go, top);

  mount(root, waiting());
  meta.person(key)
    .then((who) => {
      seen.set(key, who);
      paint(root, who, go, top);
    })
    .catch((e) => mount(root, empty("Couldn't load that person", e.message)));
}

function paint(root, who, go, top) {
  if (top) top.bar.querySelector(".topbar-title").textContent = who.name;

  /* Both catalogues carry a death date and neither was being read, so a page could say "Born
     1930" about someone who died in 1994 and leave it there. Given as a span when there is
     one, since that is how a life is written down. */
  const lived = who.born && who.died ? `${fmtDate(who.born)} – ${fmtDate(who.died)}`
    : who.born ? `Born ${fmtDate(who.born)}`
    : who.died ? `Died ${fmtDate(who.died)}` : null;

  const facts = [
    lived,
    who.from,
    who.shows.length ? `${who.shows.length} show${who.shows.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  /* Whatever the catalogue already said about them, since it came back with the rest of the
     record and asking for it separately would be a second request for something we have.
     TVmaze has no biography for anyone, so this is empty while it is the catalogue in use.

     Clamped, with a way to open it: these run to several hundred words and would otherwise
     push what the page is for — the shows — off the bottom of the screen. The button appears
     only if there is more text than fits, which is a question only the layout can answer. */
  /* Whether this visit had the biography open. Per visit, not per person: the same actor can
     be two places in one trail, and a page that comes back a different height loses the
     position you left it at. */
  const flag = `bio:${who.key}`;
  const wasOpen = view.isOn(flag);
  const bio = who.bio ? h("p.person-bio", { class: wasOpen ? "is-open" : null, text: who.bio }) : null;
  const more = bio
    ? h("button.more-link", {
        type: "button",
        hidden: true,
        onclick: () => {
          const open = bio.classList.toggle("is-open");
          view.setOn(flag, open);
          more.textContent = open ? "Less" : "More";
        },
        text: wasOpen ? "Less" : "More",
      })
    : null;

  mount(
    root,
    h("section.person", [
      who.image
        ? keepMedia(`face:${who.key}`, "img", { src: who.image, class: "person-face" })
        : h("div.person-face", [posterFallback(who.name, "md")]),
      h("div", { style: { minWidth: 0 } }, [
        h("h1.t-display.person-name", { text: who.name }),
        facts.length ? h("div.show-facts.sep-row", facts.map((f) => h("span.sep-item", { text: f }))) : null,
        who.url
          ? h("div.row-gap", { style: { marginTop: "12px" } }, [
              h("a.chip", { href: who.url, target: "_blank", rel: "noreferrer noopener", text: "Profile" }),
            ])
          : null,
      ]),
    ]),

    bio ? h("div.person-about", [bio, more]) : null,

    who.shows.length ? h("div.sect", [h("h2.t-label", { text: "Also in" })]) : null,
    who.shows.length ? shelfScroller(h("div.shelf", who.shows.map((s) => showCard(s, go))), `also:${who.key}`) : null,
  );

  /* After mount, because until it is in the document there is no height to compare. An open
     biography is exactly as tall as its contents, so the overflow test says no — it is shown
     anyway, or there would be no way to close it again. */
  if (bio && (wasOpen || bio.scrollHeight > bio.clientHeight + 2)) more.hidden = false;
}

function showCard(s, go) {
  return h("button.shelf-card", {
    type: "button",
    onclick: () => go("show", s.key),
    "aria-label": `${s.name}${s.year ? `, ${s.year}` : ""}`,
  }, [
    h("div.shelf-art", [
      s.poster
        ? poster("shelf-poster", s.poster)
        : posterFallback(s.name, "md"),
    ]),
    h("div.shelf-name.t-title", { text: s.name }),
    // The part, where the catalogue says — TVmaze doesn't on this endpoint, so it falls back to
    // the year rather than leaving a gap.
    h("div.shelf-cap", { text: s.character || (s.year ? String(s.year) : "") }),
  ]);
}

/* Same shape as the loaded page, so nothing moves when it arrives — including the space a
   biography will take, on the catalogues that have them. */
const waiting = () => h("div", [
  h("section.person", [
    h("div.person-face.skeleton"),
    h("div", { style: { minWidth: 0, flex: "1 1 0" } }, [
      h("div.skeleton", { style: { height: "30px", width: "58%", borderRadius: "6px" } }),
      h("div.skeleton", { style: { height: "13px", width: "40%", marginTop: "14px", borderRadius: "6px" } }),
    ]),
  ]),
  /* As tall as five clamped lines and the word under them, so the shows below don't jump when
     the text lands. Three bars looked tidier and cost 40px of movement. */
  meta.activeProvider().hasBios
    ? h("div.person-about", [
        h("div", { style: { height: "calc(5 * 1.55 * 14px)" } }, [1, 2, 3, 4, 5].map((n) =>
          h("div.skeleton", {
            style: { height: "13px", width: n === 5 ? "62%" : "100%", marginTop: n === 1 ? 0 : "8.7px", borderRadius: "6px" },
          }))),
        h("div.skeleton", { style: { height: "15px", width: "44px", marginTop: "6px", borderRadius: "6px" } }),
      ])
    : null,
  h("div.sect", [h("h2.t-label", { text: "Also in" })]),
  h("div.shelf", Array.from({ length: 5 }, () => h("div.shelf-card", [h("div.shelf-art.skeleton")]))),
]);
