// Show detail — the full record for one show you track.
//
// Order follows how you'd use it: what's next, then the whole history as a barcode you can
// click, then the season-by-season list for the times you need to find a specific episode.
//
// The page it shares most with is the one for a show you don't track — same bar, same hero,
// same scores and shelves — so those pieces live in show-parts.js and the untracked page in
// show-preview.js. The season list is the heaviest part of this screen and the only part with
// a size problem, so it has show-seasons.js to itself.
import { h, svg, ICON, mount } from "./dom.js";
import { confirmDialog, chooser, dateDialog } from "./overlay.js";
import { state } from "../domain/store.js";
import { findShow, findSameShow, rememberAlias } from "../domain/schema.js";
import { showProgress, nextUp, levelMap, passOf } from "../domain/progress.js";
import { returnsIn } from "../domain/schedule.js";
import { epCode, SHOW_STATUS, passLabel, ordinal, fmtDuration } from "../domain/constants.js";
import { fmtDate } from "../domain/dates.js";
import { dayKey } from "../domain/stats.js";
import * as cache from "../io/cache.js";
import { scheduleSync } from "../io/storage.js";
import {
  catchUpToLatest, untrackShow, changeStatus, ensureMeta,
  watchNext, beginRewatch, undoRewatch, retimeShow, opts,
} from "./actions.js";
import {
  stickyBar, watchTitle, header, expandable, trailerLink, ratings, hintRatings,
  castSection, similarSection, stat, statSkel, skel, seasonSkeleton,
  expectArrival, tookArrival,
} from "./show-parts.js";
import { season, historySection } from "./show-seasons.js";
import { renderPreview } from "./show-preview.js";
import * as view from "./viewstate.js";

/* The same series under another key, if the library holds it. The portable ids come from
   whichever of the record or the card we have — a search result carries them where its
   catalogue supplies them, and the full record always does, so a page opened before the
   record lands resolves itself on the repaint that follows. */
function sameSeries(id) {
  const from = cache.getMeta(id) || cache.getHint(id) || null;
  const held = findSameShow(state, { key: id, imdb: from && from.imdb, tvdb: from && from.tvdb });
  return held && held.id !== String(id) ? held : null;
}

export function renderShow(root, id, { go, back }) {
  const show = findShow(state, id);

  /* Held under the other catalogue's numbering? Then this is that page.

     Deciding whether a show is tracked used to be a key comparison here while tracking it
     resolved the portable ids — so the same series found in the other catalogue showed as
     untracked, and Track then answered "already in your library". One series is one row, so
     it is also one page: the one the marks are recorded against. */
  if (!show) {
    const held = sameSeries(id);
    if (held) {
      /* And written down, so the next time this key turns up nothing has to be fetched to
         recognise it — a link shared into the app carries no portable id of its own. */
      if (rememberAlias(held, id)) {
        held.m = Date.now();
        scheduleSync();
      }
      return go("show", held.id, { replace: true });
    }
    // Not in the library: show it anyway.
    return renderPreview(root, id, { go, back });
  }

  const meta = cache.getMeta(id);
  if (!meta) return renderWaiting(root, show, { go, back });

  // Only the render that lands on a page that was waiting fades in. Every later one — a
  // mark, a status change — must be instant, or the app would feel like it lags behind the
  // tap that caused it.
  const fill = tookArrival(id) ? "arrive" : null;

  // Cached before a key was added, or before two copies were folded together: fill in any
  // score the other catalogue can supply, behind the paint.
  ensureMeta(id, { scores: true });

  const o = opts();
  const progress = showProgress(show, meta, o);
  const next = nextUp(show, meta, o);
  const soon = returnsIn(show, meta, o);

  // Open the season you're in the first time this show is viewed — that's the one you came
  // for, and every other season is one tap away. Scoped per show, so opening a season here
  // doesn't stop the next show you visit from doing the same.
  if (next && !view.any(`season:${id}:`)) view.setOn(`season:${id}:${next.s}`);

  const bar = stickyBar(show, back);
  mount(
    root,
    bar,
    header(show, meta, go, null),
    h("div.show-rest", [

    h("div.panel", { class: fill, style: { marginTop: "18px" } }, [
      h("div.stat-row", [
        stat(progress.watched, progress.rewatching ? passLabel(progress.pass) : "Watched"),
        stat(progress.aired, "Aired"),
        stat(progress.remaining, "Waiting", progress.remaining > 0),
        // How long that is, which is the question after how many.
        fmtDuration(progress.minutesLeft) ? stat(fmtDuration(progress.minutesLeft), "Left") : null,
        progress.unaired ? stat(progress.unaired, "To come") : null,
        progress.completed > 1 ? stat(progress.completed + "×", "Times through") : null,
      ]),
      next
        ? h("div.panel-actions", [
            h("button.btn.btn-primary", { type: "button", onclick: () => watchNext(show.id) }, [svg(ICON.check), `Mark ${epCode(next.s, next.e)} watched`]),
            // "Catch up" only means something pointed at an episode you pick, which lives on
            // the rows below. Up here the useful bulk action is everything that has aired.
            progress.remaining > 1
              ? h("button.btn.btn-sm", {
                  type: "button",
                  text: `Mark all ${progress.remaining} aired`,
                  title: "Mark every episode that has aired as watched",
                  onclick: () => catchUpToLatest(show.id),
                })
              : null,
            rewatchControls(show, progress),
          ])
        : h("div.panel-actions", [
            h("span.t-dim", { text: caughtUpLine(progress, soon) }),
            // Caught up is exactly where "watch it again" belongs: there's nothing else to
            // offer, and it's the moment you'd decide.
            progress.started
              ? h("button.btn.btn-sm", { type: "button", text: `Watch a ${ordinal(progress.pass + 1)} time`, onclick: () => beginRewatch(show.id) })
              : null,
            rewatchControls(show, progress),
          ]),
    ]),

    ratings(meta, fill),

    ...historySection(show, meta, next, o, fill),

    h("div.sect", [h("h2.t-label", { text: "Episodes" }), h("span.sect-count", { text: `${meta.seasons.length} seasons` })]),
    h("div", { class: fill }, meta.seasons.map((se) => season(show, se, next, go))),

    h("div.sect", [h("h2.t-label", { text: "This show" })]),
    controls(show, go),
    castSection(meta, go),
    similarSection(show, go),
    ]),
  );
  watchTitle(bar, root.querySelector(".show-name"));
  expandable(root, show.id);
  trailerLink(root, meta);
}

/* Before the record lands. Status, ids and the untrack button all come from the vault, so
   they work now rather than waiting on a catalogue that might not answer. */
function renderWaiting(root, show, { go, back }) {
  ensureMeta(show.id, { scores: true });
  const hint = cache.getHint(show.id);
  expectArrival(show.id);
  const bar = stickyBar(show, back);
  mount(
    root,
    bar,
    header(show, null, go, hint),
    h("div.show-rest", [
      loadingBody(show, hint),
      h("div.sect", [h("h2.t-label", { text: "This show" })]),
      controls(show, go),
    ]),
  );
  watchTitle(bar, root.querySelector(".show-name"));
}

function loadingBody(show, hint) {
  // Everything below the hero is a placeholder, so the delay goes on the container.
  // Marks are the vault's own; how many episodes exist is the catalogue's. So the watched
  // count is real from the first frame and the two beside it are not.
  const pass = passOf(show);
  let watched = 0;
  levelMap(show).forEach((level) => { if (level >= pass) watched++; });

  return h("div.pending", [
    h("div.panel", { style: { marginTop: "18px" } }, [
      h("div.stat-row", [
        stat(watched, pass > 1 ? passLabel(pass) : "Watched"),
        statSkel("Aired"),
        statSkel("Waiting"),
      ]),
      h("div.panel-actions", [skel("210px", "40px", "999px")]),
    ]),

    hintRatings(hint),

    h("div.sect", [h("h2.t-label", { text: "History" })]),
    // Sized to the barcode plus its legend, so the real thing lands without shifting.
    h("div.panel", [skel("100%", "76px")]),

    h("div.sect", [h("h2.t-label", { text: "Episodes" })]),
    h("div", [0, 1, 2].map(seasonSkeleton)),
  ]);
}

// What to say when there's nothing to watch right now. A date on its own makes you do the
// arithmetic; the distance is the part you actually wanted.
function caughtUpLine(progress, soon) {
  if (soon) {
    const when = soon.inDays === 1 ? "tomorrow" : soon.inDays === 0 ? "today" : `in ${soon.inDays} days`;
    return `${epCode(soon.ep.s, soon.ep.e)} airs ${fmtDate(soon.air)} — ${when}.`;
  }
  return progress.done ? "You've been all the way through." : "You're caught up. Nothing scheduled yet.";
}

// Offered in two places, so it lives in one. Cancelling is only shown while a rewatch is
// actually in progress, and only until the first episode of it is marked — past that point
// there's real history in the pass and backing out of it would be the surprising thing.
function rewatchControls(show, progress) {
  if (!progress.rewatching) return null;
  return h("button.btn.btn-sm.btn-ghost", {
    type: "button",
    text: "Cancel rewatch",
    title: `Go back to your ${ordinal(progress.pass - 1)} watch`,
    onclick: () => undoRewatch(show.id),
  });
}

/* Ticking off a show you finished three years ago dates every episode of it to this afternoon.
   The mark is honest — that is when it was made — and the history it produces is not.

   This is where a show is told when it was really watched. Per show, because only the person
   who watched it knows: week by week as it aired, across a fortnight two summers ago, or one
   very long Sunday. */
async function askWatchDates(show) {
  const dated = (show.entries || []).filter((e) => e.w).length;
  const mode = await chooser({
    title: "Watch dates",
    value: null,
    options: [
      { value: "aired", label: "As they aired" },
      { value: "spread", label: "Spread over a period…" },
      { value: "single", label: "All on one day…" },
      ...(dated ? [{ value: "clear", label: `Forget dates (${dated})` }] : []),
    ],
  });
  if (!mode) return;

  if (mode === "aired" || mode === "clear") return retimeShow(show.id, { mode });

  const today = dayKey(new Date());
  const picked = await dateDialog(mode === "spread"
    ? { title: "Spread over a period", body: `Episodes of ${show.name} are laid out in order between these two days.`,
        from: "", to: today, confirm: "Set dates" }
    : { title: "All on one day", body: `Every watched episode of ${show.name} is dated to this day.`,
        from: today, to: null, confirm: "Set date" });
  if (picked) retimeShow(show.id, { mode, ...picked });
}

function controls(show, go) {
  const statusRow = h("div.row-gap", SHOW_STATUS.map((st) =>
    h("button.chip", {
      type: "button",
      class: show.st === st ? "is-on" : null,
      text: { active: "Watching", planned: "Planned", paused: "Paused", dropped: "Dropped" }[st],
      onclick: () => changeStatus(show.id, st),
    })
  ));

  const catalogue = show.src === "tmdb"
    ? { label: "TMDB", href: `https://www.themoviedb.org/tv/${show.ref}` }
    : { label: "TVmaze", href: `https://www.tvmaze.com/shows/${show.ref}` };
  const ids = [
    show.imdb ? h("a.chip", { href: `https://www.imdb.com/title/${show.imdb}/`, target: "_blank", rel: "noreferrer noopener", text: "IMDb" }) : null,
    h("a.chip", { href: catalogue.href, target: "_blank", rel: "noreferrer noopener", text: catalogue.label }),
  ].filter(Boolean);

  return h("div.set-group", [
    h("div.set-row", [
      h("div.set-text", [h("div.set-name", { text: "Status" }), h("div.set-hint", { text: "Only shows you're watching appear in Up next." })]),
      statusRow,
    ]),
    h("div.set-row", [
      h("div.set-text", [
        h("div.set-name", { text: "Identity" }),
        h("div.set-hint", { text: `Stored in your vault as ${show.name}${show.year ? " (" + show.year + ")" : ""}${show.imdb ? " · " + show.imdb : ""} — numbered by ${catalogue.label}, and re-resolvable from those ids if it ever goes away.` }),
      ]),
      h("div.row-gap", ids),
    ]),
    h("div.set-row", [
      h("div.set-text", [
        h("div.set-name", { text: "Watch dates" }),
        h("div.set-hint", { text: (show.entries || []).some((e) => e.w)
          ? "These marks carry dates you set rather than the day you ticked them. Change them again, or forget them, whenever you like."
          : "A mark is dated when you tick it. Ticking off a show you watched years ago therefore dates all of it to today — this says when you really watched it." }),
      ]),
      h("button.btn.btn-sm", { type: "button", text: "Set", onclick: () => askWatchDates(show) }),
    ]),
    h("div.set-row", [
      h("div.set-text", [h("div.set-name", { text: "Remove from library" }), h("div.set-hint", { text: "Deletes this show and every watch mark on it." })]),
      h("button.btn.btn-sm.btn-danger", {
        type: "button",
        text: "Remove",
        onclick: async () => {
          const marks = (show.entries || []).length;
          const ok = await confirmDialog({
            title: `Remove ${show.name}?`,
            body: marks
              ? `This deletes ${marks} watch mark${marks === 1 ? "" : "s"}. You can track the show again later, but the marks are gone.`
              : "You can track it again at any time.",
            confirm: "Remove",
            tone: "danger",
          });
          if (!ok) return;
          untrackShow(show.id);
          go("library");
        },
      }),
    ]),
  ]);
}
