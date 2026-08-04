// What leaves the app in an export.
//
// The file is a backup first, so it carries credentials by default. It is also plaintext, and
// people are told they can hand it to something else — so leaving them out has to be one
// switch away rather than a rewrite.
import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../public/js/domain/store.js";
import { exportJSON } from "../public/js/io/storage.js";

const NOW = 1_700_000_000_000;

function library() {
  state.settings = { provider: "tvmaze", tmdbKey: "TMDB-KEY", specials: true, m: 1 };
  state.shows = [{
    id: "tvmaze:169", src: "tvmaze", ref: 169, name: "Breaking Bad", year: 2008,
    imdb: "tt0903747", tvdb: 81189, st: "active", added: NOW, m: NOW,
    entries: [{ id: "1x1", m: NOW }],
  }];
}

test("an export carries the key by default, because it is a backup", () => {
  library();
  const out = JSON.parse(exportJSON());
  assert.equal(out.settings.tmdbKey, "TMDB-KEY");
  assert.equal(out.shows.length, 1);
  assert.equal(out.shows[0].entries.length, 1);
});

test("and leaves it out when asked, without taking the rest of settings with it", () => {
  library();
  const raw = exportJSON({ keys: false });
  assert.ok(!raw.includes("TMDB-KEY"), "the key is gone from the text, not merely from a field");
  const out = JSON.parse(raw);
  assert.equal(out.settings.tmdbKey, undefined);
  assert.equal(out.settings.specials, true, "settings that are not secrets stay");
  assert.equal(out.settings.provider, "tvmaze");
  assert.equal(out.shows[0].entries.length, 1, "and the history it exists for is untouched");
});

/* The bug this would have been: building the export by deleting from the live settings rather
   than from a copy. It would have signed the reader out of their own catalogue as a side
   effect of pressing Export. */
test("stripping keys does not damage the state it copied from", () => {
  library();
  exportJSON({ keys: false });
  assert.equal(state.settings.tmdbKey, "TMDB-KEY");
  exportJSON({ keys: false });
  assert.equal(state.settings.tmdbKey, "TMDB-KEY", "and still not on the second go");
});

/* Anything credential-shaped, not only the field that exists today. The `sync` block is
   reserved for connected accounts and is stripped whether or not anything writes to it yet — a
   credential that outlives someone remembering to add it here is the expensive kind. */
test("a credential added later is stripped too", () => {
  library();
  state.settings.sync = { someService: { token: "LIVE-TOKEN" } };
  const raw = exportJSON({ keys: false });
  assert.ok(!raw.includes("LIVE-TOKEN"));
  assert.equal(JSON.parse(raw).settings.sync, undefined);
  assert.equal(state.settings.sync.someService.token, "LIVE-TOKEN", "the live copy is untouched");
});

test("the file still says what it is, either way", () => {
  library();
  for (const keys of [true, false]) {
    const out = JSON.parse(exportJSON({ keys }));
    assert.equal(out.app, "nextly");
    assert.ok(out.exported, "and when it was made");
  }
});
