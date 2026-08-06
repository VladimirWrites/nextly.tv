// Importing a Trakt export, from the Import row in Settings.
//
// Trakt charges for the API application you would otherwise connect, and does not charge for
// the download of your own data. So this reads the download: no account to link, no token to
// keep, no credentials to store, and nothing about it that this app's server could learn if it
// wanted to — the file never leaves the browser it was opened in.
//
// Two steps, because the second one costs something. Reading the file and matching it against
// the library is free and instant. Adding shows the library has never heard of is one
// catalogue lookup each, so it is offered as its own button with its own number rather than
// discovered halfway through a progress bar.
import { h, toast } from "./dom.js";
import { readJSONZip } from "../io/zip.js";
import { readExport, HISTORY_FILE, WATCHLIST_FILE, WATCHED_MOVIES_FILE } from "../domain/trakt-export.js";
import { importFeed, previewFeed } from "../io/import-feed.js";
import { hydrateLibrary } from "./actions.js";
import { state } from "../domain/store.js";

/* What is about to be added, named by kind. One of the two is often zero — an export with no
   films, or a library that already holds every series in it — and a count of nothing is not
   worth saying out loud. */
const newThings = (p) => [
  p.newShows ? `${fmtInt(p.newShows)} show${p.newShows === 1 ? "" : "s"}` : null,
  p.newMovies ? `${fmtInt(p.newMovies)} movie${p.newMovies === 1 ? "" : "s"}` : null,
].filter(Boolean).join(" and ");


/* Matched rather than listed: a long history is split across watched-history-1.json and its
   numbered siblings, and how many there are is only known once the zip is open. */
const WANTED = (name) =>
  name === "watched-shows.json" || HISTORY_FILE.test(name) || WATCHLIST_FILE.test(name)
  || WATCHED_MOVIES_FILE.test(name);

const fmtInt = (n) => Number(n || 0).toLocaleString();

/* Offered from the Import row in Settings rather than from a section of its own.

   It had one, headed "Import from Trakt", holding a row labelled "Trakt export" — which reads
   as a contradiction, and sat nowhere near the import and export this app already had. A Trakt
   zip is a file somebody imports. The place for it is the row that imports files. */
/* A Trakt zip, once something else has decided that is what the file is.

   Offered from the Import row rather than from a section of its own. It had one, headed
   "Import from Trakt", holding a row labelled "Trakt export" — which reads as a contradiction,
   and sat nowhere near the import and export this app already had. */
export async function importTraktZip(buffer, out, repaint) {
  const files = await readJSONZip(buffer, WANTED);
  review(readExport(files), out, repaint);
}

export function what(p, held = (state.shows || []).length) {
  if (p.marks || p.updated) {
    return `${fmtInt(p.marks)} new to ${fmtInt(p.shows)} shows you track`
      + (p.updated ? `, ${fmtInt(p.updated)} that would gain a watch date` : "")
      + (newThings(p) ? `, and ${newThings(p)} you don't.` : ".");
  }
  if (!p.newShows) return "Nothing in there that isn't already here.";
  return held
    ? `Nothing new for the shows you track, and ${newThings(p)} you don't.`
    : "None of them are in your library yet.";
}

/* What it holds and what importing it would do, before anything is done.
   "Added 1,412 marks" is not something anyone should learn afterwards. */
export function review(read, out, repaint) {
  const p = previewFeed(read.feed);
  /* Watchlisted shows are counted apart from watched ones, because they are a different claim:
     nothing has been seen of them, and what arrives is a place in the library rather than a
     history. Somebody who watchlists heavily should see that number before pressing anything. */
  const lines = [
    h("div", {
      text: // Shows, and only shows: the row count carries the films and the watchlist too.
      `${fmtInt(read.episodes)} episodes across ${fmtInt(read.feed.shows.length - read.planned - read.movies)} shows in that file`
        + (read.movies ? `, ${fmtInt(read.movies)} movies` : "")
        + (read.planned ? `, and ${fmtInt(read.planned)} on the watchlist` : "")
        + (read.ratings ? `. ${fmtInt(read.ratings)} ratings across ${fmtInt(read.ratedTitles)} titles` : "")
        + ".",
    }),
    h("div", { text: what(p) }),
  ];

  /* Movies come in whether or not they are switched on, so somebody with them off should be
     told where they went rather than left wondering why the count did not match. */
  if (read.movies && !(state.settings || {}).movies) {
    lines.push(h("div", { style: { marginTop: "6px" },
      text: "Movies are imported too. They stay hidden until you switch movies on in You." }));
  }

  /* A history that does not add up to what Trakt says it holds. Said plainly: an import that
     silently covers two thirds of a library is worse than one that admits it. */
  if (read.missing.length) {
    lines.push(h("div", { style: { marginTop: "6px" }, text:
      shortfallLine(read.missing) }));
  }

  /* One button, which imports.

     There were two, at two prices: one applied what could be matched for nothing, the other did
     that and looked the rest up at a request each. Splitting them was a cost argument, and the
     cost turned out not to be there — 113 shows resolve in nine seconds, so 500 is under a
     minute, once, behind a progress line.

     What the split did instead was put the emphasis on the wrong one. Somebody who already
     tracked a couple of shows saw "Import into tracked shows" in the accent colour and the real
     import greyed out beside it. Pressing the obvious one imported a hundred marks onto two
     shows and left five hundred behind, reported afterwards as "523 untracked shows left
     alone". Their library looked empty, and they said so. */
  const total = p.marks + p.updated + p.newShows;
  const buttons = h("div", { style: { marginTop: "8px" } }, [
    total
      ? h("button.btn.btn-sm.btn-primary", {
          type: "button",
          text: newThings(p) ? `Import ${newThings(p)} with their history` : "Import",
          onclick: () => run(read.feed, out, repaint),
        })
      : null,
  ]);

  out.replaceChildren(...lines, buttons);
}

async function run(feed, out, repaint) {
  out.replaceChildren(h("span", { text: "Importing…" }));
  try {
    const r = await importFeed(feed, {
      addMissing: true,
      onProgress: ({ phase, done, total }) => {
        if (phase === "adding") out.replaceChildren(h("span", { text: `Adding shows… ${done}/${total}` }));
      },
    });
    toast(`${fmtInt(r.marks)} marks imported`);
    out.replaceChildren(h("span", {
      text: `${fmtInt(r.marks)} marks, ${fmtInt(r.added)} shows added`
        + (r.rated ? `, ${fmtInt(r.rated)} ratings` : "")
        + (r.missed ? `, ${fmtInt(r.missed)} the catalogue couldn't place` : "")
        + ".",
    }));
    /* Said out loud, because it is the difference between "ratings do not work" and "those
       titles are not in your library". Both look identical from the outside, and the first is
       what gets reported. */
    if (r.lost) {
      out.append(h("p.t-dim", { style: { marginTop: "6px", fontSize: "12.5px" },
        text: `${fmtInt(r.lost)} ratings had no title to attach to — those films and shows `
          + "couldn't be placed by the catalogue in use. Switching catalogue in You and "
          + "importing again will pick them up." }));
    }
    repaint();
    /* And fill in whatever is still bare. Shows added here arrive with the record their lookup
       returned, but a show that was already tracked and never opened has none — importing
       marks against it is exactly the moment its episodes start mattering. Runs behind the
       paint, with its own progress bar, and repaints as each one lands. */
    hydrateLibrary();
  } catch (e) {
    out.replaceChildren(h("span", { text: e.message }));
  }
}
