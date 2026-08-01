// Turning a raw schedule into something worth looking at.
//
// TVmaze has no trending or popular endpoint, but every show carries a `weight` from 0 to
// 100 — its own popularity ranking — and the schedule endpoints say what is actually airing.
// Ranking what's on by weight gives a real discovery feed with no API key, which matters
// because the catalogue that needs no key is the one most people will use.
//
// Pure functions over schedule payloads. Fetching and caching live in io/discover.js.
import { showKey } from "./constants.js";
import { airMs } from "./dates.js";

// One card. Deliberately thin: a discovery row needs a name, art and a reason to care —
// not an episode list, which is fetched only if the show is actually tracked.
function card(show, episode) {
  return {
    key: showKey("tvmaze", show.id),
    src: "tvmaze",
    ref: show.id,
    name: show.name || "",
    year: /^(\d{4})/.test(show.premiered || "") ? +show.premiered.slice(0, 4) : null,
    poster: (show.image && show.image.medium) || null,
    weight: show.weight || 0,
    rating: (show.rating && show.rating.average) || null,
    genres: show.genres || [],
    network: (show.network && show.network.name) || (show.webChannel && show.webChannel.name) || null,
    season: episode ? episode.season : null,
    air: episode ? episode.airdate || null : null,
  };
}

// Collapse to one entry per show, keeping the earliest episode for each.
function byShow(episodes, pick) {
  const out = new Map();
  for (const ep of episodes || []) {
    // A third-party feed is not a contract: a malformed entry must skip, not take the
    // whole screen down with it.
    const show = ep && ep._embedded && ep._embedded.show;
    if (!show || !pick(ep)) continue;
    const existing = out.get(show.id);
    if (!existing || (airMs(ep.airdate) || 0) < (airMs(existing.air) || 0)) {
      out.set(show.id, card(show, ep));
    }
  }
  return [...out.values()];
}

/* Season premieres: a first episode of a season that hasn't started yet. The single most
   useful thing a tracker can surface — a show you might want to start, at the moment it
   becomes startable — and nothing else has to be inferred to find it. */
export function premieres(episodes, { tracked = new Set(), now = Date.now(), limit = 24 } = {}) {
  return byShow(episodes, (ep) => ep.number === 1 && (ep.season || 0) > 0)
    .filter((c) => !tracked.has(c.key))
    .filter((c) => (airMs(c.air) || 0) >= now - 86_400_000)   // today counts as still upcoming
    .sort((a, b) => b.weight - a.weight || (airMs(a.air) || 0) - (airMs(b.air) || 0))
    .slice(0, limit);
}

// Everything airing in the window, most popular first. "What is on" rather than "what is new".
export function airing(episodes, { tracked = new Set(), limit = 24 } = {}) {
  return byShow(episodes, () => true)
    .filter((c) => !tracked.has(c.key))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// The set of show keys already in a library, for excluding them from discovery. Seeing a
// show you already track offered as a discovery is worse than showing nothing.
export const trackedKeys = (shows) => new Set((shows || []).map((s) => s.id));
