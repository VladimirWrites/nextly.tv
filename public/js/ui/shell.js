// The app shell: the four destinations, as a bottom bar on phones and a left rail on
// desktop. Same markup and same order at both sizes, so the app doesn't have to be
// relearned when the window changes.
import { h, svg, ICON } from "./dom.js";

const TABS = [
  { id: "next", label: "Up next", icon: ICON.play },
  { id: "library", label: "Library", icon: ICON.library },
  { id: "search", label: "Search", icon: ICON.search },
  { id: "you", label: "You", icon: ICON.user },
];

/* The strip across the top of a desktop window, where the platform's title bar would be.
   Drawn only when the overlay is actually granted — see watchTitlebar in dom.js — and sized
   from the browser's own measurements, since the window controls sit at one end or the other
   depending on the platform and the strip is whatever is left.

   It carries the wordmark and nothing else. Everything in it is a drag region, so the window
   moves by its own name; a control in here would have to opt out again, and there is nothing
   this bar needs that the rail underneath does not already have. */
export function renderTitlebar() {
  return h("div.titlebar", { "aria-hidden": "true" }, [
    h("div.brand", [h("i.brand-lamp"), "nextly"]),
  ]);
}

export function renderNav(active, onGo, badge = 0) {
  /* Named so it takes part in the mark transition on Up next — not to animate it, but to keep
     it drawn. A named element is lifted out of the page into the transition's own layer, which
     sits above everything including this bar; Coming up is tall enough to reach the bottom of
     the screen, so without a name of its own the bar would spend the transition underneath a
     snapshot of the schedule. Its z-index is set in app.css, because the layer is stacked in
     document order and this is built before the content it has to stay in front of. */
  const nav = h("nav.nav.vt", { "aria-label": "Sections", style: { "--vt": "nav" } });

  nav.append(h("div.nav-brand", [
    h("div.brand", [h("i.brand-lamp"), "nextly"]),
    h("span.sr-only", { id: "sync-sr", role: "status", "aria-live": "polite" }),
  ]));

  for (const t of TABS) {
    const item = h("button.nav-item", {
      type: "button",
      class: t.id === active ? "is-on" : null,
      "aria-current": t.id === active ? "page" : null,
      onclick: () => onGo(t.id),
    }, [
      svg(t.icon, "nav-icon"),
      t.label,
    ]);
    // The badge counts episodes waiting, so it belongs on Up next and nowhere else.
    if (t.id === "next" && badge > 0) {
      item.append(h("span.nav-count", { text: badge > 99 ? "99+" : String(badge) }));
    }
    nav.append(item);
  }
  return nav;
}

/* The bar at the top of a screen, and the only toolbar the app has. A route can put its own
   controls in it and a count beside its name; the slots stay empty and out of the way for the
   screens that don't. A route that fills them owns the bar, so it drops its own heading rather
   than printing the same word twice. */
export function renderTopbar(title) {
  const count = h("span.topbar-count");
  const actions = h("div.topbar-actions");
  /* For a screen you arrived at from another one rather than from the nav — a person, say.
     Empty on the screens the nav reaches, where there is nothing to go back to and the lamp
     belongs instead. */
  const lead = h("div.topbar-lead");
  /* The bar's background spans the whole column while the row inside it is held to the same
     width as the page below, so its controls line up with the content rather than with the
     window's edge. */
  const bar = h("header.topbar", [
    h("div.topbar-inner", [
      lead,
      h("div.brand", [h("i.brand-lamp")]),
      h("div.topbar-title.t-title", { text: title }),
      count,
      actions,
    ]),
  ]);
  return { bar, count, actions, lead };
}

export { h, svg, ICON };
