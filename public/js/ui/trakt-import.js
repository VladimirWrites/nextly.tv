// Importing a Trakt export, in Settings.
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
import { readExport, HISTORY_FILE } from "../domain/trakt-export.js";
import { importFeed, previewFeed } from "../io/import-feed.js";

/* Matched rather than listed: a long history is split across watched-history-1.json and its
   numbered siblings, and how many there are is only known once the zip is open. */
const WANTED = (name) => name === "watched-shows.json" || HISTORY_FILE.test(name);

const fmtInt = (n) => Number(n || 0).toLocaleString();

export function traktSection(repaint) {
  const out = h("div.set-hint", { style: { marginTop: "10px" } });

  return h("div", [
    h("div.sect", [h("h2.t-label", { text: "Import from Trakt" })]),
    h("div.set-group", [
      h("div.set-row", { style: { alignItems: "flex-start" } }, [
        h("div.set-text", [
          h("div.set-name", { text: "Trakt export" }),
          h("div.set-hint", {
            text: "Ask Trakt for your data on their settings page, then open the zip here. "
              + "It is read in this browser and never uploaded.",
          }),
          out,
        ]),
        h("button.btn.btn-sm.btn-primary", { type: "button", text: "Open zip",
          onclick: () => pick(out, repaint) }),
      ]),
    ]),
  ]);
}

function pick(out, repaint) {
  const input = h("input", { type: "file", accept: ".zip,application/zip" });
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    out.replaceChildren(h("span", { text: "Reading…" }));
    try {
      const files = await readJSONZip(await file.arrayBuffer(), WANTED);
      const read = readExport(files);
      review(read, out, repaint);
    } catch (e) {
      out.replaceChildren(h("span", { text: e.message }));
    }
  });
  input.click();
}

/* What it holds and what importing it would do, before anything is done.
   "Added 1,412 marks" is not something anyone should learn afterwards. */
function review(read, out, repaint) {
  const p = previewFeed(read.feed);
  const lines = [
    h("div", { text: `${fmtInt(read.episodes)} episodes across ${fmtInt(read.feed.shows.length)} shows in that file.` }),
    h("div", {
      text: p.marks || p.updated
        ? `${fmtInt(p.marks)} new to ${fmtInt(p.shows)} shows you track`
          + (p.updated ? `, ${fmtInt(p.updated)} that would gain a watch date` : "")
          + (p.newShows ? `, and ${fmtInt(p.newShows)} shows you don't.` : ".")
        : p.newShows
          ? `Nothing new for the shows you track. ${fmtInt(p.newShows)} shows you don't.`
          : "Nothing in there that isn't already here.",
    }),
  ];

  /* A history that does not add up to what Trakt says it holds. Said plainly: an import that
     silently covers two thirds of a library is worse than one that admits it. */
  if (read.missing.length) {
    lines.push(h("div", { style: { marginTop: "6px" }, text:
      `${fmtInt(read.missing.length)} shows have fewer plays in the file than Trakt counted `
      + `(${read.missing.slice(0, 3).map((m) => m.name).filter(Boolean).join(", ")}`
      + `${read.missing.length > 3 ? ", …" : ""}). Trakt's export may not go all the way back.` }));
  }

  const buttons = h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" } }, [
    p.marks || p.updated
      ? h("button.btn.btn-sm.btn-primary", { type: "button", text: "Import into tracked shows",
          onclick: () => run(read.feed, false, out, repaint) })
      : null,
    p.newShows
      ? h("button.btn.btn-sm", { type: "button", text: `Also add ${fmtInt(p.newShows)} new shows`,
          onclick: () => run(read.feed, true, out, repaint) })
      : null,
  ]);

  out.replaceChildren(...lines, buttons);
}

async function run(feed, addMissing, out, repaint) {
  out.replaceChildren(h("span", { text: "Importing…" }));
  try {
    const r = await importFeed(feed, {
      addMissing,
      onProgress: ({ phase, done, total }) => {
        if (phase === "adding") out.replaceChildren(h("span", { text: `Adding shows… ${done}/${total}` }));
      },
    });
    toast(`${fmtInt(r.marks)} marks imported`);
    out.replaceChildren(h("span", {
      text: `${fmtInt(r.marks)} marks, ${fmtInt(r.added)} shows added`
        + (r.missed ? `, ${fmtInt(r.missed)} the catalogue couldn't place` : "")
        + (r.skipped ? `, ${fmtInt(r.skipped)} untracked shows left alone` : "") + ".",
    }));
    repaint();
  } catch (e) {
    out.replaceChildren(h("span", { text: e.message }));
  }
}
