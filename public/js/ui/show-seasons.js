// The season-by-season list on a show you track.
//
// This is the half of the show page where things can be marked, and almost all of its weight
// comes from one constraint: a season is not a fixed size. Most are a dozen episodes; some
// are several hundred, and Tagesschau's are counted in thousands. So neither the seasons nor
// the rows inside them are built until they are asked for, and both remember how far they
// were opened, because a page rebuilt from scratch on every visit would otherwise come back
// shorter than you left it and lose the place you had scrolled to.
import { h, svg, ICON } from "./dom.js";
import { seasonProgress, levelMap, passOf } from "../domain/progress.js";
import { epKey, epCode } from "../domain/constants.js";
import { isUpcoming } from "../domain/dates.js";
import { fullBarcode } from "./barcode.js";
import { toggleEpisode, catchUpTo, toggleSeason, opts } from "./actions.js";
import { infoButton } from "./show-parts.js";
import * as view from "./viewstate.js";
import { ratingChip } from "./rating.js";
import { seasonRatingKey } from "../domain/constants.js";

/* Left out entirely for a show too long to have a readable one — see fullBarcode. A heading
   over an empty panel is worse than no heading. */
export function historySection(show, meta, next, o, fill) {
  const strip = fullBarcode(show, meta, next && next.key, (ep) => {
    toggleEpisode(show.id, ep.key, (levelMap(show).get(ep.key) || 0) < passOf(show));
  }, o);
  if (!strip) return [];
  return [
    h("div.sect", [h("h2.t-label", { text: "History" })]),
    h("div.panel", { class: fill }, [strip]),
  ];
}

export function season(show, se, next, go) {
  const key = `season:${show.id}:${se.n}`;
  const open = view.isOn(key);
  const p = seasonProgress(show, se, opts());
  const levels = levelMap(show);
  const pass = passOf(show);
  const allWatched = p.watched >= p.aired && p.aired > 0;

  const head = h("button.season-head", {
    type: "button",
    "aria-expanded": open ? "true" : "false",
    onclick: (e) => {
      // Read the current state at click time. Capturing `open` from the render would go
      // stale the moment the season is toggled without a repaint, which is what made this
      // open but never close.
      const isOpen = view.isOn(key);
      view.setOn(key, !isOpen);
      const el = e.currentTarget.closest(".season");
      if (!isOpen) fillSeason(el);
      el.classList.toggle("is-open", !isOpen);
      el.querySelector(".season-head").setAttribute("aria-expanded", String(!isOpen));
    },
  }, [
    svg(ICON.caret, "season-caret"),
    h("span.season-name.t-title", { text: se.n === 0 ? "Specials" : `Season ${se.n}` }),
    infoButton(`Details for season ${se.n}`, (e) => { e.stopPropagation(); go("season", `${show.id}/${se.n}`); }),
    ratingChip(show, seasonRatingKey(se.n)),
    h("span.season-prog.t-mono", { text: `${p.watched}/${p.aired}` }),
  ]);

  const bulk = h("button.btn.btn-sm.btn-ghost", {
    type: "button",
    text: allWatched ? "Clear season" : "Mark season",
    onclick: (e) => { e.stopPropagation(); toggleSeason(show.id, se, !allWatched); },
  });

  const eps = (se.episodes || []).filter((ep) => opts().specials || !ep.special);

  /* The rows are built when the season is opened, not when the page is. Every season's
     episodes used to be constructed and then merely hidden with CSS, which is fine for a
     show with sixty episodes and ruinous for one with twenty thousand: Tagesschau is 21,349
     episodes across 75 seasons, and building all of them at once is around 150,000 elements
     before anything appears on screen. */
  const list = h("div.season-list");
  list.__fill = () => episodeRows(show, se, eps, next, levels, pass, list, go);
  if (open) list.__fill();

  const wrap = h("div.season", { class: open ? "is-open" : null, "data-season": key }, [head, list]);
  head.insertBefore(bulk, head.lastChild);
  bulk.style.marginLeft = "auto";
  return wrap;
}

// Called the first time a season is opened; afterwards the rows are already there.
function fillSeason(el) {
  const list = el.querySelector(".season-list");
  if (list && list.__fill) { list.__fill(); list.__fill = null; }
}

/* A page of episodes at a time. One season of a daily programme runs to several hundred, and
   the rows past the first screenful are not being read — they are being scrolled past on the
   way to a button that says how many more there are. */
const PAGE = 80;

function episodeRows(show, se, eps, next, levels, pass, list, go) {
  // An episode is "ahead" if it sits after the next unwatched one. Those are the only rows
  // where catching up fills in a gap rather than doing nothing.
  const isAhead = (s2, e2) => !!next && (s2 > next.s || (s2 === next.s && e2 > next.e));

  /* How many pages of this season are laid out. The page is rebuilt from scratch on every
     visit, so a season paged three deep came back showing eighty rows — which shortened the
     page and lost the place you were reading. */
  const key = `pages:${show.id}:${se.n}`;
  let at = 0;
  const more = h("button.season-more", { type: "button" });

  const addPage = () => {
    const slice = eps.slice(at, at + PAGE);
    at += slice.length;
    const rows = slice.map((ep) => episodeRow(show, se, ep, next, levels, pass, isAhead, go));
    list.insertBefore(h("div", rows), more);
    const left = eps.length - at;
    more.textContent = left ? `Show ${Math.min(left, PAGE)} more of ${left}` : "";
    more.style.display = left ? "" : "none";
  };

  more.addEventListener("click", (e) => {
    e.stopPropagation();
    view.setCount(key, view.count(key, 1) + 1);
    addPage();
  });
  list.append(more);
  // As many as were open last time, in one go.
  for (let i = 0, want = view.count(key, 1); i < want && at < eps.length; i++) addPage();
}

function episodeRow(show, se, ep, next, levels, pass, isAhead, go) {
  const k = epKey(se.n, ep.e);
  // Only an episode the catalogue puts in the future is out of reach. One it knows nothing
  // about is the viewer's call, not ours: a catalogue with no date for something you watched
  // years ago is a gap in its records, not a claim about your evening.
  const toCome = isUpcoming(ep.air);
  const level = levels.get(k) || 0;
  const watched = level >= pass;          // watched on the pass in progress
  const seenBefore = level >= 1 && !watched;
  const isNext = next && next.key === k;
  const main = h("button.ep", {
    type: "button",
    class: [watched ? "is-w" : "", seenBefore ? "is-seen" : "", isNext ? "is-next" : "", toCome ? "is-unaired" : ""].filter(Boolean).join(" ") || null,
    disabled: toCome && level === 0,
    onclick: () => toggleEpisode(show.id, k, !watched),
    "aria-pressed": watched ? "true" : "false",
    "aria-label": `${epCode(se.n, ep.e)} ${ep.name || ""}${level > 1 ? `, watched ${level} times` : level === 1 ? ", watched" : ", not watched"}`,
  }, [
    h("span.ep-box", [svg(ICON.check, "ep-check")]),
    h("span.ep-code", { text: epCode(se.n, ep.e) }),
    h("span.ep-name", { text: ep.name || "—", title: ep.name || null }),
    level > 1 ? h("span.ep-times", { text: level + "×" }) : null,
    // Reported here, given on the episode's own page. A row is a tap target for one thing.
    ratingChip(show, k),
  ]);

  // Offered only where it does something: a watchable, unwatched episode with unwatched
  // episodes behind it. One tap records "I'd actually got this far".
  const catchUp = !toCome && !watched && isAhead(se.n, ep.e)
    ? h("button.ep-catchup", {
        type: "button",
        title: `Mark this and everything before it as watched`,
        "aria-label": `Mark ${epCode(se.n, ep.e)} and everything before it as watched`,
        onclick: () => catchUpTo(show.id, k),
      }, [svg(ICON.catchup, "btn-icon")])
    : null;

  /* One trailing control's worth of room is held on every row, whether or not this row offers
     catching up. Sized to its contents, a row with the button had 46px less for the episode's
     name than the row under it. */
  return h("div.ep-row", [
    main,
    catchUp || h("span.ep-catchup.is-empty", { "aria-hidden": "true" }),
    infoButton(`Details for ${epCode(se.n, ep.e)}`, () => go("episode", `${show.id}/${se.n}/${ep.e}`)),
  ]);
}
