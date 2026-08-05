// Modal layers: choosing one of a few things, and confirming something you can't undo.
//
// Both are built here rather than handed to the platform. A native <select> renders as a
// system picker that looks like it belongs to a different app — on Android in particular it
// arrives as a full-screen grey list with none of this app's type or colour. window.prompt
// and window.confirm are worse: they carry the origin in the title bar and cannot be styled
// at all.
//
// Presentation follows reach: a sheet from the bottom edge on a phone, where the thumb is,
// and a centred panel on a desktop, where the pointer already is.
import { h, svg, ICON } from "./dom.js";

/* One layer at a time. Every path out — the button, Escape, the scrim, the browser's back
   gesture — resolves the same promise exactly once, so a caller can always await an answer
   and never has to wonder whether the layer is still up. */
// The layer currently up, if any. One at a time, and always reachable from outside so a
// route change can take it down with it.
let live = null;

/* ---- back closes the layer, not the screen ----

   A sheet is a place you can leave, and on Android the back button and the edge gesture are how
   people leave places. Without something to catch that, back took the whole screen out from
   under an open sheet, which is the one thing no app on that platform does.

   CloseWatcher is what catches it. It exists for exactly this — a close request from Escape,
   the back button or the back gesture, for UI that is not a place and has no URL — and it
   answers before the request reaches the history stack. Nothing is navigated, so the browser
   plays no navigation: pushing a history entry instead made the edge gesture drag the sheet
   sideways like a page, because from the browser's side that is precisely what it was.

   Where there is no CloseWatcher — Safari today, Firefox until recently — the history entry is
   still the only way to catch a back button at all, so it stays as the fallback, side effect
   and all. */
let ownsEntry = false;      // the top history entry is the one we pushed
let popping = false;        // closing because a pop arrived, rather than the other way round
let expectPop = false;      // we asked for the pop ourselves, closing the layer some other way

const onTopOfOurs = () => !!(history.state && history.state.overlay);

export function popOverlay() {
  if (expectPop) { expectPop = false; return true; }
  if (!ownsEntry) return false;
  ownsEntry = false;
  popping = true;
  if (live) live();
  popping = false;
  return true;
}

/* Dismisses whatever is open, as if it had been cancelled. Called when the route changes:
   a panel belongs to the screen that raised it, and leaving that screen should not leave it
   hanging over the next one. */
export function closeOverlays() {
  if (live) live();
}

const hasCloseWatcher = () => typeof CloseWatcher === "function";

function present(build, { onCancel = null } = {}) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    let done = false;
    let watcher = null;

    const close = (value) => {
      if (done) return;
      done = true;
      live = null;
      if (watcher) {
        watcher.destroy();
        watcher = null;
      }
      /* Take the entry back out, unless the pop is what closed this in the first place, or the
         route has moved on and pushed an entry of its own over ours — going back then would
         land on the screen we just left. */
      if (ownsEntry && !popping && onTopOfOurs()) {
        ownsEntry = false;
        expectPop = true;
        history.back();
      }
      ownsEntry = false;
      removeEventListener("keydown", onKey, true);
      scrim.classList.remove("is-on");
      // Stops taking clicks the instant it starts leaving, rather than for the length of
      // the fade — and stays harmless even if the removal below never runs.
      scrim.style.pointerEvents = "none";
      // Left in the tree until it has finished leaving — on a phone that is a sheet travelling
      // its own height, and cutting it short makes it vanish mid-slide.
      setTimeout(() => scrim.remove(), 240);
      if (opener && opener.focus) opener.focus();
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(onCancel);
      }
    };

    const panel = build(close);
    const scrim = h("div.scrim", {
      onclick: (e) => { if (e.target === scrim) close(onCancel); },
    }, [panel]);

    // Anything still open is replaced rather than stacked.
    if (live) live();
    live = () => close(onCancel);

    if (hasCloseWatcher()) {
      // Caught before it becomes a navigation, so nothing slides.
      watcher = new CloseWatcher();
      watcher.onclose = () => close(onCancel);
    } else {
      // Same address, marked as a layer: back has something to pop that is not the screen.
      history.pushState({ ...(history.state || {}), overlay: true }, "");
      ownsEntry = true;
    }

    document.body.append(scrim);
    addEventListener("keydown", onKey, true);
    // Painted once before the class lands, so the transition has two states to move between.
    requestAnimationFrame(() => scrim.classList.add("is-on"));

    const first = panel.querySelector("[data-autofocus]") || panel.querySelector("button");
    if (first) first.focus({ preventScroll: true });
  });
}

/* ---- choosing ----
   Options are shown all at once with the current one marked, rather than hidden behind a
   control that has to be opened before you can see what it holds. Resolves to the chosen
   value, or null if the layer was dismissed. */
export function chooser({ title, options, value }) {
  return present((close) => h("div.sheet", {
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title,
  }, [
    h("div.sheet-grip", { "aria-hidden": "true" }),
    h("div.sheet-title.t-label", { text: title }),
    h("div.sheet-list", { role: "listbox" }, options.map((o) => {
      const on = o.value === value;
      return h("button.sheet-opt", {
        type: "button",
        role: "option",
        "aria-selected": on ? "true" : "false",
        class: on ? "is-on" : null,
        "data-autofocus": on ? "" : null,
        onclick: () => close(o.value),
      }, [
        h("span.sheet-opt-label", { text: o.label }),
        on ? svg(ICON.check, "sheet-opt-check") : null,
      ]);
    })),
  ]), { onCancel: null });
}

/* ---- filtering, on more than one axis ----

   Two questions — what kind of thing, and where it stands — so two groups in one sheet rather
   than two sheets or a row of chips eating the top of the screen.

   It stays open and applies as you go, which is the difference from chooser: that answers one
   question and closes, while this one is usually two taps and the list behind is the feedback.
   Each option carries its count, because a filter that turns out to be empty is worth knowing
   about before it is chosen rather than after. */
export function filterSheet({ title = "Filter", groups, onPick }) {
  return present((close) => {
    const body = h("div.sheet", { role: "dialog", "aria-modal": "true", "aria-label": title }, [
      h("div.sheet-grip", { "aria-hidden": "true" }),
    ]);

    const draw = () => {
      body.replaceChildren(h("div.sheet-grip", { "aria-hidden": "true" }));
      for (const g of groups()) {
        body.append(h("div.sheet-title.t-label", { text: g.title }));
        body.append(h("div.sheet-list", { role: "listbox" }, g.options.map((o) => {
          const on = o.value === g.value;
          return h("button.sheet-opt", {
            type: "button",
            role: "option",
            "aria-selected": on ? "true" : "false",
            class: on ? "is-on" : null,
            onclick: () => { onPick(g.id, o.value); draw(); },
          }, [
            h("span.sheet-opt-label", { text: o.label }),
            o.count != null ? h("span.sheet-opt-count", { text: String(o.count) }) : null,
            on ? svg(ICON.check, "sheet-opt-check") : null,
          ]);
        })));
      }
      body.append(h("div.sheet-actions", [
        h("button.btn.btn-sm.btn-primary", { type: "button", text: "Done", onclick: () => close(null) }),
      ]));
    };

    draw();
    return body;
  }, { onCancel: null });
}

/* ---- picking a date, or two ----
   For correcting an imported history, where the question is "between when and when". The
   platform's own date field, because a calendar is one of the few controls a phone does better
   than anything drawn here — and because it is already the shape people know. */
export function dateDialog({ title, body, from = "", to = null, confirm = "Apply" }) {
  return present((close) => {
    const start = h("input.field.field-date", { type: "date", value: from, "data-autofocus": "" });
    const end = to === null ? null : h("input.field.field-date", { type: "date", value: to });

    const done = () => {
      if (!start.value || (end && !end.value)) return;
      close(end ? { from: start.value, to: end.value } : { from: start.value });
    };

    return h("div.dialog", { role: "dialog", "aria-modal": "true", "aria-label": title }, [
      h("div.dialog-title.t-title", { text: title }),
      body ? h("p.dialog-body", { text: body }) : null,
      h("div.date-fields", [
        h("label.date-field", [h("span.t-label", { text: end ? "First" : "Date" }), start]),
        end ? h("label.date-field", [h("span.t-label", { text: "Last" }), end]) : null,
      ]),
      h("div.dialog-actions", [
        h("button.btn", { type: "button", text: "Cancel", onclick: () => close(null) }),
        h("button.btn.btn-primary", { type: "button", text: confirm, onclick: done }),
      ]),
    ]);
  }, { onCancel: null });
}

/* ---- confirming ----
   For actions worth a second thought but not worth an exam. Typing a word to confirm is a
   speed bump for the genuinely irreversible — deleting the whole vault — and pure friction
   for anything a person could simply redo. */
export function confirmDialog({ title, body, confirm = "Confirm", tone = null }) {
  return present((close) => h("div.dialog", {
    role: "alertdialog",
    "aria-modal": "true",
    "aria-label": title,
  }, [
    h("div.dialog-title.t-title", { text: title }),
    body ? h("p.dialog-body", { text: body }) : null,
    h("div.dialog-actions", [
      h("button.btn", { type: "button", text: "Cancel", onclick: () => close(false) }),
      // One tone or the other. btn-danger is an outline in the danger colour and btn-primary
      // is a filled amber; wearing both put red text on an amber fill.
      h("button.btn", {
        type: "button",
        class: tone === "danger" ? "btn-solid-danger" : "btn-primary",
        text: confirm,
        "data-autofocus": "",
        onclick: () => close(true),
      }),
    ]),
  ]), { onCancel: false });
}
