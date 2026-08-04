// Bringing a session up without holding the screen hostage to the network.
//
// The screen is painted between the two halves of opening a vault, so what these check is the
// one fact that decision rests on: whether this device already has a copy worth showing.
import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../public/js/domain/store.js";

// storage.js reaches localStorage through a try/catch, so in Node it silently reads nothing.
// Give it a real one, since what is being tested is exactly what it finds there.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { openLocal, loadServer } = await import("../public/js/io/storage.js");
const { deriveKeys } = await import("../public/js/io/crypto.js");

const LIBRARY = {
  updatedAt: 1,
  settings: { provider: "tvmaze", m: 1 },
  shows: [{
    id: "tvmaze:169", src: "tvmaze", ref: 169, name: "Breaking Bad", year: 2008,
    st: "active", added: 1, m: 1, entries: [{ id: "1x1", m: 1 }],
  }],
};

test("a device with no copy of its own says so", () => {
  store.clear();
  assert.equal(openLocal(), false);
  assert.equal(state.shows.length, 0);
});

/* The point of the boolean. A new device signing in to an existing account has nothing to
   draw, and painting an empty library and filling it a second later reads as data loss to the
   person it happens to — so that case waits for the server and every other case does not. */
test("a device that has one says so, and the library is there to paint", () => {
  store.clear();
  store.set("nx_state", JSON.stringify(LIBRARY));
  assert.equal(openLocal(), true);
  assert.equal(state.shows.length, 1);
  assert.equal(state.shows[0].name, "Breaking Bad");
});

test("a corrupt local copy counts as no copy rather than throwing", () => {
  store.clear();
  store.set("nx_state", "{not json");
  assert.equal(openLocal(), false);
});

/* A connection that accepts the socket and then says nothing used to leave this waiting for as
   long as the browser would allow. Sync is the one thing here that can be abandoned safely. */
test("the vault request is abortable, and giving up is not an error", async () => {
  store.clear();
  await deriveKeys("1234-5678-9012-3456");
  let seen = null;
  const real = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    seen = opts;
    return Promise.reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
  };
  try {
    assert.equal(await loadServer(), null, "gives up quietly; the local copy stands");
    assert.ok(seen.signal, "the request carries a signal, so something can end it");
    assert.equal(typeof seen.signal.aborted, "boolean");
  } finally {
    globalThis.fetch = real;
  }
});
