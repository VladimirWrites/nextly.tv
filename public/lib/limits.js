// Shared limits used by both the client (pre-push size check in io/storage.js) and the
// Cloudflare Worker (server-side validation in src/index.js), so the ceiling can't drift.
//
// A watch mark is ~30 bytes of JSON before gzip. 500 shows x 100 episodes is ~1.5 MB raw,
// which gzips to roughly 150 KB and base64s to ~200 KB — so this ceiling leaves a lot of
// headroom while still bounding what a single row can cost.
export const MAX_BLOB = 900_000;
