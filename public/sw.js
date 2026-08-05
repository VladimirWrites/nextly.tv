/* nextly — service worker.
 *
 * Registered only by the app document, so its scope is the app host. The public site at
 * nextly.tv is plain HTML and deliberately has no service worker at all.
 *
 * Offline is a correctness feature here, not a nicety: your watch history lives on the
 * device, so the app should open and keep working on a train. The episode metadata comes
 * from IndexedDB, and this file makes sure the code that reads it is there too.
 *
 * /api/* is NEVER cached. The vault must always be live — a stale blob merged as if it were
 * current is exactly how you lose data.
 */
const VERSION = "v1.5.2";
const SHELL = "nextly-shell-" + VERSION;
const ART = "nextly-art-v1";          // catalogue posters, kept across shell upgrades
const ART_MAX = 400;

/* Where a share is put down between arriving and being read. Kept across shell upgrades for
   the same reason the artwork is: a share landing during an update should survive it. */
const DROP = "nextly-share-v1";
const DROP_URL = "/__shared";

const FILES = [
  "/",
  "/app.html",
  "/css/base.css",
  "/css/app.css",
  "/fonts/archivo-latin.woff2",
  "/site.webmanifest",
  // Every icon an install can ask for. The maskable one is what Android launchers actually
  // use, and leaving it out meant it was only ever cached opportunistically by the
  // stale-while-revalidate handler — so a stale copy could outlive an icon change.
  "/assets/favicon.svg",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/icon-maskable-512.png",
  "/assets/apple-touch-icon.png",
  // The ES-module graph. main.js imports all of these, so every one has to be present for
  // the app to boot with no network.
  "/js/main.js",
  "/js/domain/constants.js",
  "/js/domain/dates.js",
  "/js/domain/discover.js",
  "/js/domain/external.js",
  "/js/domain/labels.js",
  "/js/domain/merge.js",
  "/js/domain/model.js",
  "/js/domain/progress.js",
  "/js/domain/routes.js",
  "/js/domain/schedule.js",
  "/js/domain/schema.js",
  "/js/domain/scores.js",
  "/js/domain/share.js",
  "/js/domain/stats.js",
  "/js/domain/store.js",
  "/js/domain/trakt-export.js",
  "/js/io/cache.js",
  "/js/io/crypto.js",
  "/js/io/discover.js",
  "/js/io/import-feed.js",
  "/js/io/meta.js",
  "/js/io/providers/cinemeta.js",
  "/js/io/providers/tmdb.js",
  "/js/io/providers/tvmaze.js",
  "/js/io/storage.js",
  "/js/io/zip.js",
  "/js/ui/actions.js",
  "/js/ui/anon.js",
  "/js/ui/barcode.js",
  "/js/ui/celebrate.js",
  "/js/ui/chart.js",
  "/js/ui/detail.js",
  "/js/ui/discover.js",
  "/js/ui/dom.js",
  "/js/ui/feed.js",
  "/js/ui/gate.js",
  "/js/ui/library.js",
  "/js/ui/movie.js",
  "/js/ui/overlay.js",
  "/js/ui/person.js",
  "/js/ui/search.js",
  "/js/ui/settings.js",
  "/js/ui/share-button.js",
  "/js/ui/shell.js",
  "/js/ui/show-parts.js",
  "/js/ui/show-preview.js",
  "/js/ui/show-seasons.js",
  "/js/ui/show.js",
  "/js/ui/stats.js",
  "/js/ui/trail.js",
  "/js/ui/trakt-import.js",
  "/js/ui/upnext.js",
  "/js/ui/viewstate.js",
  "/js/version.js",
  "/lib/limits.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      // Added one by one: a single 404 in addAll aborts the whole install and leaves the
      // app with no offline copy at all.
      .then((c) => Promise.all(FILES.map((f) => c.add(f).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== ART && k !== DROP).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

// On localhost, stay out of the way entirely. Stale-while-revalidate is right in production
// and maddening while editing, where every change would take two reloads to appear.
const DEV = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

/* ---- a share, caught before it can leave the device ----

   Sharing into an installed app is a navigation, because that is the only entry point the
   Web Share Target API has: the manifest names a URL, and the browser opens the app at it
   with the payload attached. There is no event that hands a payload to running code.

   A navigation is a fetch, though, and this is the fetch handler — so the request never has
   to reach the network. It is answered here: the payload is put down in a cache the page can
   read, and the browser is sent on to a clean address.

   Without this, whatever you shared — usually a URL naming the show — would be posted to the
   server, which has no business seeing it. Nothing there would have stored it, but not being
   stored and not being sent are different promises, and only one of them is a fact.

   The manifest asks for POST with multipart/form-data, so the payload is a body rather than a
   query string. That keeps it out of the address bar and out of on-device history too. */
async function takeShare(req) {
  try {
    const form = await req.formData();
    const shared = {
      title: form.get("title") || "",
      text: form.get("text") || "",
      url: form.get("url") || "",
    };
    const drop = await caches.open(DROP);
    await drop.put(DROP_URL, new Response(JSON.stringify(shared), {
      headers: { "content-type": "application/json" },
    }));
  } catch (err) {
    // A share we cannot read is a share the app opens empty, which is the search screen. It
    // is not a reason to fail the navigation and leave the reader looking at an error.
  }
  // 303, so the browser follows it as a GET and the POST leaves no place in history.
  return Response.redirect("/share", 303);
}

self.addEventListener("fetch", (e) => {
  if (DEV) return;
  const req = e.request;
  const url = new URL(req.url);

  // Before the GET guard below, because this is the one request here that isn't one.
  if (req.method === "POST" && url.origin === location.origin && url.pathname === "/share") {
    e.respondWith(takeShare(req));
    return;
  }

  if (req.method !== "GET") return;

  // Catalogue artwork: immutable once published, and the slowest thing on the page. Cache
  // first, with a rough cap so a big library can't grow without bound.
  if (url.hostname === "static.tvmaze.com" || url.hostname === "image.tmdb.org") {
    e.respondWith(cacheFirstArt(req));
    return;
  }

  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  /* The landing after a share, and any other arrival at /share. Answered from the cached
     shell without asking the network, because the address may still be carrying what was
     shared — the redirect above strips it, but an iOS Shortcut or a hand-typed link can put
     it in the query, and that is the one navigation that must not go out.

     A deploy therefore reaches this screen one load later than the others. Sharing into the
     app is not where anyone notices a version. */
  if (req.mode === "navigate" && url.pathname === "/share") {
    e.respondWith(caches.match("/app.html").then((hit) => hit || fetch("/app.html")));
    return;
  }

  // Navigations: network first, so a deploy lands on the next load; the cached shell answers
  // when there's no network.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/app.html", copy));
          return res;
        })
        .catch(() => caches.match("/app.html").then((hit) => hit || caches.match("/"))),
    );
    return;
  }

  // Static assets: stale-while-revalidate. One load may pair fresh HTML with a just-stale
  // module; acceptable here, and everything catches up by the next load.
  e.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    }),
  );
});

async function cacheFirstArt(req) {
  const cache = await caches.open(ART);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      cache.put(req, res.clone());
      trim(cache);
    }
    return res;
  } catch (e) {
    return hit || Response.error();
  }
}

// Oldest-first eviction. Crude, but posters are interchangeable — the cost of dropping one
// is a single re-download.
async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= ART_MAX) return;
  await Promise.all(keys.slice(0, keys.length - ART_MAX).map((k) => cache.delete(k)));
}
