// Keep the service worker's cache name — and the version the app shows — in step with
// package.json.
//
// The cache name is what makes a deploy reach people: the worker deletes every cache that
// isn't the current one on activate, so a stale name means users keep the old app forever.
// Tying it to the version means bumping the version is the whole release ritual.
//
// Run by `npm version`, so it can't be forgotten.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const swPath = new URL("../public/sw.js", import.meta.url);
const sw = readFileSync(swPath, "utf8");

const next = sw.replace(/const VERSION = "v[^"]*";/, `const VERSION = "v${pkg.version}";`);
if (next === sw && !sw.includes(`const VERSION = "v${pkg.version}";`)) {
  console.error("sync-version: could not find the VERSION line in public/sw.js");
  process.exit(1);
}

/* The module list is generated from what is actually on disk rather than kept by hand.

   Every one of these has to be in the cache for the app to open with no network — main.js
   imports the lot, and one missing file is a blank screen rather than a missing feature. Kept
   by hand it drifted: eleven modules written over the past week were never added, so offline
   had been quietly broken for days. A list nobody has to remember cannot fall behind. */
const jsFiles = [];
const walk = (dir, base) => {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const here = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) walk(here, `${base}${entry.name}/`);
    else if (entry.name.endsWith(".js")) jsFiles.push(`${base}${entry.name}`);
  }
};
walk(new URL("../public/js/", import.meta.url), "/js/");
walk(new URL("../public/lib/", import.meta.url), "/lib/");

// main.js first, so the list reads as the entry point and everything it pulls in.
jsFiles.sort((a, b) => (a === "/js/main.js" ? -1 : b === "/js/main.js" ? 1 : a.localeCompare(b)));

/* Matched first and replaced second, because "the file did not change" and "the list is not
   there" are not the same thing — and a script that treats the first as a failure breaks every
   release where the modules happen to be unchanged. */
const LIST = /(\/\/ The ES-module graph[\s\S]*?\n)(  "\/(?:js|lib)\/[\s\S]*?)(\n\];)/;
if (!LIST.test(next)) {
  console.error("sync-version: could not find the module list in public/sw.js");
  process.exit(1);
}
const listed = next.replace(LIST, (_, head, __, tail) =>
  head + jsFiles.map((f) => `  "${f}",`).join("\n") + tail);

writeFileSync(swPath, listed);

/* And a module the app itself can read. Android shows "Version 1" for an installed PWA — that
   is the wrapper Chrome mints around it, versioned by Chrome, with no manifest field to set —
   so the only place the real one can appear is inside the app. Worth having: two devices
   disagreeing turned out to be two devices running different builds, and there was no way to
   see that from either of them. */
const versionPath = new URL("../public/js/version.js", import.meta.url);
writeFileSync(versionPath,
  `// Written by scripts/sync-version.mjs from package.json. Do not edit.\n` +
  `export const VERSION = "${pkg.version}";\n`);

/* ---- inline script hashes, for the Content-Security-Policy ----

   The policy names 'self' and nothing else, which would also refuse the two inline blocks the
   documents genuinely need: the theme bootstrap, which has to run before first paint or the
   page flashes the wrong colour, and the structured-data block on the marketing page. A CSP
   accepts an inline script whose SHA-256 it was given, so the hashes are taken from the files
   themselves at build time.

   Taken from disk rather than written down, for the same reason as the module list above: a
   hash copied by hand is a hash that stops matching the moment the script is edited, and the
   symptom — a page that boots in the wrong theme, only in production — is a bad afternoon. */
const HTML = ["app.html", "index.html"];
const INLINE = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
const hashes = {};
for (const file of HTML) {
  const html = readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
  hashes[file] = [...html.matchAll(INLINE)]
    .map((m) => `'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
}

writeFileSync(new URL("../src/inline-hashes.js", import.meta.url),
  `// Written by scripts/sync-version.mjs from the documents in public/. Do not edit.\n` +
  `export const INLINE_HASHES = ${JSON.stringify(hashes, null, 2)};\n`);

const hashCount = Object.values(hashes).reduce((n, list) => n + list.length, 0);
console.log(`sync-version: v${pkg.version} — cache name, app version, ${jsFiles.length} modules precached, ${hashCount} inline scripts hashed`);
