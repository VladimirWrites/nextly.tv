# Backing up the vault database

Written 4 August 2026. Numbers measured that day: **19 vaults, 122 KB of ciphertext, 164 KB of
database**. Everything below is shaped by how small that is — this is not a data-volume problem,
it is a "does anyone ever check" problem.

## The thing that makes this easy

`vaults.blob` is AES-GCM ciphertext encrypted in the browser with a key derived from an account
number the server has never seen. So a backup of it is exactly as unreadable as the database it
came from. A leaked backup is not a breach: it is a pile of ciphertext and a column of SHA-256
hashes.

That removes the usual hardest question — where is it safe to put a copy — and leaves the useful
ones: does a copy exist, is it current, and has anyone ever restored from it.

## The thing that makes it not trivial

`create_log` holds IP addresses. The privacy policy says: *"Entries older than 24 hours are
deleted automatically."*

A backup that includes that table keeps IP addresses for as long as the backup lives, which
makes the policy false and the retention unlawful under the basis it claims (Art. 6(1)(f),
security, with a stated 24-hour window). **Every backup below is `vaults` only.** This is the
single most important line in this document, and it is one flag on the export command.

## What we are protecting against, in order of likelihood

| | how it happens | what covers it |
|---|---|---|
| 1 | A bad migration or a mistaken `DELETE` | Time Travel — already on, nothing to build |
| 2 | Corruption noticed late, after Time Travel's window has passed | Dated exports |
| 3 | The Cloudflare account is lost, suspended, or billing lapses | An off-Cloudflare copy |
| 4 | D1 loses data on its own | Any of the above, if verified |

Row 3 is the one people skip and the one that actually ends projects. A backup living in the
same account as the thing it backs up protects against everything except losing the account.

## Tier 0 — Time Travel (already working, verify only)

D1 keeps a 30-day restore window with no configuration. It exists right now:

```bash
npx wrangler d1 time-travel info nextly-db
```

To restore to a moment before a mistake:

```bash
npx wrangler d1 time-travel restore nextly-db --timestamp 2026-08-04T12:00:00Z
```

**What it does not cover:** anything older than 30 days, and losing the account. Treat it as undo,
not as backup.

**Action:** none, beyond knowing the command exists before the day you need it.

## Tier 1 — dated exports, weekly

```bash
npx wrangler d1 export nextly-db --remote --table vaults --output backups/vaults-$(date +%F).sql
```

`--table vaults` is not optional — see above.

At 122 KB, a weekly export for a year is under 7 MB even uncompressed and with no growth
assumptions. Keep 12 weekly and 12 monthly; that is a rounding error in storage and covers
"we noticed in March that something went wrong in January".

**Where it goes** matters more than how often it runs:

- **R2**, via a scheduled Worker or a GitHub Action. Inside Cloudflare, so it covers rows 1, 2 and
  4 and not row 3.
- **A private GitHub repository.** Free, versioned, off Cloudflare. Private, not public — the
  contents are unreadable, but publishing other people's records because they happen to be
  encrypted is a bad habit to acquire, and one key-derivation flaw away from being a real
  mistake.
- **A local disk**, which is only a backup if the machine is itself backed up.

**Recommended:** a GitHub Action on a weekly schedule, exporting to a private repository. It is
off-Cloudflare by construction, so it collapses Tier 1 and Tier 2 into one job, and it needs one
Cloudflare API token with D1 read scope rather than a Worker with a new binding.

## Tier 2 — off-Cloudflare, monthly

If Tier 1 lands in R2 rather than in a private repo, this stays a separate step: once a month,
pull a copy somewhere Cloudflare cannot reach. Otherwise it is already done.

## Tier 3 — the part everyone skips

**A backup nobody has restored is a hope, not a backup.**

We now have the perfect place to prove it, built for a different reason: `nextly-db-preview`.

```bash
npx wrangler d1 execute nextly-db-preview --remote --command "DELETE FROM vaults;"
npx wrangler d1 execute nextly-db-preview --remote --file backups/vaults-2026-08-04.sql
```

Then open the preview app with a known account number and check the library appears. That last
step is the whole exercise: it tests the export, the restore, *and* that the ciphertext still
decrypts with a real key — which no `SELECT COUNT(*)` can tell you.

**Do this once now, and once after any change to the schema or the crypto.** Twice a year
otherwise. Put it in the calendar, because nothing else will remind you.

## What this changes outside the database

Two documents become inaccurate the moment backups exist, and both are user-facing promises.

**Privacy policy.** It currently describes what is stored on the server and does not mention
backups. It should say that encrypted copies are kept, for how long, and that they are as
unreadable as the live database. Retention is the substantive part: pick a number — 90 days is
defensible — and honour it, because a deletion request that leaves the blob in a backup for a
year is not a deletion.

**Terms.** They say *"We do not guarantee backups"*, which stays true and should stay: an
operational backup is insurance for the operator, not a promise to the user. The export button
remains the user's own backup, and remains the honest answer. Do not upgrade that sentence into
a guarantee just because a cron job exists.

**Deletion.** `DELETE FROM vaults` on request removes the live row and not the copies. Either
state the backup retention window in the policy and let copies age out, or run deletions against
the newest export too. The first is normal practice and far less error-prone.

## What I would not do

- **Back up `create_log`.** Covered above; it is the one real hazard here.
- **Encrypt the backups.** They are already ciphertext. A second key is another thing to lose,
  and losing it turns a backup into noise.
- **Back up hourly.** At 102 writes a day, the difference between an hourly and a weekly copy is
  a handful of rows, and every one of those users still holds their own local copy and their own
  export. Frequency is not the weak link here; verification is.
- **Automate restores.** Restoring is rare, consequential, and worth doing with a person watching.

## Suggested order

1. Run the Tier 3 drill by hand today, with one manual export. It tells you whether any of this
   works before you automate a thing.
2. Add the weekly GitHub Action to a private repo.
3. Update the privacy policy with backup retention, and pick the number first.
4. Diarise the restore drill.
