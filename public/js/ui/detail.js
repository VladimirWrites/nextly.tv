// A season, and one episode of it.
//
// Everything the catalogue knows about a season or an episode that the show page has no room
// for: the per-episode scores, what the season averaged, which episode people rated highest,
// the years it ran, the still. The show page tried carrying some of this inline and became
// unreadable — six columns fighting over a phone's width — so it is here instead, one tap
// behind an info button, where there is room to lay it out properly.
//
// Nothing is fetched for these pages. They read the record the show page already has, so they
// paint at once, and they write nothing except a watch mark you ask for.
import { h, svg, ICON, mount, keepMedia } from "./dom.js";
import { state } from "../domain/store.js";
import { findShow } from "../domain/schema.js";
import { shareButton } from "./share-button.js";
import { anonBar } from "./anon.js";
import { seasonProgress, levelMap, passOf } from "../domain/progress.js";
import { epKey, epCode, fmtScore, fmtDuration, airsLabel, portableKey} from "../domain/constants.js";
import { fmtDate, fmtDay, seasonYears, hasAired, isUpcoming } from "../domain/dates.js";
import { avgScore, bestScored, scoredCount } from "../domain/scores.js";
import { chartInto, chartCaption } from "./chart.js";
import * as cache from "../io/cache.js";
import { trailerLink } from "./show-parts.js";
import { sourceOf } from "../io/meta.js";
import { toggleEpisode, ensureMeta, opts } from "./actions.js";
import { empty } from "./upnext.js";

/* Both pages are addressed by the show's key and the numbers within it: "tvmaze:38052/3" and
   "tvmaze:38052/3/1". The key can hold a colon but never a slash, so splitting on slashes is
   unambiguous. */
function locate(arg) {
  const parts = String(arg || "").split("/");
  const id = parts[0];
  if (!id || parts.length < 2) return null;
  return { id, n: Number(parts[1]), e: parts.length > 2 ? Number(parts[2]) : null };
}

/* The record, or an honest account of why there isn't one. A season page is only ever reached
   from a show page that already had the record in hand, but a bookmarked or shared link
   arrives cold, so the fetch is asked for and the page waits. */
function record(root, arg, { top }) {
  const at = locate(arg);
  if (!at) {
    mount(root, empty("No such season", "That address doesn't name one."));
    return null;
  }

  const show = findShow(state, at.id);
  const meta = cache.getMeta(at.id);
  /* The vault first, then the card this was opened from, then the record itself — a page
     reached cold, for a show nobody tracks, has only the last of those, and printing nothing
     in the bar when the record names the show is just a gap. */
  const name = (show && show.name) || (cache.getHint(at.id) || {}).name || (meta && meta.name) || "";
  if (top) {
    top.bar.classList.remove("is-searching");
    top.bar.classList.add("has-actions");
    /* The series, not the episode. An episode number belongs to one catalogue's numbering, so
       a shared episode address means something different to a reader on the other one — and
       the series page is where they would go next anyway. */
    top.actions.replaceChildren(
      shareButton(name || "this show", "show", portableKey(at.id, show || meta || {})));
    top.bar.querySelector(".topbar-title").textContent = name;
  }

  /* Asked for on every visit, not only when the record is missing: a record written before
     episode scores existed is present, complete-looking and silent about them. ensureMeta is
     a no-op when there is nothing to fetch. */
  ensureMeta(at.id);
  if (!meta) {
    mount(root, waiting());
    return null;
  }

  const se = (meta.seasons || []).find((s) => s.n === at.n);
  if (!se) {
    mount(root, empty("No such season", `${name || "This show"} has no season ${at.n}.`));
    return null;
  }
  return { at, show, meta, se, name };
}

// The way out. The nav can't reach these pages, so the arrow is the only route back — through
// history, to the show or the season you came from.
function lead(top, back) {
  if (!top) return;
  top.lead.replaceChildren(h("button.topbar-back", {
    type: "button",
    "aria-label": "Back",
    onclick: () => back("library"),
  }, [svg(ICON.back)]));
}

/* ---------- a season ---------- */

export function renderSeason(root, arg, { go, back, top }) {
  lead(top, back);
  const found = record(root, arg, { top });
  if (!found) return;
  const { at, show, meta, se, name } = found;

  const eps = (se.episodes || []).filter((ep) => opts().specials || !ep.special);
  const p = show ? seasonProgress(show, se, opts()) : null;
  const avg = avgScore(eps);
  const best = bestScored(eps);
  const scored = scoredCount(eps);
  const from = sourceOf(meta);
  const heading = se.n === 0 ? "Specials" : `Season ${se.n}`;

  /* The shape of the season: one point per scored episode, joined. Two scored episodes is the
     least that makes a line, so a season nobody has rated yet gets no panel at all — the box
     is dropped after mounting, once the chart has said whether it had anything to draw. */
  const box = h("div.chart-box");
  const chart = avg
    ? h("div", [
        h("div.sect", [h("h2.t-label", { text: "How it went" }), h("span.sect-count", { text: chartCaption(eps, from) })]),
        h("div.panel", [box]),
      ])
    : null;

  const facts = [
    seasonYears(eps),
    `${eps.length} episode${eps.length === 1 ? "" : "s"}`,
    p ? `${p.watched} watched` : null,
    // Show-level, but this is where it belongs: a season is the thing that has a slot.
    airsLabel(meta.airs),
    meta.runtime ? `${fmtDuration(meta.runtime)} an episode` : null,
  ].filter(Boolean);

  mount(
    root,
    h("h1.t-display.detail-name", { text: heading }),
    h("div.show-facts.sep-row", { style: { marginTop: "10px" } },
      facts.map((f) => h("span.sep-item", { text: f }))),
    // This season's own, if it has one. Never the show's in its place: on the page for season
    // two, a returning show's current trailer advertises something that happens later.
    h("div.row-gap.show-links", { style: { marginTop: "12px" } }),

    // What the season scored, and where the number came from. An average over 4 of 10
    // episodes is a different claim from an average over all of them, so it says which.
    avg
      ? h("div", [
          h("div.sect", [h("h2.t-label", { text: "Score" })]),
          h("div.panel", [
            h("div.score-row", [
              h("div.score", [
                h("div.score-n", { text: fmtScore(avg) }),
                h("div.score-src", { text: `${from} average` }),
                h("div.score-votes", { text: `from ${scored} of ${eps.length}` }),
              ]),
              best && best.score !== avg
                ? h("button.score", {
                    type: "button",
                    title: `Open ${epCode(se.n, best.e)}`,
                    onclick: () => go("episode", `${at.id}/${se.n}/${best.e}`),
                  }, [
                    h("div.score-n", { text: fmtScore(best.score) }),
                    h("div.score-src", { text: "Best episode" }),
                    h("div.score-votes", { text: epCode(se.n, best.e) }),
                  ])
                : null,
            ]),
          ]),
        ])
      : null,

    // Filled after mount: a chart has to be measured against the column it lives in, and
    // until the box is in the page there is no column to measure.
    chart,

    h("div.sect", [
      h("h2.t-label", { text: "Episodes" }),
      p ? h("span.sect-count", { text: `${p.watched}/${p.aired}` }) : null,
    ]),
    h("div.detail-list", eps.map((ep) => episodeLine(at.id, se, ep, show, go, from))),

    // Only ever drawn for somebody who arrived without a vault; returns null otherwise.
    anonBar(),
  );

  if (chart && !chartInto(box, se, eps, { onPick: (pt) => go("episode", `${at.id}/${se.n}/${pt.e}`) })) {
    chart.remove();
  }
  trailerLink(root, meta, se.n);
}

/* One row on the season page. No checkbox: this page is for reading, and the marks belong to
   the show page and the episode's own. What it does carry is the score, which is the reason
   the page exists. */
function episodeLine(id, se, ep, show, go, from) {
  const level = show ? (levelMap(show).get(epKey(se.n, ep.e)) || 0) : 0;
  const watched = show ? level >= passOf(show) : false;
  /* Still to come. Held back rather than dimmed away: the row is the same row, but an episode
     with no score has not been judged rather than judged badly, and an empty column beside
     nine full ones reads as a missing number unless the row says why. */
  const soon = isUpcoming(ep.air);
  return h("button.ep.detail-line", {
    type: "button",
    class: [watched ? "is-w" : "", soon ? "is-unaired" : ""].filter(Boolean).join(" ") || null,
    onclick: () => go("episode", `${id}/${se.n}/${ep.e}`),
    "aria-label": `${epCode(se.n, ep.e)} ${ep.name || ""}${watched ? ", watched" : soon ? ", not out yet" : ""}`,
  }, [
    h("span.ep-code", { text: epCode(se.n, ep.e) }),
    h("span.ep-name", { text: ep.name || "—" }),
    /* A dash, not a blank: the column says "no score" rather than appearing to have lost one.
       The source is named once for the whole page rather than on every row, and each row
       repeats it only to a pointer. */
    h("span.ep-score.t-mono", {
      text: ep.score ? fmtScore(ep.score) : "–",
      title: ep.score ? `${fmtScore(ep.score)} on ${from}` : "Not scored yet",
    }),
    h("span.ep-air", { text: ep.air ? fmtDate(ep.air) : "TBA" }),
    svg(ICON.caret, "detail-caret"),
  ]);
}

/* ---------- one episode ---------- */

export function renderEpisode(root, arg, { go, back, top }) {
  lead(top, back);
  const found = record(root, arg, { top });
  if (!found) return;
  const { at, show, meta, se } = found;

  const ep = (se.episodes || []).find((e) => e.e === at.e);
  if (!ep) {
    mount(root, empty("No such episode", `Season ${at.n} has no episode ${at.e}.`));
    return;
  }

  const code = epCode(se.n, ep.e);
  const aired = hasAired(ep.air);
  const level = show ? (levelMap(show).get(epKey(se.n, ep.e)) || 0) : 0;
  const watched = show ? level >= passOf(show) : false;

  const facts = [
    ep.air ? (aired ? fmtDate(ep.air) : `Airs ${fmtDay(ep.air)}`) : "No date yet",
    ep.runtime ? fmtDuration(ep.runtime) : null,
    ep.special ? "Special" : null,
  ].filter(Boolean);

  mount(
    root,
    // The still, where the catalogue has one. Kept across repaints, so marking the episode
    // watched doesn't throw the picture away and decode it again.
    ep.still ? keepMedia(`still:${at.id}:${se.n}:${ep.e}`, "img", { src: ep.still, class: "detail-still" }) : null,

    h("div.t-label.detail-code", { text: code }),
    h("h1.t-display.detail-name", { text: ep.name || code }),
    h("div.show-facts.sep-row", { style: { marginTop: "10px" } }, [
      ...facts.map((f) => h("span.sep-item", { text: f })),
      // "8.4 on TVmaze", not a bare 8.4: whose eight-point-four matters.
      ep.score ? h("span.sep-item.detail-score", { text: `${fmtScore(ep.score)} on ${sourceOf(meta)}` }) : null,
    ]),

    ep.overview ? h("p.show-overview", { text: ep.overview }) : null,

    // Marking belongs here as much as on the list: this is the page you land on when you're
    // deciding whether you have seen it. Only for a show you track — there is nowhere to
    // record a mark against one you don't.
    show
      ? h("div.panel", { style: { marginTop: "18px" } }, [
          h("div.panel-actions", { style: { marginTop: "0" } }, [
            h("button.btn", {
              type: "button",
              class: watched ? "btn-ghost" : "btn-primary",
              onclick: () => toggleEpisode(show.id, epKey(se.n, ep.e), !watched),
            }, [svg(ICON.check, "btn-icon"), watched ? "Watched — undo" : "Mark watched"]),
            level > 1 ? h("span.t-dim", { style: { fontSize: "13.5px" }, text: `Watched ${level} times.` }) : null,
          ]),
        ])
      : null,

    h("div.sect", [h("h2.t-label", { text: "In this season" })]),
    h("div.detail-list", [
      h("button.ep.detail-line", {
        type: "button",
        onclick: () => go("season", `${at.id}/${se.n}`),
      }, [
        h("span.ep-name", { text: se.n === 0 ? "Specials" : `Season ${se.n}` }),
        h("span.ep-air", { text: seasonYears(se.episodes) || "" }),
        svg(ICON.caret, "detail-caret"),
      ]),
    ]),

    // Only ever drawn for somebody who arrived without a vault; returns null otherwise.
    anonBar(),
  );
}

// The record arrives from the catalogue in a moment; hold the shape it will take.
const waiting = () => h("div", [
  h("div.skeleton", { style: { height: "30px", width: "42%", borderRadius: "6px" } }),
  h("div.skeleton", { style: { height: "13px", width: "64%", marginTop: "14px", borderRadius: "6px" } }),
  h("div.sect", [h("h2.t-label", { text: "Episodes" })]),
  h("div.detail-list", Array.from({ length: 6 }, () => h("div", { style: { padding: "13px 15px" } }, [
    h("div.skeleton", { style: { height: "14px", width: "70%", borderRadius: "6px" } }),
  ]))),
]);
