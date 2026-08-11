// One person, and what else they are in.
//
// Nothing here is yours: no marks, no status, nothing that touches the vault. It is a view onto
// the catalogue, so it is read-only by construction and its only job is to get you to another
// show. Tapping one goes to that show's page, which already knows how to handle a show you
// track and one you don't.
import { h, svg, ICON, mount, posterFallback, shelfScroller, keepMedia } from "./dom.js";
import { shareButton } from "./share-button.js";
import { anonBar, canGoBack } from "./anon.js";
import * as meta from "../io/meta.js";
import { fmtDate } from "../domain/dates.js";
import { empty } from "./upnext.js";
import * as view from "./viewstate.js";
import { shelfCard } from "./shelf.js";
import { imdbChip } from "./show-parts.js";

// Held so going back to a person just visited paints at once rather than fetching again.
const seen = new Map();



export function renderPerson(root, key, { go, back, top }) {
  if (top) {
    top.bar.classList.remove("is-searching");
    /* The name is not known yet — it arrives with the record — so the button is labelled from
       the cached one where there is one and left generic otherwise. It shares an address, and
       the address is known from the first frame. */
    top.bar.classList.add("has-actions");
    top.actions.replaceChildren(shareButton((seen.get(key) || {}).name || "this person", "person", key));
    /* This screen is only ever arrived at from a show, so it is the one place in the app that
       needs a way out that isn't the nav: the show you were reading is not on the nav, and
       finding your way back to it through the library is absurd. */
    top.lead.replaceChildren(...(canGoBack() ? [h("button.topbar-back", {
      type: "button",
      "aria-label": "Back",
      // Wrapped, not passed: back() takes where to go when there is nothing behind this
      // screen, and handing it a click event would send it there.
      onclick: () => back("library"),
    }, [svg(ICON.back)])] : []));
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
    who.shows.length ? creditLine(who.shows) : null,
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
        /* Out to the catalogue that described them, and to IMDb where the catalogue knows the
           id. Two ways out rather than one: the profile is where this page's facts came from,
           and IMDb is where most people are actually going next. */
        who.url || who.imdb
          ? h("div.row-gap", { style: { marginTop: "12px" } }, [
              who.url
                ? h("a.chip", { href: who.url, target: "_blank", rel: "noreferrer noopener", text: "Profile" })
                : null,
              imdbChip(who.imdb, "name"),
            ])
          : null,
      ]),
    ]),

    bio ? h("div.person-about", [bio, more]) : null,

    who.shows.length ? h("div.sect", [h("h2.t-label", { text: "Also in" }),
        h("span.sect-count", { text: creditLine(who.shows) })]) : null,
    who.shows.length ? shelfScroller(h("div.shelf", who.shows.map((s) => showCard(s, go, who.name))), `also:${who.key}`) : null,

    // Only ever drawn for somebody who arrived without a vault; returns null otherwise.
    anonBar(),
  );

  /* After mount, because until it is in the document there is no height to compare. An open
     biography is exactly as tall as its contents, so the overflow test says no — it is shown
     anyway, or there would be no way to close it again. */
  if (bio && (wasOpen || bio.scrollHeight > bio.clientHeight + 2)) more.hidden = false;
}

/* "12 shows · 30 movies" rather than a bare total, because the two are different careers and
   somebody looking an actor up usually came for one of them. */
function creditLine(list) {
  const movies = list.filter((x) => x.kind === "movie").length;
  const shows = list.length - movies;
  return [
    shows ? `${shows} show${shows === 1 ? "" : "s"}` : null,
    movies ? `${movies} movie${movies === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");
}

/* Compared with the punctuation and the accents off, because a credit and a name are typed by
   different people on different days: "Monica Bellucci" and "Monica Belluci", "Self" and "self". */
const fold = (x) => String(x || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const AS_SELF = /^(self|herself|himself|themselves|themself)\b/;

/* What to call the part, on the page belonging to the person who played it.
 *
 * A catalogue writes a self-appearance as the person's own name, which is true and is also the
 * one place that sentence is worth nothing: on Monica Bellucci's page, Twin Peaks captioned
 * "Monica Bellucci" tells a reader who already knew. She really does appear as herself, so the
 * fact is worth keeping and only the wording was wrong.
 *
 * "Themselves" rather than a guess at anybody's pronoun: the catalogue's gender field is often
 * unset and is not worth being wrong about for one word of caption. */
function roleOf(character, personName) {
  const part = String(character || "").trim();
  if (!part) return "";
  if (AS_SELF.test(fold(part)) || fold(part) === fold(personName)) return "As themselves";
  return part;
}

function showCard(s, go, personName) {
  // The part, where the catalogue says — TVmaze doesn't on this endpoint, so it falls back to
  // the year rather than leaving a gap. A career holds shows and movies, and shelfCard sends
  // each half to its own screen.
  const part = roleOf(s.character, personName);
  /* The part wins over the status here. This is the one row in the app whose caption is a role,
     and "Watching" standing in that slot reads as the name of the part. The tick still says the
     title is yours. */
  return shelfCard(s, {
    caption: part || (s.year ? String(s.year) : ""),
    preferCaption: !!part,
    go,
  });
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
