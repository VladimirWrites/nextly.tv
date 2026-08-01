// How a season went, drawn.
//
// The barcode says what you have watched; this says what the season was worth. One point per
// scored episode, joined, against the season's own range rather than a full ten-point axis —
// almost every season lives between 7 and 9, and drawn against 0–10 they are all the same flat
// line, which is why the two figures at the left say what the range actually is.
//
// SVG, drawn at the box's own pixel width rather than scaled into it: a stretched viewBox
// makes the text three times too wide on a desktop and turns the dots into ellipses. So the
// width is measured, the drawing is made to fit, and it is made again if the column changes.
import { seasonYears } from "../domain/dates.js";
import { fmtScore, epCode } from "../domain/constants.js";
import { scoreSeries } from "../domain/scores.js";

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  return node;
};

/* Height follows width, within bounds — the same rule the charts in nestegg use. A fixed
   height that suits a phone is a squat letterbox in a 968px desktop column. */
const heightFor = (w) => Math.round(Math.max(132, Math.min(w * 0.4, 200)));

// Room at the left for the axis figures, at the bottom for the episode numbers.
const PAD = { top: 12, right: 10, bottom: 18, left: 30 };

// Past this many, a dot per episode is a smear and only the line is drawn. A daily
// programme's season is 365 episodes.
const DOTS_MAX = 40;

function build(w, se, series, onPick) {
  const { points, lo, hi, avg } = series;
  const H = heightFor(w);
  const plotW = Math.max(40, w - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (i * plotW) / (points.length - 1);
  const y = (score) => PAD.top + plotH - ((score - lo) / (hi - lo)) * plotH;

  const lows = Math.min(...points.map((p) => p.score));
  const highs = Math.max(...points.map((p) => p.score));

  const svg = el("svg", {
    class: "chart",
    width: w,
    height: H,
    viewBox: `0 0 ${w} ${H}`,
    role: "img",
    "aria-label": `Episode scores for season ${se.n}: ${points.length} episodes, `
      + `${fmtScore(lows)} to ${fmtScore(highs)}, averaging ${fmtScore(avg)}.`,
  });

  // The floor, the middle and the ceiling of the window, named. A line that climbs the whole
  // box has climbed however much these figures say it has, and no more.
  for (const v of [hi, (lo + hi) / 2, lo]) {
    svg.append(el("line", { class: "chart-rule", x1: PAD.left, x2: w - PAD.right, y1: y(v), y2: y(v) }));
    const label = el("text", { class: "chart-axis", x: PAD.left - 7, y: y(v) + 3.5, "text-anchor": "end" });
    label.textContent = fmtScore(v);
    svg.append(label);
  }

  // The average, dashed, so it reads as a reference rather than as data.
  if (avg && avg > lo && avg < hi) {
    svg.append(el("line", { class: "chart-avg", x1: PAD.left, x2: w - PAD.right, y1: y(avg), y2: y(avg) }));
  }

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(" ");
  const floor = (PAD.top + plotH).toFixed(1);
  // A faint body under the line, so it has weight without a second colour.
  svg.append(el("path", { class: "chart-area", d: `${line} L${x(points.length - 1).toFixed(1)} ${floor} L${x(0).toFixed(1)} ${floor} Z` }));
  svg.append(el("path", { class: "chart-line", d: line }));

  if (points.length <= DOTS_MAX) {
    const best = points.reduce((b, p) => (!b || p.score > b.score ? p : b), null);
    const band = plotW / Math.max(1, points.length - 1);
    points.forEach((p, i) => {
      const spot = el("g", { class: "chart-spot" + (p === best ? " is-best" : "") });
      /* The whole column is the tap target, not the dot: a 2.6px circle is not something to
         ask a thumb to hit. */
      const hit = el("rect", {
        class: "chart-hit",
        x: Math.max(0, x(i) - band / 2).toFixed(1),
        y: PAD.top,
        width: band.toFixed(1),
        height: plotH,
      });
      const title = el("title");
      title.textContent = `${epCode(se.n, p.e)}${p.name ? " · " + p.name : ""} — ${fmtScore(p.score)}`;
      hit.append(title);
      spot.append(hit, el("circle", { class: "chart-dot", cx: x(i).toFixed(1), cy: y(p.score).toFixed(1), r: 2.6 }));
      if (onPick) {
        spot.setAttribute("tabindex", "0");
        spot.setAttribute("role", "button");
        spot.setAttribute("aria-label", `${epCode(se.n, p.e)}, ${fmtScore(p.score)}`);
        spot.addEventListener("click", () => onPick(p));
        spot.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(p); }
        });
      }
      svg.append(spot);
    });
  }

  // Which end is which. Only the ends: a number under every point is noise, and each point
  // says its own on hover and on tap.
  const first = el("text", { class: "chart-foot", x: PAD.left, y: H - 4 });
  first.textContent = epCode(se.n, points[0].e);
  const last = el("text", { class: "chart-foot", x: w - PAD.right, y: H - 4, "text-anchor": "end" });
  last.textContent = epCode(se.n, points[points.length - 1].e);
  svg.append(first, last);

  return svg;
}

/* Fills a box that is already in the page, because until it is there is no width to draw to.
   Redrawn when the column changes — a phone turning, or the desktop rail appearing — and the
   observer lets go once the box is gone. Returns false where there is nothing to draw, so the
   caller can leave the section out rather than print an empty panel. */
export function chartInto(box, se, episodes, { onPick } = {}) {
  const series = scoreSeries(episodes);
  if (!series) return false;

  let drawn = 0;
  const draw = () => {
    const w = Math.round(box.clientWidth);
    if (!w || w === drawn) return;
    drawn = w;
    box.replaceChildren(build(w, se, series, onPick));
  };

  // The box is measured after the browser has laid it out, never during the render that made it.
  requestAnimationFrame(draw);

  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => {
      if (!box.isConnected) return ro.disconnect();
      draw();
    });
    ro.observe(box);
  }
  return true;
}

// The caption beside it: whose scores these are, and when they were given.
export const chartCaption = (episodes, from) => {
  const parts = [from ? `${from} scores` : "Episode scores", seasonYears(episodes)].filter(Boolean);
  return parts.join(" · ");
};
