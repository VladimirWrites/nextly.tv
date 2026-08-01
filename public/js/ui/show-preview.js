// A show you don't track.
//
// Everything readable, nothing markable — there is no watch history to record against, and
// pretending otherwise would mean writing one. Deciding whether you want something comes
// before adding it, and having to track a show in order to read what it is gets the order
// backwards.
//
// Laid out to the same shape as the tracked page on purpose, so pressing Track does not
// rearrange the screen underneath the finger that pressed it.
import { h, svg, ICON, mount, toast } from "./dom.js";
import { epCode } from "../domain/constants.js";
import * as cache from "../io/cache.js";
import * as discover from "../io/discover.js";
import { ensureMeta, trackShow, opts } from "./actions.js";
import {
  stickyBar, watchTitle, header, expandable, trailerLink, ratings, hintRatings,
  castSection, similarSection, infoButton, skel, seasonSkeleton,
  expectArrival, tookArrival,
} from "./show-parts.js";

export function renderPreview(root, id, { go, back }) {
  const meta = cache.getMeta(id);
  if (!meta) return renderWaiting(root, id, back);

  const fill = tookArrival(id) ? "arrive" : null;

  const stub = { id, name: meta.name, src: meta.src, ref: meta.ref, imdb: meta.imdb, tvdb: meta.tvdb };
  const track = h("button.btn.btn-primary", {
    type: "button",
    // The element is captured before the first await: currentTarget is nulled the moment the
    // handler yields, so reading it in the catch threw and left the button dead for good.
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await trackShow(id);
        discover.forget();      // it should stop being offered as a discovery
        go("show", id);
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    },
  }, [svg(ICON.plus), "Track this show"]);

  const aired = (meta.seasons || []).flatMap((se) => se.episodes || []).filter((ep) => ep.air).length;
  const facts = [
    meta.year, meta.status, meta.network,
    (meta.seasons || []).length ? `${meta.seasons.length} season${meta.seasons.length === 1 ? "" : "s"}` : null,
    aired ? `${aired} episodes` : null,
  ].filter(Boolean);

  const bar = stickyBar(stub, back);
  mount(
    root,
    bar,
    header(stub, meta, go, null),
    h("div.show-rest", [
      h("div.panel", { class: fill, style: { marginTop: "18px" } }, [
        h("div.panel-actions", { style: { marginTop: "0" } }, [
          track,
          h("span.t-dim", { style: { fontSize: "13.5px" }, text: "Nothing is saved until you track it." }),
        ]),
      ]),
      ratings(meta, fill),
      facts.length ? h("div.sect", [h("h2.t-label", { text: "About" })]) : null,
      facts.length ? h("div.panel", { class: fill }, [h("div.show-facts.sep-row", facts.map((f) => h("span.sep-item", { text: f })))]) : null,
      h("div.sect", [h("h2.t-label", { text: "Episodes" })]),
      h("div", { class: fill }, (meta.seasons || []).map((se) => previewSeason(id, se, go))),
      // Who is in it is part of deciding whether you want it, so it belongs here rather than
      // only on the page you reach after tracking.
      castSection(meta, go),
      similarSection(stub, go),
    ]),
  );
  watchTitle(bar, root.querySelector(".show-name"));
  expandable(root, id);
  // The page for deciding whether you want it is the page a trailer belongs on most.
  trailerLink(root, meta);
}

/* Before the record lands. With a hint this is the finished hero: the same poster, name, year
   and summary that were on the row just tapped. Without one there is only the shape. */
function renderWaiting(root, id, back) {
  ensureMeta(id, { scores: true });
  const hint = cache.getHint(id);
  expectArrival(id);
  const bar = stickyBar({ id, name: (hint && hint.name) || "" }, back);
  mount(
    root,
    bar,
    hint
      ? header({ id, name: hint.name, entries: [] }, null, null, hint)
      : h("section.show-hero", [
          h("div.show-veil"),
          h("div.show-body", [
            h("div.show-poster.skeleton"),
            h("div", { style: { minWidth: 0, flex: "1 1 0" } }, [
              skel("62%", "30px"),
              h("div.show-facts", { style: { marginTop: "12px" } }, [skel("42px", "13px"), skel("62px", "13px")]),
              h("div.show-overview", { style: { display: "grid", gap: "7px" } }, [
                skel("100%", "13px"), skel("88%", "13px"), skel("54%", "13px"),
              ]),
            ]),
          ]),
        ]),
    h("div.show-rest", [
      h("div.panel.pending", { style: { marginTop: "18px" } }, [
        h("div.panel-actions", { style: { marginTop: 0 } }, [skel("150px", "40px", "999px")]),
      ]),
      hintRatings(hint),
      h("div.sect.pending", [h("h2.t-label", { text: "Episodes" })]),
      h("div.pending", [0, 1, 2].map(seasonSkeleton)),
    ]),
  );
  watchTitle(bar, root.querySelector(".show-name"));
}

// Read-only season list. Same shape as the tracked view so the page doesn't rearrange itself
// the moment you press Track.
function previewSeason(id, se, go) {
  const eps = (se.episodes || []).filter((ep) => opts().specials || !ep.special);
  return h("div.season.is-open", [
    h("div.season-head", { style: { cursor: "default" } }, [
      h("span.season-name.t-title", { text: se.n === 0 ? "Specials" : `Season ${se.n}` }),
      infoButton(`Details for season ${se.n}`, () => go("season", `${id}/${se.n}`)),
      h("span.season-prog.t-mono", { text: `${eps.length} ep${eps.length === 1 ? "" : "s"}` }),
    ]),
    h("div.season-list", eps.slice(0, 60).map((ep) =>
      h("div.ep-row", [
        h("div.ep", { style: { cursor: "default" } }, [
          h("span.ep-code", { text: epCode(se.n, ep.e) }),
          h("span.ep-name", { text: ep.name || "—", title: ep.name || null }),
        ]),
        infoButton(`Details for ${epCode(se.n, ep.e)}`, () => go("episode", `${id}/${se.n}/${ep.e}`)),
      ])
    )),
  ]);
}
