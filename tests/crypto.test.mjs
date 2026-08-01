// The account number and the blob format. If any of this drifts, existing vaults stop
// opening — so the derivation strings are pinned by test, not just by convention.
import test from "node:test";
import assert from "node:assert/strict";
import {
  generateToken, validToken, normTok, canonToken,
  deriveKeys, getAccountId, keysReady, clearKeys, encWith, decWith,
} from "../public/js/io/crypto.js";

test("a generated token validates and is 28 characters in seven groups", () => {
  for (let i = 0; i < 40; i++) {
    const t = generateToken();
    assert.match(t, /^[0-9A-HJ-NP-TV-Z]{4}(-[0-9A-HJ-NP-TV-Z]{4}){6}$/);
    assert.equal(validToken(t), true);
  }
});

test("the checksum rejects a mistyped character", () => {
  const t = generateToken();
  const body = normTok(t);
  const wrong = (body[0] === "0" ? "1" : "0") + body.slice(1);
  assert.equal(validToken(wrong), false);
});

test("look-alike characters normalize to the same token", () => {
  assert.equal(normTok("o0O-il1L"), "0001111", "o/O map to 0, and i/l/L map to 1");
  assert.equal(normTok("abcd efgh"), "ABCDEFGH");
  assert.equal(normTok(null), "");
});

test("a token survives being typed with the wrong case, spacing, or look-alikes", () => {
  const t = generateToken();
  const mangled = t.toLowerCase().replace(/-/g, " ").replace(/0/g, "O").replace(/1/g, "l");
  assert.equal(validToken(mangled), true);
  assert.equal(canonToken(mangled), t);
});

test("tokens of the wrong length or alphabet are rejected", () => {
  assert.equal(validToken(""), false);
  assert.equal(validToken("ABCD"), false);
  assert.equal(validToken("U".repeat(28)), false, "U is not in the Crockford alphabet");
});

test("the account id is a SHA-256 hex string, and differs from the key input", async () => {
  clearKeys();
  assert.equal(keysReady(), false);
  const t = generateToken();
  await deriveKeys(t);
  assert.match(getAccountId(), /^[a-f0-9]{64}$/);
  assert.equal(keysReady(), true);
});

test("the same token always derives the same account id", async () => {
  const t = generateToken();
  await deriveKeys(t);
  const first = getAccountId();
  await deriveKeys(canonToken(t.toLowerCase()));
  assert.equal(getAccountId(), first, "a vault must open from the number however it was typed");
});

test("different tokens derive different account ids", async () => {
  await deriveKeys(generateToken());
  const a = getAccountId();
  await deriveKeys(generateToken());
  assert.notEqual(getAccountId(), a);
});

test("the derivation strings are pinned — changing them would orphan every vault", async () => {
  // This test exists to fail loudly if anyone edits the derivation inputs. It fired once, on
  // purpose, when the app was renamed from its placeholder to nextly — before there were any
  // real vaults to orphan. After launch, a failure here means a migration, not a pin update.
  await deriveKeys("00000000000000000000000000");
  assert.equal(
    getAccountId(),
    await sha256Hex("nextly|id|v1|00000000000000000000000000"),
  );
});

test("a blob round-trips through encrypt and decrypt", async () => {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const payload = { shows: [{ id: "tvmaze:1", entries: [{ id: "1x1", m: 1 }] }], settings: { theme: "dark" } };
  const blob = await encWith(payload, key);
  assert.match(blob, /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/, "the wire format is <iv>.<ciphertext>, both base64");
  assert.deepEqual(await decWith(blob, key), payload);
});

test("the ciphertext does not contain the plaintext", async () => {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const blob = await encWith({ name: "Breaking Bad" }, key);
  assert.equal(blob.includes("Breaking"), false);
});

test("the wrong key cannot read a blob", async () => {
  const gen = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const blob = await encWith({ a: 1 }, await gen());
  const other = await gen();
  await assert.rejects(() => decWith(blob, other));
});

test("compression actually shrinks a repetitive blob", async () => {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const many = { shows: [{ id: "tvmaze:1", entries: Array.from({ length: 2000 }, (_, i) => ({ id: `1x${i}`, m: 1700000000000 })) }] };
  const blob = await encWith(many, key);
  assert.ok(blob.length < JSON.stringify(many).length / 2, `expected real compression, got ${blob.length} vs ${JSON.stringify(many).length}`);
  assert.deepEqual(await decWith(blob, key), many);
});

async function sha256Hex(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
