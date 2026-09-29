// Putting the thing somebody typed at the top of what came back.
//
// Two catalogues answer a search: television from whichever one is chosen, movies from TMDB or
// Cinemeta. They were simply laid end to end, television first, on the reasoning that a title
// which is both a series and a movie should offer the series first. That reasoning is right and
// this keeps it — but laid end to end it also meant every television answer outranked every
// movie answer, including the ones that were not answers at all.
//
// TVmaze replies to "Anora" with ten shows, none of them called Anora: Nora Sand, Ahora 360,
// Awkwafina Is Nora from Queens, all scoring around 0.3 out of its own 1. Cinemeta replies with
// Anora (2024) first. Concatenated, the exact match sat eleventh, under ten near-misses, and
// read as missing. It was reported as the search being broken, and from the outside it was.
//
// So the two lists are ranked together before being shown, on how well the title answers what
// was typed and nothing else. Within a tier the original order survives untouched, which is
// where series-before-movie still lives: when both match equally well, television is still
// first, because it was first in the list handed in.
import { fold } from "./constants.js";

/* Both sides stripped of a leading article, so "The Bear" answers "bear" the same way the
   library files it under B. */
const bare = (t) => fold(t).replace(/^(the|a|an)\s+/, "").trim();

/* Whether the query stands as its own word rather than as a fragment inside a longer one. The
   distinction is the whole point: "nora" is a word in "Nelly & Nora" and a fragment in "Senora",
   and only one of those is plausibly what somebody meant. */
const wordAt = (name, q, at) => {
  const before = at === 0 ? "" : name[at - 1];
  const after = name[at + q.length] || "";
  return !/[\p{L}\p{N}]/u.test(before || "") && !/[\p{L}\p{N}]/u.test(after);
};

/* Four tiers, coarse on purpose. A finer scale would be inventing precision neither catalogue
   gives us: TVmaze's own score is not comparable with Cinemeta's ordering, so the only thing
   both lists can be judged by is the title against what was typed. */
export function titleTier(name, query) {
  const n = bare(name);
  const q = bare(query);
  if (!n || !q) return 0;
  if (n === q) return 4;                        // the thing itself
  if (n.startsWith(q) && wordAt(n, q, 0)) return 3;   // opens with it
  const at = n.indexOf(q);
  if (at >= 0 && wordAt(n, q, at)) return 2;    // holds it, as a word
  if (at >= 0) return 1;                        // holds it, inside a word
  return 0;                                     // matched on something we cannot see
}

/* Stable: equal tiers come out in the order they went in, so everything the callers arranged
   deliberately — television before movies, and each catalogue's own sense of relevance within
   that — survives. This only ever lifts a better title match over a worse one. */
export function rankResults(list, query) {
  const rows = list || [];
  const q = String(query || "").trim();
  if (!q || rows.length < 2) return rows;
  return rows
    .map((row, i) => ({ row, i, tier: titleTier(row && row.name, q) }))
    .sort((a, b) => b.tier - a.tier || a.i - b.i)
    .map((x) => x.row);
}
