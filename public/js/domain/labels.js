// What a show's state says about itself.
//
// Three small rules that decide words and badges rather than elements: the pill on a library
// card, the line of counts under its barcode, and how much of an episode's synopsis fits.
// They were written where they were used, one apiece in two view files, which is a reasonable
// place for them right up until you want to be sure they are right — and "Finished" appearing
// on a show that is merely over is the kind of thing a reader notices and a rendered page
// makes tedious to check.
//
// Pure: state and metadata in, strings and plain objects out. Nothing here knows what an
// element is.
import { fmtDuration, runState } from "./constants.js";

/* The badge on a card, or none. Only shows that have stopped get one — a running show's
   status is the least interesting thing about it, and a pill on every card is a pill nobody
   reads.

   "Finished" is deliberately stronger than "Ended": the show is over *and* you have seen all
   of it. Nothing more is coming and nothing is waiting, which is a different fact from the
   channel having cancelled it, and the only one of the two that is about you. */
export function lifePill(meta, progress) {
  if (!meta) return null;
  const life = runState(meta.status);
  if (life !== "ended" && life !== "canceled") return null;
  if (progress.aired > 0 && progress.remaining === 0 && progress.watched >= progress.aired) {
    return { label: "Finished", tone: "is-done" };
  }
  return { label: life === "canceled" ? "Canceled" : "Ended", tone: null };
}

/* The line under the barcode: the counts, and then whichever single fact is most useful next.
   One fact, not all of them — a card is a glance, and three clauses on it is a paragraph.

   Time left wins where there is any, because it answers "can I finish this tonight". Failing
   that, when the show comes back. Failing that, how many times you have been through it,
   which is only interesting once it has happened at all. */
export function cardLine(meta, progress, back) {
  if (!meta) return "—";
  const counts = `${progress.watched}/${progress.aired}`;
  const left = fmtDuration(progress.minutesLeft);
  if (left) return `${counts} · ${left} left`;
  if (back) return `${counts} · back in ${back.inDays}d`;
  return counts + (progress.completed ? ` · ${progress.completed}× through` : "");
}

/* An episode's synopsis, cut to something a card can hold. Catalogues write these to no
   length at all — some are a sentence, some are four paragraphs of plot — so the one on the
   hero card is trimmed at a word boundary with an ellipsis that admits there is more.

   Cut on the character rather than the word count because the box is measured in characters:
   a limit in words lets one long sentence of long words overflow anyway. */
const BLURB_MAX = 240;

export function episodeBlurb(meta, ep) {
  const season = (meta.seasons || []).find((s) => s.n === ep.s);
  const found = season && (season.episodes || []).find((e) => e.e === ep.e);
  const text = (found && found.overview) || "";
  return text.length > BLURB_MAX ? text.slice(0, BLURB_MAX - 3).trimEnd() + "…" : text;
}
