// What the preview environment must never share with production.
//
// Config rather than code, and tested for the same reason the CSP is: nothing here fails a
// build, nothing here throws, and every mistake shows up first in production. Wrangler's own
// dry run caught the routes one — after the comment in the file had confidently claimed the
// opposite — so it is worth a test that fails in CI rather than a habit of remembering to look.
//
// Read as text. There is no TOML parser in Node and this app has no dependencies, and the
// three facts worth asserting are all plainly visible in the source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const top = toml.slice(0, toml.indexOf("[env.preview]"));
const preview = toml.slice(toml.indexOf("[env.preview]"));

const idIn = (block) => {
  const m = block.match(/database_id\s*=\s*"([^"]+)"/);
  return m && m[1];
};

/* The whole point. A preview holding the production binding could enumerate account hashes and
   delete rows — the blobs stay ciphertext, but that is not the only thing worth protecting. */
test("a preview cannot reach the production database", () => {
  const live = idIn(top);
  const prev = idIn(preview);
  assert.ok(live, "production names a database");
  assert.ok(prev, "and so does the preview");
  assert.notEqual(prev, live, "and they are not the same one");
});

/* The load-bearing line, and the one that is not obvious: routes ARE inherited by a named
   environment, so without an empty list a preview deploy reassigns the custom domains away
   from production — which is the fault this repository has already had once. */
test("a preview claims no routes, however it is deployed", () => {
  assert.match(preview, /^routes\s*=\s*\[\s*\]\s*$/m,
    "env.preview must set routes = [] — inheriting them takes nextly.tv from production");
});

test("production still holds the custom domains", () => {
  for (const host of ["nextly.tv", "app.nextly.tv"]) {
    assert.ok(top.includes(`pattern = "${host}"`), `${host} is production's`);
  }
});

/* Not inherited, unlike routes, and each has its own failure: no assets block serves the API
   with no app behind it; no database answers every vault request with an error. */
test("a preview carries its own assets, since it inherits none", () => {
  assert.match(preview, /\[env\.preview\.assets\]/);
  assert.match(preview, /binding\s*=\s*"ASSETS"/);
});

test("both environments bind the database under the same name the Worker reads", () => {
  for (const [what, block] of [["production", top], ["preview", preview]]) {
    assert.match(block, /binding\s*=\s*"DB"/, `${what} binds DB`);
  }
});

/* Preview URLs are served from workers.dev and nowhere else, so this is what makes a preview
   reachable at all. On production it is the thing that made the subdomain exist. */
test("workers.dev is on, which is what preview URLs need", () => {
  assert.match(toml, /^workers_dev\s*=\s*true\s*$/m);
  assert.match(toml, /^preview_urls\s*=\s*true\s*$/m);
});
