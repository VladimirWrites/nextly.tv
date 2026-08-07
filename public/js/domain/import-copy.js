// What the import screen says about a file before anything is imported.
//
// Sentences, and nothing else: what a file holds, what importing it would do, and what it does
// not add up to. They live here rather than in the screen that prints them because the screen
// imports the DOM and cannot be loaded outside a browser — so every one of these was unreachable
// by a test, and one of them was a call to a function that had never been written. It threw the
// moment an export arrived whose counts did not match, which was the first thing anybody
// imported that had a shortfall in it.
//
// Plain functions over plain numbers. Nothing here reads the library or the document.

export const fmtInt = (n) => Number(n || 0).toLocaleString();

/* What is about to be added, named by kind. One of the two is often zero — an export with no
   films, or a library that already holds every series in it — and a count of nothing is not
   worth saying out loud. */
export const newThings = (p) => [
  p.newShows ? `${fmtInt(p.newShows)} show${p.newShows === 1 ? "" : "s"}` : null,
  p.newMovies ? `${fmtInt(p.newMovies)} movie${p.newMovies === 1 ? "" : "s"}` : null,
].filter(Boolean).join(" and ");

/* What importing would do to this library, which is a different question from what the file
   holds. `held` is how many titles are already tracked: with none, "nothing new for the shows
   you track" is a sentence about an empty library and reads as a fault. */
export function what(p, held = 0) {
  if (p.marks || p.updated) {
    return `${fmtInt(p.marks)} new to ${fmtInt(p.shows)} shows you track`
      + (p.updated ? `, ${fmtInt(p.updated)} that would gain a watch date` : "")
      + (newThings(p) ? `, and ${newThings(p)} you don't.` : ".");
  }
  if (!p.newShows && !p.newMovies) return "Nothing in there that isn't already here.";
  return held
    ? `Nothing new for the shows you track, and ${newThings(p)} you don't.`
    : "None of them are in your library yet.";
}

/* A history that does not add up to what the service says it holds.
 *
 * Said plainly, because an import that silently covers two thirds of a library is worse than
 * one that admits it. Named by kind, and never as "shows" when half of them are films — the
 * sentence this replaced said "shows" for both and was the reason the counts were split apart
 * in the first place.
 *
 * Three names, then an ellipsis: enough to recognise whether the gap is somewhere that matters,
 * short enough to be a sentence. */
export function shortfallLine(missing, source = "the service") {
  const rows = (missing || []).filter(Boolean);
  if (!rows.length) return "";

  const movies = rows.filter((m) => m.kind === "movie").length;
  const shows = rows.length - movies;
  const kinds = [
    shows ? `${fmtInt(shows)} show${shows === 1 ? "" : "s"}` : null,
    movies ? `${fmtInt(movies)} movie${movies === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" and ");

  const names = rows.slice(0, 3).map((m) => m.name).filter(Boolean).join(", ");
  return `${kinds} ${rows.length === 1 ? "has" : "have"} fewer plays in the file than ${source} counted`
    + (names ? ` (${names}${rows.length > 3 ? ", …" : ""})` : "")
    + `. ${source}'s export may not go all the way back.`;
}
