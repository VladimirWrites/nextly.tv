// What someone shared, turned into something the app can look up.
//
// Android hands a share to the app as a title, some text and a URL, and which of the three
// actually holds the link depends entirely on where it was shared from — a browser puts it in
// url, most apps put it in text, and some put the whole lot in one string. So all three are
// searched rather than trusted in order.
//
// Pure. Everything here is string work, and the catalogue lookups happen above it.

/* An id worth resolving, in the order of how much it settles.
   A catalogue id names one show in one numbering, so it is the strongest thing a link can
   carry. An IMDb id names the show but not the numbering, which is exactly what the vault
   stores for this reason. A title is a guess and goes to the search box instead. */
export function parseShared({ title = "", text = "", url = "" } = {}) {
  const all = [url, text, title].filter(Boolean).join(" ");
  if (!all.trim()) return null;

  const tvmaze = /tvmaze\.com\/shows\/(\d+)/i.exec(all);
  if (tvmaze) return { src: "tvmaze", ref: tvmaze[1] };

  const tmdb = /themoviedb\.org\/tv\/(\d+)/i.exec(all);
  if (tmdb) return { src: "tmdb", ref: tmdb[1] };

  // IMDb ids are stable and appear in links from all over, not only imdb.com.
  const imdb = /\b(tt\d{7,10})\b/i.exec(all);
  if (imdb) return { imdb: imdb[1].toLowerCase() };

  const tvdb = /thetvdb\.com\/.*[?&]id=(\d+)/i.exec(all);
  if (tvdb) return { tvdb: tvdb[1] };

  const query = titleFrom({ title, text, url });
  return query ? { query } : null;
}

/* Nothing but words: whatever looks most like a name. A shared title is the best of the three;
   failing that the text, with any URL stripped out of it, since "Watch Severance
   https://…" should search for the show and not for the link. */
function titleFrom({ title, text, url }) {
  const cleaned = String(text || "").replace(/https?:\/\/\S+/gi, " ").trim();
  const candidate = String(title || "").trim() || cleaned;
  if (!candidate) return "";

  // Page titles carry the site's name on the end. Cut at the usual separators and keep the
  // first part, which is the one naming the show.
  const head = candidate.split(/\s+[|—·]\s+|\s+-\s+/)[0].trim();
  const name = (head || candidate).slice(0, 80).trim();
  // A bare URL that survived is not a title.
  return /^https?:\/\//i.test(name) || name === String(url || "").trim() ? "" : name;
}
