// Which document a URL gets, and what every response is wrapped in.
//
// The vault contract is tested next door. This is the other half of the Worker: two sites on
// one script, a closed list of in-app routes, and the headers that make the browser enforce
// what the app assumes about itself. Both halves have failed silently before — a route added
// to the app but not here 404s only on a hard refresh, which is exactly the case nobody tries.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { INLINE_HASHES } from "../src/inline-hashes.js";

/* A stand-in for the assets binding that reports which file it was asked for, so a test can
   assert on the routing decision rather than on markup. */
const env = {
  DB: { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({}) }) }) },
  ASSETS: {
    async fetch(request) {
      const file = new URL(request.url).pathname;
      return new Response(`served:${file}`, {
        headers: { "content-type": file.endsWith(".html") ? "text/html" : "text/plain" },
      });
    },
  },
};

const get = (path, host = "app.nextly.tv") =>
  worker.fetch(new Request(`https://${host}${path}`), env);

const served = async (res) => (await res.text()).replace("served:", "");

/* ---- which document ---- */

test("the two hostnames get different documents at the root", async () => {
  assert.equal(await served(await get("/", "app.nextly.tv")), "/app.html");
  assert.equal(await served(await get("/", "nextly.tv")), "/index.html");
});

test("a preview deployment counts as the app", async () => {
  assert.equal(await served(await get("/", "nextly-tv.someone.workers.dev")), "/app.html");
});

test("both documents stay reachable on one hostname for local development", async () => {
  assert.equal(await served(await get("/app", "nextly.tv")), "/app.html");
  assert.equal(await served(await get("/site", "app.nextly.tv")), "/index.html");
  assert.equal(await served(await get("/app/", "nextly.tv")), "/app.html");
});

test("every in-app route boots the app document, so a hard refresh works", async () => {
  for (const p of ["/library", "/search", "/you", "/stats", "/share",
                   "/show", "/person", "/season", "/episode"]) {
    assert.equal(await served(await get(p)), "/app.html", `${p} should boot the app`);
  }
});

test("no path can carry a subject — an address that names a show is not a route", async () => {
  /* The route table holds exact paths and no prefixes, so there is no shape of address that
     could tell this server what somebody is watching. These are 404s, the same as any other
     unknown path, rather than the app shell. */
  for (const p of ["/show/tvmaze:169", "/person/42", "/season/tvmaze:169/2", "/episode/tvmaze:169/2/4"]) {
    const res = await get(p);
    assert.equal(res.status, 404, `${p} should not be a route`);
    assert.equal(await served(res), "/404.html");
  }
});

test("a trailing slash doesn't change which route it is", async () => {
  assert.equal(await served(await get("/library/")), "/app.html");
});

test("the legal pages are their own documents, not the app", async () => {
  assert.equal(await served(await get("/privacy", "nextly.tv")), "/privacy.html");
  assert.equal(await served(await get("/terms/", "nextly.tv")), "/terms.html");
});

test("an unknown path is a real 404 rather than the app shell", async () => {
  const res = await get("/librarry");
  assert.equal(res.status, 404);
  assert.equal(await served(res), "/404.html");
});

test("anything with an extension goes straight to the assets binding", async () => {
  assert.equal(await served(await get("/js/main.js")), "/js/main.js");
  assert.equal(await served(await get("/icons/icon-512.png")), "/icons/icon-512.png");
});

/* ---- a share that got past the service worker ---- */

const postShare = (body) =>
  worker.fetch(new Request("https://app.nextly.tv/share", { method: "POST", body }), env);

test("a posted share is redirected, not served, and its body is never read", async () => {
  const form = new FormData();
  form.set("url", "https://www.tvmaze.com/shows/169/breaking-bad");
  form.set("title", "Breaking Bad");
  const req = new Request("https://app.nextly.tv/share", { method: "POST", body: form });

  const res = await worker.fetch(req, env);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/share");
  // Nothing in the Worker consumed it, which is the assertion: a body left unread is a body
  // no code here was ever able to look at.
  assert.equal(req.bodyUsed, false, "the Worker must not read what was shared");
  assert.equal(await res.text(), "", "and must not echo it back either");
});

test("the redirect carries the baseline headers like everything else", async () => {
  const res = await postShare(new FormData());
  for (const name of BASE) assert.ok(res.headers.get(name), `missing ${name}`);
});

test("a share arriving with no body at all is still a redirect, not a crash", async () => {
  const res = await worker.fetch(
    new Request("https://app.nextly.tv/share", { method: "POST" }), env);
  assert.equal(res.status, 303);
});

test("GET /share still opens the app, which is where the redirect lands", async () => {
  assert.equal(await served(await get("/share")), "/app.html");
});

test("an unknown API path is JSON, not a document", async () => {
  const res = await get("/api/nothing");
  assert.equal(res.status, 404);
  assert.match(res.headers.get("content-type"), /application\/json/);
});

/* ---- what every response carries ---- */

const BASE = ["x-content-type-options", "referrer-policy", "permissions-policy"];

test("documents, assets and API responses all carry the baseline headers", async () => {
  for (const path of ["/", "/library", "/js/main.js", "/api/nothing", "/nope"]) {
    const res = await get(path);
    for (const name of BASE) {
      assert.ok(res.headers.get(name), `${path} is missing ${name}`);
    }
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  }
});

test("only documents carry a policy — a policy on a script would say nothing", async () => {
  assert.ok((await get("/library")).headers.get("content-security-policy"));
  assert.equal((await get("/js/main.js")).headers.get("content-security-policy"), null);
});

test("the app's policy names the catalogues it talks to and nothing else", async () => {
  const csp = (await get("/library")).headers.get("content-security-policy");
  assert.match(csp, /connect-src 'self' https:\/\/api\.themoviedb\.org https:\/\/api\.tvmaze\.com;/);
  assert.match(csp, /img-src 'self' data: https:\/\/image\.tmdb\.org https:\/\/static\.tvmaze\.com/);
});

test("the marketing side is allowed to reach nothing at all", async () => {
  const csp = (await get("/", "nextly.tv")).headers.get("content-security-policy");
  assert.match(csp, /connect-src 'self';/);
  assert.ok(!csp.includes("themoviedb"), "the site has no reason to talk to a catalogue");
  assert.match(csp, /img-src 'self' data:;/);
});

test("no policy admits inline or evaluated script", async () => {
  for (const path of ["/", "/library", "/privacy", "/nope"]) {
    const csp = (await get(path)).headers.get("content-security-policy");
    assert.ok(!csp.includes("unsafe-inline"), `${path} must not allow inline code`);
    assert.ok(!csp.includes("unsafe-eval"), `${path} must not allow eval`);
  }
});

test("the inline scripts each document needs are admitted by hash", async () => {
  const app = (await get("/library")).headers.get("content-security-policy");
  for (const hash of INLINE_HASHES["app.html"]) assert.ok(app.includes(hash));
  const site = (await get("/", "nextly.tv")).headers.get("content-security-policy");
  for (const hash of INLINE_HASHES["index.html"]) assert.ok(site.includes(hash));
});

test("everything not named is denied, including embedding this app in another page", async () => {
  const csp = (await get("/library")).headers.get("content-security-policy");
  assert.match(csp, /^default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /style-src 'self'/);
});

test("a document's status survives being hardened", async () => {
  const res = await get("/nope");
  assert.equal(res.status, 404);
  assert.ok(res.headers.get("content-security-policy"));
});
