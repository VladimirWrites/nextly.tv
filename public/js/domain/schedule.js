// What's coming — the other half of the question Up next answers.
//
// This needs no new network call. Catalogues ship announced-but-unaired episodes in the same
// payload as the rest, air dates included, so everything here is a query over metadata the
// cache already holds. That also means it works offline.
//
// Pure functions over vault records plus cached metadata, like the rest of domain/.
import { episodeList } from "./progress.js";
import { hasAired, airMs, daysUntil } from "./dates.js";

// How far ahead to look by default. Catalogues occasionally carry a placeholder date years
// out, and listing those as "coming up" is noise rather than news. Anything past the horizon
// is reported as a count instead of being silently dropped.
export const DEFAULT_HORIZON_DAYS = 120;

/* Which shows appear. Dropped shows are the only ones excluded: you said you're not watching
   them, so their schedule isn't news. A paused or planned show still is — knowing a show
   you've shelved comes back next week is exactly when you'd unpause it. */
const scheduled = (show) => show && show.st !== "dropped";

// Every unaired episode across the library, soonest first.
//
// Returns { rows, beyond } — `beyond` counts episodes scheduled past the horizon, so a
// truncated list can say so rather than pretending it's complete.
export function upcomingList(shows, metaOf, { specials = false, now = Date.now(), days = DEFAULT_HORIZON_DAYS } = {}) {
  const rows = [];
  let beyond = 0;

  for (const show of shows || []) {
    if (!scheduled(show)) continue;
    const meta = metaOf(show.id);
    if (!meta) continue;                       // metadata not fetched yet; appears once it is

    for (const ep of episodeList(meta, specials)) {
      if (hasAired(ep.air, now)) continue;
      const at = airMs(ep.air);
      if (at === null) continue;               // announced but unscheduled — nothing to put on a date
      const inDays = daysUntil(ep.air, now);
      if (inDays > days) { beyond++; continue; }
      rows.push({ show, meta, ep, air: ep.air, at, inDays });
    }
  }

  rows.sort((a, b) => a.at - b.at || a.show.name.localeCompare(b.show.name) || a.ep.s - b.ep.s || a.ep.e - b.ep.e);
  return { rows, beyond };
}

// Group the queue by calendar day, because that's how a schedule is read: everything landing
// on one date belongs under one heading.
export function groupByDate(rows) {
  const days = new Map();
  for (const row of rows) {
    if (!days.has(row.air)) days.set(row.air, { date: row.air, at: row.at, inDays: row.inDays, rows: [] });
    days.get(row.air).rows.push(row);
  }
  return [...days.values()].sort((a, b) => a.at - b.at);
}

// The next unaired episode of one show, for a "returns in 12 days" line. Distinct from
// progress.upcoming() only in that it also reports how far away it is.
export function returnsIn(show, meta, { specials = false, now = Date.now() } = {}) {
  for (const ep of episodeList(meta, specials)) {
    if (hasAired(ep.air, now)) continue;
    const at = airMs(ep.air);
    if (at === null) continue;
    return { ep, air: ep.air, at, inDays: daysUntil(ep.air, now) };
  }
  return null;
}

// A premiere is the first episode of a season — the arrival worth calling out, as opposed to
// the next instalment of a run already in progress.
export const isPremiere = (row) => row.ep.e === 1;
