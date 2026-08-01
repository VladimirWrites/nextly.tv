// DOM helpers, icons, and the two global feedback channels (toast + the on-air lamp).
// No app logic lives here — views build their markup with `h` and hand it to `mount`.

import { initials } from "../domain/constants.js";
import * as view from "./viewstate.js";

// h("div.card", {onclick}, [children]) — the tag string carries classes so views read as
// structure rather than as a wall of setAttribute calls.
export function h(spec, props, children) {
  const [tag, ...classes] = String(spec).split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");
  if (Array.isArray(props)) {
    children = props;
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    /* Text only, deliberately: there is no `html:` escape hatch and there should not be one.
       Nothing here ever parsed markup, and with this builder being the single way the app makes
       an element, that makes an injected string impossible rather than merely unlikely. */
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = [node.className, v].filter(Boolean).join(" ");
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    /* Assigning to node.style ignores custom properties — style["--fill"] = 0.5 does nothing at
       all, silently — so those are set through the API that understands them. */
    else if (k === "style") {
      for (const [prop, val] of Object.entries(v)) {
        if (val == null) continue;
        if (prop.startsWith("--")) node.style.setProperty(prop, String(val));
        else node.style[prop] = val;
      }
    }
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children || [])) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

// SVG needs its own namespace, so icons get a dedicated builder.
export function svg(paths, cls = "btn-icon") {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", cls);
  s.setAttribute("aria-hidden", "true");
  for (const d of [].concat(paths)) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    s.append(p);
  }
  return s;
}

export const ICON = {
  play: "M8 5.5v13l11-6.5z",
  library: ["M4 5h5v14H4z", "M11 5h5v14h-5z", "M18.5 5.6l2.4 13.1"],
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M16.2 16.2L21 21"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4.5 20a7.5 7.5 0 0 1 15 0"],
  check: "M4.5 12.6l4.6 4.6L19.5 6.8",
  plus: ["M12 5v14", "M5 12h14"],
  caret: "M9 5l7 7-7 7",
  // Three lines of falling length: order.
  order: ["M4 7h13", "M4 12h9", "M4 17h5"],
  eye: ["M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  eyeOff: ["M3 3l18 18", "M10.6 6.2A9.9 9.9 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.3 4",
           "M6.3 8A16.7 16.7 0 0 0 2 12s3.6 6.5 10 6.5a9.7 9.7 0 0 0 4-.85", "M9.9 9.9a3 3 0 0 0 4.2 4.2"],
  back: ["M20 12H4", "M10 6l-6 6 6 6"],
  info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 11v6", "M12 7.6v.6"],
  x: ["M6 6l12 12", "M18 6L6 18"],
  // Double check — "everything up to here is done". An arrow onto a line reads as download.
  catchup: ["M1.5 12.8l4.2 4.2L14.4 8.3", "M9.6 17l1.4 1.4L22.5 7.3"],
};

export function mount(root, ...nodes) {
  root.replaceChildren(...nodes.filter(Boolean));
  return root;
}

/* ---- media that outlives a render ----
   Rendering replaces the whole subtree, so an image was destroyed and rebuilt even when it
   was the same image — which is what made a page blink as it filled in. Given the same key
   and the same source, this hands back the element already on screen and moves it into the
   new tree, so the decoded frame is never dropped.

   Only for the few large images that would be noticed: the show poster and its backdrop. */
/* Held here rather than looked up in the document: the shell is rebuilt before the route
   renderer runs, so by the time a page asks for its poster the previous one has already been
   detached. A handful of slots is all that is ever live, so the oldest are dropped. */
const kept = new Map();
const KEEP_MAX = 24;

/* A picture that arrives rather than appears.

   Every one of these rows is rebuilt when its screen is painted again, so the elements are new
   even when the files are not: the browser has them, but each new <img> is empty for the frame
   or two it takes to decode, and a row of them coming back from cache flickers.

   A picture already decoded is shown at once — there is nothing to cover, and fading something
   that was ready would be an animation for its own sake. Anything else fades in when it lands.
   The distinction matters more than the fade: it is what keeps a cached row from flickering
   and an uncached one from popping. */
export function poster(cls, src, extra = {}) {
  const img = h("img", { class: cls, src, alt: "", loading: "lazy", decoding: "async", ...extra });
  // Already in hand — a cached file assigned synchronously reports itself complete.
  if (img.complete && img.naturalWidth) return img;

  img.classList.add("img-fade", "is-coming");
  const done = () => img.classList.remove("is-coming");
  img.addEventListener("load", done, { once: true });
  // A picture that never arrives must not be left invisible.
  img.addEventListener("error", done, { once: true });
  return img;
}

export function keepMedia(key, tag, props) {
  const url = String(props.src || props.bg || "");
  const live = kept.get(key);

  if (live && live.tagName.toLowerCase() === tag) {
    // Same slot, so the element is kept even when the URL changed — a search result and a
    // full record often name different sizes of one picture. Assigning the new source keeps
    // the old frame on screen until the new one has decoded, instead of blanking first.
    if (live.getAttribute("data-keep-src") !== url) {
      live.setAttribute("data-keep-src", url);
      // An <img> holds its old frame until the new one has decoded, so assigning is already
      // smooth. A background has no such courtesy: it appears the instant it is ready.
      if (props.src) live.src = props.src;
      if (props.bg) crossFade(live, props.bg);
    }
    if (props.class) live.className = props.class;
    return live;
  }

  const node = h(tag, {
    class: props.class || null,
    "data-keep": key,
    "data-keep-src": url,
    ...(props.src ? { src: props.src, alt: "", decoding: "async" } : {}),
    ...(props.bg ? { style: { backgroundImage: `url("${props.bg}")` } } : {}),
  });
  if (kept.size >= KEEP_MAX) kept.delete(kept.keys().next().value);
  kept.set(key, node);
  return node;
}

/* Swapping one backdrop for another without it appearing all at once.

   A background-image cannot be transitioned, so the new one is loaded first and then faded in
   on a copy of the element laid exactly over it while the original fades out underneath. Both
   halves move together, so the pair never adds up to more than the one image's opacity — a
   plain fade-in over the top would brighten mid-way and read as a flash of its own.

   The copy carries the same classes, which is what makes it line up: whatever position, size
   and filter the original had, it has. */
const FADE_MS = 320;

function crossFade(el, url) {
  const set = () => { el.style.backgroundImage = `url("${url}")`; };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return set();

  const img = new Image();
  img.onerror = set;
  img.onload = () => {
    const parent = el.parentNode;
    if (!parent) return set();

    const over = el.cloneNode(false);
    // It must not be mistaken for the kept element on a later render.
    over.removeAttribute("data-keep");
    over.removeAttribute("data-keep-src");
    over.style.backgroundImage = `url("${url}")`;
    over.style.opacity = "0";
    over.style.transition = `opacity ${FADE_MS}ms ease`;
    // Between the artwork and the veil over it, so the gradient still sits on top of both.
    parent.insertBefore(over, el.nextSibling);

    const shown = getComputedStyle(el).opacity;
    requestAnimationFrame(() => {
      over.style.opacity = shown;
      el.style.transition = `opacity ${FADE_MS}ms ease`;
      el.style.opacity = "0";
    });

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      set();
      el.style.transition = "";
      el.style.opacity = "";
      over.remove();
    };
    over.addEventListener("transitionend", finish, { once: true });
    // A transition that never runs — a backgrounded tab, a dropped frame — must not leave the
    // artwork faded out.
    setTimeout(finish, FADE_MS + 200);
  };
  img.src = url;
}

/* ---- toast ----
   One line, one job: confirm what just happened using the same verb the button used. */
let toastEl;
let toastTimer;
/* One line, one job: confirm what just happened using the same verb the button used.

   With an `undo` it also carries the way back, for the few seconds anyone would notice they
   had marked the wrong thing. Long enough to reach and short enough not to sit there — and it
   goes the moment it is used, because an undo you can press twice is a way to undo an undo. */
export function toast(msg, { undo = null, ms = undo ? 5200 : 2200 } = {}) {
  if (!toastEl) {
    toastEl = h("div.toast", { role: "status", "aria-live": "polite" });
    document.body.append(toastEl);
  }

  const hide = () => {
    toastEl.classList.remove("is-on", "has-undo");
    toastEl.style.pointerEvents = "";
  };

  toastEl.replaceChildren(h("span", { text: msg }));
  if (undo) {
    toastEl.classList.add("has-undo");
    // A toast is normally click-through so it never eats a tap meant for the page beneath.
    // One with a button in it has to be reachable, and only for as long as it is up.
    toastEl.style.pointerEvents = "auto";
    toastEl.append(h("button.toast-undo", {
      type: "button",
      text: "Undo",
      onclick: () => { hide(); undo(); },
    }));
  } else {
    toastEl.classList.remove("has-undo");
    toastEl.style.pointerEvents = "";
  }

  toastEl.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, ms);
}

/* ---- update progress ----
   Filling a big library's metadata takes a while on a new device. A thin bar at the very top
   says work is happening without stealing the screen, and disappears the moment it is done.
   Written directly to the DOM rather than through a render, so it can update dozens of times
   without repainting the app. */
let bar;
export function setProgress(done, total) {
  if (!bar) {
    bar = h("div.progress", { role: "progressbar", "aria-label": "Updating episode lists" });
    document.body.append(bar);
  }
  const finished = !total || done >= total;
  bar.classList.toggle("is-on", !finished);
  bar.style.width = finished ? "100%" : `${Math.round((done / total) * 100)}%`;
  if (finished) setTimeout(() => { bar.style.width = "0%"; }, 260);
}

/* ---- the on-air lamp ----
   Sync state as one dot rather than a status bar. Steady means saved, pulsing means writing,
   grey means this device is on its own for now. */
export function setSync(kind, label) {
  document.querySelectorAll(".brand-lamp").forEach((el) => {
    el.classList.toggle("is-sync", kind === "sync");
    el.classList.toggle("is-off", kind === "off");
    el.setAttribute("title", label || "");
  });
  const sr = document.getElementById("sync-sr");
  if (sr) sr.textContent = label || "";
}

// Confirm destructive steps by typing the word, not by clicking a second button — a
// mis-tap can't do it, and the word says what's about to happen.
export function confirmWord(word, message) {
  const typed = window.prompt(`${message}\n\nType ${word} to confirm.`);
  return (typed || "").trim().toUpperCase() === word.toUpperCase();
}

/* ---- install ----
   Mirrors nestegg: Chromium fires beforeinstallprompt so the button can trigger the real
   dialog. iOS has no install API at all and never fires it, so there the button explains
   Share -> Add to Home Screen instead. The button is hidden only when already installed,
   because Firefox and Brave never fire the event either and would otherwise never show it. */

export const isStandalone = () => {
  try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
  catch (e) { return false; }
};

/* ---- the desktop title bar ----
   Installed on a desktop, the app can ask for the window's title bar and put its own things
   in it, leaving the platform only the close and resize buttons in a corner. The manifest
   asks; whether it is granted depends on the platform and on whether the reader has toggled
   it off, and it can change while the app is running.

   A flag on the root element rather than a media query, because there is no media feature for
   this. The layout offsets read env(titlebar-area-*) directly and need no flag — those are
   already zero when the overlay is absent — so this only decides whether the strip is drawn. */
export function watchTitlebar() {
  const wco = navigator.windowControlsOverlay;
  if (!wco) return;
  const sync = () => document.documentElement.toggleAttribute("data-wco", wco.visible);
  sync();
  wco.addEventListener("geometrychange", sync);
}

/* Said in both places someone can install from, so it is written once.

   Safari caps script-writable storage at seven days without a visit, and a Home Screen web app
   is exempt. Everywhere else installing is a convenience; here it decides whether the account
   number is still on the device next month. Stated without alarm, because the vault itself is
   untouched by this and the number was saved before the app let anyone in: the cost is signing
   in again, not losing anything. */
export const IOS_STORAGE_WARNING =
  "Safari clears a site's stored data after seven days without a visit, and your account "
  + "number is part of that. Your watch history is safe on the server either way, but you "
  + "would need the number to sign in again. Adding nextly to your Home Screen keeps it.";

/* Firefox on a computer is the one browser with no install of any kind: no beforeinstallprompt,
   and no menu item that produces a standalone window with its own icon. Telling someone to look
   in a menu they will find nothing in is worse than telling them there is nothing to find, so
   it gets its own wording. Firefox on Android does install, hence the second test. */
export const isFirefoxDesktop = () => {
  const ua = navigator.userAgent || "";
  return /firefox|fxios/i.test(ua) && !/android|mobile|tablet/i.test(ua);
};

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent || "") ||
  (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);

let deferredInstall = null;
const installListeners = new Set();
export function onInstallStateChange(fn) { installListeners.add(fn); }
const notify = () => installListeners.forEach((fn) => fn());

addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; notify(); });
addEventListener("appinstalled", () => { deferredInstall = null; notify(); });

export const canPromptInstall = () => !!deferredInstall;

// Returns "installed", "dismissed", or "manual" when the browser gives us no prompt to show.
export async function promptInstall() {
  if (!deferredInstall) return "manual";
  deferredInstall.prompt();
  let outcome = "dismissed";
  try { outcome = (await deferredInstall.userChoice).outcome; } catch (e) {}
  deferredInstall = null;
  notify();
  return outcome === "accepted" ? "installed" : "dismissed";
}

// `size` scales the letters to the box it sits in.
export const posterFallback = (name, size = "md") =>
  h("div.card-fallback", { class: "is-" + size, "aria-hidden": "true" }, [
    h("span.card-initials", { text: initials(name) }),
  ]);

/* A horizontal list that stops at the content margin reads as "that is all of it". These run
   to the screen edge instead, and fade at whichever end still has something past it — so the
   fade is a signal rather than decoration, and never lies at the ends of the list. */
export function shelfScroller(el, key = null) {
  const update = () => {
    const more = el.scrollWidth - el.clientWidth;
    el.classList.toggle("has-start", el.scrollLeft > 4);
    el.classList.toggle("has-end", more > 4 && el.scrollLeft < more - 4);
  };
  el.addEventListener("scroll", update, { passive: true });
  // After layout, and again once posters have loaded and changed the width.
  requestAnimationFrame(update);
  setTimeout(update, 400);
  dragScroll(el);
  if (key) keepPlace(el, key);
  return el;
}

/* Where a row was left, per visit.

   A row scrolled six posters along and then tapped through comes back at the beginning, which
   loses the place in it — the same fault the page's own scroll had, one axis over. Given a key,
   a row remembers.

   Restoring is not a matter of setting it once: these rows are filled after the page is
   painted, from a cache or a request, and until the cards are in it there is nowhere to scroll
   to. So it is put back as the row grows, and stops trying the moment it arrives or the moment
   the reader moves it themselves. */
const PLACE_TRIES = [0, 80, 200, 500, 1000];

function keepPlace(el, key) {
  const at = `shelf:${key}`;
  const want = view.count(at, 0);
  let owned = false;                        // the reader has taken over

  let ticking = false;
  el.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (owned) view.setCount(at, Math.round(el.scrollLeft));
    });
  }, { passive: true });

  // Anything the reader does to the row hands it over: no restore is going to fight a thumb.
  const mine = () => {
    owned = true;
    view.setCount(at, Math.round(el.scrollLeft));
  };
  for (const ev of ["pointerdown", "wheel", "touchstart", "keydown"]) {
    el.addEventListener(ev, mine, { passive: true, once: true });
  }

  if (!want) { owned = true; return; }

  let n = 0;
  const put = () => {
    if (owned) return;
    if (el.scrollWidth - el.clientWidth >= want) {
      el.scrollLeft = want;
      owned = true;                          // arrived: everything from here is the reader's
      return;
    }
    if (n < PLACE_TRIES.length) setTimeout(put, PLACE_TRIES[n++]);
    else owned = true;                       // it never grew that wide; stop waiting
  };
  put();
}

/* Dragging the row with the pointer, because a mouse without a horizontal wheel had no way
   to move one at all — the row simply ended at the edge of the screen with more behind it.
   A trackpad and a touchscreen already do this themselves, so only a mouse is handled here;
   binding touch would fight the native scrolling that already works.

   A drag has to stay distinguishable from a click, since every card in these rows opens
   something. Nothing happens until the pointer has travelled far enough to mean it, and the
   click that arrives at the end of a real drag is swallowed — otherwise letting go over a
   card would open whatever you had just dragged out of the way. */
const DRAG_SLOP = 6;   // px before a press counts as a drag rather than a click

export function dragScroll(el) {
  let startX = 0;
  let startLeft = 0;
  let pressed = false;
  let dragged = false;

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    pressed = true;
    dragged = false;
    startX = e.clientX;
    startLeft = el.scrollLeft;
  });

  el.addEventListener("pointermove", (e) => {
    if (!pressed) return;
    const dx = e.clientX - startX;
    if (!dragged && Math.abs(dx) < DRAG_SLOP) return;
    if (!dragged) {
      dragged = true;
      el.classList.add("is-dragging");
      // Captured only once it is a drag, so a plain click still reaches the card under it.
      el.setPointerCapture(e.pointerId);
    }
    el.scrollLeft = startLeft - dx;
    e.preventDefault();
  });

  const release = (e) => {
    if (!pressed) return;
    pressed = false;
    el.classList.remove("is-dragging");
    if (el.hasPointerCapture && e.pointerId != null) {
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    }
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);

  // Fires after pointerup, in the capture phase, so it can be stopped before any card sees it.
  el.addEventListener("click", (e) => {
    if (!dragged) return;
    dragged = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  // A drag inside a row must not also start the browser's own image drag.
  el.addEventListener("dragstart", (e) => e.preventDefault());
}
