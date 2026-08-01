// A year of television, in one page.
//
// Everything here is worked out on the device from marks the device already holds. No request
// is made to draw it, and nothing about it leaves — which is also the joke at the bottom of the
// page, and the reason the joke is true.
//
// The page is careful about one thing throughout: a mark records when the box was ticked, not
// when the episode was watched. Someone who marks a season on Sunday night looks like they
// watched thirteen episodes on Sunday night. The wording says "marked" wherever that
// distinction could mislead, and says so plainly once at the end.
import { h, mount, svg, ICON } from "./dom.js";
import { state } from "../domain/store.js";
import { watchStats, primeHour, SINCE, dayKey } from "../domain/stats.js";
import { fmtDuration } from "../domain/constants.js";
import { fmtDate } from "../domain/dates.js";
import * as cache from "../io/cache.js";
import { empty } from "./upnext.js";

const DAY = 86_400_000;
// Indexed the way Date does it, so a lookup by getDay() still works.
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// The order they are drawn in. A week starts on Monday and ends at the weekend, which is how
// a week is read here and how the weekend ends up as one block rather than split across the
// two ends of the picture.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const rowOf = (day) => (day + 6) % 7;

/* What the page is about. Every figure on it obeys this — the hours, the shows, the genres and
   the records as much as the strip of days, which is what "your year" ought to have meant all
   along and did not.

   Twelve rolling months by default: asked how much television they watched this year, in July,
   nobody means since January. */
const PERIODS = [
  { id: "year12", label: "12 months", weeks: 53, since: SINCE.year12 },
  { id: "calendar", label: "This year", weeks: 53, since: SINCE.calendar },
  { id: "all", label: "All time", weeks: 53, since: SINCE.all },
];

let period = "year12";

/* Time, said the way a person would say it. fmtDuration handles hours and minutes; past a day
   the interesting unit changes, and "9,240 minutes" is a number nobody can picture. */
function longSpan(minutes) {
  if (!minutes) return "no time at all";
  const days = minutes / 1440;
  if (days < 1) return fmtDuration(minutes);
  const whole = Math.floor(days);
  const hours = Math.round((days - whole) * 24);
  return `${whole} day${whole === 1 ? "" : "s"}${hours ? `, ${hours}h` : ""}`;
}

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

export function renderStats(root, { go, back, top }) {
  if (top) {
    top.bar.classList.remove("has-actions", "is-searching");
    top.actions.replaceChildren();
    top.bar.querySelector(".topbar-title").textContent = "Your year";
    top.lead.replaceChildren(h("button.topbar-back", {
      type: "button",
      "aria-label": "Back",
      onclick: () => back("you"),
    }, [svg(ICON.back)]));
  }

  const now = Date.now();
  const chosen = PERIODS.find((p) => p.id === period) || PERIODS[0];
  const s = watchStats(state.shows, cache.getMeta, now, chosen.since(now));

  const picker = h("div.seg.stat-period", PERIODS.map((p) => h("button.seg-btn", {
    type: "button",
    class: p.id === period ? "is-on" : null,
    text: p.label,
    onclick: () => { period = p.id; renderStats(root, { go, back, top }); },
  })));

  if (!s.episodes) {
    mount(root, picker, empty("Nothing counted in this stretch",
      period === "all"
        ? "Mark an episode watched and this page starts keeping score. It is all worked out on this device."
        : "Nothing here yet for the period you have picked — try a longer one."));
    return;
  }

  const prime = primeHour(s.hours);
  const peak = Math.max(...s.days.values());

  mount(
    root,
    picker,
    headline(s),
    heatmap(s, peak, chosen),
    punchCard(s, prime),
    topShows(s, go),
    genres(s),
    records(s),
    leaderboard(s),
    h("p.stat-note", { text:
      "Counted from when you ticked each episode, not when you watched it — marking a season "
      + "in one go looks like a very long night. Every figure is worked out on this device."
      + (s.guessed ? ` ${s.guessed} episode${s.guessed === 1 ? " has" : "s have"} no runtime in the `
        + "catalogue and count as no time at all." : "") }),
  );
}

/* The number the page is about, in the largest type the app has. Episodes second: hours are
   what people are curious about and faintly appalled by, and that is the honest draw of a page
   like this. */
function headline(s) {
  return h("section.stat-hero", [
    h("div.stat-hero-n.t-display", { text: longSpan(s.minutes) }),
    h("div.stat-hero-l", { text: "in front of the television" }),
    h("div.show-facts.sep-row", { style: { marginTop: "14px" } }, [
      h("span.sep-item", { text: `${s.episodes} episodes` }),
      h("span.sep-item", { text: `${s.shows} show${s.shows === 1 ? "" : "s"}` }),
      s.finished ? h("span.sep-item", { text: `${s.finished} finished` }) : null,
      s.rewatched ? h("span.sep-item", { text: `${s.rewatched} seen again` }) : null,
    ].filter(Boolean)),
  ]);
}

/* Half a year, a tick a day, in the barcode's own idiom — this app has drawn progress as small
   marks since the first screen, and a year of watching is the same picture with time along the
   bottom instead of episodes.

   Four weights rather than a gradient: the eye reads "some", "more", "a lot" and cannot read
   the difference between seven and eight. */
function heatmap(s, peak, chosen) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  /* The strip covers the window, up to a year of it — beyond that a day is a hair's breadth and
     the picture stops being one. "All time" therefore draws its last twelve months, and says so
     underneath rather than pretending to be everything. */
  const windowStart = new Date(Math.max(s.since || 0, today.getTime() - 52 * 7 * DAY));
  windowStart.setHours(0, 0, 0, 0);
  // Back to the Monday of that week, so every column is a whole week and the weekend sits at
  // the bottom of it.
  const start = new Date(windowStart);
  start.setDate(start.getDate() - rowOf(start.getDay()));

  const cols = [];
  const months = [];
  let seen = null;
  /* Room for the widest month name at this size, so two of them can never sit on each other.
     Starting below zero lets the first full month be named at the very left. */
  const LABEL_GAP = 30;
  let lastLabelAt = -LABEL_GAP;
  /* Walked a day at a time rather than counted in milliseconds. A day is not always 86,400,000
     of them: a strip that crosses a clock change drifts by an hour, and every cell after it
     lands on the day before — which is why one period disagreed with the others about which
     days of this week had happened.

     Up to and including the week today is in, and no further: a column made entirely of days
     that have not happened is seven blanks pretending to be a week. */
  const cursor = new Date(start);
  for (let w = 0; cursor <= today; w++) {
    const weekStart = new Date(cursor);
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const at = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
      // Outside the window at either end: before it begins, or after today. The column is kept
      // whole so the weeks stay square, but nothing is drawn in those days — under "This year"
      // the days either side belong to a different year and are not this page's to colour.
      if (at > today || at < windowStart) { cells.push(h("i.hm-cell.is-void")); continue; }
      const n = s.days.get(dayKey(at)) || 0;
      const level = !n ? 0 : n >= peak * 0.66 ? 3 : n >= peak * 0.33 ? 2 : 1;
      cells.push(h("i.hm-cell", {
        class: level ? `is-${level}` : null,
        title: `${fmtDate(dayKey(at))} — ${n || "nothing"}${n ? ` episode${n === 1 ? "" : "s"}` : ""}`,
      }));
    }
    /* A month's name over the week it starts in, positioned rather than laid out: a column is
       eleven pixels wide and "Feb" is not, so as boxes in a row they printed as "JanFeb".

       The strip starts mid-month, and that stub was being named at week zero — where the next
       month's name lands a fortnight later and prints on top of it. A month is named only where
       enough of it is on the strip to be worth naming. */
    const first = weekStart;
    const label = first.toLocaleString(undefined, { month: "short" });
    // Whether this month begins on the strip at all. The stub at the left-hand end does not,
    // and naming it put a label where the next month's would land a fortnight later.
    const startsHere = new Date(first.getFullYear(), first.getMonth(), 1) >= start;

    if (label !== seen && first <= today && startsHere) {
      if (w * 14 >= lastLabelAt + LABEL_GAP) {
        months.push(h("span.hm-month", { text: label, "data-week": w }));
        lastLabelAt = w * 14;
        seen = label;
      }
      // Too close to the last one: left unnamed for now rather than dropped, so a later week
      // of the same month can carry it. Marking it seen here lost August altogether.
    } else {
      seen = label;
    }
    cols.push(h("div.hm-week", cells));
  }

  /* Only the strip scrolls; the key beside it does not, or it slides out of the panel the
     moment the strip moves. Scrolled to the end once it is in the page, because the half of six
     months worth looking at is the half nearest today. */
  /* The columns share whatever width there is, down to a floor — a phone scrolls the strip as
     it always did, and a desktop stops leaving half the panel empty. The count goes into a
     custom property because the grid needs to know how many columns to divide, and the month
     names are placed as a share of the strip rather than in pixels for the same reason: their
     pitch is no longer a fixed number. */
  for (const label of months) {
    label.style.left = `${(+label.dataset.week / cols.length) * 100}%`;
  }

  const strip = h("div.hm-scroll", [
    h("div.hm-strip", { style: { "--weeks": cols.length } }, [
      h("div.hm-months", months),
      h("div.hm-grid", cols),
    ]),
  ]);
  /* Opened at today, which is the half of a year worth looking at. Asked for more than once:
     the cells size themselves from the width of the column they land in, so the first frame
     does not yet know how wide the strip is going to be. */
  const toEnd = () => { strip.scrollLeft = strip.scrollWidth; };
  requestAnimationFrame(toEnd);
  setTimeout(toEnd, 120);

  /* The picker above already says which stretch this is, so the heading does not repeat it —
     except under "All time", where the strip shows the last twelve months rather than the
     everything the figures above it cover, and saying so matters. */
  return h("section", [
    h("div.sect", [
      h("h2.t-label", { text: chosen.id === "all" ? "The last twelve months" : "Day by day" }),
      h("span.sect-count", { text: `busiest day: ${peak}` }),
    ]),
    h("div.panel.hm-panel", [
      strip,
      h("div.hm-key", [
        h("span.t-dim", { text: "less" }),
        h("i.hm-cell"), h("i.hm-cell.is-1"), h("i.hm-cell.is-2"), h("i.hm-cell.is-3"),
        h("span.t-dim", { text: "more" }),
      ]),
    ]),
  ]);
}

/* When, crossed with which day.

   Hours alone say "evenings" and weekdays alone say "Sundays"; neither can tell a Sunday
   afternoon from a Tuesday midnight, which is the shape of a watching habit. Crossed, they can:
   seven rows of twenty-four, a mark's worth of ink per episode.

   The same tick idiom as the barcode and the strip of days above it — this app draws counts as
   small marks, and a dial drawn in thin spokes was the one thing on the page that didn't. */
function punchCard(s, prime) {
  const most = Math.max(...s.grid.flat(), 1);
  const busiestDay = s.weekdays.indexOf(Math.max(...s.weekdays));

  // Monday first, the same as the strip above it.
  const rows = WEEK_ORDER.map((d) => h("div.pc-row", [
    h("span.pc-day", { class: d === busiestDay ? "is-peak" : null, text: WEEKDAY[d] }),
    ...s.grid[d].map((n, hour) => h("i.pc-cell", {
      // Area, not width: a count four times another should look four times as big, and a disc
      // scaled by its radius would look sixteen.
      style: n ? { "--fill": Math.sqrt(n / most).toFixed(3) } : null,
      class: n ? (prime && hour === prime.hour && d === busiestDay ? "is-on is-peak" : "is-on") : null,
      title: `${WEEKDAY[d]} ${String(hour).padStart(2, "0")}:00 — ${n || "nothing"}`,
    })),
  ]));

  return h("section", [
    h("div.sect", [h("h2.t-label", { text: "When you watch" }),
      prime ? h("span.sect-count", { text: `mostly around ${String(prime.hour).padStart(2, "0")}:00` }) : null]),
    h("div.panel.pc-panel", [
      h("div.pc-grid", rows),
      h("div.pc-hours", [0, 6, 12, 18].map((hour) => h("span.pc-hour", {
        style: { left: `calc(${(hour / 24) * 100}% )` },
        text: `${String(hour).padStart(2, "0")}:00`,
      }))),
    ]),
  ]);
}

// Where the time actually went. Bars rather than a pie: eight lengths are comparable at a
// glance and eight wedges are not.
function topShows(s, go) {
  if (!s.topShows.length) return null;
  const most = s.topShows[0].minutes || 1;
  return h("section", [
    h("div.sect", [h("h2.t-label", { text: "Where it went" })]),
    h("div.panel", { style: { display: "grid", gap: "10px" } }, s.topShows.map((row) =>
      h("button.bar-row", {
        type: "button",
        onclick: () => go("show", row.id),
        title: `${row.episodes} episodes`,
      }, [
        h("span.bar-name", { text: row.name }),
        h("span.bar-track", [h("i.bar-fill", { style: { width: `${Math.max(2, (row.minutes / most) * 100)}%` } })]),
        h("span.bar-val.t-mono", { text: row.minutes ? longSpan(row.minutes) : `${row.episodes} ep` }),
      ]))),
  ]);
}

function genres(s) {
  if (!s.genres.length) return null;
  const most = s.genres[0].minutes || 1;
  return h("section", [
    h("div.sect", [h("h2.t-label", { text: "What kind of thing" })]),
    h("div.panel", { style: { display: "grid", gap: "10px" } }, s.genres.map((g) =>
      h("div.bar-row", [
        h("span.bar-name", { text: g.name }),
        h("span.bar-track", [h("i.bar-fill.is-cool", { style: { width: `${Math.max(2, (g.minutes / most) * 100)}%` } })]),
        h("span.bar-val.t-mono", { text: longSpan(g.minutes) }),
      ]))),
  ]);
}

// The three facts that read like records rather than measurements.
function records(s) {
  const rows = [
    s.streak.best > 1 ? { k: "Longest streak", v: `${s.streak.best} days`,
      note: s.streak.current > 1 ? `${s.streak.current} days and counting` : `ended ${fmtDate(s.streak.bestEnded)}` } : null,
    s.biggest ? { k: "Biggest day", v: `${s.biggest.count} episodes`,
      note: `${fmtDate(s.biggest.day)} — ${s.biggest.shows.slice(0, 2).join(", ")}` } : null,
    s.first ? { k: "First mark", v: fmtDate(new Date(s.first).toISOString().slice(0, 10)),
      note: `${Math.max(1, Math.round((Date.now() - s.first) / DAY))} days ago` } : null,
  ].filter(Boolean);
  if (!rows.length) return null;

  return h("section", [
    h("div.sect", [h("h2.t-label", { text: "For the record" })]),
    h("div.panel.rec-grid", rows.map((r) => h("div.rec", [
      h("div.rec-v.t-mono", { text: r.v }),
      h("div.rec-k", { text: r.k }),
      h("div.rec-note", { text: r.note }),
    ]))),
  ]);
}

/* The leaderboard, which is the point of the whole app told as a joke.
   Every other row is redacted because the server holds those libraries as ciphertext and has no
   key for any of them. There is no percentile to show, and the honest reason is the feature. */
function leaderboard(s) {
  const blocks = (n) => "█".repeat(n);
  const rows = [
    { name: blocks(7), val: blocks(3) },
    { name: blocks(5), val: blocks(4) },
    { name: "You", val: `${s.episodes}`, you: true },
    { name: blocks(9), val: blocks(2) },
    { name: blocks(4), val: blocks(3) },
  ];
  return h("section", [
    h("div.sect", [h("h2.t-label", { text: "Compared with everyone else" })]),
    h("div.panel", [
      h("div.board", rows.map((r) => h("div.board-row", { class: r.you ? "is-you" : null }, [
        h("span.board-name", { text: r.name }),
        h("span.board-val.t-mono", { text: r.val }),
      ]))),
      h("p.board-note", { text:
        "We can't tell you. Every other library on the server is a block of ciphertext we have "
        + "no key for, and so is yours — that is the whole design, and this is what it costs. "
        + "You are doing great." }),
    ]),
  ]);
}
