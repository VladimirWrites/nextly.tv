// The vault API contract. The Worker never sees plaintext, so the only things it can get
// wrong are the ones tested here: who may write, and whether a write can clobber.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { MAX_BLOB } from "../public/lib/limits.js";

const ID = "a".repeat(64);
const ID2 = "b".repeat(64);

// A stand-in for D1: just enough SQL dispatch to exercise the routes.
function fakeDB() {
  const vaults = new Map();
  const createLog = [];
  const prepare = (sql) => {
    let args = [];
    const api = {
      bind: (...a) => { args = a; return api; },
      async first() {
        if (sql.includes("SELECT blob, updated_at FROM vaults")) return vaults.get(args[0]) || null;
        if (sql.includes("COUNT(*) AS n FROM create_log")) {
          return { n: createLog.filter((r) => r.ip === args[0] && r.ts > args[1]).length };
        }
        return null;
      },
      async run() {
        if (sql.startsWith("INSERT INTO vaults")) vaults.set(args[0], { blob: args[1], updated_at: args[2] });
        else if (sql.startsWith("DELETE FROM vaults")) vaults.delete(args[0]);
        else if (sql.startsWith("INSERT INTO create_log")) createLog.push({ ip: args[0], ts: args[1] });
        else if (sql.startsWith("DELETE FROM create_log")) {
          for (let i = createLog.length - 1; i >= 0; i--) if (createLog[i].ts < args[0]) createLog.splice(i, 1);
        }
        return { success: true };
      },
    };
    return api;
  };
  return { DB: { prepare }, _vaults: vaults, _createLog: createLog };
}

const req = (method, body, headers = {}) =>
  new Request("https://x.test/api/vault", {
    method,
    headers: { "content-type": "application/json", "CF-Connecting-IP": "1.2.3.4", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("GET on a vault that doesn't exist is 404, not an error", async () => {
  const env = fakeDB();
  const r = await worker.fetch(req("GET", undefined, { "X-Vault-Id": ID }), env);
  assert.equal(r.status, 404);
});

test("a first PUT creates the vault and returns its updated_at", async () => {
  const env = fakeDB();
  const r = await worker.fetch(req("PUT", { id: ID, blob: "iv.ct", prev: null }), env);
  assert.equal(r.status, 200);
  const { ok, updated_at } = await r.json();
  assert.equal(ok, true);
  assert.ok(updated_at > 0);
  assert.equal(env._vaults.get(ID).blob, "iv.ct");
});

test("a stored blob reads back over GET", async () => {
  const env = fakeDB();
  await worker.fetch(req("PUT", { id: ID, blob: "iv.ct", prev: null }), env);
  const r = await worker.fetch(req("GET", undefined, { "X-Vault-Id": ID }), env);
  const body = await r.json();
  assert.equal(body.blob, "iv.ct");
});

test("a PUT with a stale prev is refused and hands back the current blob", async () => {
  const env = fakeDB();
  const first = await worker.fetch(req("PUT", { id: ID, blob: "one", prev: null }), env);
  const { updated_at } = await first.json();

  const stale = await worker.fetch(req("PUT", { id: ID, blob: "two", prev: updated_at - 1 }), env);
  assert.equal(stale.status, 409, "a device that hasn't seen the latest write must not overwrite it");
  const conflict = await stale.json();
  assert.equal(conflict.blob, "one");
  assert.equal(env._vaults.get(ID).blob, "one", "the refused write left the row untouched");
});

test("a PUT that omits prev against an existing vault is refused", async () => {
  const env = fakeDB();
  await worker.fetch(req("PUT", { id: ID, blob: "one", prev: null }), env);
  const r = await worker.fetch(req("PUT", { id: ID, blob: "two", prev: null }), env);
  assert.equal(r.status, 409, "a client that never read the row can't be allowed to replace it");
});

test("a PUT carrying the current updated_at succeeds", async () => {
  const env = fakeDB();
  const first = await worker.fetch(req("PUT", { id: ID, blob: "one", prev: null }), env);
  const { updated_at } = await first.json();
  const r = await worker.fetch(req("PUT", { id: ID, blob: "two", prev: updated_at }), env);
  assert.equal(r.status, 200);
  assert.equal(env._vaults.get(ID).blob, "two");
});

test("ids that aren't SHA-256 hex are rejected", async () => {
  const env = fakeDB();
  for (const id of ["", "xyz", "A".repeat(64), "a".repeat(63), "a".repeat(65)]) {
    const put = await worker.fetch(req("PUT", { id, blob: "x", prev: null }), env);
    assert.equal(put.status, 400, `PUT accepted a bad id: ${id}`);
    const get = await worker.fetch(req("GET", undefined, { "X-Vault-Id": id }), env);
    assert.equal(get.status, 400, `GET accepted a bad id: ${id}`);
  }
});

test("an oversized or empty blob is rejected", async () => {
  const env = fakeDB();
  const big = await worker.fetch(req("PUT", { id: ID, blob: "x".repeat(MAX_BLOB + 1), prev: null }), env);
  assert.equal(big.status, 400);
  const empty = await worker.fetch(req("PUT", { id: ID, blob: "", prev: null }), env);
  assert.equal(empty.status, 400);
});

test("a malformed body is rejected rather than crashing the route", async () => {
  const env = fakeDB();
  const r = await worker.fetch(
    new Request("https://x.test/api/vault", { method: "PUT", headers: { "content-type": "application/json" }, body: "{not json" }),
    env,
  );
  assert.equal(r.status, 400);
});

test("creating vaults is rate-limited per IP, and updates are not", async () => {
  const env = fakeDB();
  for (let i = 0; i < 20; i++) {
    const id = i.toString(16).padStart(64, "0");
    const r = await worker.fetch(req("PUT", { id, blob: "x", prev: null }), env);
    assert.equal(r.status, 200, `create ${i} should be allowed`);
  }
  const blocked = await worker.fetch(req("PUT", { id: ID2, blob: "x", prev: null }), env);
  assert.equal(blocked.status, 429);

  // An existing vault keeps taking writes — the limit is on new rows, not on saving.
  const existing = env._vaults.get("0".repeat(64));
  const update = await worker.fetch(req("PUT", { id: "0".repeat(64), blob: "y", prev: existing.updated_at }), env);
  assert.equal(update.status, 200);
});

test("DELETE removes the row", async () => {
  const env = fakeDB();
  await worker.fetch(req("PUT", { id: ID, blob: "x", prev: null }), env);
  const r = await worker.fetch(req("DELETE", undefined, { "X-Vault-Id": ID }), env);
  assert.equal(r.status, 200);
  assert.equal(env._vaults.has(ID), false);
});

test("unsupported methods and unknown API paths are refused", async () => {
  const env = fakeDB();
  const post = await worker.fetch(req("POST", { id: ID, blob: "x" }), env);
  assert.equal(post.status, 405);
  const unknown = await worker.fetch(new Request("https://x.test/api/nope"), env);
  assert.equal(unknown.status, 404);
});

test("no response carries a cache header that would let a vault be stored", async () => {
  const env = fakeDB();
  await worker.fetch(req("PUT", { id: ID, blob: "x", prev: null }), env);
  const r = await worker.fetch(req("GET", undefined, { "X-Vault-Id": ID }), env);
  assert.equal(r.headers.get("cache-control"), "no-store");
});
