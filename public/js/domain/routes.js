// Which screen an address names, and what address a screen has.
//
// Real paths rather than a hash, so a screen is a link you can bookmark and the back button
// does what it looks like it does. With one exception, and it is the whole reason this file
// exists rather than being six lines inside the router.
//
// Four screens name something specific: which show, which person, which season, which
// episode. A path is sent to the server on every navigation that reaches the network — a
// refresh, a cold start, a restored tab, a link someone opened — so `/show/tmdb:67070` tells
// whoever runs the server which programme an address is watching. That is precisely the fact
// the rest of this app goes to some lengths not to hold, and it was sitting in the one place
// nobody thought to look.
//
// So the name goes in the fragment. A fragment is the only part of a URL a browser never
// transmits: not to the origin, not to a proxy, not to the CDN in front of it. The server
// sees `/show` and learns that somebody opened a show page, which is nothing.
//
// The four tab routes keep ordinary paths. They name no content, so they cost nothing.
//
// Pure, and here rather than in the router, because "what does this address mean" is a
// decision and decisions are testable. The router owns `location` and `history`.

// Route -> how many parts its argument has. Also the test for "does this route name a thing".
/* `feed` names which discovery list is being shown in full. It is in here rather than among the
   tabs for the same reason as the rest: a feed is a thing an address names, and naming it in
   the path would tell the server which one. That it is only ever a word like "trending" today
   is not a reason to build the other shape of address — the next one might be "shows like
   this", and that is a show. */
export const DETAIL = { show: 1, person: 1, season: 2, episode: 3, feed: 1 };

const TABS = ["library", "search", "you", "stats"];

export const HOME = { name: "next", arg: null };

export function parseRoute(pathname, hash = "") {
  const parts = String(pathname || "").split("/").filter(Boolean);
  if (!parts.length) return HOME;
  const head = parts[0];

  if (DETAIL[head]) {
    /* The fragment, and only the fragment. An earlier version put the subject in the path and
       read that as a fallback, which meant there was still a shape of address that named a
       show to the server. There is no longer one: a path that carries a subject is not a
       route this app answers to, and the Worker gives it a 404 like any other unknown. */
    const bits = String(hash).replace(/^#/, "").split("/").filter(Boolean).map(safeDecode);
    if (bits.length < DETAIL[head]) return HOME;
    return { name: head, arg: bits.slice(0, DETAIL[head]).join("/") };
  }

  if (TABS.includes(head)) return { name: head, arg: null };
  // Android's share target lands here. It is a destination the app passes through, never one
  // it sits on, so it keeps no place in history.
  if (head === "share") return { name: "share", arg: null };
  return HOME;
}

export function pathFor(name, arg) {
  if (DETAIL[name]) {
    /* Each part encoded on its own, so the slashes between them stay slashes. Colons are put
       back afterwards: they are legal in a fragment, and `tmdb:67070` is worth reading in an
       address bar where `tmdb%3A67070` is not. Both forms parse, so a link in either opens. */
    const frag = String(arg).split("/").map(encodeURIComponent).join("/").replace(/%3A/g, ":");
    return `/${name}#${frag}`;
  }
  return name === "next" ? "/" : `/${name}`;
}

/* A stray percent sign is not a reason to lose the page. decodeURIComponent throws on one —
   `%` alone, or a truncated escape — and an address bar is somewhere people type. */
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}
