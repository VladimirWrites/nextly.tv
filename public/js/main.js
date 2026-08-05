// Boot and routing.
//
// Views are functions that paint into one container. There's no framework and no virtual
// DOM: an action mutates the state, calls scheduleSync, and asks for a repaint. At this
// scale that's less code than a framework's setup, and it keeps the whole data path — tap,
// mutate, encrypt, push — readable end to end.
import { h, mount, setSync, toast, onInstallStateChange, isStandalone, watchTitlebar } from "./ui/dom.js";
import { renderNav, renderTopbar, renderTitlebar } from "./ui/shell.js";
import { renderGate } from "./ui/gate.js";
import { signedOut } from "./ui/anon.js";
import { renderUpNext } from "./ui/upnext.js";
import { renderLibrary, stopIndexWatch } from "./ui/library.js";
import { closeOverlays, popOverlay } from "./ui/overlay.js";
import { renderShow } from "./ui/show.js";
import { renderMovie } from "./ui/movie.js";
import { stopBarWatch } from "./ui/show-parts.js";
import { renderPerson } from "./ui/person.js";
import { renderSeason, renderEpisode } from "./ui/detail.js";
import { renderStats } from "./ui/stats.js";
import { renderFeed } from "./ui/feed.js";
import { feedById } from "./ui/discover.js";
import * as view from "./ui/viewstate.js";
import * as trail from "./ui/trail.js";
import { renderSearch, presetSearch } from "./ui/search.js";
import { renderSettings, applyTheme } from "./ui/settings.js";
import { setRepaint, hydrateLibrary, opts } from "./ui/actions.js";
import { state } from "./domain/store.js";
import { findShow, findSameShow } from "./domain/schema.js";
import { upNextList } from "./domain/progress.js";
import { showKey } from "./domain/constants.js";
import { parseShared } from "./domain/share.js";
import { parseRoute, pathFor } from "./domain/routes.js";
import { deriveKeys, keysReady } from "./io/crypto.js";
import { openLocal, syncVault, loadServer, flushSync, rememberedToken, rememberToken, setSyncReporter, setDataListener, askToPersist, readTheme } from "./io/storage.js";
import * as cache from "./io/cache.js";
import * as meta from "./io/meta.js";

const app = document.getElementById("app");
let route = { name: "next", arg: null };

/* ---- routing ----
   What an address means, and what address a screen has, is decided in domain/routes.js —
   including why the four detail screens keep their subject in the fragment. Everything here
   is the part that has to touch `location` and `history`. */

// Where the app currently is, in the form pathFor produces, so the two can be compared.
const hereNow = () => location.pathname + location.hash;

/* ---- where you were on each screen ----
   The bookkeeping is in ui/trail.js; what is left here is the part that has to touch the
   history object. */
history.scrollRestoration = "manual";

const stateOf = () => history.state || {};

// The entry being looked at. Entries made before this existed, and the one a cold load starts
// on, are given a key on sight.
function hereKey() {
  const st = stateOf();
  if (st.key) {
    trail.note(st.key, st.depth || 0);
    return st.key;
  }
  const key = trail.newKey();
  const depth = st.depth || 0;
  history.replaceState({ ...st, depth, key }, "");
  trail.note(key, depth);
  return key;
}

let here = hereKey();
view.bindEntry(here);

/* Recorded as it happens rather than on the way out: a screen can be left by the system's back
   button, an edge gesture, a link or a redirect, and every one of them would need its own
   place to remember this. */
let ticking = false;
addEventListener("scroll", () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    trail.remember(here, window.scrollY);
  });
}, { passive: true });

/* Screens are not finished when they are first painted — a show page can still be waiting on
   its record, and it is a few hundred pixels tall until that lands. So the position is asked
   for again as the page grows, and the asking stops the moment it is reached or the page turns
   out not to go that far. */
function restoreScroll(y) {
  if (!y) return window.scrollTo(0, 0);
  const at = [0, 60, 140, 300, 600];
  let n = 0;
  const tryOnce = () => {
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) < 2) return;      // arrived
    if (n < at.length) setTimeout(tryOnce, at[n++]);   // still growing
  };
  tryOnce();
}

/* The tab bar, which is not quite the same as going somewhere.

   The four tabs are places you switch between rather than places you go into, so walking back
   through every tab you happened to visit would be wrong — three taps around the bar should
   not cost three presses of Back to get out. They used to replace for exactly that reason, and
   the cost was that Back from anywhere in the app closed it, with Up next never reachable that
   way.

   One entry, not none. The first step away from Up next is pushed; moving between the other
   tabs replaces, so there is never more than one of them on the stack. Back from Library,
   Search or You lands on Up next, and Back from there leaves — which is what Back does
   everywhere else on the platform.

   Going the other way is a step back rather than a third entry, or Up next would be reachable
   by Back and then still be sitting on top of the tab it was reached from. Only from a tab: a
   show page has its own trail behind it and popping that would land somewhere unrelated. */
const SIDE_TABS = ["library", "search", "you"];

function goTab(name) {
  const depth = (history.state && history.state.depth) || 0;
  if (name === "next" && SIDE_TABS.includes(route.name) && depth > 0) return history.back();
  // Deep-linked straight into a tab, so there is no Up next underneath to go back to.
  go(name, null, { replace: route.name !== "next" });
}

function go(name, arg = null, { replace = false } = {}) {
  const path = pathFor(name, arg);
  // Compared against the fragment as well, or every move between two shows would look like
  // standing still — they share a path and differ only after the hash.
  if (hereNow() !== path || location.search) {
    /* How many screens deep this entry is, so a Back button can tell going back from going
       out. A page opened from a link or a bookmark starts at nothing and has no history of
       ours to return to; one reached by tapping through does. */
    const depth = (history.state && history.state.depth) || 0;
    trail.remember(here, window.scrollY);   // where this screen was left
    const next = replace ? depth : depth + 1;
    // A push destroys whatever was ahead of it. Replacing destroys only what it stands on.
    trail.forgetFrom(replace ? depth : next);
    here = trail.newKey();
    trail.note(here, next);
    // A new visit opens nothing of its own accord, and closes nothing the visit behind it had.
    view.bindEntry(here);
    if (replace) history.replaceState({ depth: next, key: here }, "", path);
    else history.pushState({ depth: next, key: here }, "", path);
  }
  route = { name, arg };
  /* Crossfaded, where the browser can: one screen becoming another reads as a place changing
     rather than a page being replaced. Only between screens — a repaint after marking an
     episode has to be instant, or the app feels behind the tap that caused it. */
  transition(() => { render(); window.scrollTo(0, 0); });
}

/* Back out of a screen that was tapped into.

   Through history, so screens stack: search → a show → an actor → another show goes back
   the way it came, one step at a time. Deciding where to go from the screen's own state
   instead sent that last step to the search box, three screens over, because that is where
   the trail happened to start.

   The fallback is for a screen with nothing of ours behind it — opened from a shared link
   or a bookmark — where leaving the app is not what the arrow appears to offer. */
function back(fallback = "library") {
  if ((history.state && history.state.depth) > 0) history.back();
  else go(fallback, null, { replace: true });
}

/* Back, by whatever means: the system button, the edge gesture, or the arrow in the bar. It
   crossfades the same way a forward step does — going back used to repaint instantly while
   going in faded, so the screen appeared to vanish rather than to be left. */
addEventListener("popstate", () => {
  // A sheet or a dialog is a place of its own: back closes that first, and the address it was
  // opened at has not changed, so there is nothing to redraw.
  if (popOverlay()) return;

  // Still the height of the screen being left: popstate runs before anything is repainted.
  trail.remember(here, window.scrollY);
  here = hereKey();
  view.bindEntry(here);
  const was = trail.recall(here);

  route = parseRoute(location.pathname, location.hash);
  // Scrolled inside the same callback as the paint, so the transition's picture of the new
  // screen is taken at the height it is meant to appear at rather than at the top.
  transition(() => { render(); window.scrollTo(0, was); });
  restoreScroll(was);
});

/* ---- render ---- */

function render() {
  /* No keys means one of two things and they need opposite treatment. Signing in has not
     finished, in which case painting a screen from an empty store would show an empty library
     that is about to be replaced. Or there is no vault at all because somebody followed a
     shared link, in which case there will never be keys and refusing to paint leaves them
     looking at nothing for ever — which is exactly what it did. */
  if (!keysReady() && !signedOut()) return;

  const waiting = upNextList(state.shows, cache.getMeta, opts()).length;
  /* A feed's name is the row it came from. Put here rather than drawn on the page so it lands
     in the bar with every other screen's, and so the document title says which feed too. */
  const feed = route.name === "feed" ? feedById(route.arg) : null;
  const titles = { next: "Up next", library: "Library", search: "Search", you: "You", stats: "Your year", show: "", movie: "", person: "", season: "", episode: "", feed: feed ? feed.title : "" };
  /* The show and film pages bleed their cover to the edges of the column, so they cap their own
     children instead of being capped as a whole. A film's cover is the same cover — it was left
     out of this and sat inset by the page gutter with bands either side, which reads as a bug
     rather than as a design. */
  const body = h("main.main", { class: ["show", "movie"].includes(route.name) ? "is-show" : null });

  setDocumentTitle(titles);

  // The show page has its own bar over the cover, so it takes no topbar at all.
  const top = route.name === "show" ? null : renderTopbar(titles[route.name]);

  /* A screen tapped into rather than navigated to. On a phone the tab bar comes off these:
     they carry a back button already, so the bar is a second way out of a screen that has
     one, and it costs a permanent 84px band on the longest scroll in the app. The rail stays
     on a desktop, where the room is free either way. */
  document.body.classList.toggle("no-nav", ["show", "movie", "person", "season", "episode", "stats", "feed"].includes(route.name));

  mount(app, renderTitlebar(), h("div.shell", [
    renderNav(["show", "movie", "person", "season", "episode"].includes(route.name) ? "library"
      : route.name === "stats" ? "you" : route.name === "feed" ? "search" : route.name,
    goTab, waiting),
    h("div.shell-main", [top ? top.bar : null, body]),
  ]));

  const ctx = { go, back, repaint: render, top };
  // Only on a change of screen, not on every repaint: a sync landing mid-decision must not
  // cancel a confirmation the user is in the middle of reading.
  if (route.name !== lastRoute) {
    closeOverlays();
    lastRoute = route.name;
  }
  if (route.name !== "show") stopBarWatch();
  if (route.name !== "library") stopIndexWatch();
  if (route.name === "share") {
    mount(body, h("div.empty", [h("div.spinner", { style: { margin: "0 auto" } })]));
    if (!resolvingShare) { resolvingShare = true; openShared().finally(() => { resolvingShare = false; }); }
  }
  else if (route.name === "library") renderLibrary(body, ctx);
  else if (route.name === "search") renderSearch(body, ctx);
  else if (route.name === "you") renderSettings(body, ctx);
  else if (route.name === "stats") renderStats(body, ctx);
  else if (route.name === "show") renderShow(body, route.arg, ctx);
  else if (route.name === "movie") renderMovie(body, route.arg, ctx);
  else if (route.name === "person") renderPerson(body, route.arg, ctx);
  else if (route.name === "season") renderSeason(body, route.arg, ctx);
  else if (route.name === "episode") renderEpisode(body, route.arg, ctx);
  else if (route.name === "feed") renderFeed(body, route.arg, ctx);
  else renderUpNext(body, ctx);
}

/* Installed, the window title is appended to the app's name, so repeating the brand there
   produced "nextly — TV show tracker - nextly". The app is called nextly; the title says
   where you are. In a browser tab the brand is added back, because "Library" on its own does
   not identify the tab among a dozen others. */
let lastRoute = null;
let resolvingShare = false;

// Nothing is animated where the API is absent, or where someone has asked for less motion.
/* The crossfade the View Transitions API gives for free, and nothing beyond it. Screens
   sliding in from a direction read as a phone app on a phone and as a wobble on a desktop,
   where the thing being slid is a metre wide. */
function transition(paint) {
  const ok = document.startViewTransition
    && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!ok) return paint();
  document.startViewTransition(() => paint());
}

function setDocumentTitle(titles) {
  const show = route.name === "show" ? findShow(state, route.arg) : null;
  // An untracked show isn't in the library, but the card it was opened from names it.
  const hint = !show && route.name === "show" ? cache.getHint(route.arg) : null;
  const where = show ? show.name : hint ? hint.name : titles[route.name] || "";
  document.title = !where ? "nextly" : isStandalone() ? where : `${where} · nextly`;
}

/* ---- a shared link ----
   Something was shared to the app from elsewhere. Whatever can be made of it is made here and
   then handed to the screen that deals with it: a show, or the search box. The URL is replaced
   rather than pushed, so Back from wherever this lands goes where the app was, not around this
   again. */
/* What was shared, from wherever it was left.

   Normally the service worker has it: it caught the share as it arrived, put it down, and
   sent the browser here with a clean address. That is the path that keeps the shared link on
   the device.

   The query string is read as a fallback, because /share?url=… is a perfectly good way in for
   anything that cannot use a share target — an iOS Shortcut, a bookmarklet, a typed address.
   Arriving that way does send the link to the server, and there is no way for it not to: it
   is in the address before this code exists. Worth having anyway, since it is the reader's
   own deliberate act rather than something the app arranged behind them. */
async function takeShared() {
  try {
    const drop = await caches.open("nextly-share-v1");
    const held = await drop.match("/__shared");
    if (held) {
      // Read once. A share left lying about would re-open itself on the next visit here.
      await drop.delete("/__shared");
      return await held.json();
    }
  } catch (e) {
    // No Cache API, or a worker that never ran: the query is the other way in.
  }
  const q = new URLSearchParams(location.search);
  return { title: q.get("title"), text: q.get("text"), url: q.get("url") };
}

async function openShared() {
  const found = parseShared(await takeShared());

  if (!found) return go("search", null, { replace: true });

  if (found.query) {
    // Nothing but a name: let the search screen do what it is for.
    presetSearch(found.query);
    return go("search", null, { replace: true });
  }

  if (found.src) {
    const key = showKey(found.src, found.ref);
    // Already tracked under another catalogue's numbering? Then that is the one to open.
    const held = findSameShow(state, { key });
    return go("show", held ? held.id : key, { replace: true });
  }

  // A portable id names the show but not the numbering, so the catalogue in use resolves it.
  const held = findSameShow(state, found);
  if (held) return go("show", held.id, { replace: true });
  try {
    const m = await meta.activeProvider().lookup(found);
    if (m) {
      await cache.putMeta(m);
      return go("show", m.key, { replace: true });
    }
  } catch (e) {
    // Falls through to the search box, which is the honest answer to "we could not find it".
  }
  toast("Couldn't work out which show that was.");
  go("search", null, { replace: true });
}

/* ---- boot ---- */

/* The screens worth opening without an account, listed rather than derived. DETAIL would have
   been the tempting test and it answers a different question — it means "names a thing in the
   fragment", which is also true of a discovery feed. What matters here is whether a screen
   makes sense to a stranger and needs nothing of theirs to draw. */
const SHAREABLE = new Set(["show", "movie", "person", "season", "episode"]);

/* Signed out, looking at one thing. The subset of sign-in that does not involve a key: the
   metadata cache so artwork survives a reload, the theme so it does not flash, and a render. No
   token is remembered, no keys are derived, and no vault is opened or created. */
async function browse(r) {
  applyTheme(readTheme());
  await cache.loadAll();
  document.body.classList.add("is-anon");
  route = r;
  setRepaint(render);
  render();
}


/* The vault is opened in two steps and the screen is drawn between them.

   The old order awaited the whole of bootVault, which ends in a request to /api/vault — so
   every launch on a phone held an empty page up for as long as a sleeping radio took to
   answer, with the finished library sitting in localStorage the entire time. Nothing about
   that request changes what is drawn in the common case: the merge usually brings nothing.

   The exception is a device with no copy of its own, where there genuinely is nothing to draw
   and an empty library would look like a lost one. That case, and only that case, still waits. */
async function signIn(token) {
  rememberToken(token);
  await deriveKeys(token);
  await cache.loadAll();
  const had = openLocal();
  if (!had) await syncVault();

  applyTheme(readTheme());
  // There is a vault now, so its local copy is worth asking the browser to keep.
  askToPersist();
  route = parseRoute(location.pathname, location.hash);
  render();
  // Metadata fills in behind the paint: the library already renders from cache, and each
  // result repaints as it lands.
  hydrateLibrary();

  /* And the sync, now that there is something on screen to correct. A repaint only when the
     merge actually changed something — the usual answer is that it did not, and redrawing a
     correct screen out from under somebody who has started reading it is its own bug. */
  if (had) {
    syncVault().then((changed) => {
      if (!changed) return;
      render();
      hydrateLibrary();
    }).catch(() => { /* loadServer reports offline itself; the local copy stands */ });
  }
}

async function boot() {
  setSyncReporter(setSync);
  // Data can arrive after boot — a sync on foregrounding, or a merge with another device —
  // and those shows need their metadata fetched too, not just a repaint.
  /* A merge can bring a theme with it, but only when the vault is the one holding it. The
     device store is written from here rather than in io/storage.js, because applying a theme
     is a thing the UI does and the io layer has no business reaching into it. */
  setDataListener(() => {
    const set = state.settings || {};
    if (set.themeSync && set.theme && set.theme !== readTheme()) applyTheme(set.theme);
    render();
    hydrateLibrary();
  });
  setRepaint(render);
  // beforeinstallprompt can arrive after boot; repaint so Settings picks it up.
  onInstallStateChange(() => { if (route.name === "you") render(); });

  suppressBrowserGestures();
  watchTitlebar();

  const token = rememberedToken();
  if (!token) {
    /* A link somebody sent opens the thing they sent, not a sign-up form.
   
       None of these four screens needs a vault: what they draw comes from the catalogue, which
       is fetched here in the browser. Demanding an account first would make a shared link a
       dead end and make the sender look like they had forwarded an advert — and it would waste
       the one moment when somebody is looking at the app because a friend told them to.
   
       Everything that writes is off. There is nowhere to write to. */
    const shared = parseRoute(location.pathname, location.hash);
    if (SHAREABLE.has(shared.name)) return browse(shared);

    applyTheme("auto");
    return renderGate(app, {
      onSignIn: async (t) => {
        try {
          await signIn(t);
        } catch (e) {
          toast("Couldn't open that vault — check the account number.");
        }
      },
    });
  }
  await signIn(token);
}

/* ---- installed, not browsed ----

   Two habits of a web page that read as browser inside an installed app: a long press offering
   to download or print, and a drag selecting the interface instead of moving it. Both are
   suppressed, and only when there is no address bar overhead — in a tab they are how the web
   works, and taking them away there would be rude.

   The exceptions are what someone would actually want the browser for: a link, a picture, a
   field they are typing in, and any text they have deliberately selected. Shift is left as the
   way out on a desktop, where right-click is a tool rather than an accident. */
const NATIVE_MENU_OK = 'a, img, video, audio, textarea, input, [contenteditable="true"]';

function suppressBrowserGestures() {
  if (!isStandalone()) return;
  document.body.classList.add("is-installed");

  addEventListener("contextmenu", (e) => {
    if (e.shiftKey) return;
    if (e.target.closest && e.target.closest(NATIVE_MENU_OK)) return;
    // Text someone has picked out: the menu is how they copy it.
    if (String(getSelection() || "").length) return;
    e.preventDefault();
  });

  /* Pinching. The stylesheet stops it where touch-action is honoured, which is most of
     Chromium; these cover the rest. Safari answers to the gesture events rather than to
     touch-action, a second finger arriving during a scroll starts a zoom on its own, and on a
     desktop the trackpad's pinch arrives as a wheel event holding ctrl.

     Not passive, because a listener that cannot call preventDefault cannot stop anything. */
  const stop = (e) => e.preventDefault();
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    addEventListener(type, stop, { passive: false });
  }
  addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
}

// Coming back to the tab is the moment another device's changes should appear.
addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !keysReady()) return;
  /* Only when the merge brought something. Repainting on every return rebuilt whatever was on
     screen — and a rebuilt screen throws its horizontal rows back to placeholders and refills
     them, which reads as a flinch each time the app is opened. Most returns change nothing:
     nobody else has touched the vault. */
  loadServer().then((changed) => {
    if (changed) { render(); hydrateLibrary(); }
  });
});

// A pending debounced save must not die with the tab.
addEventListener("pagehide", () => { if (keysReady()) flushSync(); });

// Follow the system theme live while the setting is on "auto".
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (readTheme() === "auto") applyTheme("auto");
});

/* ---- updates ----
   sw.js calls skipWaiting on install and clients.claim on activate, so a new build takes
   over as soon as it is found. Without the code below the running tab keeps executing the
   old JavaScript until something happens to reload it — which for an installed app can be
   days, and is why a deployed fix could sit there unseen.

   The guard matters: on a first install, skipWaiting and claim fire immediately and would
   otherwise look identical to an update, reloading the app the very first time it is opened.
   A worker already controlling the page at load means any worker found now is a real
   update. */
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let updating = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updating) location.reload();
  });

  addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      /* Shown while the new build downloads, which is the part worth showing: it takes as long
         as it takes, and the reload at the end of it is instant. Raising it at the reload
         instead meant it was created and then navigated away from in the same breath, so it
         was never actually seen.

         What made that seem like the safer place was a real fault — an install that never
         activates leaves this panel over the app, and it is opaque. That is handled here
         rather than by not showing it: a worker going redundant takes it down, and a backstop
         takes it down anyway if the install neither finishes nor reports. */
      reg.addEventListener("updatefound", () => {
        if (!hadController) return;      // first install, not an update
        updating = true;
        showUpdating();

        const worker = reg.installing;
        if (worker) {
          worker.addEventListener("statechange", () => {
            if (worker.state === "redundant") { updating = false; hideUpdating(); }
          });
        }
        setTimeout(() => {
          if (document.querySelector(".updating")) { updating = false; hideUpdating(); }
        }, 20000);
      });

      // An installed app rarely navigates, so the browser seldom re-checks sw.js by itself.
      // Ask on load and whenever it comes back to the foreground.
      const check = () => { try { reg.update(); } catch (e) {} };
      check();
      addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    }).catch(() => {});
  });
}

// Shown while a new build is downloading, and taken down again if that download never lands.
function hideUpdating() {
  const el = document.querySelector(".updating");
  if (el) el.remove();
}

/* The one screen the app puts up that is not about anybody's television, so it is the one
   place most at risk of looking like a different program. It is drawn in the app's own
   vocabulary instead: a barcode filling a tick at a time, the same picture the library draws
   for a show being watched and the same one the front page uses as its rule. */
function showUpdating() {
  if (document.querySelector(".updating")) return;
  document.body.append(
    h("div.updating", [
      h("div.brand", [h("i.brand-lamp.is-sync"), "nextly"]),
      h("div.updating-bar", { "aria-hidden": "true" }),
      h("div.updating-text", { role: "status", text: "Fetching a new version…" }),
    ]),
  );
}

boot();
