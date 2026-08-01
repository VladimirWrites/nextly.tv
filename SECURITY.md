# Security

nextly claims that the server cannot read your watch history. This document says exactly
what that means, what it does not cover, and where to report a break.

## Reporting a vulnerability

Email **write@vladimirj.dev**. Please include enough detail to reproduce it. You should get
a reply within a week; if you do not, assume the mail went astray and send it again.

Please do not open a public issue for anything that would let someone else read a vault.
Anything that only affects the person running the app — a rendering bug, a broken link — is
fine as a normal issue.

There is no bounty. This is a personal project given away for free, and pretending otherwise
would be dishonest.

## What the server holds

One row per account:

| Column | Contents |
| --- | --- |
| `account_id` | `SHA-256("nextly\|id\|v1\|" + account number)`, hex |
| `blob` | `base64(iv) + "." + base64(AES-GCM ciphertext)` |
| `updated_at` | epoch millis of the last write |

Plus a separate `create_log` of IP addresses used only to rate-limit account creation, with
rows older than 24 hours deleted on every create. It is not linked to any account.

That is the whole of it. There is no email address, no password, no username, no analytics
and no cookies.

The server is also never told which shows you look at, and that takes two things rather than
one. Metadata is fetched by the browser straight from the catalogue, so those requests do not
pass through here. And the four screens that name something specific — a show, a person, a
season, an episode — keep the name in the URL's *fragment*, which is the one part a browser
never transmits: `/show#tmdb:67070` arrives here as a request for `/show`.

### Sharing into the app

The Web Share Target API has no way to hand a payload to running code: the manifest names a
URL, and sharing *navigates* the app to it. So a share is a request, and a request is
something that can leave the device.

It doesn't. The manifest asks for `POST` with `multipart/form-data`, so what you shared is a
body rather than a query string, and the service worker answers that navigation itself —
reading the body, putting it in a cache the page reads once, and redirecting to a clean
`/share`. Nothing goes to the network. Verified against a running server: sharing a TVmaze
link produces no request for `/share` at all, neither the `POST` nor the redirect that
follows it.

Two residual paths, both narrow:

- If the service worker somehow isn't controlling, the browser posts to the origin. The
  Worker replies `303` **without reading the body** — the bytes reached the edge and nothing
  can un-send them, but no code on the server is capable of looking at them. The share is
  lost and the app opens the search screen, which is the right trade.
- `/share?url=…` still works as a plain link, for anything that can't use a share target — an
  iOS Shortcut, a bookmarklet. That does put the link in the URL, and cannot not: it is in
  the address before any of our code exists. It is a deliberate act by the reader rather than
  something the app arranged on their behalf.

## How the key is derived

The account number is the only credential: 128 bits from `crypto.getRandomValues`, encoded
as 26 Crockford-style base32 characters plus a 2-character checksum.

Two values are derived from it, from **different input strings**:

- **Account id** — `SHA-256("nextly|id|v1|" + token)`. A storage label, nothing more.
- **Vault key** — `PBKDF2-HMAC-SHA256` over `"nextly|key|v1|" + token`, 310,000 iterations,
  salt `"nextly|salt|v1|" + token`, producing an AES-GCM-256 key.

The separate prefixes are the point: the id the server stores is not a prefix, truncation or
weakening of the key input, so possessing every row in the database gets you no closer to any
key.

State is `JSON.stringify`'d, gzipped, then encrypted with a fresh 12-byte random IV per
write. Compression happens before encryption because ciphertext does not compress; reads
detect gzip by its magic bytes, so blobs written before compression existed still open.

### About the salt

The PBKDF2 salt is derived from the token rather than random. This is deliberate and worth
being explicit about, because a deterministic salt is normally a red flag.

A salt exists to stop one precomputed table attacking many users at once, and to stop two
users with the same password sharing a key. Neither applies here: the token is 128 random
bits, so no two accounts collide and no table can be precomputed against a keyspace that
size. A random salt would also have to be stored somewhere the server could see, which buys
nothing and adds a value to lose.

The consequence, stated plainly: **the 310,000 iterations are not what protects you.** The
128 bits of token entropy are. The stretching is there so that a weak token — one someone
transcribed, shortened, or generated with a broken `crypto` — is not instantly cheap to
attack. Do not read it as protection for a guessable secret, because there is no way to
choose one.

## What this does not protect against

Being specific here is the point of the document.

**We serve the code that holds your key.** This is the fundamental limit of any
browser-delivered end-to-end encryption, and no amount of client-side cryptography escapes
it: whoever controls the server controls the JavaScript, and could ship a build that
exfiltrates the key. What the design does is make that the *only* attack — it cannot be done
passively, it cannot be done retroactively to data already stored, and it cannot be done
without shipping evidence to every user's browser.

Three things narrow it further, and none of them close it:

- Every response carries a `Content-Security-Policy` with `default-src 'none'`, no
  `unsafe-inline`, no `unsafe-eval`, and a `connect-src` naming only the two catalogues. A
  malicious build could not quietly post a key to a third-party host without also changing
  the header, which is visible.
- The source is here, and every release is a tagged commit. What is served can be compared
  with what is published.
- The service worker precaches the whole module graph, so an installed app keeps running the
  build it has until an update is fetched and activated.

If this matters to you, the honest answer is to self-host. It is a Cloudflare Worker, a D1
table and a directory of static files; see the README.

**Losing the number loses the data.** There is no recovery, because there is nothing to
recover it from. This is the cost of the rest of it.

**Anyone with the number has everything, forever.** There is no forward secrecy and no way
to revoke. Rotating means creating a new account and re-importing an export.

**Blob size is visible.** The server learns roughly how large a library is, and when it
changes. It does not learn what is in it.

**Access patterns are visible.** IP address, timing and frequency of writes reach
Cloudflare, as they would for any hosted service. What is *not* visible is which screen any
of it was for: every navigation arrives as `/`, `/library`, `/show` and so on, with nothing
in the path or the query to say which show, person, season or episode.

Sharing a link into the app does not reach the server either. The share target is a `POST`,
and the service worker answers it before it can leave the device — see below.

**The catalogues see their own traffic.** TVmaze, and TMDB if you supply a key, learn which
shows that browser asked about — the requests go straight from the browser, so this server
never sees them, but the catalogue does. A TMDB key is yours and is stored inside the
encrypted blob; it never reaches this server.

**Nothing here is audited.** No third party has reviewed the cryptography. It is standard
WebCrypto used in a conventional way, which is the most that can be said for it.

## Server-side hardening

For completeness, what the Worker does:

- Account ids are validated against `/^[a-f0-9]{64}$/` before touching the database.
- All D1 access is through parameterised statements.
- Blobs are type- and length-checked against a shared 900,000-byte ceiling.
- Writes carry the `updated_at` the client last saw; a stale one is refused with 409 and the
  current blob, so two devices merge rather than overwrite.
- New-vault creation is rate-limited to 20 per IP per 24 hours. Updates are unlimited.
- The vault id travels in the `X-Vault-Id` header, never in a URL, so it cannot leak through
  access logs, `Referer` or browser history.
- JSON responses are `no-store`.
- Every response carries `nosniff`, `no-referrer`, a permissions policy, and — on documents —
  the CSP described above.

## Scope

In scope: anything that lets one person read or alter another's vault, anything that gets a
key or account number off a device, and anything that makes the claims in this document
false.

Out of scope: the limits listed under "What this does not protect against", which are
properties of the design rather than defects in it. If you think one of them is worse than
described, that is very much in scope — say so.
