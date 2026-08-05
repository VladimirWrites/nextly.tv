// nextly — Cloudflare Worker (static assets + API).
//
// Static files in ./public are served by the assets binding. The Worker runs first so it
// can own /api/* and route everything else to the single-page app.
//
// There is deliberately no metadata proxy here: the browser calls TMDB directly with the
// user's own API key, so the key never reaches this server and neither does the list of
// shows being looked up.
import { MAX_BLOB } from "../public/lib/limits.js";
import { INLINE_HASHES } from "./inline-hashes.js";

/* ---- headers every response carries ----

   The app's whole security argument is that the code running in the browser is the code we
   shipped: it holds the key, it does the decrypting, and nothing else is supposed to be in
   the page at all. These headers are what makes that a rule the browser enforces rather than
   a property the code happens to have.

   `nosniff` because a response typed as JSON should never be run as anything else.
   `no-referrer` because the paths in this app name shows someone is watching, and there is no
   third party that needs to know one was visited.
   The permissions list is everything the app has no business asking for; denying them up front
   means nothing it grows later can quietly start asking. */
const BASE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), " +
    "magnetometer=(), microphone=(), payment=(), usb=()",
};

/* The policy for a document. Everything is denied by default and then named back one source
   at a time, so a directive nobody thought about — a font host, an embedded frame, a ping —
   is refused rather than allowed.

   The two inline blocks the app needs are admitted by hash, generated from the files at build
   time. `script-src 'self'` with no 'unsafe-inline' and no 'unsafe-eval' is the important
   line: there is no way to introduce executable code into these pages short of changing what
   this server serves.

   Styles are 'self' alone, which is why neither document carries a style attribute — the
   handful they had were moved into the stylesheets to make this directive possible. */
const policy = (file, extra = {}) => [
  "default-src 'none'",
  `script-src 'self' ${(INLINE_HASHES[file] || []).join(" ")}`.trim(),
  "style-src 'self'",
  `img-src 'self' data:${extra.img ? " " + extra.img : ""}`,
  "font-src 'self'",
  `connect-src 'self'${extra.connect ? " " + extra.connect : ""}`,
  "manifest-src 'self'",
  "worker-src 'self'",
  // A link out is a navigation, not a fetch, so these stay narrow without breaking any of them.
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/* The app talks to two catalogues and shows their artwork. Both are named exactly, because
   the alternative — allowing any https image — would leave the one channel that could carry
   something out of the page open for no gain. */
const CSP_APP = policy("app.html", {
  /* Cinemeta is here for films, which TVmaze does not carry at all — it is a television
     database. Its artwork comes from two hosts it does not serve itself: metahub for its own
     posters, and Amazon's image CDN for the ones it takes from IMDb. Both have to be named, or
     the poster is the only part of a film that fails to arrive. */
  connect: "https://api.themoviedb.org https://api.tvmaze.com https://v3-cinemeta.strem.io",
  img: "https://image.tmdb.org https://static.tvmaze.com https://images.metahub.space https://m.media-amazon.com",
});

// The marketing side talks to nobody and shows only its own pictures.
const CSP_SITE = policy("index.html");

// Response objects from the assets binding are immutable, so hardening means rebuilding.
function harden(res, csp = null) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(BASE_HEADERS)) headers.set(k, v);
  if (csp) headers.set("content-security-policy", csp);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...BASE_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// ---------------------------------------------------------------------------
// /api/vault — zero-knowledge encrypted blob store keyed by account hash.
// The id travels in the X-Vault-Id header (GET/DELETE) or the body (PUT), never the URL,
// so it can't leak via access logs / Referer / browser history.
// GET    [X-Vault-Id: <hash>]  -> { blob, updated_at } | 404
// PUT    { id, blob, prev }    -> { ok: true, updated_at } | 409 { blob, updated_at }
// DELETE [X-Vault-Id: <hash>]  -> { ok: true }
//
// `prev` is the updated_at the client last reconciled with. If the stored row has moved on
// since, the write is refused with 409 and the current blob, and the client merges and
// retries. Two devices editing at once therefore converge instead of overwriting each other.
// ---------------------------------------------------------------------------
const ID_RE = /^[a-f0-9]{64}$/;          // SHA-256 hex
const CREATE_WINDOW_MS = 86_400_000;     // 24h rate-limit window for new-vault creation
const CREATE_LIMIT = 20;                 // max new vaults one IP can create per window

const vaultId = (request) => request.headers.get("X-Vault-Id");

async function vaultGet(request, env) {
  const id = vaultId(request);
  if (!id || !ID_RE.test(id)) return json({ error: "bad id" }, 400);
  const row = await env.DB.prepare(
    "SELECT blob, updated_at FROM vaults WHERE account_id = ?"
  ).bind(id).first();
  if (!row) return json({ error: "not found" }, 404);
  return json({ blob: row.blob, updated_at: row.updated_at });
}

async function vaultPut(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "bad json" }, 400); }

  const { id, blob, prev } = body || {};
  if (!id || !ID_RE.test(id)) return json({ error: "bad id" }, 400);
  if (typeof blob !== "string" || blob.length === 0 || blob.length > MAX_BLOB) {
    return json({ error: "bad blob" }, 400);
  }

  const existing = await env.DB.prepare(
    "SELECT blob, updated_at FROM vaults WHERE account_id = ?"
  ).bind(id).first();

  // Optimistic concurrency. A client that hasn't seen the current row — because another
  // device wrote after it last synced, or because it never managed to read at all — gets the
  // row back instead of overwriting it.
  if (existing && existing.updated_at !== prev) {
    return json({ error: "conflict", blob: existing.blob, updated_at: existing.updated_at }, 409);
  }

  // Only NEW-vault creation is rate-limited; updates to an existing vault are unlimited.
  // This caps how many rows a single IP can add, which is what stops table-stuffing.
  if (!existing) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const now = Date.now();
    const since = now - CREATE_WINDOW_MS;
    await env.DB.prepare("DELETE FROM create_log WHERE ts < ?").bind(since).run(); // expire old IPs
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM create_log WHERE ip = ? AND ts > ?").bind(ip, since).first();
    if ((c && c.n ? c.n : 0) >= CREATE_LIMIT) return json({ error: "rate limited" }, 429);
    await env.DB.prepare("INSERT INTO create_log (ip, ts) VALUES (?1, ?2)").bind(ip, now).run();
  }

  const updated_at = Date.now();
  await env.DB.prepare(
    `INSERT INTO vaults (account_id, blob, updated_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(account_id) DO UPDATE SET blob = ?2, updated_at = ?3`
  ).bind(id, blob, updated_at).run();

  return json({ ok: true, updated_at });
}

async function vaultDelete(request, env) {
  const id = vaultId(request);
  if (!id || !ID_RE.test(id)) return json({ error: "bad id" }, 400);
  await env.DB.prepare("DELETE FROM vaults WHERE account_id = ?").bind(id).run();
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (pathname === "/api/vault") {
      try {
        if (method === "GET") return await vaultGet(request, env);
        if (method === "PUT") return await vaultPut(request, env);
        if (method === "DELETE") return await vaultDelete(request, env);
        return json({ error: "method not allowed" }, 405);
      } catch (e) {
        return json({ error: "storage error" }, 500);
      }
    }

    if (pathname.startsWith("/api/")) return json({ error: "not found" }, 404);

    /* A share that got past the service worker.

       Sharing into the installed app posts here, and the service worker is supposed to catch
       it before it leaves the device — see the note in public/sw.js. It normally does: a
       share target only exists once the app is installed, and this worker claims its clients
       the moment it activates. But "normally" is not "always", and when it doesn't, the
       browser posts the body to us.

       The body is not read. It has already arrived, so not reading it un-sends nothing — the
       point is that no code here is ever able to look at what somebody shared, which is a
       stronger thing to be able to say than a promise not to. The redirect sends the browser
       to a clean /share, the app finds nothing waiting, and it opens the search screen. One
       share lost, rarely, in exchange for a capability that does not exist. */
    if (pathname === "/share" && method === "POST") {
      return new Response(null, { status: 303, headers: { ...BASE_HEADERS, location: "/share" } });
    }

    /* ---- host routing ----
       Two documents, split by hostname: the public site at nextly.tv, and the app itself at
       app.nextly.tv. They're separated because they have opposite jobs — one exists to be
       read by strangers and indexed, the other is a locked door with nothing to show.
       Keeping them apart means the app never has to carry marketing copy, and the site never
       has to load the app. */
    /* Every document leaves here with the policy that belongs to it, and every asset with the
       baseline. Chosen by which file is being served rather than by which path was asked for,
       so the several routes that all end at app.html cannot disagree about it. */
    const serve = async (file) => {
      const res = await env.ASSETS.fetch(new Request(new URL(file, url.origin), request));
      return harden(res, file === "/app.html" ? CSP_APP : CSP_SITE);
    };
    const host = url.hostname;
    const isAppHost = host.startsWith("app.") || host.endsWith(".workers.dev");

    // Path bridges, so both documents stay reachable on one hostname during local
    // development and on preview deployments.
    if (pathname === "/app" || pathname === "/app/") return serve("/app.html");
    if (pathname === "/site" || pathname === "/site/") return serve("/index.html");

    // Static pages. Listed before the SPA fallback, which would otherwise swallow them.
    const page = /^\/(privacy|terms)\/?$/.exec(pathname);
    if (page) return serve(`/${page[1]}.html`);

    if (pathname === "/" || pathname === "") return serve(isAppHost ? "/app.html" : "/index.html");

    // Anything with a file extension is a real asset. The assets binding 404s on its own if
    // it doesn't exist.
    if (pathname.slice(1).includes(".")) return harden(await env.ASSETS.fetch(request));

    // In-app routes boot the app document so a hard refresh on /library works. The set is
    // closed and known, so unknown paths get a real 404 rather than the app shell — a
    // catch-all here would turn every typo into a soft 404 and serve the app from the
    // marketing host. Allowed on any hostname, because locally there is only one.
    if (isAppRoute(pathname)) return serve("/app.html");

    const res = await serve("/404.html");
    return new Response(res.body, { status: 404, headers: res.headers });
  },
};

/* Every route main.js knows how to render. Kept next to the Worker because the two have to
   agree: a route added there without being added here would 404 on refresh.

   A closed set of exact paths, with no prefixes in it, and that is the point rather than a
   simplification. The four detail screens are bare — `/show`, never `/show/tmdb:67070` —
   because which show it is travels in the fragment, which a browser does not send. With no
   prefix matching here there is no shape of address that could carry a subject to this server
   even if something upstream tried: `/show/anything` is simply not a route, and gets the same
   404 as any other unknown path. See the routing note in public/js/domain/routes.js. */
const APP_ROUTES = new Set([
  "/library", "/search", "/you", "/stats", "/share",
  "/show", "/movie", "/person", "/season", "/episode", "/feed",
]);

const isAppRoute = (p) => APP_ROUTES.has(p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p);
